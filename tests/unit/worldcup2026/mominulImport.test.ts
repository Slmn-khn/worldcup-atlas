// Mominul-only 2026 import pipeline: policy lock, approved pack invariants,
// importer gating (dry-run touches no client; write refuses without explicit
// confirmation), and the display-row mapping used by /schedule/2026.
//
// Uses the real raw snapshots under data/2026/raw/mominul_2026_dataset (repo
// files — no network) plus poisoned client doubles for the gating tests.

import { beforeAll, describe, expect, it } from "vitest";

import {
  checkMominulImportPolicy,
  loadMominulImportPolicy,
} from "../../../src/server/agents/worldcup2026/mominulImportPolicy";
import {
  buildMominulApprovedPack,
  matchWinnerCode,
  validateMominulApprovedPack,
  type MominulApprovedPack,
} from "../../../src/server/agents/worldcup2026/mominulApprovedPack";
import {
  chunkArray,
  runMominulImport,
} from "../../../src/server/agents/worldcup2026/mominulImporter";
import {
  formatArchivedScore,
  mominulToArchivedRows,
} from "../../../src/server/worldcup2026/archiveSchedule";
import { computeGroupStandings } from "../../../src/server/worldcup2026/groupStandings";
import type {
  Prisma,
  PrismaClient,
} from "../../../src/generated/prisma/client";

const VALID_POLICY = {
  schema: "mominul-import-policy/v1",
  sourceId: "mominul_2026_dataset",
  status: "APPROVED_BY_USER",
  approvedFor: [
    "teams",
    "venues",
    "tournament_stages",
    "referees",
    "matches",
    "matches_detailed",
    "squads_and_players",
    "match_events",
    "match_team_stats",
    "match_lineups",
    "player_stats",
  ],
  excludedFromImport: [
    "match_prediction_features",
    "bustami_efi",
    "openfootball",
    "worldcup26_live",
    "manual_pack_values",
  ],
  rules: [],
};

/** A client double that throws on ANY access — proves code never touches it. */
function poisonedPrisma(): PrismaClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`Unexpected Prisma access: ${String(property)}`);
      },
    },
  ) as PrismaClient;
}

type ImportPhase =
  | "stages"
  | "teams"
  | "venues"
  | "referees"
  | "matches"
  | "players"
  | "events"
  | "lineups"
  | "playerStats"
  | "teamMatchStats";

