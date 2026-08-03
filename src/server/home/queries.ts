// Homepage data orchestrator (Phase 4). One server-side entry point that
// assembles everything the homepage needs from the existing DB-backed query
// layer + the media layer. Every non-critical section is wrapped in its own
// try/catch with a clear `[home]` log prefix and a safe fallback, so a failure
// in fixtures, media, finals, or any single section can never crash the page.
//
// Rules honored:
// - Server-only. Reads Prisma + query helpers directly — never internal API
//   routes, never external providers.
// - Only APPROVED media is returned (the media query layer enforces this).
// - No hardcoded historical totals — stats/timeline/finals come from the DB.

import { prisma } from "@/server/db/prisma";
import { isLatestMatchesSectionEnabled } from "@/config/features";
import { getCombinedArchiveStats } from "@/server/archive/stats";
import { buildWc2026FinalSummary } from "@/server/worldcup2026/canonicalBridge";
import { getWc2026Overview } from "@/server/worldcup2026/queries";
import { getTournamentCards } from "@/server/queries/tournaments";
import { getRecordsOverview } from "@/server/queries/records";
import { getHomeFixtures2026 } from "@/server/fixtures/queries";
import {
  getMediaForEntities,
  getPrimaryPlayerPortraitsBySlug,
} from "@/server/media/queries";
import {
  finalStageFilter,
  formatFinalScore,
  matchCardInclude,
} from "@/server/queries/helpers";
import { MediaAssetType, MediaEntityType } from "@/generated/prisma/enums";
import { formatStage } from "@/lib/format";
import type { MediaAssetDto } from "@/server/media/types";
import type {
  RecordLeaderboardDto,
  TournamentCardDto,
} from "@/server/queries/types";
import type { FixtureDto, FixtureFreshness } from "@/server/fixtures/types";

const FEATURED_TOURNAMENTS_LIMIT = 6;
const RECENT_FINALS_LIMIT = 6;
const COUNTRY_HIGHLIGHTS_LIMIT = 12;
const PLAYER_RECORDS_LIMIT = 5;

export type HomeArchiveStats = {
  tournaments: number;
  matches: number;
  goals: number;
  nations: number;
  champions: number;
  spanStart: number | null;
  spanEnd: number | null;
};

export type HomeTimelineEntry = {
  year: number;
  host: string | null;
  winner: string | null;
};

export type HomeFeaturedTournament = TournamentCardDto & {
  /** Approved HERO media for the tournament, or null (CSS fallback). */
  heroMedia: MediaAssetDto | null;
};

export type HomeFinal = {
  id: string;
  slug: string;
  year: number;
  tournamentName: string;
  stageLabel: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  decidedByPenalties: boolean;
  venue: string | null;
  /** Approved EVENT_COVER media for the match, or null (flags + scoreline). */
  eventMedia: MediaAssetDto | null;
};

export type HomeCountryHighlight = {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  /** Tournament entries (Team rows are per tournament) — honest appearances. */
  appearances: number;
};

export type HomePlayerRecord = {
  id: string;
  name: string;
  slug: string;
  countryName: string | null;
  /** World Cup goals excluding own goals — the record this card stands for. */
  goals: number;
  portraitUrl: string | null;
};

export type HomeFixtureData = {
  latest: FixtureDto[];
  live: FixtureDto[];
  today: FixtureDto[];
  results: FixtureDto[];
  upcoming: FixtureDto[];
  nextUpcoming: FixtureDto | null;
  freshness: FixtureFreshness;
};

export type HomeViewModel = {
  archiveStats: HomeArchiveStats;
  fixtures: HomeFixtureData | null;
  timeline: HomeTimelineEntry[];
  featuredTournaments: HomeFeaturedTournament[];
  recentFinals: HomeFinal[];
  countries: HomeCountryHighlight[];
  playerRecords: HomePlayerRecord[];
  records: RecordLeaderboardDto[];
};

const EMPTY_STATS: HomeArchiveStats = {
  tournaments: 0,
  matches: 0,
  goals: 0,
  nations: 0,
  champions: 0,
  spanStart: null,
  spanEnd: null,
};

