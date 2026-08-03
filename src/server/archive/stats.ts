// Combined archive statistics — canonical historical tables PLUS the
// imported 2026 archive (WorldCup2026* tables, Mominul-only import).
//
// Everything is computed from the database; nothing is hardcoded:
//   - counts come from canonical count queries,
//   - the 2026 additions come from imported match/team rows (goals are summed
//     from match scores, never player stats),
//   - champions/span derive from the (2026-inclusive) tournament cards.
//
// DOUBLE-COUNTING GUARD: when the canonical Tournament table already has
// year 2026 (a future promotion), the 2026 additions are skipped entirely —
// sourceMode stays "db" and canonical counts stand alone.

import { prisma } from "@/server/db/prisma";
import { getArchiveStats } from "@/server/queries/home";
import { getTournamentCards } from "@/server/queries/tournaments";
import {
  buildWc2026StatAdditions,
  countNewWc2026Nations,
} from "@/server/worldcup2026/canonicalBridge";
import { getWc2026Overview, getWc2026Teams } from "@/server/worldcup2026/queries";
import type { TournamentCardDto } from "@/server/queries/types";

export type CombinedArchiveStats = {
  tournamentsCount: number;
  matchesCount: number;
  goalsCount: number;
  nationsCount: number;
  championsCount: number;
  spanStart: number | null;
  spanEnd: number | null;
  /** e.g. "1930–2026" — derived from tournament years, never hardcoded. */
  archiveSpan: string | null;
  latestTournamentYear: number | null;
  sourceMode: "db" | "db-plus-2026" | "fallback";
};

const EMPTY_STATS: CombinedArchiveStats = {
  tournamentsCount: 0,
  matchesCount: 0,
  goalsCount: 0,
  nationsCount: 0,
  championsCount: 0,
  spanStart: null,
  spanEnd: null,
  archiveSpan: null,
  latestTournamentYear: null,
  sourceMode: "fallback",
};

/**
 * @param prefetchedCards Optional 2026-inclusive tournament cards (from
 * getTournamentCards) so callers that already loaded them avoid a re-query.
 */
export async function getCombinedArchiveStats(
  prefetchedCards?: TournamentCardDto[],
): Promise<CombinedArchiveStats> {
  try {
    const [canonical, cards, canonical2026] = await Promise.all([
      getArchiveStats(),
      prefetchedCards !== undefined
        ? Promise.resolve(prefetchedCards)
        : getTournamentCards(),
      prisma.tournament.findUnique({
        where: { year: 2026 },
        select: { id: true },
      }),
    ]);

    let tournamentsCount = canonical.tournaments;
    let matchesCount = canonical.matches;
    let goalsCount = canonical.goals;
    let nationsCount = canonical.countries;
    let sourceMode: CombinedArchiveStats["sourceMode"] = "db";

    // Add the imported 2026 archive ONLY while canonical 2026 is absent.
    if (canonical2026 === null) {
      const overview = await getWc2026Overview().catch(() => null);
      if (overview !== null) {
        const additions = buildWc2026StatAdditions(overview);
        tournamentsCount += additions.tournaments;
        matchesCount += additions.matches;
        goalsCount += additions.goals;

        // Nations: canonical count + genuinely NEW 2026 participants (2026
        // debutants). Historical nations stay distinct rows; a 2026 team
        // matching any canonical nation identity is not re-counted.
        const [teams, canonicalNations] = await Promise.all([
          getWc2026Teams(),
          prisma.country.findMany({
            select: { name: true, code: true, fifaCode: true },
          }),
        ]);
        nationsCount += countNewWc2026Nations(
          teams.map((team) => ({ name: team.name, fifaCode: team.fifaCode })),
          canonicalNations.flatMap((nation) => [
            { name: nation.name, code: nation.fifaCode },
            { name: nation.name, code: nation.code },
          ]),
        );
        sourceMode = "db-plus-2026";
      }
    }

    // Champions + span from the (2026-inclusive) cards — same derivation the
    // homepage always used, so name semantics stay consistent.
    const winners = new Set(
      cards
        .map((card) => card.winner)
        .filter((winner): winner is string => winner !== null),
    );
    const years = cards.map((card) => card.year);
    const spanStart = years.length > 0 ? Math.min(...years) : null;
    const spanEnd = years.length > 0 ? Math.max(...years) : null;

    return {
      tournamentsCount,
      matchesCount,
      goalsCount,
      nationsCount,
      championsCount: winners.size,
      spanStart,
      spanEnd,
      archiveSpan:
        spanStart !== null && spanEnd !== null
          ? `${spanStart}–${spanEnd}`
          : null,
      latestTournamentYear: spanEnd,
      sourceMode,
    };
  } catch (error) {
    console.error("[archive] failed to compute combined stats", error);
    return EMPTY_STATS;
  }
}
