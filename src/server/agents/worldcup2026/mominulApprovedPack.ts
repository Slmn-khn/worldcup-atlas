// Approved Mominul import pack — the ONLY data source for the 2026 archive
// import (policy: mominulImportPolicy.ts).
//
// Reads the collected raw snapshots under data/2026/raw/mominul_2026_dataset/
// (via the existing tolerant CSV layer), joins/normalizes them into typed
// records mirroring the WorldCup2026* Prisma models, validates hard
// invariants (counts, duplicate ids, referential integrity, the final), and
// can write/load the finalized pack under data/2026/approved/mominul/
// finalized/. Excluded on principle: match_prediction_features.csv (ML-only),
// every non-Mominul source. No database access anywhere in this module.
//
// Relative runtime imports only (no "@/" alias) so tsx scripts can load it.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256Hex } from "./collector";
import { DATA_2026_DIR, MOMINUL_SOURCE_ID, RAW_2026_DIR } from "./sourceRegistry";
import { parseMominulFile } from "./providers/mominulDataset";
import { pickInt, pickNumber, pickString } from "./providers/tolerantCsv";
import { getFlagCodeForCountry } from "../../../lib/media/flags";

export const MOMINUL_APPROVED_PACK_DIR = path.join(
  DATA_2026_DIR,
  "approved",
  "mominul",
  "finalized",
);

/** Raw source files the pack is built from (all Mominul, nothing else). */
export const MOMINUL_PACK_SOURCE_FILES = [
  "teams.csv",
  "venues.csv",
  "tournament_stages.csv",
  "referees.csv",
  "matches.csv",
  "matches_detailed.csv",
  "squads_and_players.csv",
  "match_events.csv",
  "match_team_stats.csv",
  "match_lineups.csv",
  "player_stats.csv",
  "real_match_details.json",
] as const;

/** Never read, never imported: ML-only feature set. */
export const MOMINUL_PACK_EXCLUDED_FILES = ["match_prediction_features.csv"] as const;

// ---------------------------------------------------------------------------
// Record types (mirror the WorldCup2026* Prisma models; ints are source ids)
// ---------------------------------------------------------------------------

