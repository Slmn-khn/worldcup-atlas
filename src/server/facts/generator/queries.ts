// DB-touching layer for the data-template fact generator. Fetches rows into
// the plain shapes defined in ./types.ts and hands them to the pure builders
// in ./format.ts / ./rank.ts. Every query is scoped to men's World Cup
// tournaments only (see format.ts header comment for why).

import { prisma } from "@/server/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  buildBiggestWinCandidate,
  buildFinalScoreCandidate,
  buildHighestScoringCandidate,
  buildHostWinnerCandidate,
  buildPenaltyShootoutCandidate,
  buildSquadSelectionsCandidate,
  buildTopScorerCandidate,
  doesHostMatchWinner,
  type HostWinnerInput,
  type SquadSelectionsInput,
  type TopScorerInput,
} from "./format";
import {
  rankBiggestWins,
  rankHighestScoringMatches,
  rankPenaltyShootouts,
  selectFinalMatches,
} from "./rank";
import type { GeneratedFactCandidate, MatchFactInput } from "./types";

export const TOP_SCORERS_LIMIT = 3;
export const SQUAD_SELECTIONS_LIMIT = 3;
export const BIGGEST_WINS_LIMIT = 3;
export const HIGHEST_SCORING_LIMIT = 3;
export const PENALTY_SHOOTOUT_LIMIT = 10;

/**
 * Every fact template scopes to men's World Cup tournaments: the archive
 * also imports the women's World Cup, and a leaderboard combining both
 * without saying so would silently misrepresent the numbers (the same rule
 * src/server/queries/records.ts and the hand-written starter facts follow).
 *
 * Deliberately excludes `contains: "Women's"` rather than matching
 * `contains: "Men's"` — "Women's" contains "men's" as a literal substring
 * ("Wo-men's"), so a positive "Men's" match would incorrectly include every
 * women's tournament too. Excluding "Women's" has no such collision. Not
 * case-insensitive: Prisma's nested `not` filter doesn't accept `mode`, and
 * every imported tournament name is consistently capitalized "... FIFA
 * Women's World Cup" / "... FIFA Men's World Cup" (verified against the
 * live database), so an exact-case `contains` is sufficient here.
 */
const MENS_TOURNAMENT_FILTER = {
  name: { not: { contains: "Women's" } },
};

const matchSelect = {
  slug: true,
  stage: true,
  homeScore: true,
  awayScore: true,
  homeScorePenalties: true,
  awayScorePenalties: true,
  decidedByPenalties: true,
  tournament: { select: { year: true, slug: true } },
  homeTeam: {
    select: { name: true, slug: true, country: { select: { slug: true, name: true } } },
  },
  awayTeam: {
    select: { name: true, slug: true, country: { select: { slug: true, name: true } } },
  },
} satisfies Prisma.MatchSelect;

type MatchRow = Prisma.MatchGetPayload<{ select: typeof matchSelect }>;

function toMatchFactInput(match: MatchRow): MatchFactInput {
  return {
    slug: match.slug,
    stage: match.stage,
    year: match.tournament.year,
    tournamentSlug: match.tournament.slug,
    home: {
      name: match.homeTeam.name,
      slug: match.homeTeam.slug,
      countrySlug: match.homeTeam.country?.slug ?? null,
      countryName: match.homeTeam.country?.name ?? null,
    },
    away: {
      name: match.awayTeam.name,
      slug: match.awayTeam.slug,
      countrySlug: match.awayTeam.country?.slug ?? null,
      countryName: match.awayTeam.country?.name ?? null,
    },
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeScorePenalties: match.homeScorePenalties,
    awayScorePenalties: match.awayScorePenalties,
    decidedByPenalties: match.decidedByPenalties,
  };
}

/** Every men's World Cup match, as plain fact-builder input. Fetched once and
 * reused across the four match-based templates (biggest win, highest
 * scoring, penalty shootouts, final scores) to avoid four separate scans. */