/**
 * Archive-at-a-glance counters — combined canonical + imported 2026 archive
 * (src/server/archive/stats.ts). Champions and the span derive from the
 * 2026-inclusive tournament cards; nothing is hardcoded, and the combined
 * layer guards against double-counting if 2026 is later promoted into the
 * canonical tables.
 */
async function getArchiveStatsSection(
  tournamentCards: TournamentCardDto[],
): Promise<HomeArchiveStats> {
  try {
    const combined = await getCombinedArchiveStats(tournamentCards);
    return {
      tournaments: combined.tournamentsCount,
      matches: combined.matchesCount,
      goals: combined.goalsCount,
      nations: combined.nationsCount,
      champions: combined.championsCount,
      spanStart: combined.spanStart,
      spanEnd: combined.spanEnd,
    };
  } catch (error) {
    console.error("[home] failed to load archive stats", error);
    return EMPTY_STATS;
  }
}

async function getFixturesSection(): Promise<HomeFixtureData | null> {
  // Post-tournament archive mode: the homepage band is hidden, so don't spend
  // the fixture queries. (Reads are DB-only either way — never a provider.)
  if (!isLatestMatchesSectionEnabled()) return null;
  try {
    return await getHomeFixtures2026();
  } catch (error) {
    console.error("[home] failed to load 2026 fixtures", error);
    return null;
  }
}

function getTimelineSection(
  tournamentCards: TournamentCardDto[],
): HomeTimelineEntry[] {
  // Already year-desc from getTournamentCards; map to a light timeline shape.
  return tournamentCards.map((t) => ({
    year: t.year,
    host: t.hostName,
    winner: t.winner,
  }));
}

async function getFeaturedTournamentsSection(
  tournamentCards: TournamentCardDto[],
): Promise<HomeFeaturedTournament[]> {
  const featured = tournamentCards.slice(0, FEATURED_TOURNAMENTS_LIMIT);
  if (featured.length === 0) return [];
  try {
    const media = await getMediaForEntities({
      entityType: MediaEntityType.TOURNAMENT,
      entityIds: featured.map((t) => t.id),
      usage: MediaAssetType.HERO,
    });
    return featured.map((t) => ({ ...t, heroMedia: media.get(t.id) ?? null }));
  } catch (error) {
    console.error("[home] failed to load featured tournament media", error);
    return featured.map((t) => ({ ...t, heroMedia: null }));
  }
}

async function getRecentFinalsSection(): Promise<HomeFinal[]> {
  try {
    const finals = await prisma.match.findMany({
      where: { stage: finalStageFilter },
      include: matchCardInclude,
      orderBy: { matchDate: "desc" },
      take: RECENT_FINALS_LIMIT,
    });

    let eventMedia = new Map<string, MediaAssetDto>();
    try {
      eventMedia = await getMediaForEntities({
        entityType: MediaEntityType.MATCH,
        entityIds: finals.map((match) => match.id),
        usage: MediaAssetType.EVENT_COVER,
      });
    } catch (mediaError) {
      console.error("[home] failed to load final event media", mediaError);
    }

    const list: HomeFinal[] = finals.map((match) => ({
      id: match.id,
      slug: match.slug,
      year: match.tournament.year,
      tournamentName: match.tournament.name,
      stageLabel: formatStage(match.stage) ?? "Final",
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      score: formatFinalScore(match),
      decidedByPenalties: match.decidedByPenalties,
      venue: match.stadium?.name ?? null,
      eventMedia: eventMedia.get(match.id) ?? null,
    }));

    // The imported 2026 final leads the board (skipped once a canonical 2026
    // final exists — no duplicates). Its slug path routes to /matches/2026/<id>.
    try {
      if (!list.some((final) => final.year === 2026)) {
        const overview = await getWc2026Overview();
        const summary =
          overview !== null ? buildWc2026FinalSummary(overview) : null;
        if (summary !== null) {
          list.unshift({
            id: summary.id,
            slug: summary.matchSlugPath,
            year: summary.year,
            tournamentName: summary.tournamentName,
            stageLabel: "Final",
            homeTeam: summary.homeTeam,
            awayTeam: summary.awayTeam,
            score: summary.score,
            decidedByPenalties: summary.decidedByPenalties,
            venue: summary.venue,
            eventMedia: null,
          });
        }
      }
    } catch (bridgeError) {
      console.error("[home] 2026 final bridge unavailable", bridgeError);
    }

    return list.slice(0, RECENT_FINALS_LIMIT);
  } catch (error) {
    console.error("[home] failed to load recent finals", error);
    return [];
  }
}

