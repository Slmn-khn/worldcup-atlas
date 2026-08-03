// Tournament queries for DB-backed pages (Checkpoint 4D).

import { prisma } from "@/server/db/prisma";
import {
  buildWc2026TournamentCard,
  mergeWc2026TournamentCard,
} from "@/server/worldcup2026/canonicalBridge";
import { getWc2026Overview } from "@/server/worldcup2026/queries";
import {
  finalStageFilter,
  formatFinalScore,
  matchCardInclude,
  toIso,
  toMatchCardDto,
} from "./helpers";
import type {
  FilterOptionDto,
  TopScorerDto,
  TournamentCardDto,
  TournamentDetailDto,
  TournamentFilterOptions,
  TournamentIndexDto,
  MatchCardDto,
} from "./types";

/** Name + flag-resolution hints for a team referenced by id. */
type TeamFlagRef = { name: string; slug: string; code: string | null };

/** Resolves team name/slug/code for the scalar winner/runner-up ids. */
async function teamRefsByIds(
  ids: (string | null)[],
): Promise<Map<string, TeamFlagRef>> {
  const wanted = ids.filter((id): id is string => id !== null);
  if (wanted.length === 0) return new Map();
  const teams = await prisma.team.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true, slug: true, code: true },
  });
  return new Map(
    teams.map((team) => [
      team.id,
      { name: team.name, slug: team.slug, code: team.code },
    ]),
  );
}

/** Final-match display score per tournament id (tournaments without a "final" stage are absent). */
async function finalScoreByTournamentId(): Promise<Map<string, string>> {
  const finals = await prisma.match.findMany({
    where: { stage: finalStageFilter },
    select: {
      tournamentId: true,
      homeScore: true,
      awayScore: true,
      homeScorePenalties: true,
      awayScorePenalties: true,
      decidedByPenalties: true,
    },
  });
  return new Map(
    finals.map((final) => [final.tournamentId, formatFinalScore(final)]),
  );
}

export async function getTournamentCards(): Promise<TournamentCardDto[]> {
  const tournaments = await prisma.tournament.findMany({
    orderBy: { year: "desc" },
  });
  const refs = await teamRefsByIds(
    tournaments.flatMap((t) => [t.winnerTeamId, t.runnerUpTeamId]),
  );
  const finalScores = await finalScoreByTournamentId();

  const cards = tournaments.map((t) => {
    const winnerRef =
      t.winnerTeamId !== null ? (refs.get(t.winnerTeamId) ?? null) : null;
    const runnerUpRef =
      t.runnerUpTeamId !== null ? (refs.get(t.runnerUpTeamId) ?? null) : null;
    return {
      id: t.id,
      year: t.year,
      name: t.name,
      slug: t.slug,
      hostName: t.hostName,
      teamsCount: t.teamsCount,
      matchesCount: t.matchesCount,
      goalsCount: t.goalsCount,
      winner: winnerRef?.name ?? null,
      winnerSlug: winnerRef?.slug ?? null,
      winnerCode: winnerRef?.code ?? null,
      runnerUp: runnerUpRef?.name ?? null,
      runnerUpSlug: runnerUpRef?.slug ?? null,
      runnerUpCode: runnerUpRef?.code ?? null,
      finalScore: finalScores.get(t.id) ?? null,
    };
  });

  // Bridge in the imported 2026 archive (Mominul-only tables) as a card.
  // mergeWc2026TournamentCard drops the synthetic card if canonical 2026
  // exists (post-promotion), so the archive is never double-counted. Timeline,
  // featured tournaments, /tournaments, and archive-span derivations all flow
  // from this list, which keeps every surface 2026-aware in one place.
  try {
    const overview = await getWc2026Overview();
    if (overview !== null) {
      return mergeWc2026TournamentCard(
        cards,
        buildWc2026TournamentCard(overview),
      );
    }
  } catch (error) {
    console.error("[tournaments] 2026 archive bridge unavailable", error);
  }
  return cards;
}

/**
 * Filtered + sorted tournament cards for the /tournaments index, with
 * filter-option metadata sourced from the actual rows. The archive holds a
 * few dozen tournaments, so filtering happens in memory over the same cards
 * the unfiltered page renders — no second source of truth.
 */
