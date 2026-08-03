// Records / leaderboard queries (Checkpoints 4D/5F).
// Every leaderboard is computed from imported data only and labeled with
// exactly what the data supports. Deliberately NOT implemented (data absent):
// appearances/caps, minutes, assists, clean sheets, lineups. Titles/finals
// ARE safe — Tournament.winnerTeamId is populated from the source's winner
// column. Scope is combined across all imported tournaments and labeled as
// such (see scopeNote) — never silently mixed under a misleading label.

import { prisma } from "@/server/db/prisma";
import { formatScore } from "./helpers";
import type {
  RecordItemDto,
  RecordLeaderboardDto,
  RecordsOverviewDto,
} from "./types";

const TAKE = 5;

// ---------------------------------------------------------------- helpers --

async function playerItems(
  grouped: { playerId: string; count: number }[],
): Promise<RecordItemDto[]> {
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
  return grouped.flatMap((g, index) => {
    const player = byId.get(g.playerId);
    if (player === undefined) return [];
    return [
      {
        rank: index + 1,
        label: player.name,
        href: `/players/${player.slug}`,
        value: g.count,
        detail: player.country?.name ?? null,
      },
    ];
  });
}

type CountryRef = { id: string; name: string; slug: string };

function topCountryItems(
  countsByCountry: Map<string, number>,
  countryById: Map<string, CountryRef>,
  take = TAKE,
): RecordItemDto[] {
  return [...countsByCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([countryId, value], index) => {
      const country = countryById.get(countryId);
      return {
        rank: index + 1,
        label: country?.name ?? "Unknown nation",
        href: country !== undefined ? `/countries/${country.slug}` : null,
        value,
        detail: null,
      };
    });
}

/** Aggregates a per-team count map into a per-country count map. */
function aggregateByCountry(
  countsByTeam: Map<string, number>,
  countryByTeam: Map<string, string | null>,
): Map<string, number> {
  const byCountry = new Map<string, number>();
  for (const [teamId, count] of countsByTeam) {
    const countryId = countryByTeam.get(teamId) ?? null;
    if (countryId !== null) {
      byCountry.set(countryId, (byCountry.get(countryId) ?? 0) + count);
    }
  }
  return byCountry;
}

type MatchRow = {
  id: string;
  slug: string;
  stage: string;
  homeScore: number;
  awayScore: number;
  homeTeamId: string;
  awayTeamId: string;
  winningTeamId: string | null;
  homeTeam: { name: string };
  awayTeam: { name: string };
  tournament: { year: number };
};

function matchItem(
  match: MatchRow,
  value: number,
  rank: number,
): RecordItemDto {
  return {
    rank,
    label: `${match.homeTeam.name} ${formatScore(match.homeScore, match.awayScore)} ${match.awayTeam.name}`,
    href: `/matches/${match.slug}`,
    value,
    detail: `${match.tournament.year}, ${match.stage}`,
  };
}

