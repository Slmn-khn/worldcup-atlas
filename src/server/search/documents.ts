// Search document builders (Checkpoint 6A). Every document is derived from
// normalized application tables (or the existing query layer) — never from
// RawSourceRecord — and links to a real page.

import { prisma } from "@/server/db/prisma";
import { formatMinute } from "@/lib/format";
import { formatScore } from "@/server/queries/helpers";
import { getCountryCards } from "@/server/queries/countries";
import { getRecordsOverview } from "@/server/queries/records";
import type { SearchDocument } from "./types";

function compactKeywords(parts: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      parts.filter((part): part is string => !!part && part.trim() !== ""),
    ),
  ];
}

/** Both dash variants and both orders, so "7-1" and "1–7" both match. */
function scoreKeywords(home: number, away: number): string[] {
  return [
    `${home}–${away}`,
    `${home}-${away}`,
    `${away}–${home}`,
    `${away}-${home}`,
  ];
}

export async function buildTournamentSearchDocuments(): Promise<
  SearchDocument[]
> {
  const tournaments = await prisma.tournament.findMany({
    select: {
      id: true,
      year: true,
      name: true,
      hostName: true,
      teamsCount: true,
      goalsCount: true,
      matchesCount: true,
      winnerTeamId: true,
      runnerUpTeamId: true,
    },
  });
  const teamIds = tournaments
    .flatMap((t) => [t.winnerTeamId, t.runnerUpTeamId])
    .filter((id): id is string => id !== null);
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true },
  });
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

  return tournaments.map((t) => {
    const winner =
      t.winnerTeamId !== null
        ? (teamNameById.get(t.winnerTeamId) ?? null)
        : null;
    const runnerUp =
      t.runnerUpTeamId !== null
        ? (teamNameById.get(t.runnerUpTeamId) ?? null)
        : null;
    return {
      id: `tournament-${t.id}`,
      type: "tournament" as const,
      title: t.name,
      subtitle: compactKeywords([
        t.hostName !== null ? `Host: ${t.hostName}` : null,
        winner !== null ? `Champions: ${winner}` : null,
      ]).join(" · "),
      description: compactKeywords([
        t.teamsCount !== null ? `${t.teamsCount} teams` : null,
        t.matchesCount !== null ? `${t.matchesCount} matches` : null,
        t.goalsCount !== null ? `${t.goalsCount} goals` : null,
      ]).join(" · "),
      href: `/tournaments/${t.year}`,
      keywords: compactKeywords([
        String(t.year),
        `world cup ${t.year}`,
        t.hostName,
        winner,
        runnerUp,
      ]),
      tournamentYear: t.year,
      sortYear: t.year,
    };
  });
}

export async function buildCountrySearchDocuments(): Promise<SearchDocument[]> {
  const countries = await getCountryCards();
  return countries.map((country) => ({
    id: `country-${country.id}`,
    type: "country" as const,
    title: country.name,
    subtitle: "Nation profile",
    description: compactKeywords([
      country.tournamentsEntered > 0
        ? `${country.tournamentsEntered} tournaments`
        : null,
      country.matchesCount !== null && country.matchesCount > 0
        ? `${country.matchesCount} matches`
        : null,
      country.goalsFor !== null && country.goalsFor > 0
        ? `${country.goalsFor} goals`
        : null,
      country.titlesCount !== null && country.titlesCount > 0
        ? `${country.titlesCount} ${country.titlesCount === 1 ? "title" : "titles"}`
        : null,
    ]).join(" · "),
    href: `/countries/${country.slug}`,
    keywords: compactKeywords([
      country.code,
      "nation",
      "country",
      "national team",
    ]),
    countryName: country.name,
    countryCode: country.code ?? undefined,
  }));
}

export async function buildPlayerSearchDocuments(): Promise<SearchDocument[]> {
  const players = await prisma.player.findMany({
    include: {
      country: { select: { name: true } },
      _count: {
        select: {
          squadPlayers: true,
          goals: { where: { isOwnGoal: false } },
          awards: true,
        },
      },
    },
  });
  return players.map((player) => ({
    id: `player-${player.id}`,
    type: "player" as const,
    title: player.name,
    subtitle: compactKeywords([
      player.country?.name ?? null,
      player.position,
    ]).join(" · "),
    description: compactKeywords([
      `${player._count.squadPlayers} World Cup ${player._count.squadPlayers === 1 ? "squad" : "squads"}`,
      player._count.goals > 0 ? `${player._count.goals} goals` : null,
      player._count.awards > 0 ? `${player._count.awards} awards` : null,
    ]).join(" · "),
    href: `/players/${player.slug}`,
    keywords: compactKeywords([
      player.country?.name ?? null,
      player.position,
      player._count.goals > 0 ? "goals" : null,
      player._count.awards > 0 ? "award winner" : null,
    ]),
    playerName: player.name,
    countryName: player.country?.name ?? undefined,
  }));
}