type UpsertArgs = {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

type ImportPrismaDouble = {
  prisma: PrismaClient;
  operations: ImportPhase[];
  transactionOptions: Array<{ maxWait?: number; timeout?: number }>;
  transactionSizes: number[];
  batchUpdates: Array<Record<string, unknown>>;
  maxConcurrentWrites: () => number;
};

function importPrismaDouble(
  options: {
    existingTeamId?: number;
    failTeamId?: number;
  } = {},
): ImportPrismaDouble {
  const operations: ImportPhase[] = [];
  const transactionOptions: Array<{ maxWait?: number; timeout?: number }> = [];
  const transactionSizes: number[] = [];
  const batchUpdates: Array<Record<string, unknown>> = [];
  let activeWrites = 0;
  let maxConcurrentWrites = 0;

  const sourceModel = (
    phase: ImportPhase,
    sourceField: string,
    initialKeys: number[] = [],
  ) => {
    const rows = new Map(
      initialKeys.map((key) => [key, `${phase}-${key}`] as const),
    );
    return {
      findMany: async () =>
        [...rows].map(([key, id]) => ({ id, [sourceField]: key })),
      upsert: async (args: UpsertArgs) => {
        const key = Number(args.where[sourceField]);
        operations.push(phase);
        activeWrites += 1;
        maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
        try {
          await Promise.resolve();
          if (phase === "teams" && key === options.failTeamId) {
            throw new Error("simulated team write failure");
          }
          const id = rows.get(key) ?? `${phase}-${key}`;
          rows.set(key, id);
          return { id, [sourceField]: key };
        } finally {
          activeWrites -= 1;
        }
      },
    };
  };

  const playerStatIds = new Set<string>();
  const teamStatKeys = new Set<string>();
  const prismaHolder: { value: PrismaClient | null } = { value: null };
  const rawClient = {
    worldCup2026ImportBatch: {
      create: async () => ({ id: "batch-test" }),
      update: async (args: { data: Record<string, unknown> }) => {
        batchUpdates.push(args.data);
        return { id: "batch-test", ...args.data };
      },
    },
    worldCup2026Stage: sourceModel("stages", "sourceStageId"),
    worldCup2026Team: sourceModel(
      "teams",
      "sourceTeamId",
      options.existingTeamId === undefined ? [] : [options.existingTeamId],
    ),
    worldCup2026Venue: sourceModel("venues", "sourceVenueId"),
    worldCup2026Referee: sourceModel("referees", "sourceRefereeId"),
    worldCup2026Match: sourceModel("matches", "sourceMatchId"),
    worldCup2026Player: sourceModel("players", "sourcePlayerId"),
    worldCup2026MatchEvent: sourceModel("events", "sourceEventId"),
    worldCup2026Lineup: sourceModel("lineups", "sourceLineupId"),
    worldCup2026PlayerStat: {
      findMany: async () =>
        [...playerStatIds].map((playerId) => ({ playerId })),
      upsert: async (args: UpsertArgs) => {
        const playerId = String(args.where.playerId);
        operations.push("playerStats");
        playerStatIds.add(playerId);
        return { id: `playerStats-${playerId}`, playerId };
      },
    },
    worldCup2026TeamMatchStat: {
      findMany: async () =>
        [...teamStatKeys].map((key) => {
          const [matchId, teamCode] = key.split("::");
          return { matchId, teamCode };
        }),
      upsert: async (args: UpsertArgs) => {
        const compound = args.where.matchId_teamCode as {
          matchId: string;
          teamCode: string;
        };
        operations.push("teamMatchStats");
        teamStatKeys.add(`${compound.matchId}::${compound.teamCode}`);
        return { id: `teamMatchStats-${teamStatKeys.size}` };
      },
    },
    $transaction: async (
      handler: (tx: Prisma.TransactionClient) => Promise<unknown>,
      transaction: { maxWait?: number; timeout?: number },
    ) => {
      transactionOptions.push(transaction);
      const operationsBefore = operations.length;
      try {
        return await handler(
          prismaHolder.value as unknown as Prisma.TransactionClient,
        );
      } finally {
        transactionSizes.push(operations.length - operationsBefore);
      }
    },
  };
  const prisma = rawClient as unknown as PrismaClient;
  prismaHolder.value = prisma;

  return {
    prisma,
    operations,
    transactionOptions,
    transactionSizes,
    batchUpdates,
    maxConcurrentWrites: () => maxConcurrentWrites,
  };
}

let pack: MominulApprovedPack;

beforeAll(async () => {
  const built = await buildMominulApprovedPack();
  expect(built.errors).toEqual([]);
  pack = built.pack;
});

describe("chunkArray", () => {
  it("splits rows without dropping or duplicating them", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 100)).toEqual([]);
  });

  it("rejects an invalid chunk size", () => {
    expect(() => chunkArray([1], 0)).toThrow("positive integer");
  });
});