function topMatchItems(
  matches: MatchRow[],
  valueOf: (match: MatchRow) => number,
  take = TAKE,
): RecordItemDto[] {
  return matches
    .map((match) => ({ match, value: valueOf(match) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, take)
    .map(({ match, value }, index) => matchItem(match, value, index + 1));
}

function board(
  key: string,
  title: string,
  description: string,
  items: RecordItemDto[],
): RecordLeaderboardDto {
  return { key, title, description, items };
}

// --------------------------------------------------------------- overview --

export async function getRecordsOverview(): Promise<RecordsOverviewDto> {
  // Shared lookups, fetched once.
  const [tournaments, teams, countries, matches] = await Promise.all([
    prisma.tournament.findMany({
      select: {
        name: true,
        slug: true,
        year: true,
        goalsCount: true,
        matchesCount: true,
        teamsCount: true,
        winnerTeamId: true,
      },
      orderBy: { year: "asc" },
    }),
    prisma.team.findMany({ select: { id: true, countryId: true } }),
    prisma.country.findMany({ select: { id: true, name: true, slug: true } }),
    prisma.match.findMany({
      select: {
        id: true,
        slug: true,
        stage: true,
        homeScore: true,
        awayScore: true,
        homeTeamId: true,
        awayTeamId: true,
        winningTeamId: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        tournament: { select: { year: true } },
      },
    }),
  ]);
  const countryByTeam = new Map(teams.map((t) => [t.id, t.countryId]));
  const countryById = new Map(countries.map((c) => [c.id, c]));
  const matchById = new Map(matches.map((m) => [m.id, m]));

  // Grouped event aggregates.
  const [
    goalsByTeam,
    goalsByPlayer,
    bookingsByPlayer,
    bookingsByTeam,
    bookingsByMatch,
    shootoutKicksByMatch,
    pensConvertedByPlayer,
    pensNotConvertedByPlayer,
    awardsByPlayer,
  ] = await Promise.all([
    prisma.goal.groupBy({ by: ["teamId"], _count: { _all: true } }),
    prisma.goal.groupBy({
      by: ["playerId"],
      where: { isOwnGoal: false },
      _count: { _all: true },
      orderBy: { _count: { playerId: "desc" } },
      take: TAKE,
    }),
    prisma.booking.groupBy({
      by: ["playerId"],
      _count: { _all: true },
      orderBy: { _count: { playerId: "desc" } },
      take: TAKE,
    }),
    prisma.booking.groupBy({ by: ["teamId"], _count: { _all: true } }),
    prisma.booking.groupBy({
      by: ["matchId"],
      _count: { _all: true },
      orderBy: { _count: { matchId: "desc" } },
      take: TAKE,
    }),
    prisma.penaltyKick.groupBy({
      by: ["matchId"],
      where: { type: "SHOOTOUT" },
      _count: { _all: true },
      orderBy: { _count: { matchId: "desc" } },
      take: TAKE,
    }),
    prisma.penaltyKick.groupBy({
      by: ["playerId"],
      where: { converted: true, type: "SHOOTOUT", playerId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { playerId: "desc" } },
      take: TAKE,
    }),
    prisma.penaltyKick.groupBy({
      by: ["playerId"],
      where: { converted: false, type: "SHOOTOUT", playerId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { playerId: "desc" } },
      take: TAKE,
    }),
    prisma.award.groupBy({
      by: ["playerId"],
      where: { playerId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { playerId: "desc" } },
      take: TAKE,
    }),
  ]);

  // ---- Scope (data-driven, from actual tournament names). ----
  const mensYears = tournaments
    .filter((t) => t.name.includes("Men's"))
    .map((t) => t.year);
  const womensYears = tournaments
    .filter((t) => t.name.includes("Women's"))
    .map((t) => t.year);
  const scopeLabel = "All imported tournaments";
  const scopeParts: string[] = [];
  if (mensYears.length > 0) {
    scopeParts.push(
      `${mensYears.length} men's editions (${Math.min(...mensYears)}–${Math.max(...mensYears)})`,
    );
  }
  if (womensYears.length > 0) {
    scopeParts.push(
      `${womensYears.length} women's editions (${Math.min(...womensYears)}–${Math.max(...womensYears)})`,
    );
  }
  const scopeNote =
    `Leaderboards combine all ${tournaments.length} imported tournaments` +
    (scopeParts.length > 0 ? ` — ${scopeParts.join(" and ")} — ` : " ") +
    "and are computed from the imported source data only. This is an independent archive, not an official record list." +
    (tournaments.some((t) => t.year === 2026)
      ? ""
      : " The completed 2026 tournament is archived separately; its scorers, assists, and match stats live in the 2026 archive hub and are not yet merged into these historical leaderboards.");

  // ---- Team (nation) records. ----
  const teamGoals = new Map(goalsByTeam.map((g) => [g.teamId, g._count._all]));
  const matchCountByTeam = new Map<string, number>();
  const winsByTeam = new Map<string, number>();
  for (const match of matches) {
    for (const teamId of [match.homeTeamId, match.awayTeamId]) {
      matchCountByTeam.set(teamId, (matchCountByTeam.get(teamId) ?? 0) + 1);
    }
    if (match.winningTeamId !== null) {
      winsByTeam.set(
        match.winningTeamId,
        (winsByTeam.get(match.winningTeamId) ?? 0) + 1,
      );
    }
  }
  const titlesByCountry = new Map<string, number>();
  for (const tournament of tournaments) {
    const countryId =
      tournament.winnerTeamId !== null
        ? (countryByTeam.get(tournament.winnerTeamId) ?? null)
        : null;
    if (countryId !== null) {
      titlesByCountry.set(countryId, (titlesByCountry.get(countryId) ?? 0) + 1);
    }
  }

  const teamRecords = [
    board(
      "most-titles-by-nation",
      "Most titles",
      "Tournaments won, from the source's tournament winner field (includes 1950, which had no single final).",
      topCountryItems(titlesByCountry, countryById),
    ),
    board(
      "most-goals-by-nation",
      "Most goals by a nation",
      "Goals credited to the nation's teams (own goals count for the credited team).",
      topCountryItems(
        aggregateByCountry(teamGoals, countryByTeam),
        countryById,
      ),
    ),
    board(
      "most-wins-by-nation",
      "Most match wins",
      "Match wins, with penalty-shootout wins counted as wins (matching the source's result column).",
      topCountryItems(
        aggregateByCountry(winsByTeam, countryByTeam),
        countryById,
      ),
    ),
    board(
      "most-matches-by-nation",
      "Most matches played",
      "Matches involving the nation's tournament teams.",
      topCountryItems(
        aggregateByCountry(matchCountByTeam, countryByTeam),
        countryById,
      ),
    ),
  ];

  // ---- Player records. ----
  const playerRecords = [
    board(
      "top-goal-scorers",
      "Most goals",
      "Goals scored, excluding own goals.",
      await playerItems(
        goalsByPlayer.map((g) => ({
          playerId: g.playerId,
          count: g._count._all,
        })),
      ),
    ),
    board(
      "most-awards-by-player",
      "Most tournament awards",
      "Official tournament awards (Golden Ball, Golden Boot, and similar) in the imported dataset.",
      await playerItems(
        awardsByPlayer.flatMap((g) =>
          g.playerId === null
            ? []
            : [{ playerId: g.playerId, count: g._count._all }],
        ),
      ),
    ),
  ];

  // ---- Match records. ----
  const matchRecords = [
    board(
      "highest-scoring-matches",
      "Highest-scoring matches",
      "Total goals in a single match.",
      topMatchItems(matches, (m) => m.homeScore + m.awayScore),
    ),
    board(
      "biggest-wins",
      "Biggest wins",
      "Largest margin of victory in a single match.",
      topMatchItems(matches, (m) => Math.abs(m.homeScore - m.awayScore)),
    ),
    board(
      "most-goals-by-one-team",
      "Most goals by one team in a match",
      "Goals scored by a single team in one match.",
      topMatchItems(matches, (m) => Math.max(m.homeScore, m.awayScore)),
    ),
  ];

  // ---- Tournament records. ----
  function tournamentBoard(
    key: string,
    title: string,
    description: string,
    valueOf: (t: (typeof tournaments)[number]) => number | null,
  ): RecordLeaderboardDto {
    const items = tournaments
      .flatMap((t) => {
        const value = valueOf(t);
        return value === null ? [] : [{ tournament: t, value }];
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, TAKE)
      .map(({ tournament, value }, index) => ({
        rank: index + 1,
        label: tournament.name,
        href: `/tournaments/${tournament.year}`,
        value,
        detail: null,
      }));
    return board(key, title, description, items);
  }

  const tournamentRecords = [
    tournamentBoard(
      "most-goals-by-tournament",
      "Most goals in a tournament",
      "Total goals per tournament, counted from imported goal events.",
      (t) => t.goalsCount,
    ),
    tournamentBoard(
      "most-matches-by-tournament",
      "Most matches in a tournament",
      "Matches played per tournament.",
      (t) => t.matchesCount,
    ),
    tournamentBoard(
      "most-teams-by-tournament",
      "Most teams in a tournament",
      "Qualified teams per tournament, from the source's team count.",
      (t) => t.teamsCount,
    ),
  ];

  // ---- Penalty records. ----
  const shootoutMatchItems = shootoutKicksByMatch.flatMap((group, index) => {
    const match = matchById.get(group.matchId);
    if (match === undefined) return [];
    return [matchItem(match, group._count._all, index + 1)];
  });

  const penaltyRecords = [
    board(
      "most-shootout-kicks-in-match",
      "Longest shootouts",
      "Most penalty kicks taken in a single shootout.",
      shootoutMatchItems,
    ),
    board(
      "most-shootout-conversions",
      "Most shootout penalties converted",
      "Converted shootout kicks — in-match penalties are counted as goals.",
      await playerItems(
        pensConvertedByPlayer.flatMap((g) =>
          g.playerId === null
            ? []
            : [{ playerId: g.playerId, count: g._count._all }],
        ),
      ),
    ),
    board(
      "most-shootout-misses",
      "Most shootout penalties missed or saved",
      "Unconverted shootout kicks — the source does not distinguish missed from saved.",
      await playerItems(
        pensNotConvertedByPlayer.flatMap((g) =>
          g.playerId === null
            ? []
            : [{ playerId: g.playerId, count: g._count._all }],
        ),
      ),
    ),
  ];

  // ---- Discipline records. ----
  const teamBookings = new Map(
    bookingsByTeam.map((g) => [g.teamId, g._count._all]),
  );
  const cardsByMatchItems = bookingsByMatch.flatMap((group, index) => {
    const match = matchById.get(group.matchId);
    if (match === undefined) return [];
    return [matchItem(match, group._count._all, index + 1)];
  });

  const disciplineRecords = [
    board(
      "most-bookings-by-player",
      "Most cards received",
      "Yellow, second yellow, and red cards combined.",
      await playerItems(
        bookingsByPlayer.map((g) => ({
          playerId: g.playerId,
          count: g._count._all,
        })),
      ),
    ),
    board(
      "most-bookings-by-nation",
      "Most cards by a nation",
      "Cards shown to the nation's players across all imported tournaments.",
      topCountryItems(
        aggregateByCountry(teamBookings, countryByTeam),
        countryById,
      ),
    ),
    board(
      "most-cards-in-match",
      "Most cards in a match",
      "Yellow, second yellow, and red cards in a single match.",
      cardsByMatchItems,
    ),
  ];

  return {
    scopeLabel,
    scopeNote,
    teamRecords,
    playerRecords,
    matchRecords,
    tournamentRecords,
    penaltyRecords,
    disciplineRecords,
  };
}