async function getCountryHighlightsSection(): Promise<HomeCountryHighlight[]> {
  try {
    const countries = await prisma.country.findMany({
      include: { _count: { select: { teams: true } } },
      orderBy: { teams: { _count: "desc" } },
      take: COUNTRY_HIGHLIGHTS_LIMIT,
    });
    return countries.map((country) => ({
      id: country.id,
      name: country.name,
      slug: country.slug,
      code: country.code,
      appearances: country._count.teams,
    }));
  } catch (error) {
    console.error("[home] failed to load country highlights", error);
    return [];
  }
}

async function getPlayerRecordsSection(): Promise<HomePlayerRecord[]> {
  try {
    const grouped = await prisma.goal.groupBy({
      by: ["playerId"],
      where: { isOwnGoal: false },
      _count: { _all: true },
      orderBy: { _count: { playerId: "desc" } },
      take: PLAYER_RECORDS_LIMIT,
    });
    if (grouped.length === 0) return [];

    const players = await prisma.player.findMany({
      where: { id: { in: grouped.map((g) => g.playerId) } },
      include: { country: { select: { name: true } } },
    });
    const byId = new Map(players.map((p) => [p.id, p]));

    let portraits = new Map<string, MediaAssetDto>();
    try {
      portraits = await getPrimaryPlayerPortraitsBySlug(
        players.map((p) => p.slug),
      );
    } catch (mediaError) {
      console.error("[home] failed to load player portraits", mediaError);
    }

    return grouped.flatMap((group) => {
      const player = byId.get(group.playerId);
      if (player === undefined) return [];
      return [
        {
          id: player.id,
          name: player.name,
          slug: player.slug,
          countryName: player.country?.name ?? null,
          goals: group._count._all,
          portraitUrl: portraits.get(player.slug)?.url ?? null,
        },
      ];
    });
  } catch (error) {
    console.error("[home] failed to load player records", error);
    return [];
  }
}

async function getRecordsSection(): Promise<RecordLeaderboardDto[]> {
  try {
    const overview = await getRecordsOverview();
    const boards = [
      overview.playerRecords[0],
      overview.teamRecords[0],
      overview.matchRecords[0],
    ].filter(
      (board): board is RecordLeaderboardDto =>
        board !== undefined && board.items.length > 0,
    );
    return boards.map((board) => ({
      ...board,
      items: board.items.slice(0, 3),
    }));
  } catch (error) {
    console.error("[home] failed to load records preview", error);
    return [];
  }
}

/**
 * Assemble the full homepage view model. Tournament cards are loaded once and
 * shared across the stats/timeline/featured sections. Each section degrades to
 * a safe fallback on failure — the page always renders.
 */
export async function getHomeViewModel(): Promise<HomeViewModel> {
  let tournamentCards: TournamentCardDto[] = [];
  try {
    tournamentCards = await getTournamentCards();
  } catch (error) {
    console.error("[home] failed to load tournament cards", error);
  }

  const [
    archiveStats,
    fixtures,
    featuredTournaments,
    recentFinals,
    countries,
    playerRecords,
    records,
  ] = await Promise.all([
    getArchiveStatsSection(tournamentCards),
    getFixturesSection(),
    getFeaturedTournamentsSection(tournamentCards),
    getRecentFinalsSection(),
    getCountryHighlightsSection(),
    getPlayerRecordsSection(),
    getRecordsSection(),
  ]);

  return {
    archiveStats,
    fixtures,
    timeline: getTimelineSection(tournamentCards),
    featuredTournaments,
    recentFinals,
    countries,
    playerRecords,
    records,
  };
}