export async function getAllMensMatches(): Promise<MatchFactInput[]> {
  const matches = await prisma.match.findMany({
    where: { tournament: MENS_TOURNAMENT_FILTER },
    select: matchSelect,
  });
  return matches.map(toMatchFactInput);
}

// ---------------------------------------------------------------------------
// 1. Top scorers
// ---------------------------------------------------------------------------

/** Raw top-scorer rows, shared by the deterministic generator and the
 * AI-assisted drafter (src/server/facts/aiDrafter) so both read the exact
 * same structured, DB-verified figures. */
export async function fetchTopScorerInputs(): Promise<TopScorerInput[]> {
  const grouped = await prisma.goal.groupBy({
    by: ["playerId"],
    where: { isOwnGoal: false, match: { tournament: MENS_TOURNAMENT_FILTER } },
    _count: { _all: true },
    orderBy: { _count: { playerId: "desc" } },
    take: TOP_SCORERS_LIMIT,
  });
  if (grouped.length === 0) return [];

  const playerIds = grouped.map((g) => g.playerId);
  const [players, goalYears] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, slug: true, name: true, country: { select: { slug: true, name: true } } },
    }),
    prisma.goal.findMany({
      where: { playerId: { in: playerIds }, isOwnGoal: false, match: { tournament: MENS_TOURNAMENT_FILTER } },
      select: { playerId: true, match: { select: { tournament: { select: { year: true } } } } },
    }),
  ]);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const era = eraByPlayerId(goalYears.map((g) => ({ playerId: g.playerId, year: g.match.tournament.year })));

  return grouped.flatMap((group, index) => {
    const player = playerById.get(group.playerId);
    if (player === undefined) return [];
    const playerEra = era.get(group.playerId) ?? null;
    return [
      {
        rank: index + 1,
        player: {
          slug: player.slug,
          name: player.name,
          countrySlug: player.country?.slug ?? null,
          countryName: player.country?.name ?? null,
        },
        goals: group._count._all,
        eraStartYear: playerEra?.min ?? null,
        eraEndYear: playerEra?.max ?? null,
      },
    ];
  });
}

export async function generateTopScorerCandidates(): Promise<GeneratedFactCandidate[]> {
  const inputs = await fetchTopScorerInputs();
  return inputs.map(buildTopScorerCandidate);
}

// ---------------------------------------------------------------------------
// 2. Squad selections ("most appearances", honestly reframed — see format.ts)
// ---------------------------------------------------------------------------

/** Raw squad-selection rows — see fetchTopScorerInputs for why this is
 * exported separately from the candidate builder. */
export async function fetchSquadSelectionInputs(): Promise<SquadSelectionsInput[]> {
  const grouped = await prisma.squadPlayer.groupBy({
    by: ["playerId"],
    where: { tournament: MENS_TOURNAMENT_FILTER },
    _count: { _all: true },
    orderBy: { _count: { playerId: "desc" } },
    take: SQUAD_SELECTIONS_LIMIT,
  });
  if (grouped.length === 0) return [];

  const playerIds = grouped.map((g) => g.playerId);
  const [players, squadYears] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, slug: true, name: true, country: { select: { slug: true, name: true } } },
    }),
    prisma.squadPlayer.findMany({
      where: { playerId: { in: playerIds }, tournament: MENS_TOURNAMENT_FILTER },
      select: { playerId: true, tournament: { select: { year: true } } },
    }),
  ]);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const era = eraByPlayerId(squadYears.map((s) => ({ playerId: s.playerId, year: s.tournament.year })));

  return grouped.flatMap((group, index) => {
    const player = playerById.get(group.playerId);
    if (player === undefined) return [];
    const playerEra = era.get(group.playerId) ?? null;
    return [
      {
        rank: index + 1,
        player: {
          slug: player.slug,
          name: player.name,
          countrySlug: player.country?.slug ?? null,
          countryName: player.country?.name ?? null,
        },
        selections: group._count._all,
        eraStartYear: playerEra?.min ?? null,
        eraEndYear: playerEra?.max ?? null,
      },
    ];
  });
}

