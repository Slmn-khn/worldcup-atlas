// Query layer for the imported 2026 archive (WorldCup2026* tables,
// sourceId "mominul_2026_dataset"). Server-only, read-only: no provider
// fetches, no sync, no writes. Every function degrades to null/[] when the
// import has not run, so pages can fall back to the file-backed pack.

import { prisma } from "@/server/db/prisma";
import type {
  WorldCup2026Match,
  WorldCup2026Player,
  WorldCup2026PlayerStat,
} from "@/generated/prisma/client";

export const MOMINUL_ATTRIBUTION = "Mominul FIFA World Cup 2026 Dataset";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type Wc2026MatchDto = {
  id: string;
  sourceMatchId: number;
  matchNumber: number | null;
  date: string | null;
  kickoffTimeUtc: string | null;
  stageName: string | null;
  groupLetter: string | null;
  venueName: string | null;
  cityName: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  resultType: string | null;
  status: string;
  winnerTeamCode: string | null;
  homeXg: number | null;
  awayXg: number | null;
};

export type Wc2026TeamDto = {
  id: string;
  sourceTeamId: number | null;
  name: string;
  slug: string;
  fifaCode: string | null;
  flagCode: string | null;
  groupLetter: string | null;
  confederation: string | null;
  fifaRanking: number | null;
  eloRating: number | null;
  managerName: string | null;
};

export type Wc2026VenueDto = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  capacity: number | null;
  elevationMeters: number | null;
};

export type Wc2026Overview = {
  teamsCount: number;
  matchesCount: number;
  venuesCount: number;
  playersCount: number;
  goalsCount: number;
  hosts: string[];
  startDate: string | null;
  endDate: string | null;
  championName: string | null;
  championCode: string | null;
  runnerUpName: string | null;
  runnerUpCode: string | null;
  thirdName: string | null;
  thirdCode: string | null;
  fourthName: string | null;
  fourthCode: string | null;
  finalMatch: Wc2026MatchDto | null;
  thirdPlaceMatch: Wc2026MatchDto | null;
};

export {
  computeGroupStandings,
  type Wc2026Group,
  type Wc2026GroupStandingRow,
} from "./groupStandings";

export type Wc2026PlayerListItem = {
  sourcePlayerId: number;
  name: string;
  teamName: string | null;
  teamCode: string | null;
  position: string | null;
  club: string | null;
  goals: number | null;
  assists: number | null;
};

export type Wc2026StatLeader = {
  sourcePlayerId: number;
  name: string;
  teamName: string | null;
  teamCode: string | null;
  value: number;
  secondary?: number | null;
};

export type Wc2026TeamXgRow = {
  teamName: string;
  teamCode: string | null;
  matches: number;
  xgFor: number;
  xgAgainst: number;
  goalsFor: number;
};

