// Approved 2026 importer — Mominul dataset ONLY, into the quarantined
// WorldCup2026* tables. Safety model:
//
//   - DRY-RUN is the default and NEVER touches the database (not even reads);
//     it validates the policy + finalized pack and reports the plan.
//   - WRITE mode requires CONFIRM_2026_MOMINUL_IMPORT="true", and additionally
//     --confirm-production when NODE_ENV=production.
//   - Idempotent: every entity upserts on its stable source id (or compound
//     source key), so re-runs converge instead of duplicating. Nothing outside
//     the WorldCup2026* tables is ever written, and nothing is deleted.
//   - Entity rows are written sequentially inside short, independent chunks.
//     No transaction spans phases, so a partial run can safely be retried.
//   - Every run in write mode is recorded as a WorldCup2026ImportBatch row.
//
// The PrismaClient is passed in (null in dry-run) so tsx scripts construct it
// and unit tests can assert dry-run performs zero client calls.

import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import {
  loadMominulApprovedPack,
  validateMominulApprovedPack,
  type MominulApprovedPack,
} from "./mominulApprovedPack";
import { loadMominulImportPolicy } from "./mominulImportPolicy";
import { MOMINUL_SOURCE_ID } from "./sourceRegistry";

export type MominulImportGate =
  | "POLICY_INVALID"
  | "PACK_MISSING"
  | "PACK_INVALID"
  | "CONFIG_INVALID"
  | "CONFIRM_ENV_MISSING"
  | "PRODUCTION_FLAG_MISSING";

const ENTITY_ORDER = [
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
] as const;

type MominulEntity = (typeof ENTITY_ORDER)[number];
type EntityCount = {
  planned: number;
  created: number;
  updated: number;
  skipped: number;
};

export type MominulEntityCounts = Record<MominulEntity, EntityCount>;

export type MominulImportResult = {
  mode: "DRY_RUN" | "WRITE";
  ok: boolean;
  refusedBy: MominulImportGate | null;
  sourceId: string;
  batchId: string | null;
  counts: MominulEntityCounts;
  warnings: string[];
  errors: string[];
};

export type MominulImportOptions = {
  dryRun: boolean;
  /** Required in addition to the env confirm when NODE_ENV=production. */
  confirmProduction?: boolean;
  /** Overrides MOMINUL_IMPORT_CHUNK_SIZE for every entity phase. */
  chunkSize?: number;
  /** Overrides MOMINUL_IMPORT_TRANSACTION_TIMEOUT_MS. */
  transactionTimeoutMs?: number;
  /** Test-only override; production defaults to 20 seconds. */
  transactionMaxWaitMs?: number;
  /** Source and environment overrides for tests. */
  packDir?: string;
  policyPath?: string;
  env?: Record<string, string | undefined>;
};

