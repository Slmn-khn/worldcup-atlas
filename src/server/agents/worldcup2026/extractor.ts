// Candidate builder for the 2026 data steward agent (Phase 1).
//
// Reads the raw snapshots under data/2026/raw/<sourceId>/ and extracts
// SOURCE-SPECIFIC candidate records. Deliberately light-handed: values are
// trimmed and typed but NOT merged, aliased, or cross-referenced between
// sources — that is the normalizer's job. Every record keeps a RawSourceRef
// back to the snapshot (and row/line) it came from, and rows that cannot be
// parsed land in an errors array instead of being silently dropped.
//
// Formats handled:
//   - OpenFootball worldcup.json (rounds/matches JSON)
//   - OpenFootball Football.TXT (cup.txt: group tables + dated match lines)
//   - worldcup2026 CSV exports (teams/groups/games/stadia, csv-parse)
//   - worldcup2026 API JSON (defensive parsing, mirrors the wc26 fixture
//     provider's tolerance for shape drift)

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parse as parseCsvSync } from "csv-parse/sync";

import { parseKickoff } from "../../../lib/date";
import { APPROVED_2026_SOURCES, RAW_2026_DIR } from "./sourceRegistry";
import type {
  CandidateGroup,
  CandidateMatch,
  CandidateMatchStatus,
  CandidateParseError,
  CandidateStanding,
  CandidateTeam,
  CandidateVenue,
  RawSourceRef,
} from "./types";

export type ExtractedCandidates = {
  teams: CandidateTeam[];
  groups: CandidateGroup[];
  venues: CandidateVenue[];
  matches: CandidateMatch[];
  standings: CandidateStanding[];
  errors: CandidateParseError[];
};

function emptyCandidates(): ExtractedCandidates {
  return {
    teams: [],
    groups: [],
    venues: [],
    matches: [],
    standings: [],
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Small safe readers
// ---------------------------------------------------------------------------

function toStr(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function toInt(value: unknown): number | null {
  const num = toNum(value);
  return num !== null && Number.isInteger(num) ? num : null;
}

/** "Group A" | "A" → "Group A"; anything unrecognizable → trimmed original. */
export function canonicalGroupLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const letter = /^(?:group\s+)?([a-l])$/i.exec(trimmed);
  if (letter !== null) return `Group ${letter[1].toUpperCase()}`;
  return trimmed;
}

// ---------------------------------------------------------------------------
// OpenFootball worldcup.json
// ---------------------------------------------------------------------------

type OfJsonScorePair = [number, number];

function readScorePair(value: unknown): OfJsonScorePair | null {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 0 &&
    value[1] >= 0
  ) {
    return [value[0], value[1]];
  }
  return null;
}

function ofTeamName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value !== null && typeof value === "object") {
    return toStr((value as Record<string, unknown>).name);
  }
  return null;
}

/**
 * Extracts matches (and the teams/groups they imply) from an OpenFootball
 * `worldcup.json` document ({ name, matches: [...] } or { rounds: [...] }).
 */
