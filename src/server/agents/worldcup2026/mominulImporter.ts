// Approved 2026 importer — Mominul dataset ONLY, into the quarantined
// WorldCup2026* tables. Safety model:
//
//   - DRY-RUN is the default and NEVER touches the database (not even reads);
//     it validates the policy + finalized pack and reports the plan.
//   - WRITE mode requires CONFIRM_2026_MOMINUL_IMPORT="true", and additionally
//     --confirm-production when NODE_ENV=production.
//   - Idempotent: every entity upserts on its integer source id (or compound
//     source key), so re-runs converge instead of duplicating. Nothing outside
//     the WorldCup2026* tables is ever written, and nothing is deleted.
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
  | "CONFIRM_ENV_MISSING"
  | "PRODUCTION_FLAG_MISSING";

export type MominulEntityCounts = Record<
  string,
  { planned: number; created: number; updated: number; skipped: number }
>;

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
  /** Overrides for tests. */
  packDir?: string;
  policyPath?: string;
  env?: Record<string, string | undefined>;
};

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

function emptyCounts(pack: MominulApprovedPack | null): MominulEntityCounts {
  const counts: MominulEntityCounts = {};
  for (const key of ENTITY_ORDER) {
    counts[key] = {
      planned: pack === null ? 0 : pack[key].length,
      created: 0,
      updated: 0,
      skipped: 0,
    };
  }
  return counts;
}