export async function buildMatchSearchDocuments(): Promise<SearchDocument[]> {
  const matches = await prisma.match.findMany({
    select: {
      id: true,
      slug: true,
      stage: true,
      homeScore: true,
      awayScore: true,
      homeScorePenalties: true,
      awayScorePenalties: true,
      decidedByPenalties: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      stadium: { select: { name: true } },
      tournament: { select: { year: true, name: true } },
    },
  });
  return matches.map((match) => {
    const score = formatScore(match.homeScore, match.awayScore);
    const pens =
      match.decidedByPenalties &&
      match.homeScorePenalties !== null &&
      match.awayScorePenalties !== null
        ? formatScore(match.homeScorePenalties, match.awayScorePenalties)
        : null;
    return {
      id: `match-${match.id}`,
      type: "match" as const,
      title: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      subtitle: `${match.tournament.name} · ${match.stage} · ${score}${pens !== null ? ` (${pens} pens)` : ""}`,
      description: compactKeywords([
        match.stadium?.name ?? null,
        match.decidedByPenalties ? "Decided by penalty shootout" : null,
      ]).join(" · "),
      href: `/matches/${match.slug}`,
      keywords: compactKeywords([
        match.homeTeam.name,
        match.awayTeam.name,
        match.stage,
        String(match.tournament.year),
        match.stadium?.name ?? null,
        ...scoreKeywords(match.homeScore, match.awayScore),
        ...(match.decidedByPenalties ? ["penalty shootout", "penalties"] : []),
      ]),
      tournamentYear: match.tournament.year,
      stage: match.stage,
      sortYear: match.tournament.year,
    };
  });
}

export async function buildRecordSearchDocuments(): Promise<SearchDocument[]> {
  const records = await getRecordsOverview();
  const categories: { name: string; boards: typeof records.teamRecords }[] = [
    { name: "Team records", boards: records.teamRecords },
    { name: "Player records", boards: records.playerRecords },
    { name: "Match records", boards: records.matchRecords },
    { name: "Tournament records", boards: records.tournamentRecords },
    { name: "Penalty records", boards: records.penaltyRecords },
    { name: "Discipline records", boards: records.disciplineRecords },
  ];
  return categories.flatMap((category) =>
    category.boards
      .filter((board) => board.items.length > 0)
      .map((board) => {
        const top = board.items[0];
        return {
          id: `record-${board.key}`,
          type: "record" as const,
          title: board.title,
          subtitle: `${top.label} — ${top.value}`,
          description: board.description,
          href: "/records",
          keywords: compactKeywords([
            board.key.split("-").join(" "),
            category.name,
            "record",
            "leaderboard",
            ...board.items.slice(0, 3).map((item) => item.label),
          ]),
        };
      }),
  );
}

const eventMatchSelect = {
  select: {
    slug: true,
    stage: true,
    homeTeam: { select: { name: true } },
    awayTeam: { select: { name: true } },
    tournament: { select: { year: true } },
  },
} as const;

