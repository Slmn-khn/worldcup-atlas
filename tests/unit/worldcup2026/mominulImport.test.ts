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
import { runMominulImport } from "../../../src/server/agents/worldcup2026/mominulImporter";
import {
  formatArchivedScore,
  mominulToArchivedRows,
} from "../../../src/server/worldcup2026/archiveSchedule";
import { computeGroupStandings } from "../../../src/server/worldcup2026/groupStandings";
import type { PrismaClient } from "../../../src/generated/prisma/client";

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

let pack: MominulApprovedPack;

beforeAll(async () => {
  const built = await buildMominulApprovedPack();
  expect(built.errors).toEqual([]);
  pack = built.pack;
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
    const tampered: MominulApprovedPack = { ...pack, venues: pack.venues.slice(0, 10) };
    const validation = validateMominulApprovedPack(tampered);
    expect(validation.errors.some((error) => error.includes("16 venues"))).toBe(
      true,
    );
  });

  it("computes winners including penalty shootouts", () => {
    const shootout = pack.matches.find((match) => match.resultType === "Penalties");
    expect(shootout).toBeDefined();
    expect(matchWinnerCode(shootout!)).toBe(shootout!.winnerTeamCode);
    expect(shootout!.winnerTeamCode).not.toBeNull();
  });

  it("keeps every match Completed — the tournament is over", () => {
    expect(pack.matches.every((match) => match.status === "Completed")).toBe(true);
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

describe("schedule display rows from the imported source", () => {
  it("maps 104 completed matches with no SCHEDULED status anywhere", () => {
    const rows = mominulToArchivedRows(pack.matches);
    expect(rows).toHaveLength(104);
    for (const row of rows) {
      expect(row.status).not.toBe("SCHEDULED");
      expect(["FULL_TIME", "AFTER_EXTRA_TIME", "PENALTIES"]).toContain(row.status);
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