function toDate(day: string | null, time?: string | null): Date | null {
  if (day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = time !== null && time !== undefined && /^\d{2}:\d{2}$/.test(time)
    ? time
    : "00:00";
  return new Date(`${day}T${clock}:00.000Z`);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Runs upserts in transaction chunks; returns per-row created flags. */
async function runChunked<T>(
  prisma: PrismaClient,
  rows: T[],
  existingKeys: Set<string | number>,
  keyOf: (row: T) => string | number | null,
  upsertOf: (row: T) => Prisma.PrismaPromise<unknown> | null,
  counts: { created: number; updated: number; skipped: number },
  chunkSize = 100,
): Promise<void> {
  let batch: Prisma.PrismaPromise<unknown>[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const op = upsertOf(row);
    if (key === null || op === null) {
      counts.skipped += 1;
      continue;
    }
    if (existingKeys.has(key)) counts.updated += 1;
    else counts.created += 1;
    batch.push(op);
    if (batch.length >= chunkSize) {
      await prisma.$transaction(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await prisma.$transaction(batch);
}

/**
 * The import pipeline. Dry-run resolves the plan WITHOUT a database client;
 * write mode performs ordered idempotent upserts and records the batch.
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

  // 5. Batch start.
  const batch = await prisma.worldCup2026ImportBatch.create({
    data: {
      sourceId: MOMINUL_SOURCE_ID,
      sourceVersion: pack.manifest.generatedAt,
      status: "running",
      dryRun: false,
      filesImported: asJson(pack.manifest.sourceFiles),
      recordsPlanned: asJson(
        Object.fromEntries(ENTITY_ORDER.map((key) => [key, pack[key].length])),
      ),
    },
  });

  try {
    // 6. Stages.
    const existingStages = new Set(
      (
        await prisma.worldCup2026Stage.findMany({
          select: { sourceStageId: true },
        })
      ).flatMap((row) => (row.sourceStageId === null ? [] : [row.sourceStageId])),
    );
    await runChunked(
      prisma,
      pack.stages,
      existingStages,
      (row) => row.sourceStageId,
      (row) =>
        prisma.worldCup2026Stage.upsert({
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
        }),
      counts.stages,
    );
    const stageIdMap = new Map(
      (
        await prisma.worldCup2026Stage.findMany({
          select: { id: true, sourceStageId: true },
        })
      ).flatMap((row) =>
        row.sourceStageId === null ? [] : [[row.sourceStageId, row.id] as const],
      ),
    );

    // 7. Teams.
    const existingTeams = new Set(
      (
        await prisma.worldCup2026Team.findMany({ select: { sourceTeamId: true } })
      ).flatMap((row) => (row.sourceTeamId === null ? [] : [row.sourceTeamId])),
    );
    await runChunked(
      prisma,
      pack.teams,
      existingTeams,
      (row) => row.sourceTeamId,
      (row) => {
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
        return prisma.worldCup2026Team.upsert({
          where: { sourceTeamId: row.sourceTeamId },
          create: { sourceTeamId: row.sourceTeamId, ...data },
          update: data,
        });
      },
      counts.teams,
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

    // 8. Venues.
    const existingVenues = new Set(
      (
        await prisma.worldCup2026Venue.findMany({
          select: { sourceVenueId: true },
        })
      ).flatMap((row) => (row.sourceVenueId === null ? [] : [row.sourceVenueId])),
    );
    await runChunked(
      prisma,
      pack.venues,
      existingVenues,
      (row) => row.sourceVenueId,
      (row) => {
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
        return prisma.worldCup2026Venue.upsert({
          where: { sourceVenueId: row.sourceVenueId },
          create: { sourceVenueId: row.sourceVenueId, ...data },
          update: data,
        });
      },
      counts.venues,
    );
    const venueIdMap = new Map(
      (
        await prisma.worldCup2026Venue.findMany({
          select: { id: true, sourceVenueId: true },
        })
      ).flatMap((row) =>
        row.sourceVenueId === null ? [] : [[row.sourceVenueId, row.id] as const],
      ),
    );

    // 9. Referees.
    const existingReferees = new Set(
      (
        await prisma.worldCup2026Referee.findMany({
          select: { sourceRefereeId: true },
        })
      ).flatMap((row) =>
        row.sourceRefereeId === null ? [] : [row.sourceRefereeId],
      ),
    );
    await runChunked(
      prisma,
      pack.referees,
      existingReferees,
      (row) => row.sourceRefereeId,
      (row) => {
        const data = {
          name: row.name,
          slug: row.slug,
          country: row.country,
          avgCardsPerGame: row.avgCardsPerGame,
          sourceId: MOMINUL_SOURCE_ID,
          raw: asJson(row),
        };
        return prisma.worldCup2026Referee.upsert({
          where: { sourceRefereeId: row.sourceRefereeId },
          create: { sourceRefereeId: row.sourceRefereeId, ...data },
          update: data,
        });
      },
      counts.referees,
    );
    const refereeIdMap = new Map(
      (
        await prisma.worldCup2026Referee.findMany({
          select: { id: true, sourceRefereeId: true },
        })
      ).flatMap((row) =>
        row.sourceRefereeId === null ? [] : [[row.sourceRefereeId, row.id] as const],
      ),
    );

    // 10. Matches.
    const existingMatches = new Set(
      (
        await prisma.worldCup2026Match.findMany({
          select: { sourceMatchId: true },
        })
      ).map((row) => row.sourceMatchId),
    );
    await runChunked(
      prisma,
      pack.matches,
      existingMatches,
      (row) => row.sourceMatchId,
      (row) => {
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
        return prisma.worldCup2026Match.upsert({
          where: { sourceMatchId: row.sourceMatchId },
          create: { sourceMatchId: row.sourceMatchId, ...data },
          update: data,
        });
      },
      counts.matches,
    );
    const matchIdMap = new Map(
      (
        await prisma.worldCup2026Match.findMany({
          select: { id: true, sourceMatchId: true },
        })
      ).map((row) => [row.sourceMatchId, row.id] as const),
    );

    // 11. Players.
    const existingPlayers = new Set(
      (
        await prisma.worldCup2026Player.findMany({
          select: { sourcePlayerId: true },
        })
      ).map((row) => row.sourcePlayerId),
    );
    await runChunked(
      prisma,
      pack.players,
      existingPlayers,
      (row) => row.sourcePlayerId,
      (row) => {
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
        return prisma.worldCup2026Player.upsert({
          where: { sourcePlayerId: row.sourcePlayerId },
          create: { sourcePlayerId: row.sourcePlayerId, ...data },
          update: data,
        });
      },
      counts.players,
    );
    const playerIdMap = new Map(
      (
        await prisma.worldCup2026Player.findMany({
          select: { id: true, sourcePlayerId: true },
        })
      ).map((row) => [row.sourcePlayerId, row.id] as const),
    );

    // 12. Events.
    const existingEvents = new Set(
      (
        await prisma.worldCup2026MatchEvent.findMany({
          select: { sourceEventId: true },
        })
      ).flatMap((row) => (row.sourceEventId === null ? [] : [row.sourceEventId])),
    );
    await runChunked(
      prisma,
      pack.events,
      existingEvents,
      (row) => row.sourceEventId,
      (row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        if (matchId === undefined) return null;
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
        return prisma.worldCup2026MatchEvent.upsert({
          where: { sourceEventId: row.sourceEventId },
          create: { sourceEventId: row.sourceEventId, ...data },
          update: data,
        });
      },
      counts.events,
    );

    // 13. Lineups.
    const existingLineups = new Set(
      (
        await prisma.worldCup2026Lineup.findMany({
          select: { sourceLineupId: true },
        })
      ).flatMap((row) => (row.sourceLineupId === null ? [] : [row.sourceLineupId])),
    );
    await runChunked(
      prisma,
      pack.lineups,
      existingLineups,
      (row) => row.sourceLineupId,
      (row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        if (matchId === undefined) return null;
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
        return prisma.worldCup2026Lineup.upsert({
          where: { sourceLineupId: row.sourceLineupId },
          create: { sourceLineupId: row.sourceLineupId, ...data },
          update: data,
        });
      },
      counts.lineups,
    );

    // 14. Player stats (keyed by the player's DB id — one row per player).
    const existingStatPlayerIds = new Set(
      (
        await prisma.worldCup2026PlayerStat.findMany({
          select: { playerId: true },
        })
      ).map((row) => row.playerId),
    );
    await runChunked(
      prisma,
      pack.playerStats,
      existingStatPlayerIds,
      (row) => playerIdMap.get(row.sourcePlayerId) ?? null,
      (row) => {
        const playerId = playerIdMap.get(row.sourcePlayerId);
        if (playerId === undefined) return null;
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
        return prisma.worldCup2026PlayerStat.upsert({
          where: { playerId },
          create: { playerId, ...data },
          update: data,
        });
      },
      counts.playerStats,
    );

    // 15. Team match stats (compound key matchId + teamCode).
    const existingTeamStats = new Set(
      (
        await prisma.worldCup2026TeamMatchStat.findMany({
          select: { matchId: true, teamCode: true },
        })
      ).map((row) => `${row.matchId}::${row.teamCode ?? ""}`),
    );
    await runChunked(
      prisma,
      pack.teamMatchStats,
      existingTeamStats,
      (row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        if (matchId === undefined || row.teamCode === null) return null;
        return `${matchId}::${row.teamCode}`;
      },
      (row) => {
        const matchId = matchIdMap.get(row.sourceMatchId);
        if (matchId === undefined || row.teamCode === null) return null;
        const data = {
          teamId: teamIdMap.get(row.sourceTeamId) ?? null,
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
        return prisma.worldCup2026TeamMatchStat.upsert({
          where: {
            matchId_teamCode: { matchId, teamCode: row.teamCode },
          },
          create: { matchId, teamCode: row.teamCode, ...data },
          update: data,
        });
      },
      counts.teamMatchStats,
    );

    // 16. Batch complete.
    await prisma.worldCup2026ImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        recordsCreated: asJson(
          Object.fromEntries(
            ENTITY_ORDER.map((key) => [key, counts[key].created]),
          ),
        ),
        recordsUpdated: asJson(
          Object.fromEntries(
            ENTITY_ORDER.map((key) => [key, counts[key].updated]),
          ),
        ),
        recordsSkipped: asJson(
          Object.fromEntries(
            ENTITY_ORDER.map((key) => [key, counts[key].skipped]),
          ),
        ),
        warnings: asJson(warnings),
      },
    });
    return result(true, null, counts, batch.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Import failed: ${message}`);
    await prisma.worldCup2026ImportBatch
      .update({
        where: { id: batch.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errors: asJson(errors),
        },
      })
      .catch(() => undefined);
    return result(false, null, counts, batch.id);
  }
}