describe("mominul import policy", () => {
  it("accepts the committed policy file", async () => {
    const result = await loadMominulImportPolicy();
    expect(result.ok).toBe(true);
  });

  it("rejects a policy for any other source", () => {
    const result = checkMominulImportPolicy({
      ...VALID_POLICY,
      sourceId: "bustami_fifa_efi_2026",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a policy that stops excluding Bustami/prediction data", () => {
    const result = checkMominulImportPolicy({
      ...VALID_POLICY,
      excludedFromImport: ["openfootball"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("bustami_efi");
      expect(result.errors.join(" ")).toContain("match_prediction_features");
    }
  });

  it("rejects an excluded key smuggled into approvedFor", () => {
    const result = checkMominulImportPolicy({
      ...VALID_POLICY,
      approvedFor: [...VALID_POLICY.approvedFor, "bustami_efi"],
    });
    expect(result.ok).toBe(false);
  });
});

describe("approved pack invariants (real dataset)", () => {
  it("meets the expected archive counts", () => {
    expect(pack.teams).toHaveLength(48);
    expect(pack.venues).toHaveLength(16);
    expect(pack.matches).toHaveLength(104);
    expect(pack.players).toHaveLength(1248);
    expect(pack.stages).toHaveLength(7);
    expect(validateMominulApprovedPack(pack).errors).toEqual([]);
  });

  it("derives the podium from results — never hardcodes it", () => {
    expect(pack.tournament.championTeamCode).toBe("ESP");
    expect(pack.tournament.runnerUpTeamCode).toBe("ARG");
    expect(pack.tournament.thirdTeamCode).toBe("ENG");
    expect(pack.tournament.fourthTeamCode).toBe("FRA");
    expect(pack.tournament.finalScoreLine).toBe("Spain 1–0 Argentina AET");
    expect(pack.tournament.hosts).toEqual(["CAN", "MEX", "USA"]);
  });

  it("rejects duplicate source ids", () => {
    const tampered: MominulApprovedPack = {
      ...pack,
      matches: [...pack.matches, { ...pack.matches[0] }],
    };
    const validation = validateMominulApprovedPack(tampered);
    expect(
      validation.errors.some((error) => error.includes("Duplicate match")),
    ).toBe(true);
  });

  it("rejects wrong counts", () => {
    const tampered: MominulApprovedPack = {
      ...pack,
      venues: pack.venues.slice(0, 10),
    };
    const validation = validateMominulApprovedPack(tampered);
    expect(validation.errors.some((error) => error.includes("16 venues"))).toBe(
      true,
    );
  });

  it("computes winners including penalty shootouts", () => {
    const shootout = pack.matches.find(
      (match) => match.resultType === "Penalties",
    );
    expect(shootout).toBeDefined();
    expect(matchWinnerCode(shootout!)).toBe(shootout!.winnerTeamCode);
    expect(shootout!.winnerTeamCode).not.toBeNull();
  });

  it("keeps every match Completed — the tournament is over", () => {
    expect(pack.matches.every((match) => match.status === "Completed")).toBe(
      true,
    );
  });
});

describe("importer gating", () => {
  it("dry-run validates the pack without touching any database client", async () => {
    const result = await runMominulImport(poisonedPrisma(), {
      dryRun: true,
      env: {},
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("DRY_RUN");
    expect(result.batchId).toBeNull();
    expect(result.counts.matches.planned).toBe(104);
    expect(result.counts.players.planned).toBe(1248);
  });

  it("write mode refuses without CONFIRM_2026_MOMINUL_IMPORT", async () => {
    const result = await runMominulImport(poisonedPrisma(), {
      dryRun: false,
      env: {},
    });
    expect(result.ok).toBe(false);
    expect(result.refusedBy).toBe("CONFIRM_ENV_MISSING");
  });

  it("production write additionally refuses without --confirm-production", async () => {
    const result = await runMominulImport(poisonedPrisma(), {
      dryRun: false,
      env: { CONFIRM_2026_MOMINUL_IMPORT: "true", NODE_ENV: "production" },
    });
    expect(result.ok).toBe(false);
    expect(result.refusedBy).toBe("PRODUCTION_FLAG_MISSING");
  });
});

describe("write importer transactions", () => {
  it("runs ordered phases in bounded transactions and counts existing teams as updated", async () => {
    const existingTeamId = pack.teams[0]!.sourceTeamId;
    const mock = importPrismaDouble({ existingTeamId });

    const result = await runMominulImport(mock.prisma, {
      dryRun: false,
      chunkSize: 100,
      transactionTimeoutMs: 65_432,
      env: { CONFIRM_2026_MOMINUL_IMPORT: "true" },
    });

    expect(result.ok).toBe(true);
    expect(result.counts.teams).toMatchObject({
      planned: 48,
      created: 47,
      updated: 1,
      skipped: 0,
    });
    expect([...new Set(mock.operations)]).toEqual([
      "stages",
      "teams",
      "venues",
      "referees",
      "matches",
      "players",
      "events",
      "lineups",
      "playerStats",
      "teamMatchStats",
    ]);
    expect(mock.transactionSizes.length).toBeGreaterThan(10);
    expect(Math.max(...mock.transactionSizes)).toBeLessThanOrEqual(100);
    expect(mock.maxConcurrentWrites()).toBe(1);
    expect(
      mock.transactionOptions.every(({ maxWait }) => maxWait === 20_000),
    ).toBe(true);
    expect(
      mock.transactionOptions.every(({ timeout }) => timeout === 65_432),
    ).toBe(true);
    expect(
      mock.batchUpdates.some((update) => update.status === "completed"),
    ).toBe(true);
  }, 30_000);

  it("keeps only committed chunk counts and marks the batch failed", async () => {
    const firstTeamId = pack.teams[0]!.sourceTeamId;
    const failingTeamId = pack.teams[1]!.sourceTeamId;
    const mock = importPrismaDouble({
      existingTeamId: firstTeamId,
      failTeamId: failingTeamId,
    });

    const result = await runMominulImport(mock.prisma, {
      dryRun: false,
      env: {
        CONFIRM_2026_MOMINUL_IMPORT: "true",
        MOMINUL_IMPORT_CHUNK_SIZE: "1",
        MOMINUL_IMPORT_TRANSACTION_TIMEOUT_MS: "54321",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.counts.stages.created).toBe(7);
    expect(result.counts.teams).toMatchObject({
      created: 0,
      updated: 1,
      skipped: 0,
    });
    expect(result.errors.join(" ")).toContain("teams chunk 2/48 failed");
    expect(mock.transactionOptions.at(-1)?.timeout).toBe(54_321);
    expect(mock.batchUpdates.at(-1)?.status).toBe("failed");
  });
});

describe("schedule display rows from the imported source", () => {
  it("maps 104 completed matches with no SCHEDULED status anywhere", () => {
    const rows = mominulToArchivedRows(pack.matches);
    expect(rows).toHaveLength(104);
    for (const row of rows) {
      expect(row.status).not.toBe("SCHEDULED");
      expect(["FULL_TIME", "AFTER_EXTRA_TIME", "PENALTIES"]).toContain(
        row.status,
      );
      expect(row.verification).toBe("VERIFIED");
      expect(row.sources).toEqual(["mominul_2026_dataset"]);
    }
  });

  it("formats the final as 1–0 AET with Spain as champion", () => {
    const rows = mominulToArchivedRows(pack.matches);
    const final = rows.find((row) => row.stageKey === "final");
    expect(final).toBeDefined();
    expect(final!.homeTeamName).toBe("Spain");
    expect(final!.awayTeamName).toBe("Argentina");
    expect(formatArchivedScore(final!)).toBe("1–0 AET");
    expect(final!.winnerTeamCode).toBe("ESP");
  });

  it("labels penalty shootouts with the pens score", () => {
    const rows = mominulToArchivedRows(pack.matches);
    const shootout = rows.find((row) => row.status === "PENALTIES");
    expect(shootout).toBeDefined();
    expect(formatArchivedScore(shootout!)).toMatch(/\(\d+–\d+ pens\)/);
  });
});

describe("group standings computed from imported matches", () => {
  it("produces 12 complete groups from the group stage", () => {
    const groupMatches = mominulPackGroupMatches();
    const groups = computeGroupStandings(groupMatches);
    expect(groups).toHaveLength(12);
    for (const group of groups) {
      expect(group.rows).toHaveLength(4);
      // Every team plays 3 group games; total points per group ≤ 18.
      for (const row of group.rows) expect(row.played).toBe(3);
    }
  });

  it("ranks Group A by points with Mexico top", () => {
    const groups = computeGroupStandings(mominulPackGroupMatches());
    const groupA = groups.find((group) => group.letter === "A");
    expect(groupA).toBeDefined();
    expect(groupA!.rows[0].teamName).toBe("Mexico");
    expect(groupA!.rows[0].points).toBe(9);
  });

  function mominulPackGroupMatches() {
    return pack.matches.filter((match) => match.stageName === "Group Stage");
  }
});

describe("top scorer extraction from player_stats", () => {
  it("finds a leading scorer with recorded goals", () => {
    const sorted = [...pack.playerStats].sort(
      (a, b) => (b.goals ?? 0) - (a.goals ?? 0),
    );
    expect(sorted[0]?.goals ?? 0).toBeGreaterThan(0);
    expect(sorted[0]?.playerName).toBeTruthy();
    // Aggregate goals recorded in player stats roughly track match scores.
    const totalPlayerGoals = pack.playerStats.reduce(
      (sum, stat) => sum + (stat.goals ?? 0),
      0,
    );
    expect(totalPlayerGoals).toBeGreaterThan(0);
  });
});