export async function generateSquadSelectionCandidates(): Promise<GeneratedFactCandidate[]> {
  const inputs = await fetchSquadSelectionInputs();
  return inputs.map(buildSquadSelectionsCandidate);
}

function eraByPlayerId(
  rows: { playerId: string; year: number }[],
): Map<string, { min: number; max: number }> {
  const era = new Map<string, { min: number; max: number }>();
  for (const row of rows) {
    const current = era.get(row.playerId);
    era.set(
      row.playerId,
      current
        ? { min: Math.min(current.min, row.year), max: Math.max(current.max, row.year) }
        : { min: row.year, max: row.year },
    );
  }
  return era;
}

// ---------------------------------------------------------------------------
// 3 & 4. Biggest wins & highest scoring matches
// ---------------------------------------------------------------------------

export function generateBiggestWinCandidates(
  matches: MatchFactInput[],
): GeneratedFactCandidate[] {
  return rankBiggestWins(matches, BIGGEST_WINS_LIMIT).flatMap((match, index) => {
    const candidate = buildBiggestWinCandidate(match, index + 1);
    return candidate ? [candidate] : [];
  });
}

export function generateHighestScoringCandidates(
  matches: MatchFactInput[],
): GeneratedFactCandidate[] {
  return rankHighestScoringMatches(matches, HIGHEST_SCORING_LIMIT).map((match, index) =>
    buildHighestScoringCandidate(match, index + 1),
  );
}

// ---------------------------------------------------------------------------
// 5. Host winners
// ---------------------------------------------------------------------------

/** Raw host-winner rows — see fetchTopScorerInputs for why this is exported
 * separately from the candidate builder. */
export async function fetchHostWinnerInputs(): Promise<HostWinnerInput[]> {
  const tournaments = await prisma.tournament.findMany({
    where: MENS_TOURNAMENT_FILTER,
    select: { year: true, slug: true, hostName: true, winnerTeamId: true },
    orderBy: { year: "asc" },
  });
  const winnerTeamIds = tournaments.flatMap((t) => (t.winnerTeamId !== null ? [t.winnerTeamId] : []));
  const winnerTeams = await prisma.team.findMany({
    where: { id: { in: winnerTeamIds } },
    select: { id: true, name: true, country: { select: { slug: true, name: true } } },
  });
  const teamById = new Map(winnerTeams.map((t) => [t.id, t]));

  return tournaments.flatMap((tournament) => {
    if (tournament.hostName === null || tournament.winnerTeamId === null) return [];
    const winnerTeam = teamById.get(tournament.winnerTeamId);
    if (winnerTeam === undefined) return [];
    if (!doesHostMatchWinner(tournament.hostName, winnerTeam.name)) return [];
    return [
      {
        year: tournament.year,
        tournamentSlug: tournament.slug,
        hostName: tournament.hostName,
        winnerTeamName: winnerTeam.name,
        winnerCountrySlug: winnerTeam.country?.slug ?? null,
      },
    ];
  });
}

export async function generateHostWinnerCandidates(): Promise<GeneratedFactCandidate[]> {
  const inputs = await fetchHostWinnerInputs();
  return inputs.map(buildHostWinnerCandidate);
}

// ---------------------------------------------------------------------------
// 6 & 7. Penalty shootouts & final score facts
// ---------------------------------------------------------------------------

export function generatePenaltyShootoutCandidates(
  matches: MatchFactInput[],
): GeneratedFactCandidate[] {
  return rankPenaltyShootouts(matches, PENALTY_SHOOTOUT_LIMIT).flatMap((match) => {
    const candidate = buildPenaltyShootoutCandidate(match);
    return candidate ? [candidate] : [];
  });
}

export function generateFinalScoreCandidates(
  matches: MatchFactInput[],
): GeneratedFactCandidate[] {
  return selectFinalMatches(matches).flatMap((match) => {
    const candidate = buildFinalScoreCandidate(match);
    return candidate ? [candidate] : [];
  });
}