function isoDay(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

function toMatchDto(match: WorldCup2026Match): Wc2026MatchDto {
  return {
    id: match.id,
    sourceMatchId: match.sourceMatchId,
    matchNumber: match.matchNumber,
    date: isoDay(match.date),
    kickoffTimeUtc: match.kickoffTimeUtc,
    stageName: match.stageName,
    groupLetter: match.groupLetter,
    venueName: (match.raw as { venueName?: string } | null)?.venueName ?? null,
    cityName: (match.raw as { cityName?: string } | null)?.cityName ?? null,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    homeTeamCode: match.homeTeamCode,
    awayTeamCode: match.awayTeamCode,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homePenaltyScore: match.homePenaltyScore,
    awayPenaltyScore: match.awayPenaltyScore,
    resultType: match.resultType,
    status: match.status,
    winnerTeamCode: match.winnerTeamCode,
    homeXg: match.homeXg,
    awayXg: match.awayXg,
  };
}

/** True when the Mominul import has populated the 2026 archive tables. */
export async function hasImported2026Data(): Promise<boolean> {
  try {
    return (await prisma.worldCup2026Match.count()) > 0;
  } catch {
    return false;
  }
}

// All matches, kickoff ascending (match number breaks ties).
export async function getWc2026Matches(): Promise<Wc2026MatchDto[]> {
  const rows = await prisma.worldCup2026Match.findMany({
    include: { venue: { select: { name: true, city: true } } },
    orderBy: [{ date: "asc" }, { sourceMatchId: "asc" }],
  });
  return rows.map((row) => ({
    ...toMatchDto(row),
    venueName: row.venue?.name ?? null,
    cityName: row.venue?.city ?? null,
  }));
}

export async function getWc2026Overview(): Promise<Wc2026Overview | null> {
  const matchesCount = await prisma.worldCup2026Match.count().catch(() => 0);
  if (matchesCount === 0) return null;

  const [teamsCount, venuesCount, playersCount, scoreAgg, venues, dates] =
    await Promise.all([
      prisma.worldCup2026Team.count(),
      prisma.worldCup2026Venue.count(),
      prisma.worldCup2026Player.count(),
      prisma.worldCup2026Match.aggregate({
        _sum: { homeScore: true, awayScore: true },
      }),
      prisma.worldCup2026Venue.findMany({ select: { country: true } }),
      prisma.worldCup2026Match.aggregate({ _min: { date: true }, _max: { date: true } }),
    ]);

  const finalRow = await prisma.worldCup2026Match.findFirst({
    where: { stageName: "Final" },
    include: { venue: { select: { name: true, city: true } } },
  });
  const thirdRow = await prisma.worldCup2026Match.findFirst({
    where: { stageName: { contains: "Third", mode: "insensitive" } },
    include: { venue: { select: { name: true, city: true } } },
  });

  const withVenue = (
    row: (WorldCup2026Match & { venue: { name: string; city: string | null } | null }) | null,
  ): Wc2026MatchDto | null =>
    row === null
      ? null
      : {
          ...toMatchDto(row),
          venueName: row.venue?.name ?? null,
          cityName: row.venue?.city ?? null,
        };

  const finalMatch = withVenue(finalRow);
  const thirdPlaceMatch = withVenue(thirdRow);

  const loserOf = (match: Wc2026MatchDto | null): [string | null, string | null] => {
    if (match === null || match.winnerTeamCode === null) return [null, null];
    return match.winnerTeamCode === match.homeTeamCode
      ? [match.awayTeamName, match.awayTeamCode]
      : [match.homeTeamName, match.homeTeamCode];
  };
  const winnerOf = (match: Wc2026MatchDto | null): [string | null, string | null] => {
    if (match === null || match.winnerTeamCode === null) return [null, null];
    return match.winnerTeamCode === match.homeTeamCode
      ? [match.homeTeamName, match.homeTeamCode]
      : [match.awayTeamName, match.awayTeamCode];
  };
  const [championName, championCode] = winnerOf(finalMatch);
  const [runnerUpName, runnerUpCode] = loserOf(finalMatch);
  const [thirdName, thirdCode] = winnerOf(thirdPlaceMatch);
  const [fourthName, fourthCode] = loserOf(thirdPlaceMatch);

  return {
    teamsCount,
    matchesCount,
    venuesCount,
    playersCount,
    goalsCount: (scoreAgg._sum.homeScore ?? 0) + (scoreAgg._sum.awayScore ?? 0),
    hosts: [
      ...new Set(
        venues
          .map((venue) => venue.country)
          .filter((country): country is string => country !== null),
      ),
    ].sort(),
    startDate: isoDay(dates._min.date),
    endDate: isoDay(dates._max.date),
    championName,
    championCode,
    runnerUpName,
    runnerUpCode,
    thirdName,
    thirdCode,
    fourthName,
    fourthCode,
    finalMatch,
    thirdPlaceMatch,
  };
}

export async function getWc2026Teams(): Promise<Wc2026TeamDto[]> {
  const rows = await prisma.worldCup2026Team.findMany({
    orderBy: [{ groupLetter: "asc" }, { name: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    sourceTeamId: row.sourceTeamId,
    name: row.name,
    slug: row.slug,
    fifaCode: row.fifaCode,
    flagCode: row.flagCode,
    groupLetter: row.groupLetter,
    confederation: row.confederation,
    fifaRanking: row.fifaRanking,
    eloRating: row.eloRating,
    managerName: row.managerName,
  }));
}

export async function getWc2026Venues(): Promise<Wc2026VenueDto[]> {
  const rows = await prisma.worldCup2026Venue.findMany({
    orderBy: [{ country: "asc" }, { name: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    country: row.country,
    capacity: row.capacity,
    elevationMeters: row.elevationMeters,
  }));
}


export async function getWc2026Players(options: {
  q?: string;
  teamCode?: string;
  limit?: number;
}): Promise<{ players: Wc2026PlayerListItem[]; total: number }> {
  const where = {
    ...(options.q !== undefined
      ? { name: { contains: options.q, mode: "insensitive" as const } }
      : {}),
    ...(options.teamCode !== undefined ? { teamCode: options.teamCode } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.worldCup2026Player.findMany({
      where,
      include: { stats: { select: { goals: true, assists: true } } },
      orderBy: [{ teamCode: "asc" }, { name: "asc" }],
      take: options.limit ?? 60,
    }),
    prisma.worldCup2026Player.count({ where }),
  ]);
  return {
    players: rows.map((row) => ({
      sourcePlayerId: row.sourcePlayerId,
      name: row.name,
      teamName: row.teamName,
      teamCode: row.teamCode,
      position: row.position,
      club: row.club,
      goals: row.stats?.goals ?? null,
      assists: row.stats?.assists ?? null,
    })),
    total,
  };
}

type LeaderPick = (stat: WorldCup2026PlayerStat) => number | null;

async function statLeaders(
  primary: LeaderPick,
  secondary: LeaderPick | null,
  take: number,
  orderBy: { [key: string]: "desc" }[],
  where?: Record<string, unknown>,
): Promise<Wc2026StatLeader[]> {
  const rows = await prisma.worldCup2026PlayerStat.findMany({
    where,
    include: { player: { select: { sourcePlayerId: true, name: true } } },
    orderBy,
    take,
  });
  return rows.flatMap((row) => {
    const value = primary(row);
    if (value === null || value === 0) return [];
    return [
      {
        sourcePlayerId: row.player.sourcePlayerId,
        name: row.playerName ?? row.player.name,
        teamName: null,
        teamCode: row.teamCode,
        value,
        secondary: secondary === null ? null : secondary(row),
      },
    ];
  });
}

export type Wc2026Stats = {
  topScorers: Wc2026StatLeader[];
  topAssists: Wc2026StatLeader[];
  mostCards: Wc2026StatLeader[];
  goalkeepers: Wc2026StatLeader[];
  teamXg: Wc2026TeamXgRow[];
};

export async function getWc2026Stats(): Promise<Wc2026Stats> {
  const [topScorers, topAssists, cardRows, goalkeepers, matches] =
    await Promise.all([
      statLeaders(
        (stat) => stat.goals,
        (stat) => stat.assists,
        10,
        [{ goals: "desc" }, { assists: "desc" }],
      ),
      statLeaders(
        (stat) => stat.assists,
        (stat) => stat.goals,
        10,
        [{ assists: "desc" }, { goals: "desc" }],
      ),
      prisma.worldCup2026PlayerStat.findMany({
        include: { player: { select: { sourcePlayerId: true, name: true } } },
        orderBy: [{ yellowCards: "desc" }, { redCards: "desc" }],
        take: 10,
      }),
      statLeaders(
        (stat) => stat.cleanSheets,
        (stat) => stat.saves,
        10,
        [{ cleanSheets: "desc" }, { saves: "desc" }],
        { saves: { gt: 0 } },
      ),
      getWc2026Matches(),
    ]);

  const mostCards: Wc2026StatLeader[] = cardRows.flatMap((row) => {
    const total = (row.yellowCards ?? 0) + (row.redCards ?? 0);
    if (total === 0) return [];
    return [
      {
        sourcePlayerId: row.player.sourcePlayerId,
        name: row.playerName ?? row.player.name,
        teamName: null,
        teamCode: row.teamCode,
        value: total,
        secondary: row.redCards,
      },
    ];
  });

  const xgByTeam = new Map<string, Wc2026TeamXgRow>();
  for (const match of matches) {
    const add = (
      name: string | null,
      code: string | null,
      xgFor: number | null,
      xgAgainst: number | null,
      goalsFor: number | null,
    ) => {
      if (name === null) return;
      const row =
        xgByTeam.get(name) ??
        ({ teamName: name, teamCode: code, matches: 0, xgFor: 0, xgAgainst: 0, goalsFor: 0 } satisfies Wc2026TeamXgRow);
      xgByTeam.set(name, row);
      row.matches += 1;
      row.xgFor += xgFor ?? 0;
      row.xgAgainst += xgAgainst ?? 0;
      row.goalsFor += goalsFor ?? 0;
    };
    add(match.homeTeamName, match.homeTeamCode, match.homeXg, match.awayXg, match.homeScore);
    add(match.awayTeamName, match.awayTeamCode, match.awayXg, match.homeXg, match.awayScore);
  }
  const teamXg = [...xgByTeam.values()]
    .sort((a, b) => b.xgFor - a.xgFor)
    .slice(0, 12)
    .map((row) => ({
      ...row,
      xgFor: Math.round(row.xgFor * 10) / 10,
      xgAgainst: Math.round(row.xgAgainst * 10) / 10,
    }));

  return { topScorers, topAssists, mostCards, goalkeepers, teamXg };
}

// ---------------------------------------------------------------------------
// Match detail
// ---------------------------------------------------------------------------

export type Wc2026MatchEventDto = {
  id: string;
  minute: number | null;
  stoppageMinute: number | null;
  eventType: string;
  cardType: string | null;
  playerName: string | null;
  playerSourceId: number | null;
  teamCode: string | null;
  teamName: string | null;
};

export type Wc2026LineupEntryDto = {
  id: string;
  playerName: string | null;
  playerSourceId: number | null;
  teamCode: string | null;
  isStarting: boolean | null;
  tacticalPosition: string | null;
  minutesPlayed: number | null;
};

export type Wc2026TeamStatDto = {
  teamCode: string | null;
  teamName: string | null;
  possessionPct: number | null;
  totalShots: number | null;
  shotsOnTarget: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  saves: number | null;
};

export type Wc2026MatchDetail = Wc2026MatchDto & {
  refereeName: string | null;
  goalkeeperHome: string | null;
  goalkeeperAway: string | null;
  playerOfTheMatch: string | null;
  events: Wc2026MatchEventDto[];
  lineups: Wc2026LineupEntryDto[];
  teamStats: Wc2026TeamStatDto[];
};

export async function getWc2026MatchDetail(
  sourceMatchId: number,
): Promise<Wc2026MatchDetail | null> {
  const row = await prisma.worldCup2026Match.findUnique({
    where: { sourceMatchId },
    include: {
      venue: { select: { name: true, city: true } },
      referee: { select: { name: true } },
      events: {
        include: { player: { select: { sourcePlayerId: true } } },
        orderBy: [{ minute: "asc" }, { stoppageMinute: "asc" }, { sourceEventId: "asc" }],
      },
      lineups: {
        include: { player: { select: { sourcePlayerId: true } } },
        orderBy: [{ teamCode: "asc" }, { isStarting: "desc" }, { playerName: "asc" }],
      },
      teamStats: { orderBy: { teamCode: "asc" } },
    },
  });
  if (row === null) return null;
  return {
    ...toMatchDto(row),
    venueName: row.venue?.name ?? null,
    cityName: row.venue?.city ?? null,
    refereeName: row.refereeName ?? row.referee?.name ?? null,
    goalkeeperHome: row.goalkeeperHome,
    goalkeeperAway: row.goalkeeperAway,
    playerOfTheMatch: row.playerOfTheMatch,
    events: row.events.map((event) => ({
      id: event.id,
      minute: event.minute,
      stoppageMinute: event.stoppageMinute,
      eventType: event.eventType,
      cardType: event.cardType,
      playerName: event.playerName,
      playerSourceId: event.player?.sourcePlayerId ?? null,
      teamCode: event.teamCode,
      teamName: event.teamName,
    })),
    lineups: row.lineups.map((entry) => ({
      id: entry.id,
      playerName: entry.playerName,
      playerSourceId: entry.player?.sourcePlayerId ?? null,
      teamCode: entry.teamCode,
      isStarting: entry.isStarting,
      tacticalPosition: entry.tacticalPosition,
      minutesPlayed: entry.minutesPlayed,
    })),
    teamStats: row.teamStats.map((stat) => ({
      teamCode: stat.teamCode,
      teamName: stat.teamName,
      possessionPct: stat.possessionPct,
      totalShots: stat.totalShots,
      shotsOnTarget: stat.shotsOnTarget,
      corners: stat.corners,
      fouls: stat.fouls,
      offsides: stat.offsides,
      saves: stat.saves,
    })),
  };
}

// ---------------------------------------------------------------------------
// Player detail
// ---------------------------------------------------------------------------

export type Wc2026PlayerDetail = {
  sourcePlayerId: number;
  name: string;
  teamName: string | null;
  teamCode: string | null;
  position: string | null;
  club: string | null;
  marketValueEur: number | null;
  caps: number | null;
  dateOfBirth: string | null;
  heightCm: number | null;
  stats: {
    matchesPlayed: number | null;
    matchesStarted: number | null;
    minutesPlayed: number | null;
    goals: number | null;
    assists: number | null;
    yellowCards: number | null;
    redCards: number | null;
    saves: number | null;
    cleanSheets: number | null;
    averageRating: number | null;
  } | null;
  matchEvents: {
    matchSourceId: number;
    matchLabel: string;
    minute: number | null;
    eventType: string;
  }[];
};

export async function getWc2026PlayerDetail(
  sourcePlayerId: number,
): Promise<Wc2026PlayerDetail | null> {
  const row = await prisma.worldCup2026Player.findUnique({
    where: { sourcePlayerId },
    include: {
      stats: true,
      events: {
        include: {
          match: {
            select: {
              sourceMatchId: true,
              homeTeamName: true,
              awayTeamName: true,
              stageName: true,
            },
          },
        },
        orderBy: [{ match: { sourceMatchId: "asc" } }, { minute: "asc" }],
      },
    },
  });
  if (row === null) return null;
  return {
    sourcePlayerId: row.sourcePlayerId,
    name: row.name,
    teamName: row.teamName,
    teamCode: row.teamCode,
    position: row.position,
    club: row.club,
    marketValueEur: row.marketValueEur,
    caps: row.caps,
    dateOfBirth: isoDay(row.dateOfBirth),
    heightCm: row.heightCm,
    stats:
      row.stats === null
        ? null
        : {
            matchesPlayed: row.stats.matchesPlayed,
            matchesStarted: row.stats.matchesStarted,
            minutesPlayed: row.stats.minutesPlayed,
            goals: row.stats.goals,
            assists: row.stats.assists,
            yellowCards: row.stats.yellowCards,
            redCards: row.stats.redCards,
            saves: row.stats.saves,
            cleanSheets: row.stats.cleanSheets,
            averageRating: row.stats.averageRating,
          },
    matchEvents: row.events.map((event) => ({
      matchSourceId: event.match.sourceMatchId,
      matchLabel: `${event.match.homeTeamName ?? "?"} v ${event.match.awayTeamName ?? "?"} · ${event.match.stageName ?? ""}`,
      minute: event.minute,
      eventType: event.eventType,
    })),
  };
}

// ---------------------------------------------------------------------------
// Types re-exported for pages
// ---------------------------------------------------------------------------

export type { WorldCup2026Player };