export async function buildEventSearchDocuments(): Promise<SearchDocument[]> {
  // v1 deliberately indexes goals, shootout penalty kicks, and awards only.
  // Bookings/substitutions would make the index noisy without adding much
  // search value — they remain browsable in the data explorer.
  const [goals, penaltyKicks, awards] = await Promise.all([
    prisma.goal.findMany({
      include: {
        match: eventMatchSelect,
        team: { select: { name: true } },
        player: { select: { name: true } },
      },
    }),
    prisma.penaltyKick.findMany({
      include: {
        match: eventMatchSelect,
        team: { select: { name: true } },
        player: { select: { name: true } },
      },
    }),
    prisma.award.findMany({
      include: {
        tournament: { select: { year: true } },
        player: { select: { name: true, slug: true } },
        team: { select: { name: true } },
      },
    }),
  ]);

  const goalDocs = goals.map((goal) => {
    const matchLabel = `${goal.match.homeTeam.name} vs ${goal.match.awayTeam.name}`;
    const kind = goal.isOwnGoal
      ? "own goal"
      : goal.isPenalty
        ? "penalty goal"
        : "goal";
    return {
      id: `goal-${goal.id}`,
      type: "event" as const,
      title: `${goal.player.name} ${kind}`,
      subtitle: `${matchLabel} · ${goal.match.tournament.year}`,
      description: compactKeywords([
        formatMinute(goal.minute, goal.stoppageMinute),
        goal.match.stage,
        `for ${goal.team.name}`,
      ]).join(" · "),
      href: `/matches/${goal.match.slug}`,
      keywords: compactKeywords([
        goal.player.name,
        goal.team.name,
        goal.match.homeTeam.name,
        goal.match.awayTeam.name,
        String(goal.match.tournament.year),
        goal.match.stage,
        kind,
        "goals",
      ]),
      tournamentYear: goal.match.tournament.year,
      playerName: goal.player.name,
      stage: goal.match.stage,
      sortYear: goal.match.tournament.year,
    };
  });

  const penaltyDocs = penaltyKicks.map((kick) => {
    const matchLabel = `${kick.match.homeTeam.name} vs ${kick.match.awayTeam.name}`;
    const outcome = kick.converted ? "converted" : "not converted";
    return {
      id: `pk-${kick.id}`,
      type: "event" as const,
      title: `${kick.player?.name ?? "Unknown taker"} shootout penalty`,
      subtitle: `${matchLabel} · ${kick.match.tournament.year}`,
      description: `${outcome} · ${kick.match.stage}`,
      href: `/matches/${kick.match.slug}`,
      keywords: compactKeywords([
        kick.player?.name ?? null,
        kick.team.name,
        kick.match.homeTeam.name,
        kick.match.awayTeam.name,
        String(kick.match.tournament.year),
        "penalty shootout",
        "penalty",
        outcome,
      ]),
      tournamentYear: kick.match.tournament.year,
      playerName: kick.player?.name ?? undefined,
      stage: kick.match.stage,
      sortYear: kick.match.tournament.year,
    };
  });

  const awardDocs = awards.map((award) => ({
    id: `award-${award.id}`,
    type: "event" as const,
    title: `${award.name} ${award.tournament.year}`,
    subtitle: compactKeywords([
      award.player?.name ?? null,
      award.team?.name ?? null,
    ]).join(" · "),
    description: "Tournament award",
    href:
      award.player !== null
        ? `/players/${award.player.slug}`
        : `/tournaments/${award.tournament.year}`,
    keywords: compactKeywords([
      award.name,
      award.player?.name ?? null,
      award.team?.name ?? null,
      String(award.tournament.year),
      "award",
    ]),
    tournamentYear: award.tournament.year,
    playerName: award.player?.name ?? undefined,
    sortYear: award.tournament.year,
  }));

  return [...goalDocs, ...penaltyDocs, ...awardDocs];
}