export type Mominul2026Team = {
  sourceTeamId: number;
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

export type Mominul2026Venue = {
  sourceVenueId: number;
  name: string;
  slug: string;
  stadiumName: string | null;
  city: string | null;
  country: string | null;
  capacity: number | null;
  latitude: number | null;
  longitude: number | null;
  elevationMeters: number | null;
};

export type Mominul2026Stage = {
  sourceStageId: number;
  name: string;
  slug: string;
  isKnockout: boolean;
  sortOrder: number;
};

export type Mominul2026Referee = {
  sourceRefereeId: number;
  name: string;
  slug: string;
  country: string | null;
  avgCardsPerGame: number | null;
};

export type Mominul2026Match = {
  sourceMatchId: number;
  matchNumber: number;
  date: string | null;
  kickoffTimeUtc: string | null;
  sourceStageId: number | null;
  stageName: string | null;
  groupLetter: string | null;
  sourceVenueId: number | null;
  venueName: string | null;
  cityName: string | null;
  sourceHomeTeamId: number | null;
  sourceAwayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  status: string;
  resultType: string | null;
  winnerTeamCode: string | null;
  winnerTeamName: string | null;
  homeXg: number | null;
  awayXg: number | null;
  goalkeeperHome: string | null;
  goalkeeperAway: string | null;
  playerOfTheMatch: string | null;
  sourceRefereeId: number | null;
  refereeName: string | null;
};

export type Mominul2026Player = {
  sourcePlayerId: number;
  sourceTeamId: number | null;
  teamName: string | null;
  teamCode: string | null;
  name: string;
  slug: string;
  position: string | null;
  club: string | null;
  marketValueEur: number | null;
  caps: number | null;
  dateOfBirth: string | null;
  heightCm: number | null;
  internationalGoals: number | null;
};

export type Mominul2026Event = {
  sourceEventId: number;
  sourceMatchId: number;
  sourcePlayerId: number | null;
  sourceTeamId: number | null;
  teamCode: string | null;
  teamName: string | null;
  minute: number | null;
  stoppageMinute: number | null;
  eventType: string;
  playerName: string | null;
  cardType: string | null;
};

export type Mominul2026Lineup = {
  sourceLineupId: number;
  sourceMatchId: number;
  sourcePlayerId: number | null;
  sourceTeamId: number | null;
  teamCode: string | null;
  teamName: string | null;
  playerName: string | null;
  isStarting: boolean | null;
  tacticalPosition: string | null;
  minutesPlayed: number | null;
};

export type Mominul2026PlayerStat = {
  sourcePlayerId: number;
  sourceTeamId: number | null;
  playerName: string | null;
  teamCode: string | null;
  matchesPlayed: number | null;
  matchesStarted: number | null;
  minutesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
  penaltiesScored: number | null;
  ownGoals: number | null;
  saves: number | null;
  goalsConceded: number | null;
  cleanSheets: number | null;
  averageRating: number | null;
  dataSource: string | null;
  lastVerified: string | null;
};

export type Mominul2026TeamMatchStat = {
  sourceMatchId: number;
  sourceTeamId: number;
  teamCode: string | null;
  teamName: string | null;
  possessionPct: number | null;
  totalShots: number | null;
  shotsOnTarget: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  saves: number | null;
  dataSource: string | null;
  lastUpdated: string | null;
};

export type Mominul2026TournamentSummary = {
  year: 2026;
  name: string;
  hosts: string[];
  startDate: string | null;
  endDate: string | null;
  teamsCount: number;
  matchesCount: number;
  venuesCount: number;
  playersCount: number;
  goalsCount: number;
  championTeamCode: string | null;
  championTeamName: string | null;
  runnerUpTeamCode: string | null;
  runnerUpTeamName: string | null;
  thirdTeamCode: string | null;
  thirdTeamName: string | null;
  fourthTeamCode: string | null;
  fourthTeamName: string | null;
  finalScoreLine: string | null;
};

export type MominulApprovedPackManifest = {
  schema: "mominul-approved-pack/v1";
  sourceId: string;
  generatedAt: string;
  sourceFiles: string[];
  fileHashes: Record<string, string>;
  recordCounts: Record<string, number>;
  excludedFiles: string[];
  approval: "USER_VERIFIED_SOURCE";
  notes: string[];
};

export type MominulApprovedPack = {
  manifest: MominulApprovedPackManifest;
  tournament: Mominul2026TournamentSummary;
  teams: Mominul2026Team[];
  venues: Mominul2026Venue[];
  stages: Mominul2026Stage[];
  referees: Mominul2026Referee[];
  matches: Mominul2026Match[];
  players: Mominul2026Player[];
  events: Mominul2026Event[];
  lineups: Mominul2026Lineup[];
  playerStats: Mominul2026PlayerStat[];
  teamMatchStats: Mominul2026TeamMatchStat[];
};

export type MominulPackBuildResult = {
  pack: MominulApprovedPack;
  warnings: string[];
  errors: string[];
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Mirrors scripts/import/utils/slug.ts — stable, diacritic-folding slugs. */
export function slugify2026(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "True"/"true"/1 → true, "False"/"false"/0 → false, else null. */
function parseBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return null;
}

/** "45" → {minute:45}; "90+3" → {minute:90, stoppage:3}. */
function parseMinute(value: unknown): {
  minute: number | null;
  stoppage: number | null;
} {
  if (typeof value === "number" && Number.isInteger(value)) {
    return { minute: value, stoppage: null };
  }
  if (typeof value === "string") {
    const match = /^(\d+)\s*\+\s*(\d+)$/.exec(value.trim());
    if (match !== null) {
      return { minute: Number(match[1]), stoppage: Number(match[2]) };
    }
    const plain = /^(\d+)$/.exec(value.trim());
    if (plain !== null) return { minute: Number(plain[1]), stoppage: null };
  }
  return { minute: null, stoppage: null };
}

function cardTypeFor(eventType: string): string | null {
  const lower = eventType.toLowerCase();
  if (lower.includes("second yellow")) return "SECOND_YELLOW";
  if (lower.includes("yellow")) return "YELLOW";
  if (lower.includes("red")) return "RED";
  return null;
}

/** Winner code from scores (+ penalties when level). Null for level w/o pens. */
export function matchWinnerCode(match: {
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
}): string | null {
  if (match.homeScore === null || match.awayScore === null) return null;
  if (match.homeScore > match.awayScore) return match.homeTeamCode;
  if (match.awayScore > match.homeScore) return match.awayTeamCode;
  if (match.homePenaltyScore !== null && match.awayPenaltyScore !== null) {
    if (match.homePenaltyScore > match.awayPenaltyScore) return match.homeTeamCode;
    if (match.awayPenaltyScore > match.homePenaltyScore) return match.awayTeamCode;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build from raw snapshots
// ---------------------------------------------------------------------------

type ParsedRows = Record<string, unknown>[];

async function readRows(
  rawDir: string,
  fileName: string,
  warnings: string[],
  errors: string[],
): Promise<ParsedRows> {
  const filePath = path.join(rawDir, MOMINUL_SOURCE_ID, fileName);
  let body: string;
  try {
    body = await readFile(filePath, "utf8");
  } catch {
    errors.push(`Missing required source file: ${fileName}. Run pnpm data:2026:collect.`);
    return [];
  }
  const parsed = parseMominulFile(fileName, body);
  if (parsed.fileError !== null) {
    errors.push(`${fileName}: ${parsed.fileError}`);
    return [];
  }
  const rows: ParsedRows = [];
  for (const record of parsed.records) {
    if (record.parseStatus === "ERROR") {
      warnings.push(
        `${fileName} row ${record.sourceRowNumber}: unusable row skipped (${record.warnings.join("; ") || "no key columns"}).`,
      );
      continue;
    }
    rows.push(record.parsed);
  }
  return rows;
}

async function hashSourceFiles(
  rawDir: string,
): Promise<{ hashes: Record<string, string>; present: string[] }> {
  const hashes: Record<string, string> = {};
  const present: string[] = [];
  for (const fileName of MOMINUL_PACK_SOURCE_FILES) {
    try {
      const body = await readFile(
        path.join(rawDir, MOMINUL_SOURCE_ID, fileName),
        "utf8",
      );
      hashes[fileName] = sha256Hex(body);
      present.push(fileName);
    } catch {
      // absence is reported by readRows for required files
    }
  }
  return { hashes, present };
}

/**
 * Builds the full approved pack from the raw Mominul snapshots. Pure other
 * than reading the snapshot files; never writes, never touches a database.
 */
export async function buildMominulApprovedPack(
  rawDir: string = RAW_2026_DIR,
  generatedAt = new Date().toISOString(),
): Promise<MominulPackBuildResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const [
    teamRows,
    venueRows,
    stageRows,
    refereeRows,
    matchRows,
    matchDetailRows,
    squadRows,
    eventRows,
    teamStatRows,
    lineupRows,
    playerStatRows,
  ] = await Promise.all([
    readRows(rawDir, "teams.csv", warnings, errors),
    readRows(rawDir, "venues.csv", warnings, errors),
    readRows(rawDir, "tournament_stages.csv", warnings, errors),
    readRows(rawDir, "referees.csv", warnings, errors),
    readRows(rawDir, "matches.csv", warnings, errors),
    readRows(rawDir, "matches_detailed.csv", warnings, errors),
    readRows(rawDir, "squads_and_players.csv", warnings, errors),
    readRows(rawDir, "match_events.csv", warnings, errors),
    readRows(rawDir, "match_team_stats.csv", warnings, errors),
    readRows(rawDir, "match_lineups.csv", warnings, errors),
    readRows(rawDir, "player_stats.csv", warnings, errors),
  ]);

  // --- teams ---------------------------------------------------------------
  const teams: Mominul2026Team[] = [];
  const teamSlugs = new Set<string>();
  for (const row of teamRows) {
    const id = pickInt(row, ["team_id", "id"]);
    const name = pickString(row, ["team_name", "name"]);
    if (id === null || name === null) {
      warnings.push(`teams.csv: skipped row without team_id/team_name.`);
      continue;
    }
    const fifaCode = pickString(row, ["fifa_code"]);
    let slug = slugify2026(name);
    if (teamSlugs.has(slug)) slug = `${slug}-${id}`;
    teamSlugs.add(slug);
    teams.push({
      sourceTeamId: id,
      name,
      slug,
      fifaCode,
      flagCode: getFlagCodeForCountry({ code: fifaCode, name }),
      groupLetter: pickString(row, ["group_letter", "group"]),
      confederation: pickString(row, ["confederation"]),
      fifaRanking: pickInt(row, ["fifa_ranking_pre_tournament", "fifa_ranking"]),
      eloRating: pickInt(row, ["elo_rating"]),
      managerName: pickString(row, ["manager_name", "manager"]),
    });
  }
  const teamById = new Map(teams.map((team) => [team.sourceTeamId, team]));

  // --- venues --------------------------------------------------------------
  const venues: Mominul2026Venue[] = [];
  const venueSlugs = new Set<string>();
  for (const row of venueRows) {
    const id = pickInt(row, ["venue_id", "id"]);
    const name = pickString(row, ["stadium_name", "venue_name", "name"]);
    if (id === null || name === null) {
      warnings.push(`venues.csv: skipped row without venue_id/stadium_name.`);
      continue;
    }
    let slug = slugify2026(name);
    if (venueSlugs.has(slug)) slug = `${slug}-${id}`;
    venueSlugs.add(slug);
    venues.push({
      sourceVenueId: id,
      name,
      slug,
      stadiumName: name,
      city: pickString(row, ["city"]),
      country: pickString(row, ["country"]),
      capacity: pickInt(row, ["capacity"]),
      latitude: pickNumber(row, ["latitude"]),
      longitude: pickNumber(row, ["longitude"]),
      elevationMeters: pickInt(row, ["elevation_meters"]),
    });
  }
  const venueById = new Map(venues.map((venue) => [venue.sourceVenueId, venue]));

  // --- stages --------------------------------------------------------------
  const stages: Mominul2026Stage[] = [];
  for (const row of stageRows) {
    const id = pickInt(row, ["stage_id", "id"]);
    const name = pickString(row, ["stage_name", "name"]);
    if (id === null || name === null) {
      warnings.push(`tournament_stages.csv: skipped row without stage_id/name.`);
      continue;
    }
    stages.push({
      sourceStageId: id,
      name,
      slug: slugify2026(name),
      isKnockout: parseBool(row["is_knockout"]) ?? false,
      // Source stage ids are chronological (1 = Group Stage … 7 = Final).
      sortOrder: id,
    });
  }
  const stageById = new Map(stages.map((stage) => [stage.sourceStageId, stage]));

  // --- referees ------------------------------------------------------------
  const referees: Mominul2026Referee[] = [];
  for (const row of refereeRows) {
    const id = pickInt(row, ["referee_id", "id"]);
    const name = pickString(row, ["name", "referee_name"]);
    if (id === null || name === null) {
      warnings.push(`referees.csv: skipped row without referee_id/name.`);
      continue;
    }
    referees.push({
      sourceRefereeId: id,
      name,
      slug: slugify2026(name),
      country: pickString(row, ["country"]),
      avgCardsPerGame: pickNumber(row, ["avg_cards_per_game"]),
    });
  }

  // --- players -------------------------------------------------------------
  const players: Mominul2026Player[] = [];
  const playerSlugs = new Set<string>();
  for (const row of squadRows) {
    const id = pickInt(row, ["player_id", "id"]);
    const name = pickString(row, ["player_name", "name"]);
    if (id === null || name === null) {
      warnings.push(`squads_and_players.csv: skipped row without player_id/name.`);
      continue;
    }
    const teamId = pickInt(row, ["team_id"]);
    const team = teamId !== null ? teamById.get(teamId) : undefined;
    let slug = slugify2026(name);
    if (playerSlugs.has(slug)) slug = `${slug}-${id}`;
    playerSlugs.add(slug);
    players.push({
      sourcePlayerId: id,
      sourceTeamId: teamId,
      teamName: team?.name ?? null,
      teamCode: team?.fifaCode ?? null,
      name,
      slug,
      position: pickString(row, ["position"]),
      club: pickString(row, ["club_team", "club"]),
      marketValueEur: pickInt(row, ["market_value_eur"]),
      caps: pickInt(row, ["caps"]),
      dateOfBirth: pickString(row, ["date_of_birth"]),
      heightCm: pickInt(row, ["height_cm"]),
      internationalGoals: pickInt(row, ["goals"]),
    });
  }
  const playerById = new Map(players.map((player) => [player.sourcePlayerId, player]));

  // --- matches (core ids + detailed names, joined on match_id) -------------
  const detailByMatchId = new Map<number, Record<string, unknown>>();
  for (const row of matchDetailRows) {
    const id = pickInt(row, ["match_id", "id"]);
    if (id !== null) detailByMatchId.set(id, row);
  }

  const matches: Mominul2026Match[] = [];
  for (const row of matchRows) {
    const id = pickInt(row, ["match_id", "id"]);
    if (id === null) {
      warnings.push(`matches.csv: skipped row without match_id.`);
      continue;
    }
    const detail = detailByMatchId.get(id) ?? {};
    const sourceStageId = pickInt(row, ["stage_id"]);
    const stage = sourceStageId !== null ? stageById.get(sourceStageId) : undefined;
    const sourceVenueId = pickInt(row, ["venue_id"]);
    const venue = sourceVenueId !== null ? venueById.get(sourceVenueId) : undefined;
    const homeId = pickInt(row, ["home_team_id"]);
    const awayId = pickInt(row, ["away_team_id"]);
    const home = homeId !== null ? teamById.get(homeId) : undefined;
    const away = awayId !== null ? teamById.get(awayId) : undefined;
    const potmId = pickInt(row, ["player_of_the_match_id"]);
    const potm =
      (potmId !== null ? playerById.get(potmId)?.name : null) ??
      pickString(detail, ["player_of_the_match_name"]);

    const match: Mominul2026Match = {
      sourceMatchId: id,
      matchNumber: id,
      date: pickString(row, ["date"]) ?? pickString(detail, ["date"]),
      kickoffTimeUtc:
        pickString(row, ["kickoff_time_utc"]) ??
        pickString(detail, ["kickoff_time_utc"]),
      sourceStageId,
      stageName: stage?.name ?? pickString(detail, ["stage_name"]),
      groupLetter:
        stage?.isKnockout === false
          ? (home?.groupLetter ?? away?.groupLetter ?? null)
          : null,
      sourceVenueId,
      venueName: venue?.name ?? pickString(detail, ["stadium_name"]),
      cityName: venue?.city ?? pickString(detail, ["city"]),
      sourceHomeTeamId: homeId,
      sourceAwayTeamId: awayId,
      homeTeamName: home?.name ?? pickString(detail, ["home_team_name"]),
      awayTeamName: away?.name ?? pickString(detail, ["away_team_name"]),
      homeTeamCode: home?.fifaCode ?? pickString(detail, ["home_fifa_code"]),
      awayTeamCode: away?.fifaCode ?? pickString(detail, ["away_fifa_code"]),
      homeScore: pickInt(row, ["home_score"]),
      awayScore: pickInt(row, ["away_score"]),
      homePenaltyScore: pickInt(row, ["home_penalty_score"]),
      awayPenaltyScore: pickInt(row, ["away_penalty_score"]),
      status: pickString(row, ["status"]) ?? "Completed",
      resultType: pickString(row, ["result_type"]),
      winnerTeamCode: null,
      winnerTeamName: null,
      homeXg: pickNumber(row, ["home_xg"]),
      awayXg: pickNumber(row, ["away_xg"]),
      goalkeeperHome: pickString(detail, ["home_goalkeeper"]),
      goalkeeperAway: pickString(detail, ["away_goalkeeper"]),
      playerOfTheMatch: potm,
      sourceRefereeId: pickInt(row, ["referee_id"]),
      refereeName: pickString(detail, ["referee_name"]),
    };
    match.winnerTeamCode = matchWinnerCode(match);
    match.winnerTeamName =
      match.winnerTeamCode === null
        ? null
        : match.winnerTeamCode === match.homeTeamCode
          ? match.homeTeamName
          : match.awayTeamName;
    matches.push(match);
  }

  // --- events --------------------------------------------------------------
  const events: Mominul2026Event[] = [];
  for (const row of eventRows) {
    const id = pickInt(row, ["event_id", "id"]);
    const matchId = pickInt(row, ["match_id"]);
    const eventType = pickString(row, ["event_type", "event"]);
    if (id === null || matchId === null || eventType === null) {
      warnings.push(`match_events.csv: skipped row without event_id/match_id/event_type.`);
      continue;
    }
    const teamId = pickInt(row, ["team_id"]);
    const team = teamId !== null ? teamById.get(teamId) : undefined;
    const playerId = pickInt(row, ["player_id"]);
    const { minute, stoppage } = parseMinute(row["minute"]);
    events.push({
      sourceEventId: id,
      sourceMatchId: matchId,
      sourcePlayerId: playerId,
      sourceTeamId: teamId,
      teamCode: team?.fifaCode ?? null,
      teamName: team?.name ?? null,
      minute,
      stoppageMinute: stoppage,
      eventType,
      playerName: playerId !== null ? (playerById.get(playerId)?.name ?? null) : null,
      cardType: cardTypeFor(eventType),
    });
  }

  // --- lineups -------------------------------------------------------------
  const lineups: Mominul2026Lineup[] = [];
  for (const row of lineupRows) {
    const id = pickInt(row, ["lineup_id", "id"]);
    const matchId = pickInt(row, ["match_id"]);
    if (id === null || matchId === null) {
      warnings.push(`match_lineups.csv: skipped row without lineup_id/match_id.`);
      continue;
    }
    const teamId = pickInt(row, ["team_id"]);
    const team = teamId !== null ? teamById.get(teamId) : undefined;
    const playerId = pickInt(row, ["player_id"]);
    const player = playerId !== null ? playerById.get(playerId) : undefined;
    lineups.push({
      sourceLineupId: id,
      sourceMatchId: matchId,
      sourcePlayerId: playerId,
      sourceTeamId: teamId,
      teamCode: team?.fifaCode ?? null,
      teamName: team?.name ?? null,
      playerName: player?.name ?? null,
      isStarting: parseBool(row["is_starting_xi"]),
      tacticalPosition: pickString(row, ["tactical_position"]),
      minutesPlayed: pickInt(row, ["minutes_played"]),
    });
  }

  // --- player stats --------------------------------------------------------
  const playerStats: Mominul2026PlayerStat[] = [];
  for (const row of playerStatRows) {
    const playerId = pickInt(row, ["player_id", "id"]);
    if (playerId === null) {
      warnings.push(`player_stats.csv: skipped row without player_id.`);
      continue;
    }
    const teamId = pickInt(row, ["team_id"]);
    const team = teamId !== null ? teamById.get(teamId) : undefined;
    playerStats.push({
      sourcePlayerId: playerId,
      sourceTeamId: teamId,
      playerName:
        pickString(row, ["player_name"]) ??
        playerById.get(playerId)?.name ??
        null,
      teamCode: team?.fifaCode ?? null,
      matchesPlayed: pickInt(row, ["matches_played"]),
      matchesStarted: pickInt(row, ["matches_started"]),
      minutesPlayed: pickInt(row, ["minutes_played"]),
      goals: pickInt(row, ["goals"]),
      assists: pickInt(row, ["assists"]),
      yellowCards: pickInt(row, ["yellow_cards"]),
      redCards: pickInt(row, ["red_cards"]),
      penaltiesScored: pickInt(row, ["penalty_goals"]),
      ownGoals: pickInt(row, ["own_goals"]),
      saves: pickInt(row, ["saves"]),
      goalsConceded: pickInt(row, ["goals_conceded"]),
      cleanSheets: pickInt(row, ["clean_sheets"]),
      averageRating: pickNumber(row, ["average_rating"]),
      dataSource: pickString(row, ["data_source"]),
      lastVerified: pickString(row, ["last_verified"]),
    });
  }

  // --- team match stats ----------------------------------------------------
  const teamMatchStats: Mominul2026TeamMatchStat[] = [];
  for (const row of teamStatRows) {
    const matchId = pickInt(row, ["match_id"]);
    const teamId = pickInt(row, ["team_id"]);
    if (matchId === null || teamId === null) {
      warnings.push(`match_team_stats.csv: skipped row without match_id/team_id.`);
      continue;
    }
    const team = teamById.get(teamId);
    teamMatchStats.push({
      sourceMatchId: matchId,
      sourceTeamId: teamId,
      teamCode: team?.fifaCode ?? null,
      teamName: team?.name ?? null,
      possessionPct: pickNumber(row, ["possession_pct"]),
      totalShots: pickInt(row, ["total_shots"]),
      shotsOnTarget: pickInt(row, ["shots_on_target"]),
      corners: pickInt(row, ["corners"]),
      fouls: pickInt(row, ["fouls"]),
      offsides: pickInt(row, ["offsides"]),
      saves: pickInt(row, ["saves"]),
      dataSource: pickString(row, ["data_source"]),
      lastUpdated: pickString(row, ["last_updated"]),
    });
  }

  // --- tournament summary (derived, never invented) ------------------------
  const finalMatch = matches.find((match) => match.stageName === "Final") ?? null;
  const thirdMatch =
    matches.find((match) => (match.stageName ?? "").toLowerCase().includes("third")) ??
    null;
  const loserOf = (match: Mominul2026Match | null): [string | null, string | null] => {
    if (match === null || match.winnerTeamCode === null) return [null, null];
    return match.winnerTeamCode === match.homeTeamCode
      ? [match.awayTeamCode, match.awayTeamName]
      : [match.homeTeamCode, match.homeTeamName];
  };
  const [runnerUpCode, runnerUpName] = loserOf(finalMatch);
  const [fourthCode, fourthName] = loserOf(thirdMatch);
  const dates = matches
    .map((match) => match.date)
    .filter((date): date is string => date !== null)
    .sort();
  const hosts = [...new Set(venues.map((venue) => venue.country).filter(
    (country): country is string => country !== null,
  ))].sort();

  const tournament: Mominul2026TournamentSummary = {
    year: 2026,
    name: "FIFA World Cup 2026",
    hosts,
    startDate: dates[0] ?? null,
    endDate: dates[dates.length - 1] ?? null,
    teamsCount: teams.length,
    matchesCount: matches.length,
    venuesCount: venues.length,
    playersCount: players.length,
    goalsCount: matches.reduce(
      (sum, match) => sum + (match.homeScore ?? 0) + (match.awayScore ?? 0),
      0,
    ),
    championTeamCode: finalMatch?.winnerTeamCode ?? null,
    championTeamName: finalMatch?.winnerTeamName ?? null,
    runnerUpTeamCode: runnerUpCode,
    runnerUpTeamName: runnerUpName,
    thirdTeamCode: thirdMatch?.winnerTeamCode ?? null,
    thirdTeamName: thirdMatch?.winnerTeamName ?? null,
    fourthTeamCode: fourthCode,
    fourthTeamName: fourthName,
    finalScoreLine:
      finalMatch !== null && finalMatch.homeScore !== null
        ? `${finalMatch.homeTeamName} ${finalMatch.homeScore}–${finalMatch.awayScore} ${finalMatch.awayTeamName}${
            finalMatch.resultType === "AET"
              ? " AET"
              : finalMatch.resultType === "Penalties"
                ? " (pens)"
                : ""
          }`
        : null,
  };

  const { hashes, present } = await hashSourceFiles(rawDir);

  const pack: MominulApprovedPack = {
    manifest: {
      schema: "mominul-approved-pack/v1",
      sourceId: MOMINUL_SOURCE_ID,
      generatedAt,
      sourceFiles: present,
      fileHashes: hashes,
      recordCounts: {
        teams: teams.length,
        venues: venues.length,
        stages: stages.length,
        referees: referees.length,
        matches: matches.length,
        players: players.length,
        events: events.length,
        lineups: lineups.length,
        playerStats: playerStats.length,
        teamMatchStats: teamMatchStats.length,
      },
      excludedFiles: [...MOMINUL_PACK_EXCLUDED_FILES],
      approval: "USER_VERIFIED_SOURCE",
      notes: [
        "This pack is generated only from the Mominul FIFA World Cup 2026 Dataset.",
        "No OpenFootball/worldcup26/Bustami/manual-pack rows are imported.",
      ],
    },
    tournament,
    teams,
    venues,
    stages,
    referees,
    matches,
    players,
    events,
    lineups,
    playerStats,
    teamMatchStats,
  };

  return { pack, warnings, errors };
}

// ---------------------------------------------------------------------------
// Validation (hard invariants for import)
// ---------------------------------------------------------------------------

export type MominulPackValidation = { errors: string[]; warnings: string[] };

function findDuplicates(ids: number[]): number[] {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export function validateMominulApprovedPack(
  pack: MominulApprovedPack,
): MominulPackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Counts.
  if (pack.teams.length !== 48) {
    errors.push(`Expected 48 teams, got ${pack.teams.length}.`);
  }
  if (pack.venues.length !== 16) {
    errors.push(`Expected 16 venues, got ${pack.venues.length}.`);
  }
  if (pack.matches.length !== 104) {
    errors.push(`Expected 104 matches, got ${pack.matches.length}.`);
  }
  if (pack.players.length < 1000 || pack.players.length > 1500) {
    errors.push(`Expected ~1248 players, got ${pack.players.length}.`);
  } else if (pack.players.length !== 1248) {
    warnings.push(`Player count is ${pack.players.length} (expected 1248).`);
  }

  // Placeholder team names.
  for (const team of pack.teams) {
    if (/^(tbd|tba|\?|unknown|placeholder)/i.test(team.name.trim())) {
      errors.push(`Placeholder team name: "${team.name}".`);
    }
  }

  // Duplicate source ids.
  const dupeChecks: [string, number[]][] = [
    ["team", pack.teams.map((r) => r.sourceTeamId)],
    ["venue", pack.venues.map((r) => r.sourceVenueId)],
    ["stage", pack.stages.map((r) => r.sourceStageId)],
    ["referee", pack.referees.map((r) => r.sourceRefereeId)],
    ["match", pack.matches.map((r) => r.sourceMatchId)],
    ["player", pack.players.map((r) => r.sourcePlayerId)],
    ["event", pack.events.map((r) => r.sourceEventId)],
    ["lineup", pack.lineups.map((r) => r.sourceLineupId)],
    ["playerStat", pack.playerStats.map((r) => r.sourcePlayerId)],
  ];
  for (const [label, ids] of dupeChecks) {
    const dupes = findDuplicates(ids);
    if (dupes.length > 0) {
      errors.push(`Duplicate ${label} source ids: ${dupes.slice(0, 10).join(", ")}.`);
    }
  }

  // Statuses — the tournament is complete.
  const notCompleted = pack.matches.filter(
    (match) => !/^(completed|final|finished)$/i.test(match.status),
  );
  if (notCompleted.length > 0) {
    errors.push(
      `${notCompleted.length} matches are not Completed (e.g. match ${notCompleted[0]?.sourceMatchId} status "${notCompleted[0]?.status}").`,
    );
  }

  // The final: Spain 1–0 Argentina after extra time.
  const final = pack.matches.find((match) => match.stageName === "Final");
  if (final === undefined) {
    errors.push("No match with stage Final found.");
  } else {
    const codes = [final.homeTeamCode, final.awayTeamCode];
    const okTeams = codes.includes("ESP") && codes.includes("ARG");
    const okScore =
      (final.homeTeamCode === "ESP" && final.homeScore === 1 && final.awayScore === 0) ||
      (final.awayTeamCode === "ESP" && final.awayScore === 1 && final.homeScore === 0);
    const okAet = final.resultType === "AET";
    if (!okTeams || !okScore || !okAet || final.winnerTeamCode !== "ESP") {
      errors.push(
        `Final mismatch: expected Spain 1–0 Argentina AET, got ${final.homeTeamCode} ${final.homeScore}–${final.awayScore} ${final.awayTeamCode} (${final.resultType}).`,
      );
    }
  }

  // Referential integrity.
  const teamIds = new Set(pack.teams.map((team) => team.sourceTeamId));
  const venueIds = new Set(pack.venues.map((venue) => venue.sourceVenueId));
  const stageIds = new Set(pack.stages.map((stage) => stage.sourceStageId));
  const refereeIds = new Set(pack.referees.map((referee) => referee.sourceRefereeId));
  const matchIds = new Set(pack.matches.map((match) => match.sourceMatchId));
  const playerIds = new Set(pack.players.map((player) => player.sourcePlayerId));

  for (const match of pack.matches) {
    for (const [label, value, set] of [
      ["home team", match.sourceHomeTeamId, teamIds],
      ["away team", match.sourceAwayTeamId, teamIds],
      ["venue", match.sourceVenueId, venueIds],
      ["stage", match.sourceStageId, stageIds],
      ["referee", match.sourceRefereeId, refereeIds],
    ] as const) {
      if (value !== null && !set.has(value)) {
        errors.push(`Match ${match.sourceMatchId} references unknown ${label} ${value}.`);
      }
    }
  }
  for (const event of pack.events) {
    if (!matchIds.has(event.sourceMatchId)) {
      errors.push(`Event ${event.sourceEventId} references unknown match ${event.sourceMatchId}.`);
    }
    if (event.sourcePlayerId !== null && !playerIds.has(event.sourcePlayerId)) {
      errors.push(`Event ${event.sourceEventId} references unknown player ${event.sourcePlayerId}.`);
    }
  }
  for (const lineup of pack.lineups) {
    if (!matchIds.has(lineup.sourceMatchId)) {
      errors.push(`Lineup ${lineup.sourceLineupId} references unknown match ${lineup.sourceMatchId}.`);
    }
    if (lineup.sourcePlayerId !== null && !playerIds.has(lineup.sourcePlayerId)) {
      errors.push(`Lineup ${lineup.sourceLineupId} references unknown player ${lineup.sourcePlayerId}.`);
    }
  }
  for (const stat of pack.playerStats) {
    if (!playerIds.has(stat.sourcePlayerId)) {
      errors.push(`Player stat references unknown player ${stat.sourcePlayerId}.`);
    }
  }
  for (const stat of pack.teamMatchStats) {
    if (!matchIds.has(stat.sourceMatchId)) {
      errors.push(`Team stat references unknown match ${stat.sourceMatchId}.`);
    }
    if (!teamIds.has(stat.sourceTeamId)) {
      errors.push(`Team stat references unknown team ${stat.sourceTeamId}.`);
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Write / load the finalized pack
// ---------------------------------------------------------------------------

const PACK_FILES: Record<string, keyof Omit<MominulApprovedPack, "manifest">> = {
  "tournament.json": "tournament",
  "teams.json": "teams",
  "venues.json": "venues",
  "stages.json": "stages",
  "referees.json": "referees",
  "matches.json": "matches",
  "players.json": "players",
  "events.json": "events",
  "lineups.json": "lineups",
  "player-stats.json": "playerStats",
  "team-match-stats.json": "teamMatchStats",
};

export async function writeMominulApprovedPack(
  pack: MominulApprovedPack,
  dir: string = MOMINUL_APPROVED_PACK_DIR,
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [fileName, key] of Object.entries(PACK_FILES)) {
    const payload = pack[key];
    const body = Array.isArray(payload)
      ? { schema: `mominul-approved-pack/${key}/v1`, sourceId: pack.manifest.sourceId, count: payload.length, records: payload }
      : { schema: `mominul-approved-pack/${key}/v1`, sourceId: pack.manifest.sourceId, ...payload };
    await writeFile(
      path.join(dir, fileName),
      `${JSON.stringify(body, null, 2)}\n`,
      "utf8",
    );
    written.push(fileName);
  }
  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(pack.manifest, null, 2)}\n`,
    "utf8",
  );
  written.push("manifest.json");
  return written;
}

/** Loads a previously written finalized pack; null when absent/corrupt. */
export async function loadMominulApprovedPack(
  dir: string = MOMINUL_APPROVED_PACK_DIR,
): Promise<MominulApprovedPack | null> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    ) as MominulApprovedPackManifest;
    if (manifest.schema !== "mominul-approved-pack/v1") return null;
    if (manifest.sourceId !== MOMINUL_SOURCE_ID) return null;

    const readRecords = async <T>(fileName: string): Promise<T[]> => {
      const doc = JSON.parse(
        await readFile(path.join(dir, fileName), "utf8"),
      ) as { records?: unknown };
      if (!Array.isArray(doc.records)) {
        throw new Error(`${fileName} has no records array`);
      }
      return doc.records as T[];
    };
    const tournamentDoc = JSON.parse(
      await readFile(path.join(dir, "tournament.json"), "utf8"),
    ) as Mominul2026TournamentSummary;

    return {
      manifest,
      tournament: tournamentDoc,
      teams: await readRecords<Mominul2026Team>("teams.json"),
      venues: await readRecords<Mominul2026Venue>("venues.json"),
      stages: await readRecords<Mominul2026Stage>("stages.json"),
      referees: await readRecords<Mominul2026Referee>("referees.json"),
      matches: await readRecords<Mominul2026Match>("matches.json"),
      players: await readRecords<Mominul2026Player>("players.json"),
      events: await readRecords<Mominul2026Event>("events.json"),
      lineups: await readRecords<Mominul2026Lineup>("lineups.json"),
      playerStats: await readRecords<Mominul2026PlayerStat>("player-stats.json"),
      teamMatchStats: await readRecords<Mominul2026TeamMatchStat>(
        "team-match-stats.json",
      ),
    };
  } catch {
    return null;
  }
}