export function extractOpenfootballJson(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
): ExtractedCandidates {
  const out = emptyCandidates();
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (error) {
    out.errors.push({
      ...ref,
      ref: "document",
      message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return out;
  }
  if (doc === null || typeof doc !== "object") {
    out.errors.push({ ...ref, ref: "document", message: "Not a JSON object." });
    return out;
  }

  const root = doc as Record<string, unknown>;
  const flat = Array.isArray(root.matches) ? (root.matches as unknown[]) : [];
  const fromRounds = Array.isArray(root.rounds)
    ? (root.rounds as unknown[]).flatMap((round) =>
        round !== null &&
        typeof round === "object" &&
        Array.isArray((round as Record<string, unknown>).matches)
          ? ((round as Record<string, unknown>).matches as unknown[])
          : [],
      )
    : [];
  const rawMatches = [...flat, ...fromRounds];

  const teamGroups = new Map<string, string | null>();

  rawMatches.forEach((raw, index) => {
    const rowRef = { ...ref, ref: `matches[${index}]` };
    if (raw === null || typeof raw !== "object") {
      out.errors.push({ ...rowRef, message: "Match row is not an object." });
      return;
    }
    const match = raw as Record<string, unknown>;
    const team1 = ofTeamName(match.team1);
    const team2 = ofTeamName(match.team2);
    if (team1 === null || team2 === null) {
      out.errors.push({
        ...rowRef,
        message: "Match row is missing team1/team2 names.",
        rawLine: JSON.stringify(match).slice(0, 200),
      });
      return;
    }

    const score =
      match.score !== null && typeof match.score === "object"
        ? (match.score as Record<string, unknown>)
        : {};
    const ft = readScorePair(score.ft);
    const et = readScorePair(score.et);
    const pens = readScorePair(score.p);
    // Final score of the tie: after extra time when it was played.
    const finalScore = et ?? ft;

    const groupName = canonicalGroupLabel(toStr(match.group));
    const round = toStr(match.round);
    const kickoff = parseKickoff(toStr(match.date), toStr(match.time));

    // The tournament data is a static archive snapshot: a recorded full-time
    // score deterministically means FINISHED; no score means SCHEDULED.
    const status: CandidateMatchStatus =
      finalScore !== null ? "FINISHED" : "SCHEDULED";

    for (const [name] of [[team1], [team2]] as const) {
      if (!teamGroups.has(name) || teamGroups.get(name) === null) {
        teamGroups.set(name, groupName);
      }
    }

    out.matches.push({
      matchNumber: toInt(match.num),
      sourceMatchId: toStr(match.num),
      stageLabel: groupName !== null ? "group" : round,
      roundLabel: round,
      groupName,
      kickoffAtUtc: kickoff.kickoffAtUtc?.toISOString() ?? null,
      kickoffDateLabel: kickoff.kickoffDateLabel,
      kickoffTimeLabel: kickoff.kickoffTimeLabel,
      homeTeamName: team1,
      awayTeamName: team2,
      homeScore: finalScore?.[0] ?? null,
      awayScore: finalScore?.[1] ?? null,
      homePenaltyScore: pens?.[0] ?? null,
      awayPenaltyScore: pens?.[1] ?? null,
      status,
      // The 2026 openfootball file uses `ground` for the host city.
      venueName: null,
      cityName: toStr(match.ground) ?? toStr(match.city),
      sourceRef: rowRef,
    });
  });

  // Teams/groups implied by group-stage participation.
  const groups = new Map<string, string[]>();
  for (const [team, group] of [...teamGroups.entries()].sort()) {
    out.teams.push({
      name: team,
      groupName: group,
      sourceRef: { ...ref, ref: `team:${team}` },
    });
    if (group !== null) {
      groups.set(group, [...(groups.get(group) ?? []), team]);
    }
  }
  for (const [name, teams] of [...groups.entries()].sort()) {
    out.groups.push({
      name,
      teamNames: teams,
      sourceRef: { ...ref, ref: `group:${name}` },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// OpenFootball Football.TXT (cup.txt)
// ---------------------------------------------------------------------------

/** `Group A | Mexico        South Africa    South Korea   Czech Republic` */
const CUP_TXT_GROUP_LINE = /^Group\s+([A-L])\s*\|\s*(.+)$/;

/** `▪ Group A` section headers inside the schedule part. */
const CUP_TXT_GROUP_HEADER = /^[▪•►]\s*Group\s+([A-L])\s*$/;

/** `Thu June 11` / `Fri June 12` date lines. */
const CUP_TXT_DATE_LINE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]+)\s+(\d{1,2})\s*$/;

/**
 * `  13:00 UTC-6   Mexico  2-0 (1-0)  South Africa   @ Mexico City`
 * Score and half-time part are optional (upcoming matches have none).
 */
const CUP_TXT_MATCH_LINE =
  /^\s+(\d{1,2}[.:]\d{2})\s+(UTC[+-]\d{1,2}(?::\d{2})?)\s+(.+?)\s+(?:(\d+)-(\d+)(?:\s*\((\d+)-(\d+)\))?\s+(.+?)|v\s+(.+?))\s+@\s+(.+?)\s*$/;

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04", May: "05",
  June: "06", July: "07", August: "08", September: "09", October: "10",
  November: "11", December: "12",
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", Jun: "06", Jul: "07",
  Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * Parses an OpenFootball Football.TXT cup file. Handles the 2026 layout:
 * `Group X | ...` team tables, then per-group schedules with date lines and
 * indented match lines. Goal-scorer continuation lines (starting with `(`)
 * and `#` comments are skipped. Match-shaped lines that fail to parse are
 * reported as errors — never silently dropped.
 */
export function extractOpenfootballCupTxt(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
  year = 2026,
): ExtractedCandidates {
  const out = emptyCandidates();
  const lines = body.split(/\r?\n/);

  let currentGroup: string | null = null;
  let currentDate: string | null = null; // ISO yyyy-mm-dd

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const rowRef = { ...ref, ref: `line:${lineNo}` };
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("=")) {
      return;
    }

    const groupTable = CUP_TXT_GROUP_LINE.exec(line);
    if (groupTable !== null) {
      const name = `Group ${groupTable[1]}`;
      // Team columns are separated by runs of 2+ spaces.
      const teams = groupTable[2]
        .split(/\s{2,}/)
        .map((team) => team.trim())
        .filter((team) => team !== "");
      if (teams.length === 0) {
        out.errors.push({ ...rowRef, message: "Empty group table row.", rawLine: line });
        return;
      }
      out.groups.push({ name, teamNames: teams, sourceRef: rowRef });
      for (const team of teams) {
        out.teams.push({ name: team, groupName: name, sourceRef: rowRef });
      }
      return;
    }

    const groupHeader = CUP_TXT_GROUP_HEADER.exec(trimmed);
    if (groupHeader !== null) {
      currentGroup = `Group ${groupHeader[1]}`;
      currentDate = null;
      return;
    }
    // Any other bullet line (matchday calendar etc.) is structural noise.
    if (/^[▪•►]/.test(trimmed)) return;

    const dateLine = CUP_TXT_DATE_LINE.exec(trimmed);
    if (dateLine !== null) {
      const month = MONTHS[dateLine[1]];
      if (month !== undefined) {
        currentDate = `${year}-${month}-${dateLine[2].padStart(2, "0")}`;
      }
      return;
    }

    const matchLine = CUP_TXT_MATCH_LINE.exec(line);
    if (matchLine !== null) {
      const [
        ,
        time,
        utcOffset,
        homeName,
        ftHome,
        ftAway,
        ,
        ,
        awayAfterScore,
        awayAfterV,
        city,
      ] = matchLine;
      const away = awayAfterScore ?? awayAfterV;
      const hasScore = ftHome !== undefined && ftAway !== undefined;
      const kickoff = parseKickoff(currentDate, `${time} ${utcOffset}`);
      out.matches.push({
        stageLabel: "group",
        roundLabel: null,
        groupName: currentGroup,
        kickoffAtUtc: kickoff.kickoffAtUtc?.toISOString() ?? null,
        kickoffDateLabel: currentDate,
        kickoffTimeLabel: `${time} ${utcOffset}`,
        homeTeamName: homeName.trim(),
        awayTeamName: away?.trim() ?? null,
        homeScore: hasScore ? Number(ftHome) : null,
        awayScore: hasScore ? Number(ftAway) : null,
        status: hasScore ? "FINISHED" : "SCHEDULED",
        cityName: city.trim(),
        sourceRef: rowRef,
      });
      return;
    }

    // Goal-scorer continuation lines are expected noise; anything else that
    // LOOKS like a match line (starts with an indented kick-off time) but did
    // not parse is a real problem and must be reported.
    if (/^\s+\d{1,2}[.:]\d{2}\s/.test(line)) {
      out.errors.push({
        ...rowRef,
        message: "Match-shaped line did not parse.",
        rawLine: line,
      });
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// worldcup2026 CSVs
// ---------------------------------------------------------------------------

type CsvRow = Record<string, string>;

function parseCsv(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
  errors: CandidateParseError[],
): CsvRow[] {
  try {
    return parseCsvSync(body, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as CsvRow[];
  } catch (error) {
    errors.push({
      ...ref,
      ref: "document",
      message: `CSV parse failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return [];
  }
}

/** teams.csv: `_id,id,name_en,name_fa,flag,fifa_code,iso2,groups,__v` */
export function extractWc26TeamsCsv(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
): ExtractedCandidates {
  const out = emptyCandidates();
  const rows = parseCsv(body, ref, out.errors);
  rows.forEach((row, index) => {
    const rowRef = { ...ref, ref: `row:${index + 2}` };
    const name = toStr(row.name_en) ?? toStr(row.name);
    if (name === null) {
      out.errors.push({
        ...rowRef,
        message: "Team row has no name_en.",
        rawLine: JSON.stringify(row).slice(0, 200),
      });
      return;
    }
    out.teams.push({
      name,
      fifaCode: toStr(row.fifa_code),
      iso2Code: toStr(row.iso2),
      groupName: canonicalGroupLabel(toStr(row.groups) ?? toStr(row.group)),
      sourceTeamId: toStr(row.id),
      sourceRef: rowRef,
    });
  });
  return out;
}

/** stadia.csv: `_id,id,name_en,…,city_en,…,country_en,…,capacity,region,…` */
export function extractWc26StadiaCsv(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
): ExtractedCandidates {
  const out = emptyCandidates();
  const rows = parseCsv(body, ref, out.errors);
  rows.forEach((row, index) => {
    const rowRef = { ...ref, ref: `row:${index + 2}` };
    const name = toStr(row.name_en) ?? toStr(row.name);
    if (name === null) {
      out.errors.push({
        ...rowRef,
        message: "Stadium row has no name_en.",
        rawLine: JSON.stringify(row).slice(0, 200),
      });
      return;
    }
    out.venues.push({
      name,
      cityName: toStr(row.city_en) ?? toStr(row.city),
      countryName: toStr(row.country_en) ?? toStr(row.country),
      capacity: toInt(row.capacity),
      sourceVenueId: toStr(row.id),
      sourceRef: rowRef,
    });
  });
  return out;
}

/**
 * groups.csv: one row per group with flattened `teams[i].<stat>` columns.
 * Team references are numeric ids joined through the teams map.
 */
export function extractWc26GroupsCsv(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
  teamNameById: Map<string, string>,
): ExtractedCandidates {
  const out = emptyCandidates();
  const rows = parseCsv(body, ref, out.errors);
  rows.forEach((row, index) => {
    const rowRef = { ...ref, ref: `row:${index + 2}` };
    const groupName = canonicalGroupLabel(toStr(row.name));
    if (groupName === null) {
      out.errors.push({
        ...rowRef,
        message: "Group row has no name.",
        rawLine: JSON.stringify(row).slice(0, 200),
      });
      return;
    }
    const teamNames: string[] = [];
    for (let slot = 0; slot < 4; slot += 1) {
      const teamId = toStr(row[`teams[${slot}].team_id`]);
      if (teamId === null) continue;
      const teamName = teamNameById.get(teamId);
      if (teamName === undefined) {
        out.errors.push({
          ...rowRef,
          message: `Group ${groupName} slot ${slot} references unknown team id ${teamId}.`,
        });
        continue;
      }
      teamNames.push(teamName);
      const stat = (key: string): number | null =>
        toInt(row[`teams[${slot}].${key}`]);
      const played = stat("mp");
      const wins = stat("w");
      const draws = stat("d");
      const losses = stat("l");
      const goalsFor = stat("gf");
      const goalsAgainst = stat("ga");
      const points = stat("pts");
      if (
        played === null ||
        wins === null ||
        draws === null ||
        losses === null ||
        goalsFor === null ||
        goalsAgainst === null ||
        points === null
      ) {
        out.errors.push({
          ...rowRef,
          message: `Group ${groupName} slot ${slot} has incomplete table stats.`,
        });
        continue;
      }
      out.standings.push({
        groupName,
        teamName,
        played,
        wins,
        draws,
        losses,
        goalsFor,
        goalsAgainst,
        goalDifference: stat("gd") ?? goalsFor - goalsAgainst,
        points,
        rank: null, // column order is not a documented ranking
        sourceRef: rowRef,
      });
    }
    if (teamNames.length > 0) {
      out.groups.push({ name: groupName, teamNames, sourceRef: rowRef });
    }
  });
  return out;
}

/**
 * games.csv: rows reference teams/stadia by numeric id; `finished`/
 * `time_elapsed` describe status. A `FALSE/notstarted` row's 0-0 score is a
 * placeholder, not a result — scores are only kept for finished games.
 */
export function extractWc26GamesCsv(
  body: string,
  ref: Omit<RawSourceRef, "ref">,
  teamNameById: Map<string, string>,
  venueById: Map<string, { name: string; cityName: string | null }>,
): ExtractedCandidates {
  const out = emptyCandidates();
  const rows = parseCsv(body, ref, out.errors);
  rows.forEach((row, index) => {
    const rowRef = { ...ref, ref: `row:${index + 2}` };
    const homeName = teamNameById.get(toStr(row.home_team_id) ?? "");
    const awayName = teamNameById.get(toStr(row.away_team_id) ?? "");
    if (homeName === undefined && awayName === undefined) {
      out.errors.push({
        ...rowRef,
        message: "Game row references no known team ids.",
        rawLine: JSON.stringify(row).slice(0, 200),
      });
      return;
    }

    const finished = (toStr(row.finished) ?? "").toUpperCase() === "TRUE";
    const elapsed = toStr(row.time_elapsed);
    let status: CandidateMatchStatus = "UNKNOWN";
    if (finished) status = "FINISHED";
    else if (elapsed === "notstarted") status = "SCHEDULED";
    else if (elapsed !== null) status = "LIVE";

    const venue = venueById.get(toStr(row.stadium_id) ?? "");
    const localDate = toStr(row.local_date); // "06/11/2026 13:00" (venue-local)
    const localParts = localDate?.split(/\s+/) ?? [];

    const type = toStr(row.type);
    // Same convention as the API: knockout rows reuse `group` for a stage
    // token ("R32", "FINAL"), so only group-stage rows carry a group letter.
    const isGroupStage = type === null || /group/i.test(type);
    out.matches.push({
      matchNumber: toInt(row.id),
      sourceMatchId: toStr(row.id),
      stageLabel: type,
      roundLabel:
        isGroupStage && toStr(row.matchday) !== null
          ? `Matchday ${row.matchday}`
          : null,
      groupName: isGroupStage ? canonicalGroupLabel(toStr(row.group)) : null,
      // The `date` column's UTC instant contradicts local_date in the
      // snapshot; neither is trusted as UTC here. Keep the labels only and
      // let the normalizer surface kickoff conflicts between sources.
      kickoffAtUtc: null,
      kickoffDateLabel: localParts[0] ?? null,
      kickoffTimeLabel: localParts[1] ?? null,
      homeTeamName: homeName ?? null,
      awayTeamName: awayName ?? null,
      homeScore: finished ? toInt(row.home_score) : null,
      awayScore: finished ? toInt(row.away_score) : null,
      status,
      venueName: venue?.name ?? null,
      cityName: venue?.cityName ?? null,
      sourceRef: rowRef,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// worldcup2026 API JSON (defensive — endpoint shapes are not guaranteed)
// ---------------------------------------------------------------------------

function apiRecords(doc: unknown): unknown[] {
  if (Array.isArray(doc)) return doc;
  if (doc !== null && typeof doc === "object") {
    const root = doc as Record<string, unknown>;
    for (const key of ["data", "matches", "games", "teams", "stadiums", "groups", "results"]) {
      if (Array.isArray(root[key])) return root[key] as unknown[];
    }
  }
  return [];
}

/** api-teams.json / api-stadiums.json / api-games.json defensive extraction. */
export function extractWc26ApiJson(
  kind: "teams" | "stadiums" | "games" | "groups",
  body: string,
  ref: Omit<RawSourceRef, "ref">,
): ExtractedCandidates {
  const out = emptyCandidates();
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (error) {
    out.errors.push({
      ...ref,
      ref: "document",
      message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return out;
  }

  const records = apiRecords(doc);
  records.forEach((raw, index) => {
    const rowRef = { ...ref, ref: `records[${index}]` };
    if (raw === null || typeof raw !== "object") {
      out.errors.push({ ...rowRef, message: "Record is not an object." });
      return;
    }
    const row = raw as Record<string, unknown>;

    if (kind === "teams") {
      const name = toStr(row.name_en) ?? toStr(row.name) ?? toStr(row.title);
      if (name === null) {
        out.errors.push({ ...rowRef, message: "Team record has no name." });
        return;
      }
      out.teams.push({
        name,
        fifaCode: toStr(row.fifa_code) ?? toStr(row.fifaCode),
        iso2Code: toStr(row.iso2),
        groupName: canonicalGroupLabel(toStr(row.groups) ?? toStr(row.group)),
        sourceTeamId: toStr(row.id),
        sourceRef: rowRef,
      });
      return;
    }

    if (kind === "stadiums") {
      const name = toStr(row.name_en) ?? toStr(row.name);
      if (name === null) {
        out.errors.push({ ...rowRef, message: "Stadium record has no name." });
        return;
      }
      out.venues.push({
        name,
        cityName: toStr(row.city_en) ?? toStr(row.city),
        countryName: toStr(row.country_en) ?? toStr(row.country),
        capacity: toInt(row.capacity),
        sourceVenueId: toStr(row.id),
        sourceRef: rowRef,
      });
      return;
    }

    if (kind === "games") {
      const home =
        toStr((row.homeTeam as Record<string, unknown> | undefined)?.name_en) ??
        toStr(row.home_team_name_en) ??
        toStr(row.home_team) ??
        toStr(row.homeTeamName);
      const away =
        toStr((row.visitingTeam as Record<string, unknown> | undefined)?.name_en) ??
        toStr(row.away_team_name_en) ??
        toStr(row.away_team) ??
        toStr(row.awayTeamName);
      // Same guard as the CSV games path: a record naming no team at all is
      // reported, never emitted as a teamless match (which would collide with
      // the real match carrying the same number).
      if (home === null && away === null) {
        out.errors.push({
          ...rowRef,
          message: "Game record has no resolvable team names.",
          rawLine: JSON.stringify(row).slice(0, 200),
        });
        return;
      }
      const finished =
        row.finished === true || (toStr(row.finished) ?? "").toUpperCase() === "TRUE";
      const apiType = toStr(row.type);
      // Knockout rows reuse the `group` column for a stage token ("R32",
      // "FINAL") — only group-stage rows carry a real group letter.
      const apiIsGroupStage = apiType === null || /group/i.test(apiType);
      out.matches.push({
        matchNumber: toInt(row.id),
        sourceMatchId: toStr(row.id) ?? toStr(row._id),
        stageLabel: apiType,
        roundLabel:
          apiIsGroupStage && toStr(row.matchday) !== null
            ? `Matchday ${toStr(row.matchday)}`
            : null,
        groupName: apiIsGroupStage
          ? canonicalGroupLabel(toStr(row.group))
          : null,
        kickoffAtUtc: null,
        kickoffDateLabel: toStr(row.local_date)?.split(/\s+/)[0] ?? null,
        kickoffTimeLabel: toStr(row.local_date)?.split(/\s+/)[1] ?? null,
        homeTeamName: home,
        awayTeamName: away,
        homeScore: finished ? toInt(row.home_score) : null,
        awayScore: finished ? toInt(row.away_score) : null,
        status: finished ? "FINISHED" : "SCHEDULED",
        venueName: toStr((row.stadium as Record<string, unknown> | undefined)?.name_en),
        cityName: null,
        sourceRef: rowRef,
      });
      return;
    }

    // kind === "groups": group records with an embedded teams table.
    const groupName = canonicalGroupLabel(toStr(row.name));
    if (groupName === null) {
      out.errors.push({ ...rowRef, message: "Group record has no name." });
      return;
    }
    const teams = Array.isArray(row.teams) ? (row.teams as unknown[]) : [];
    const teamNames: string[] = [];
    teams.forEach((entry) => {
      if (entry === null || typeof entry !== "object") return;
      const teamRow = entry as Record<string, unknown>;
      const teamName =
        toStr((teamRow.team_id as Record<string, unknown> | undefined)?.name_en) ??
        toStr(teamRow.name_en) ??
        toStr(teamRow.name);
      if (teamName === null) return;
      teamNames.push(teamName);
      const played = toInt(teamRow.mp);
      const wins = toInt(teamRow.w);
      const draws = toInt(teamRow.d);
      const losses = toInt(teamRow.l);
      const goalsFor = toInt(teamRow.gf);
      const goalsAgainst = toInt(teamRow.ga);
      const points = toInt(teamRow.pts);
      if (
        played !== null &&
        wins !== null &&
        draws !== null &&
        losses !== null &&
        goalsFor !== null &&
        goalsAgainst !== null &&
        points !== null
      ) {
        out.standings.push({
          groupName,
          teamName,
          played,
          wins,
          draws,
          losses,
          goalsFor,
          goalsAgainst,
          goalDifference: toInt(teamRow.gd) ?? goalsFor - goalsAgainst,
          points,
          rank: null,
          sourceRef: rowRef,
        });
      }
    });
    if (teamNames.length > 0) {
      out.groups.push({ name: groupName, teamNames, sourceRef: rowRef });
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Orchestration: raw dir → candidates
// ---------------------------------------------------------------------------

async function readRawIfPresent(
  rawDir: string,
  sourceId: string,
  outputFile: string,
): Promise<string | null> {
  const filePath = path.join(rawDir, sourceId, outputFile);
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) return null;
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function mergeInto(target: ExtractedCandidates, part: ExtractedCandidates): void {
  target.teams.push(...part.teams);
  target.groups.push(...part.groups);
  target.venues.push(...part.venues);
  target.matches.push(...part.matches);
  target.standings.push(...part.standings);
  target.errors.push(...part.errors);
}

/**
 * Reads every collected raw snapshot and extracts all candidate records.
 * Missing snapshots (failed/never-collected endpoints) are skipped silently —
 * the collector already reported them, and the validator reports coverage.
 */
export async function buildCandidatesFromRaw(
  rawDir: string = RAW_2026_DIR,
): Promise<ExtractedCandidates> {
  const all = emptyCandidates();

  for (const source of APPROVED_2026_SOURCES) {
    const bodies = new Map<string, string>();
    for (const endpoint of source.endpoints ?? []) {
      const body = await readRawIfPresent(rawDir, source.id, endpoint.outputFile);
      if (body !== null) bodies.set(endpoint.id, body);
    }

    if (source.id === "openfootball_worldcup_2026") {
      const cupTxt = bodies.get("of26-cup-txt");
      if (cupTxt !== undefined) {
        mergeInto(
          all,
          extractOpenfootballCupTxt(cupTxt, {
            sourceId: source.id,
            endpointId: "of26-cup-txt",
          }),
        );
      }
      const json = bodies.get("of26-worldcup-json");
      if (json !== undefined) {
        mergeInto(
          all,
          extractOpenfootballJson(json, {
            sourceId: source.id,
            endpointId: "of26-worldcup-json",
          }),
        );
      }
    }

    if (source.id === "worldcup2026_repo") {
      // CSV snapshot family (joined through the teams/stadia id maps).
      const teamsCsv = bodies.get("wc26-csv-teams");
      const teamNameById = new Map<string, string>();
      if (teamsCsv !== undefined) {
        const extracted = extractWc26TeamsCsv(teamsCsv, {
          sourceId: source.id,
          endpointId: "wc26-csv-teams",
        });
        for (const team of extracted.teams) {
          if (team.sourceTeamId != null) {
            teamNameById.set(team.sourceTeamId, team.name);
          }
        }
        mergeInto(all, extracted);
      }

      const stadiaCsv = bodies.get("wc26-csv-stadia");
      const venueById = new Map<string, { name: string; cityName: string | null }>();
      if (stadiaCsv !== undefined) {
        const extracted = extractWc26StadiaCsv(stadiaCsv, {
          sourceId: source.id,
          endpointId: "wc26-csv-stadia",
        });
        for (const venue of extracted.venues) {
          if (venue.sourceVenueId != null) {
            venueById.set(venue.sourceVenueId, {
              name: venue.name,
              cityName: venue.cityName ?? null,
            });
          }
        }
        mergeInto(all, extracted);
      }

      const groupsCsv = bodies.get("wc26-csv-groups");
      if (groupsCsv !== undefined) {
        mergeInto(
          all,
          extractWc26GroupsCsv(
            groupsCsv,
            { sourceId: source.id, endpointId: "wc26-csv-groups" },
            teamNameById,
          ),
        );
      }

      const gamesCsv = bodies.get("wc26-csv-games");
      if (gamesCsv !== undefined) {
        mergeInto(
          all,
          extractWc26GamesCsv(
            gamesCsv,
            { sourceId: source.id, endpointId: "wc26-csv-games" },
            teamNameById,
            venueById,
          ),
        );
      }

      // Live API family — only used when the API snapshots were collectable.
      // The CSV family above is preferred for teams/venues; API games/groups
      // add current results/standings when present.
      for (const [endpointId, kind] of [
        ["wc26-api-teams", "teams"],
        ["wc26-api-stadiums", "stadiums"],
        ["wc26-api-games", "games"],
        ["wc26-api-groups", "groups"],
      ] as const) {
        const body = bodies.get(endpointId);
        if (body !== undefined) {
          mergeInto(
            all,
            extractWc26ApiJson(kind, body, { sourceId: source.id, endpointId }),
          );
        }
      }
    }
  }

  return all;
}