/** "FUN_FACT" → "Fun fact", "SCHEDULE_2026" → "Schedule 2026". */
function factCategoryLabel(category: string): string {
  const words = category.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Discovery Vault facts. Only PUBLISHED facts are ever indexed (same rule as
// the public query layer). Environments where the Fact tables have not been
// migrated yet simply contribute zero documents — indexing never fails
// because of the vault.
export async function buildFactSearchDocuments(): Promise<SearchDocument[]> {
  const facts = await prisma.fact
    .findMany({
      where: { status: "PUBLISHED" },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        category: true,
        eraStartYear: true,
        eraEndYear: true,
        tags: true,
      },
    })
    .catch(() => []);
  return facts.map((fact) => {
    const categoryLabel = factCategoryLabel(fact.category);
    const year = fact.eraEndYear ?? fact.eraStartYear ?? undefined;
    return {
      id: `fact-${fact.id}`,
      type: "fact" as const,
      title: fact.title,
      subtitle: `Discovery Vault · ${categoryLabel}`,
      description: fact.summary,
      href: `/facts/${fact.slug}`,
      keywords: compactKeywords([
        ...fact.tags,
        categoryLabel,
        "fact",
        "discovery vault",
        "trivia",
        fact.eraStartYear !== null ? String(fact.eraStartYear) : null,
        fact.eraEndYear !== null ? String(fact.eraEndYear) : null,
      ]),
      tournamentYear: year,
      sortYear: year,
    };
  });
}

// 2026 imported archive (Mominul-only import; WorldCup2026* tables). Indexed
// only when the import has populated the tables — an empty archive simply
// contributes zero documents, so indexing never fails because of 2026.
export async function buildWorldCup2026SearchDocuments(): Promise<
  SearchDocument[]
> {
  const matchCount = await prisma.worldCup2026Match.count().catch(() => 0);
  if (matchCount === 0) return [];

  const [teams, venues, matches, players] = await Promise.all([
    prisma.worldCup2026Team.findMany(),
    prisma.worldCup2026Venue.findMany(),
    prisma.worldCup2026Match.findMany({
      include: { venue: { select: { name: true } } },
    }),
    prisma.worldCup2026Player.findMany({
      include: { stats: { select: { goals: true, assists: true } } },
    }),
  ]);

  // One tournament document for the 2026 archive hub. Champion/final are
  // derived from the imported final row — never hardcoded.
  const finalRow = matches.find((match) => match.stageName === "Final");
  const championName =
    finalRow?.winnerTeamCode != null
      ? finalRow.winnerTeamCode === finalRow.homeTeamCode
        ? finalRow.homeTeamName
        : finalRow.awayTeamName
      : null;
  const tournamentDoc: SearchDocument = {
    id: "wc2026-tournament",
    type: "tournament",
    title: "2026 World Cup",
    subtitle: "Completed tournament archive",
    description:
      finalRow != null && finalRow.homeScore !== null
        ? `${championName !== null ? `Champion ${championName} · ` : ""}Final ${finalRow.homeTeamName} ${finalRow.homeScore}–${finalRow.awayScore} ${finalRow.awayTeamName}${finalRow.resultType === "AET" ? " AET" : ""}`
        : null,
    href: "/tournaments/2026",
    keywords: [
      "2026",
      "world cup 2026",
      "2026 final",
      ...(championName !== null ? [championName] : []),
    ],
    tournamentYear: 2026,
    sortYear: 2026,
  };

  const teamDocs: SearchDocument[] = teams.map((team) => ({
    id: `wc2026-team-${team.id}`,
    type: "country",
    title: team.name,
    subtitle: "2026 World Cup team",
    description: [
      team.groupLetter !== null ? `Group ${team.groupLetter}` : null,
      team.confederation,
      team.managerName !== null ? `Manager ${team.managerName}` : null,
    ]
      .filter((value) => value !== null)
      .join(" · "),
    href: "/tournaments/2026#teams",
    keywords: [
      team.name,
      team.fifaCode ?? "",
      "2026",
      "world cup 2026",
    ].filter((keyword) => keyword !== ""),
    tournamentYear: 2026,
    countryName: team.name,
    countryCode: team.fifaCode ?? undefined,
    sortYear: 2026,
  }));

  const venueDocs: SearchDocument[] = venues.map((venue) => ({
    id: `wc2026-venue-${venue.id}`,
    type: "venue",
    title: venue.name,
    subtitle: "2026 World Cup venue",
    description: [venue.city, venue.country]
      .filter((value) => value !== null)
      .join(", "),
    href: "/tournaments/2026#venues",
    keywords: [venue.name, venue.city ?? "", venue.country ?? "", "2026"].filter(
      (keyword) => keyword !== "",
    ),
    tournamentYear: 2026,
    sortYear: 2026,
  }));

  const matchDocs: SearchDocument[] = matches.map((match) => ({
    id: `wc2026-match-${match.id}`,
    type: "match",
    title: `${match.homeTeamName ?? "?"} ${match.homeScore ?? "–"}–${match.awayScore ?? "–"} ${match.awayTeamName ?? "?"}`,
    subtitle: `2026 · ${match.stageName ?? "Match"}`,
    description: match.venue?.name ?? null,
    href: `/matches/2026/${match.sourceMatchId}`,
    keywords: [
      match.homeTeamName ?? "",
      match.awayTeamName ?? "",
      match.stageName ?? "",
      "2026",
    ].filter((keyword) => keyword !== ""),
    tournamentYear: 2026,
    stage: match.stageName ?? undefined,
    sortYear: 2026,
  }));

  const playerDocs: SearchDocument[] = players.map((player) => ({
    id: `wc2026-player-${player.id}`,
    type: "player",
    title: player.name,
    subtitle: `2026 · ${player.teamName ?? "World Cup squad"}`,
    description: [
      player.position,
      player.stats?.goals != null && player.stats.goals > 0
        ? `${player.stats.goals} goals`
        : null,
    ]
      .filter((value) => value !== null)
      .join(" · "),
    href: `/tournaments/2026/players/${player.sourcePlayerId}`,
    keywords: [player.name, player.teamName ?? "", "2026"].filter(
      (keyword) => keyword !== "",
    ),
    tournamentYear: 2026,
    playerName: player.name,
    countryName: player.teamName ?? undefined,
    sortYear: 2026,
  }));

  return [tournamentDoc, ...teamDocs, ...venueDocs, ...matchDocs, ...playerDocs];
}

export async function buildAllSearchDocuments(): Promise<SearchDocument[]> {
  const [
    tournaments,
    countries,
    players,
    matches,
    records,
    events,
    facts,
    wc2026,
  ] = await Promise.all([
    buildTournamentSearchDocuments(),
    buildCountrySearchDocuments(),
    buildPlayerSearchDocuments(),
    buildMatchSearchDocuments(),
    buildRecordSearchDocuments(),
    buildEventSearchDocuments(),
    buildFactSearchDocuments(),
    buildWorldCup2026SearchDocuments(),
  ]);
  return [
    ...tournaments,
    ...countries,
    ...players,
    ...matches,
    ...records,
    ...events,
    ...facts,
    ...wc2026,
  ];
}