export type ChunkResult = {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

export type PhaseResult = ChunkResult & {
  label: string;
  chunksCompleted: number;
  chunksTotal: number;
};

const DEFAULT_CHUNK_SIZE = 100;
const DEFAULT_LARGE_CHUNK_SIZE = 250;
const DEFAULT_TRANSACTION_MAX_WAIT_MS = 20_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;

function emptyChunkResult(): ChunkResult {
  return { created: 0, updated: 0, skipped: 0, warnings: [] };
}

function emptyCounts(pack: MominulApprovedPack | null): MominulEntityCounts {
  return Object.fromEntries(
    ENTITY_ORDER.map((key) => [
      key,
      {
        planned: pack === null ? 0 : pack[key].length,
        created: 0,
        updated: 0,
        skipped: 0,
      },
    ]),
  ) as MominulEntityCounts;
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError("chunkSize must be a positive integer.");
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

class WriteChunkError extends Error {
  readonly phaseResult: PhaseResult;

  constructor(
    label: string,
    chunkNumber: number,
    chunksTotal: number,
    phaseResult: PhaseResult,
    error: unknown,
  ) {
    const detail = error instanceof Error ? error.message : String(error);
    super(`${label} chunk ${chunkNumber}/${chunksTotal} failed: ${detail}`);
    this.name = "WriteChunkError";
    this.phaseResult = phaseResult;
  }
}

function toDate(day: string | null, time?: string | null): Date | null {
  if (day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock =
    time !== null && time !== undefined && /^\d{2}:\d{2}$/.test(time)
      ? time
      : "00:00";
  return new Date(`${day}T${clock}:00.000Z`);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function positiveInteger(
  optionValue: number | undefined,
  envValue: string | undefined,
  fallback: number,
  label: string,
): number {
  const raw: number | string = optionValue ?? envValue ?? fallback;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${label} must be a positive integer (received ${JSON.stringify(raw)}).`,
    );
  }
  return parsed;
}

function countJson(counts: MominulEntityCounts, field: keyof EntityCount) {
  return asJson(
    Object.fromEntries(ENTITY_ORDER.map((key) => [key, counts[key][field]])),
  );
}

/**
 * The import pipeline. Dry-run resolves the plan WITHOUT a database client;
 * write mode performs ordered, chunked idempotent upserts and records the batch.
 */
export async function runMominulImport(
  prisma: PrismaClient | null,
  options: MominulImportOptions,
): Promise<MominulImportResult> {
  const env = options.env ?? process.env;
  const warnings: string[] = [];
  const errors: string[] = [];
  const result = (
    ok: boolean,
    refusedBy: MominulImportGate | null,
    counts: MominulEntityCounts,
    batchId: string | null = null,
  ): MominulImportResult => ({
    mode: options.dryRun ? "DRY_RUN" : "WRITE",
    ok,
    refusedBy,
    sourceId: MOMINUL_SOURCE_ID,
    batchId,
    counts,
    warnings,
    errors,
  });

  // 1. Source-lock policy.
  const policy = await loadMominulImportPolicy(options.policyPath);
  if (!policy.ok) {
    errors.push(...policy.errors);
    return result(false, "POLICY_INVALID", emptyCounts(null));
  }

  // 2. Finalized approved pack.
  const pack = await loadMominulApprovedPack(options.packDir);
  if (pack === null) {
    errors.push(
      "Approved Mominul pack not found. Run: pnpm data:2026:mominul:approved-pack",
    );
    return result(false, "PACK_MISSING", emptyCounts(null));
  }

  // 3. Hard validation (counts, duplicates, referential integrity, final).
  const validation = validateMominulApprovedPack(pack);
  warnings.push(...validation.warnings);
  if (validation.errors.length > 0) {
    errors.push(...validation.errors);
    return result(false, "PACK_INVALID", emptyCounts(pack));
  }

  const counts = emptyCounts(pack);
  let configuredChunkSize: number;
  let transactionTimeoutMs: number;
  let transactionMaxWaitMs: number;
  try {
    configuredChunkSize = positiveInteger(
      options.chunkSize,
      env.MOMINUL_IMPORT_CHUNK_SIZE,
      DEFAULT_CHUNK_SIZE,
      "Mominul import chunk size",
    );
    transactionTimeoutMs = positiveInteger(
      options.transactionTimeoutMs,
      env.MOMINUL_IMPORT_TRANSACTION_TIMEOUT_MS,
      DEFAULT_TRANSACTION_TIMEOUT_MS,
      "Mominul import transaction timeout",
    );
    transactionMaxWaitMs = positiveInteger(
      options.transactionMaxWaitMs,
      undefined,
      DEFAULT_TRANSACTION_MAX_WAIT_MS,
      "Mominul import transaction max wait",
    );
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return result(false, "CONFIG_INVALID", counts);
  }

  if (options.dryRun) {
    // Plan only — deliberately no database reads or writes in dry-run.
    return result(true, null, counts);
  }

  // 4. Write-mode gates.
  if (env.CONFIRM_2026_MOMINUL_IMPORT !== "true") {
    errors.push(
      'Write mode requires CONFIRM_2026_MOMINUL_IMPORT="true" in the environment.',
    );
    return result(false, "CONFIRM_ENV_MISSING", counts);
  }
  if (env.NODE_ENV === "production" && options.confirmProduction !== true) {
    errors.push(
      "NODE_ENV=production: write mode additionally requires --confirm-production.",
    );
    return result(false, "PRODUCTION_FLAG_MISSING", counts);
  }
  if (prisma === null) {
    errors.push("Write mode needs a database client.");
    return result(false, null, counts);
  }
  const database = prisma;

  const hasChunkOverride =
    options.chunkSize !== undefined ||
    env.MOMINUL_IMPORT_CHUNK_SIZE !== undefined;
  const chunkSizeFor = (entity: MominulEntity): number =>
    hasChunkOverride
      ? configuredChunkSize
      : entity === "events" || entity === "lineups"
        ? DEFAULT_LARGE_CHUNK_SIZE
        : DEFAULT_CHUNK_SIZE;

  // 5. Batch start. Dry-run returns before this point and writes nothing.
  const batch = await prisma.worldCup2026ImportBatch.create({
    data: {
      sourceId: MOMINUL_SOURCE_ID,
      sourceVersion: pack.manifest.generatedAt,
      status: "running",
      dryRun: false,
      filesImported: asJson(pack.manifest.sourceFiles),
      recordsPlanned: countJson(counts, "planned"),
    },
  });

  let activePhase = "batch start";

  const mergePhaseResult = (
    entity: MominulEntity,
    phase: PhaseResult,
  ): void => {
    counts[entity].created += phase.created;
    counts[entity].updated += phase.updated;
    counts[entity].skipped += phase.skipped;
    warnings.push(...phase.warnings);
  };

  const persistBatchProgress = async (): Promise<void> => {
    await prisma.worldCup2026ImportBatch.update({
      where: { id: batch.id },
      data: {
        recordsCreated: countJson(counts, "created"),
        recordsUpdated: countJson(counts, "updated"),
        recordsSkipped: countJson(counts, "skipped"),
        warnings: asJson(warnings),
      },
    });
  };

  /** Each chunk is one short interactive transaction with explicit limits. */
  async function runWriteChunk<T>(
    label: string,
    items: T[],
    chunkSize: number,
    handler: (tx: Prisma.TransactionClient, chunk: T[]) => Promise<ChunkResult>,
  ): Promise<PhaseResult> {
    const chunks = chunkArray(items, chunkSize);
    const phase: PhaseResult = {
      label,
      ...emptyChunkResult(),
      chunksCompleted: 0,
      chunksTotal: chunks.length,
    };

    for (const [index, chunk] of chunks.entries()) {
      try {
        const committed = await database.$transaction(
          async (tx) => handler(tx, chunk),
          {
            maxWait: transactionMaxWaitMs,
            timeout: transactionTimeoutMs,
          },
        );
        phase.created += committed.created;
        phase.updated += committed.updated;
        phase.skipped += committed.skipped;
        phase.warnings.push(...committed.warnings);
        phase.chunksCompleted += 1;
      } catch (error) {
        throw new WriteChunkError(
          label,
          index + 1,
          chunks.length,
          phase,
          error,
        );
      }
    }

    return phase;
  }

  type StableKey = string | number;
  type WriteRow<T> = (
    tx: Prisma.TransactionClient,
    row: T,
  ) => Promise<string | null>;

  const runUpsertPhase = async <T>(
    entity: MominulEntity,
    items: T[],
    existingKeys: Set<StableKey>,
    keyOf: (row: T) => StableKey | null,
    writeRow: WriteRow<T>,
  ): Promise<void> => {
    activePhase = entity;
    try {
      const phase = await runWriteChunk(
        entity,
        items,
        chunkSizeFor(entity),
        async (tx, chunk) => {
          const committed = emptyChunkResult();
          // Sequential writes keep connection pressure predictable and avoid
          // an unbounded Promise.all inside an interactive transaction.
          for (const row of chunk) {
            const key = keyOf(row);
            if (key === null) {
              committed.skipped += 1;
              committed.warnings.push(
                `${entity}: skipped row without a stable key.`,
              );
              continue;
            }

            const skipReason = await writeRow(tx, row);
            if (skipReason !== null) {
              committed.skipped += 1;
              committed.warnings.push(skipReason);
              continue;
            }

            if (existingKeys.has(key)) committed.updated += 1;
            else committed.created += 1;
          }
          return committed;
        },
      );
      mergePhaseResult(entity, phase);
      await persistBatchProgress();
    } catch (error) {
      if (error instanceof WriteChunkError) {
        // Only prior chunks are included. The failing chunk rolled back.
        mergePhaseResult(entity, error.phaseResult);
      }
      throw error;
    }
  };

  try {
    // 6. Stages.
    activePhase = "stages";
    const existingStages = new Set<StableKey>(
      (
        await prisma.worldCup2026Stage.findMany({
          select: { sourceStageId: true },
        })
      ).flatMap((row) =>
        row.sourceStageId === null ? [] : [row.sourceStageId],
      ),
    );
    await runUpsertPhase(
      "stages",
      pack.stages,
      existingStages,
      (row) => row.sourceStageId,
      async (tx, row) => {
        await tx.worldCup2026Stage.upsert({
          where: { sourceStageId: row.sourceStageId },
          create: {
            sourceStageId: row.sourceStageId,
            name: row.name,
            slug: row.slug,
            isKnockout: row.isKnockout,
            sortOrder: row.sortOrder,
            sourceId: MOMINUL_SOURCE_ID,
            raw: asJson(row),
          },
          update: {
            name: row.name,
            slug: row.slug,
            isKnockout: row.isKnockout,
            sortOrder: row.sortOrder,
            sourceId: MOMINUL_SOURCE_ID,
            raw: asJson(row),
          },
        });
        return null;
      },
    );

    // 7. Teams.
    activePhase = "teams";
    const existingTeams = new Set<StableKey>(
      (
        await prisma.worldCup2026Team.findMany({
          select: { sourceTeamId: true },
        })
      ).flatMap((row) => (row.sourceTeamId === null ? [] : [row.sourceTeamId])),
    );
    await runUpsertPhase(
      "teams",
      pack.teams,
      existingTeams,
      (row) => row.sourceTeamId,
      async (tx, row) => {
        const data = {
          name: row.name,
          slug: row.slug,
          fifaCode: row.fifaCode,
          flagCode: row.flagCode,
          groupLetter: row.groupLetter,
          confederation: row.confederation,
          fifaRanking: row.fifaRanking,
          eloRating: row.eloRating,
          managerName: row.managerName,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026Team.upsert({
          where: { sourceTeamId: row.sourceTeamId },
          create: { sourceTeamId: row.sourceTeamId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 8. Venues.
    activePhase = "venues";
    const existingVenues = new Set<StableKey>(
      (
        await prisma.worldCup2026Venue.findMany({
          select: { sourceVenueId: true },
        })
      ).flatMap((row) =>
        row.sourceVenueId === null ? [] : [row.sourceVenueId],
      ),
    );
    await runUpsertPhase(
      "venues",
      pack.venues,
      existingVenues,
      (row) => row.sourceVenueId,
      async (tx, row) => {
        const data = {
          name: row.name,
          slug: row.slug,
          stadiumName: row.stadiumName,
          city: row.city,
          country: row.country,
          capacity: row.capacity,
          latitude: row.latitude,
          longitude: row.longitude,
          elevationMeters: row.elevationMeters,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026Venue.upsert({
          where: { sourceVenueId: row.sourceVenueId },
          create: { sourceVenueId: row.sourceVenueId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 9. Referees.
    activePhase = "referees";
    const existingReferees = new Set<StableKey>(
      (
        await prisma.worldCup2026Referee.findMany({
          select: { sourceRefereeId: true },
        })
      ).flatMap((row) =>
        row.sourceRefereeId === null ? [] : [row.sourceRefereeId],
      ),
    );
    await runUpsertPhase(
      "referees",
      pack.referees,
      existingReferees,
      (row) => row.sourceRefereeId,
      async (tx, row) => {
        const data = {
          name: row.name,
          slug: row.slug,
          country: row.country,
          avgCardsPerGame: row.avgCardsPerGame,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026Referee.upsert({
          where: { sourceRefereeId: row.sourceRefereeId },
          create: { sourceRefereeId: row.sourceRefereeId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 10. Refresh dependency lookup maps after the four parent phases.
    activePhase = "refresh lookup maps";
    const stageIdMap = new Map(
      (
        await prisma.worldCup2026Stage.findMany({
          select: { id: true, sourceStageId: true },
        })
      ).flatMap((row) =>
        row.sourceStageId === null
          ? []
          : [[row.sourceStageId, row.id] as const],
      ),
    );
    const teamIdMap = new Map(
      (
        await prisma.worldCup2026Team.findMany({
          select: { id: true, sourceTeamId: true },
        })
      ).flatMap((row) =>
        row.sourceTeamId === null ? [] : [[row.sourceTeamId, row.id] as const],
      ),
    );
    const venueIdMap = new Map(
      (
        await prisma.worldCup2026Venue.findMany({
          select: { id: true, sourceVenueId: true },
        })
      ).flatMap((row) =>
        row.sourceVenueId === null
          ? []
          : [[row.sourceVenueId, row.id] as const],
      ),
    );
    const refereeIdMap = new Map(
      (
        await prisma.worldCup2026Referee.findMany({
          select: { id: true, sourceRefereeId: true },
        })
      ).flatMap((row) =>
        row.sourceRefereeId === null
          ? []
          : [[row.sourceRefereeId, row.id] as const],
      ),
    );

    // 11. Matches.
    activePhase = "matches";
    const existingMatches = new Set<StableKey>(
      (
        await prisma.worldCup2026Match.findMany({
          select: { sourceMatchId: true },
        })
      ).map((row) => row.sourceMatchId),
    );
    await runUpsertPhase(
      "matches",
      pack.matches,
      existingMatches,
      (row) => row.sourceMatchId,
      async (tx, row) => {
        const missing = [
          row.sourceStageId !== null && !stageIdMap.has(row.sourceStageId)
            ? `stage ${row.sourceStageId}`
            : null,
          row.sourceVenueId !== null && !venueIdMap.has(row.sourceVenueId)
            ? `venue ${row.sourceVenueId}`
            : null,
          row.sourceHomeTeamId !== null && !teamIdMap.has(row.sourceHomeTeamId)
            ? `home team ${row.sourceHomeTeamId}`
            : null,
          row.sourceAwayTeamId !== null && !teamIdMap.has(row.sourceAwayTeamId)
            ? `away team ${row.sourceAwayTeamId}`
            : null,
          row.sourceRefereeId !== null && !refereeIdMap.has(row.sourceRefereeId)
            ? `referee ${row.sourceRefereeId}`
            : null,
        ].filter((value): value is string => value !== null);
        if (missing.length > 0) {
          return `matches: skipped source match ${row.sourceMatchId}; missing ${missing.join(", ")}.`;
        }

        const data = {
          matchNumber: row.matchNumber,
          date: toDate(row.date, row.kickoffTimeUtc),
          kickoffTimeUtc: row.kickoffTimeUtc,
          stageId:
            row.sourceStageId === null
              ? null
              : (stageIdMap.get(row.sourceStageId) ?? null),
          stageName: row.stageName,
          groupLetter: row.groupLetter,
          venueId:
            row.sourceVenueId === null
              ? null
              : (venueIdMap.get(row.sourceVenueId) ?? null),
          homeTeamId:
            row.sourceHomeTeamId === null
              ? null
              : (teamIdMap.get(row.sourceHomeTeamId) ?? null),
          awayTeamId:
            row.sourceAwayTeamId === null
              ? null
              : (teamIdMap.get(row.sourceAwayTeamId) ?? null),
          homeTeamName: row.homeTeamName,
          awayTeamName: row.awayTeamName,
          homeTeamCode: row.homeTeamCode,
          awayTeamCode: row.awayTeamCode,
          homeScore: row.homeScore,
          awayScore: row.awayScore,
          homePenaltyScore: row.homePenaltyScore,
          awayPenaltyScore: row.awayPenaltyScore,
          resultType: row.resultType,
          status: row.status,
          winnerTeamName: row.winnerTeamName,
          winnerTeamCode: row.winnerTeamCode,
          homeXg: row.homeXg,
          awayXg: row.awayXg,
          goalkeeperHome: row.goalkeeperHome,
          goalkeeperAway: row.goalkeeperAway,
          playerOfTheMatch: row.playerOfTheMatch,
          refereeId:
            row.sourceRefereeId === null
              ? null
              : (refereeIdMap.get(row.sourceRefereeId) ?? null),
          refereeName: row.refereeName,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026Match.upsert({
          where: { sourceMatchId: row.sourceMatchId },
          create: { sourceMatchId: row.sourceMatchId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 12. Refresh the match lookup before child phases.
    activePhase = "refresh match map";
    const matchIdMap = new Map(
      (
        await prisma.worldCup2026Match.findMany({
          select: { id: true, sourceMatchId: true },
        })
      ).map((row) => [row.sourceMatchId, row.id] as const),
    );

    // 13. Players.
    activePhase = "players";
    const existingPlayers = new Set<StableKey>(
      (
        await prisma.worldCup2026Player.findMany({
          select: { sourcePlayerId: true },
        })
      ).map((row) => row.sourcePlayerId),
    );
    await runUpsertPhase(
      "players",
      pack.players,
      existingPlayers,
      (row) => row.sourcePlayerId,
      async (tx, row) => {
        if (row.sourceTeamId !== null && !teamIdMap.has(row.sourceTeamId)) {
          return `players: skipped source player ${row.sourcePlayerId}; missing team ${row.sourceTeamId}.`;
        }
        const data = {
          teamId:
            row.sourceTeamId === null
              ? null
              : (teamIdMap.get(row.sourceTeamId) ?? null),
          teamName: row.teamName,
          teamCode: row.teamCode,
          name: row.name,
          slug: row.slug,
          position: row.position,
          club: row.club,
          marketValueEur: row.marketValueEur,
          caps: row.caps,
          dateOfBirth: toDate(row.dateOfBirth),
          heightCm: row.heightCm,
          internationalGoals: row.internationalGoals,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026Player.upsert({
          where: { sourcePlayerId: row.sourcePlayerId },
          create: { sourcePlayerId: row.sourcePlayerId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 14. Refresh the player lookup before child phases.
    activePhase = "refresh player map";
    const playerIdMap = new Map(
      (
        await prisma.worldCup2026Player.findMany({
          select: { id: true, sourcePlayerId: true },
        })
      ).map((row) => [row.sourcePlayerId, row.id] as const),
    );

    // 15. Events.
    activePhase = "events";
    const existingEvents = new Set<StableKey>(
      (
        await prisma.worldCup2026MatchEvent.findMany({
          select: { sourceEventId: true },
        })
      ).flatMap((row) =>
        row.sourceEventId === null ? [] : [row.sourceEventId],
      ),
    );
    await runUpsertPhase(
      "events",
      pack.events,
      existingEvents,
      (row) => row.sourceEventId,
      async (tx, row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        const missing = [
          matchId === undefined ? `match ${row.sourceMatchId}` : null,
          row.sourcePlayerId !== null && !playerIdMap.has(row.sourcePlayerId)
            ? `player ${row.sourcePlayerId}`
            : null,
          row.sourceTeamId !== null && !teamIdMap.has(row.sourceTeamId)
            ? `team ${row.sourceTeamId}`
            : null,
        ].filter((value): value is string => value !== null);
        if (matchId === undefined || missing.length > 0) {
          return `events: skipped source event ${row.sourceEventId}; missing ${missing.join(", ")}.`;
        }
        const data = {
          matchId,
          playerId:
            row.sourcePlayerId === null
              ? null
              : (playerIdMap.get(row.sourcePlayerId) ?? null),
          teamId:
            row.sourceTeamId === null
              ? null
              : (teamIdMap.get(row.sourceTeamId) ?? null),
          teamCode: row.teamCode,
          teamName: row.teamName,
          minute: row.minute,
          stoppageMinute: row.stoppageMinute,
          eventType: row.eventType,
          playerName: row.playerName,
          cardType: row.cardType,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026MatchEvent.upsert({
          where: { sourceEventId: row.sourceEventId },
          create: { sourceEventId: row.sourceEventId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 16. Lineups.
    activePhase = "lineups";
    const existingLineups = new Set<StableKey>(
      (
        await prisma.worldCup2026Lineup.findMany({
          select: { sourceLineupId: true },
        })
      ).flatMap((row) =>
        row.sourceLineupId === null ? [] : [row.sourceLineupId],
      ),
    );
    await runUpsertPhase(
      "lineups",
      pack.lineups,
      existingLineups,
      (row) => row.sourceLineupId,
      async (tx, row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        const missing = [
          matchId === undefined ? `match ${row.sourceMatchId}` : null,
          row.sourcePlayerId !== null && !playerIdMap.has(row.sourcePlayerId)
            ? `player ${row.sourcePlayerId}`
            : null,
          row.sourceTeamId !== null && !teamIdMap.has(row.sourceTeamId)
            ? `team ${row.sourceTeamId}`
            : null,
        ].filter((value): value is string => value !== null);
        if (matchId === undefined || missing.length > 0) {
          return `lineups: skipped source lineup ${row.sourceLineupId}; missing ${missing.join(", ")}.`;
        }
        const data = {
          matchId,
          playerId:
            row.sourcePlayerId === null
              ? null
              : (playerIdMap.get(row.sourcePlayerId) ?? null),
          teamId:
            row.sourceTeamId === null
              ? null
              : (teamIdMap.get(row.sourceTeamId) ?? null),
          teamCode: row.teamCode,
          teamName: row.teamName,
          playerName: row.playerName,
          isStarting: row.isStarting,
          tacticalPosition: row.tacticalPosition,
          minutesPlayed: row.minutesPlayed,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026Lineup.upsert({
          where: { sourceLineupId: row.sourceLineupId },
          create: { sourceLineupId: row.sourceLineupId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 17. Player stats (one stable row per player).
    activePhase = "playerStats";
    const existingStatPlayerIds = new Set<StableKey>(
      (
        await prisma.worldCup2026PlayerStat.findMany({
          select: { playerId: true },
        })
      ).map((row) => row.playerId),
    );
    await runUpsertPhase(
      "playerStats",
      pack.playerStats,
      existingStatPlayerIds,
      (row) => playerIdMap.get(row.sourcePlayerId) ?? null,
      async (tx, row) => {
        const playerId = playerIdMap.get(row.sourcePlayerId);
        const missing = [
          playerId === undefined ? `player ${row.sourcePlayerId}` : null,
          row.sourceTeamId !== null && !teamIdMap.has(row.sourceTeamId)
            ? `team ${row.sourceTeamId}`
            : null,
        ].filter((value): value is string => value !== null);
        if (playerId === undefined || missing.length > 0) {
          return `playerStats: skipped source player ${row.sourcePlayerId}; missing ${missing.join(", ")}.`;
        }
        const data = {
          teamId:
            row.sourceTeamId === null
              ? null
              : (teamIdMap.get(row.sourceTeamId) ?? null),
          playerName: row.playerName,
          teamCode: row.teamCode,
          matchesPlayed: row.matchesPlayed,
          matchesStarted: row.matchesStarted,
          minutesPlayed: row.minutesPlayed,
          goals: row.goals,
          assists: row.assists,
          yellowCards: row.yellowCards,
          redCards: row.redCards,
          penaltiesScored: row.penaltiesScored,
          ownGoals: row.ownGoals,
          saves: row.saves,
          goalsConceded: row.goalsConceded,
          cleanSheets: row.cleanSheets,
          averageRating: row.averageRating,
          dataSource: row.dataSource,
          lastVerified: row.lastVerified,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026PlayerStat.upsert({
          where: { playerId },
          create: { playerId, ...data },
          update: data,
        });
        return null;
      },
    );

    // 18. Team match stats (stable compound key: matchId + teamCode).
    activePhase = "teamMatchStats";
    const existingTeamStats = new Set<StableKey>(
      (
        await prisma.worldCup2026TeamMatchStat.findMany({
          select: { matchId: true, teamCode: true },
        })
      ).map((row) => `${row.matchId}::${row.teamCode ?? ""}`),
    );
    await runUpsertPhase(
      "teamMatchStats",
      pack.teamMatchStats,
      existingTeamStats,
      (row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        if (matchId === undefined || row.teamCode === null) return null;
        return `${matchId}::${row.teamCode}`;
      },
      async (tx, row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        const teamId = teamIdMap.get(row.sourceTeamId);
        const missing = [
          matchId === undefined ? `match ${row.sourceMatchId}` : null,
          teamId === undefined ? `team ${row.sourceTeamId}` : null,
          row.teamCode === null ? "team code" : null,
        ].filter((value): value is string => value !== null);
        if (
          matchId === undefined ||
          teamId === undefined ||
          row.teamCode === null
        ) {
          return `teamMatchStats: skipped source match ${row.sourceMatchId}/team ${row.sourceTeamId}; missing ${missing.join(", ")}.`;
        }
        const data = {
          teamId,
          teamName: row.teamName,
          possessionPct: row.possessionPct,
          totalShots: row.totalShots,
          shotsOnTarget: row.shotsOnTarget,
          corners: row.corners,
          fouls: row.fouls,
          offsides: row.offsides,
          saves: row.saves,
          dataSource: row.dataSource,
          lastUpdated: row.lastUpdated,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        await tx.worldCup2026TeamMatchStat.upsert({
          where: { matchId_teamCode: { matchId, teamCode: row.teamCode } },
          create: { matchId, teamCode: row.teamCode, ...data },
          update: data,
        });
        return null;
      },
    );

    // 19. Mark the batch complete after every phase has committed.
    activePhase = "mark import batch completed";
    await prisma.worldCup2026ImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        recordsCreated: countJson(counts, "created"),
        recordsUpdated: countJson(counts, "updated"),
        recordsSkipped: countJson(counts, "skipped"),
        warnings: asJson(warnings),
      },
    });
    return result(true, null, counts, batch.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Import failed in ${activePhase}: ${message}`);
    await prisma.worldCup2026ImportBatch
      .update({
        where: { id: batch.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          recordsCreated: countJson(counts, "created"),
          recordsUpdated: countJson(counts, "updated"),
          recordsSkipped: countJson(counts, "skipped"),
          warnings: asJson(warnings),
          errors: asJson(errors),
        },
      })
      .catch(() => undefined);
    return result(false, null, counts, batch.id);
  }
}