export async function getTournamentIndex(
  options: TournamentFilterOptions = {},
): Promise<TournamentIndexDto> {
  const all = await getTournamentCards();

  const q = options.q?.trim().toLowerCase();
  let filtered = all.filter((tournament) => {
    if (
      options.yearFrom !== undefined &&
      tournament.year < options.yearFrom
    ) {
      return false;
    }
    if (options.yearTo !== undefined && tournament.year > options.yearTo) {
      return false;
    }
    if (options.host !== undefined && tournament.hostName !== options.host) {
      return false;
    }
    if (options.winner !== undefined && tournament.winner !== options.winner) {
      return false;
    }
    if (q !== undefined && q !== "") {
      const haystack = [
        String(tournament.year),
        tournament.name,
        tournament.hostName ?? "",
        tournament.winner ?? "",
        tournament.runnerUp ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sort = options.sort ?? "newest";
  filtered = [...filtered].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return a.year - b.year;
      case "most-goals":
        return (b.goalsCount ?? 0) - (a.goalsCount ?? 0) || b.year - a.year;
      case "most-matches":
        return (
          (b.matchesCount ?? 0) - (a.matchesCount ?? 0) || b.year - a.year
        );
      case "most-teams":
        return (b.teamsCount ?? 0) - (a.teamsCount ?? 0) || b.year - a.year;
      case "newest":
      default:
        return b.year - a.year;
    }
  });

  const optionFrom = (values: (string | null)[]): FilterOptionDto[] => {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (value === null) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ label: value, value, count }));
  };

  return {
    tournaments: filtered,
    total: all.length,
    filteredTotal: filtered.length,
    options: {
      hosts: optionFrom(all.map((tournament) => tournament.hostName)),
      winners: optionFrom(all.map((tournament) => tournament.winner)),
      years: [...all]
        .sort((a, b) => b.year - a.year)
        .map((tournament) => ({
          label: String(tournament.year),
          value: String(tournament.year),
        })),
    },
  };
}

async function topScorersForTournament(
  tournamentId: string,
  take: number,
): Promise<TopScorerDto[]> {
  const grouped = await prisma.goal.groupBy({
    by: ["playerId"],
    where: { match: { tournamentId }, isOwnGoal: false },
    _count: { _all: true },
    orderBy: { _count: { playerId: "desc" } },
    take,
  });
  const players = await prisma.player.findMany({
    where: { id: { in: grouped.map((g) => g.playerId) } },
    select: {
      id: true,
      name: true,
      slug: true,
      country: { select: { name: true } },
    },
  });
  const byId = new Map(players.map((p) => [p.id, p]));
  return grouped.flatMap((g) => {
    const player = byId.get(g.playerId);
    if (player === undefined) return [];
    return [
      {
        playerId: player.id,
        name: player.name,
        slug: player.slug,
        countryName: player.country?.name ?? null,
        goals: g._count._all,
      },
    ];
  });
}

export async function getTournamentByYear(
  year: number,
): Promise<TournamentDetailDto | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { year },
    include: {
      teams: {
        select: { id: true, name: true, slug: true, code: true },
        orderBy: { name: "asc" },
      },
    },
  });
  if (tournament === null) return null;

  const [
    matches,
    topScorers,
    awards,
    penaltyShootouts,
    penaltyKicks,
    bookings,
    substitutions,
    teamRefs,
    finalScores,
  ] = await Promise.all([
    prisma.match.findMany({
      where: { tournamentId: tournament.id },
      include: matchCardInclude,
      orderBy: [{ matchDate: "asc" }, { matchNumber: "asc" }],
    }),
    topScorersForTournament(tournament.id, 5),
    prisma.award.findMany({
      where: { tournamentId: tournament.id },
      include: {
        player: { select: { name: true, slug: true } },
        team: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.match.count({
      where: { tournamentId: tournament.id, decidedByPenalties: true },
    }),
    prisma.penaltyKick.count({
      where: { match: { tournamentId: tournament.id } },
    }),
    prisma.booking.count({ where: { match: { tournamentId: tournament.id } } }),
    prisma.substitution.count({
      where: { match: { tournamentId: tournament.id } },
    }),
    teamRefsByIds([tournament.winnerTeamId, tournament.runnerUpTeamId]),
    finalScoreByTournamentId(),
  ]);

  const winnerRef =
    tournament.winnerTeamId !== null
      ? (teamRefs.get(tournament.winnerTeamId) ?? null)
      : null;
  const runnerUpRef =
    tournament.runnerUpTeamId !== null
      ? (teamRefs.get(tournament.runnerUpTeamId) ?? null)
      : null;

  return {
    id: tournament.id,
    year: tournament.year,
    name: tournament.name,
    slug: tournament.slug,
    hostName: tournament.hostName,
    teamsCount: tournament.teamsCount,
    matchesCount: tournament.matchesCount,
    goalsCount: tournament.goalsCount,
    winner: winnerRef?.name ?? null,
    winnerSlug: winnerRef?.slug ?? null,
    winnerCode: winnerRef?.code ?? null,
    runnerUp: runnerUpRef?.name ?? null,
    runnerUpSlug: runnerUpRef?.slug ?? null,
    runnerUpCode: runnerUpRef?.code ?? null,
    finalScore: finalScores.get(tournament.id) ?? null,
    startDate: toIso(tournament.startDate),
    endDate: toIso(tournament.endDate),
    teams: tournament.teams,
    matches: matches.map(toMatchCardDto),
    topScorers,
    awards: awards.map((award) => ({
      name: award.name,
      playerName: award.player?.name ?? null,
      playerSlug: award.player?.slug ?? null,
      teamName: award.team?.name ?? null,
    })),
    stats: { penaltyShootouts, penaltyKicks, bookings, substitutions },
  };
}

export async function getTournamentMatches(
  year: number,
): Promise<MatchCardDto[]> {
  const matches = await prisma.match.findMany({
    where: { tournament: { year } },
    include: matchCardInclude,
    orderBy: [{ matchDate: "asc" }, { matchNumber: "asc" }],
  });
  return matches.map(toMatchCardDto);
}
