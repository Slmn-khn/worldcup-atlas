// Display-ready archive schedule for the completed 2026 World Cup.
//
// This is the data source for /schedule/2026 in post-tournament archive mode.
// It is FILE-backed — the human-authenticated reference pack and (optional)
// approved finalized artifacts — never the stale live `Fixture` DB rows and
// never a provider fetch. Preferred source order:
//
//   1. data/2026/approved/finalized/matches.json          (pack match format)
//   2. data/2026/approved/finalized/display-schedule.json (generated artifact)
//   3. data/2026/reference/manual-verified-v1/matches.json (verified base)
//      + data/2026/review/review-decisions.json            (approved gap-fills)
//
// Guardrails honored:
//   - Unapproved provider/enrichment rows are never consumed as final; a
//     review decision must set `approved: true` to fill a gap, and even then
//     the row's verification is capped at REPORTED (only the pack itself can
//     say VERIFIED).
//   - Missing scores are never invented; those rows become RESULT_UNDER_REVIEW.
//   - The tournament is over, so no row is ever "SCHEDULED".
//   - No database access at all.
//
// Uses RELATIVE runtime imports only (no "@/" alias) so the display-schedule
// generator script can run under tsx, mirroring the fixtures sync convention.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  loadManualReferencePack,
  packMatchesFileSchema,
  packMatchSchema,
  MANUAL_PACK_DIR,
  type ManualReferencePack,
} from "../agents/worldcup2026/manualReferencePack";
import { DATA_2026_DIR } from "../agents/worldcup2026/sourceRegistry";

export const FINALIZED_2026_DIR = `${DATA_2026_DIR}/approved/finalized`;
export const REVIEW_DECISIONS_2026_PATH = `${DATA_2026_DIR}/review/review-decisions.json`;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Archived2026MatchStatus =
  | "FULL_TIME"
  | "AFTER_EXTRA_TIME"
  | "PENALTIES"
  | "RESULT_UNDER_REVIEW"
  | "INCOMPLETE";

export type Archived2026Verification =
  | "VERIFIED"
  | "REPORTED"
  | "PARTIAL"
  | "UNVERIFIED"
  | "NEEDS_REVIEW";

export type Archived2026ScheduleRow = {
  id: string;
  matchId: string;
  /** ISO date (YYYY-MM-DD) or null when the pack has no confirmed date. */
  date: string | null;
  /** Pre-formatted day label, e.g. "11 June 2026" / "Date under review". */
  dateLabel: string;
  timeLabel?: string | null;
  /** Raw pack stage key, e.g. "group", "round_of_32", "final". */
  stageKey: string;
  /** Display stage, e.g. "Group Stage", "Quarter-final". */
  stage: string;
  groupName?: string | null;
  homeTeamCode?: string | null;
  homeTeamName?: string | null;
  awayTeamCode?: string | null;
  awayTeamName?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  winnerTeamCode?: string | null;
  venueId?: string | null;
  venueName?: string | null;
  cityName?: string | null;
  status: Archived2026MatchStatus;
  verification: Archived2026Verification;
  sources: string[];
  notes?: string | null;
};

export type Archived2026ScheduleResult = {
  mode: "ARCHIVE";
  tournamentComplete: true;
  totalOfficialMatches: number;
  capturedMatches: number;
  rows: Archived2026ScheduleRow[];
  unresolvedCount: number;
  verifiedCount: number;
  lastUpdatedLabel?: string;
};

// ---------------------------------------------------------------------------
// Stage + date display
// ---------------------------------------------------------------------------

const STAGE_META: Record<string, { label: string; order: number }> = {
  group: { label: "Group Stage", order: 0 },
  round_of_32: { label: "Round of 32", order: 1 },
  round_of_16: { label: "Round of 16", order: 2 },
  quarterfinal: { label: "Quarter-final", order: 3 },
  semifinal: { label: "Semi-final", order: 4 },
  third_place: { label: "Third place", order: 5 },
  final: { label: "Final", order: 6 },
};

export function archivedStageLabel(stageKey: string): string {
  return STAGE_META[stageKey]?.label ?? stageKey;
}

function stageOrder(stageKey: string): number {
  return STAGE_META[stageKey]?.order ?? 99;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-06-11" → "11 June 2026"; unparseable/missing → "Date under review". */
export function archivedDateLabel(date: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (match === null) return "Date under review";
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName === undefined) return "Date under review";
  return `${Number(day)} ${monthName} ${year}`;
}

// ---------------------------------------------------------------------------
// Score + status display
// ---------------------------------------------------------------------------

/**
 * Display score line: "2–1", "1–1 (4–2 pens)", "1–0 AET". Null when the result
 * is under review / incomplete — the UI shows "Under review" instead. Never a
 * kickoff placeholder: the tournament is over.
 */
export function formatArchivedScore(
  row: Pick<
    Archived2026ScheduleRow,
    | "status"
    | "homeScore"
    | "awayScore"
    | "homePenaltyScore"
    | "awayPenaltyScore"
  >,
): string | null {
  if (row.homeScore == null || row.awayScore == null) return null;
  const base = `${row.homeScore}–${row.awayScore}`;
  if (row.status === "PENALTIES") {
    return row.homePenaltyScore != null && row.awayPenaltyScore != null
      ? `${base} (${row.homePenaltyScore}–${row.awayPenaltyScore} pens)`
      : `${base} (pens)`;
  }
  if (row.status === "AFTER_EXTRA_TIME") return `${base} AET`;
  return base;
}

type PackMatch = z.infer<typeof packMatchSchema>;

/**
 * Status for a completed-tournament row. Order matters: an unresolved team or
 * score always wins (RESULT_UNDER_REVIEW — e.g. M96, where the shootout winner
 * is known but the scores are not), then penalties beat extra time (M75 went
 * to extra time AND penalties — that is a PENALTIES result).
 */
export function archivedStatusFor(match: PackMatch): Archived2026MatchStatus {
  if (match.home == null || match.away == null) return "RESULT_UNDER_REVIEW";
  const score = match.score ?? null;
  if (score === null || score.home === null || score.away === null) {
    return "RESULT_UNDER_REVIEW";
  }
  if (score.penalties != null) return "PENALTIES";
  if (score.extra_time === true) return "AFTER_EXTRA_TIME";
  return "FULL_TIME";
}

const VERIFICATION_MAP: Record<string, Archived2026Verification> = {
  verified: "VERIFIED",
  reported: "REPORTED",
  partial: "PARTIAL",
  // The pack's "unverified" records are honest data gaps awaiting review.
  unverified: "NEEDS_REVIEW",
};

export function archivedVerificationFor(
  verification: string,
): Archived2026Verification {
  return VERIFICATION_MAP[verification] ?? "NEEDS_REVIEW";
}

// ---------------------------------------------------------------------------
// Review decisions (optional approved gap-fills)
// ---------------------------------------------------------------------------

// data/2026/review/review-decisions.json — written by a human reviewer. Only
// decisions with `approved: true` AND a structurally valid pack-format match
// are applied, and applied rows are capped at REPORTED verification: reviewed
// provider evidence never silently becomes VERIFIED (that upgrade belongs in
// the reference pack itself).
export const reviewDecisionsFileSchema = z
  .object({
    schema: z.string().optional(),
    decisions: z.array(
      z
        .object({
          id: z.string().optional(),
          approved: z.boolean(),
          note: z.string().nullish(),
          match: packMatchSchema.optional(),
        })
        .loose(),
    ),
  })
  .loose();

export type ReviewDecisionsFile = z.infer<typeof reviewDecisionsFileSchema>;

/** Approved pack-format matches from a decisions file, keyed by match_id. */
export function approvedGapFills(
  decisions: ReviewDecisionsFile | null,
): Map<string, PackMatch> {
  const fills = new Map<string, PackMatch>();
  for (const decision of decisions?.decisions ?? []) {
    if (!decision.approved || decision.match === undefined) continue;
    fills.set(decision.match.match_id, decision.match);
  }
  return fills;
}

// ---------------------------------------------------------------------------
// Row building (pure — unit-tested)
// ---------------------------------------------------------------------------

type PackLookups = {
  teamNameByCode: Map<string, string>;
  groupNameByTeamCode: Map<string, string>;
  venueById: Map<string, { name: string | null; city: string | null }>;
};

export function buildPackLookups(pack: ManualReferencePack | null): PackLookups {
  const teamNameByCode = new Map<string, string>();
  for (const team of pack?.teams ?? []) {
    if (team.code !== null && team.name !== null) {
      teamNameByCode.set(team.code, team.name);
    }
  }
  // Only groups with a CONFIRMED letter contribute — unknown letters must not
  // be invented from match-id prefixes or team sets.
  const groupNameByTeamCode = new Map<string, string>();
  for (const group of pack?.groups ?? []) {
    if (group.group === null) continue;
    const label = `Group ${group.group.replace(/^group\s*/i, "").toUpperCase()}`;
    for (const code of group.teams) {
      if (code !== null) groupNameByTeamCode.set(code, label);
    }
  }
  const venueById = new Map<string, { name: string | null; city: string | null }>();
  for (const venue of pack?.venues ?? []) {
    venueById.set(venue.id, {
      // stadium_name is the archive-canonical venue name; fifa_name is the
      // tournament-branding alias (see pack conflict C-005).
      name: venue.stadium_name ?? venue.fifa_name ?? null,
      city: venue.city ?? null,
    });
  }
  return { teamNameByCode, groupNameByTeamCode, venueById };
}

function toRow(
  match: PackMatch,
  lookups: PackLookups,
  verificationCap?: "REPORTED",
): Archived2026ScheduleRow {
  const status = archivedStatusFor(match);
  let verification = archivedVerificationFor(match.verification);
  if (verificationCap === "REPORTED" && verification === "VERIFIED") {
    verification = "REPORTED";
  }
  const score = match.score ?? null;
  const venue = match.venue_id != null ? lookups.venueById.get(match.venue_id) : undefined;
  const teamName = (code: string | null | undefined): string | null =>
    code == null ? null : (lookups.teamNameByCode.get(code) ?? code);
  const groupName =
    match.stage === "group"
      ? (lookups.groupNameByTeamCode.get(match.home ?? "") ??
        lookups.groupNameByTeamCode.get(match.away ?? "") ??
        null)
      : null;

  return {
    id: match.match_id,
    matchId: match.match_id,
    date: match.date ?? null,
    dateLabel: archivedDateLabel(match.date),
    timeLabel: null, // the archive pack records no kickoff times
    stageKey: match.stage,
    stage: archivedStageLabel(match.stage),
    groupName,
    homeTeamCode: match.home ?? null,
    homeTeamName: teamName(match.home),
    awayTeamCode: match.away ?? null,
    awayTeamName: teamName(match.away),
    homeScore: score?.home ?? null,
    awayScore: score?.away ?? null,
    homePenaltyScore: score?.penalties?.home ?? null,
    awayPenaltyScore: score?.penalties?.away ?? null,
    winnerTeamCode: match.winner ?? null,
    venueId: match.venue_id ?? null,
    venueName: venue?.name ?? null,
    cityName: venue?.city ?? null,
    status,
    verification,
    sources: match.sources ?? [],
    notes: match.notes ?? null,
  };
}

function compareRows(a: Archived2026ScheduleRow, b: Archived2026ScheduleRow): number {
  // Date ascending, undated rows last, then bracket order, then match number.
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  const byStage = stageOrder(a.stageKey) - stageOrder(b.stageKey);
  if (byStage !== 0) return byStage;
  const numA = /^M(\d+)$/.exec(a.matchId)?.[1];
  const numB = /^M(\d+)$/.exec(b.matchId)?.[1];
  if (numA !== undefined && numB !== undefined) return Number(numA) - Number(numB);
  return a.matchId.localeCompare(b.matchId);
}

/**
 * Builds sorted display rows from pack-format matches. `gapFills` (approved
 * review decisions) replace matching unresolved rows or append new ones; they
 * never override a row the pack already verified.
 */
export function buildArchivedScheduleRows(
  matches: PackMatch[],
  pack: ManualReferencePack | null,
  gapFills: Map<string, PackMatch> = new Map(),
): Archived2026ScheduleRow[] {
  const lookups = buildPackLookups(pack);
  const rows = new Map<string, Archived2026ScheduleRow>();
  for (const match of matches) {
    rows.set(match.match_id, toRow(match, lookups));
  }
  for (const [matchId, fill] of gapFills) {
    const existing = rows.get(matchId);
    if (existing !== undefined && existing.verification === "VERIFIED") continue;
    rows.set(matchId, toRow(fill, lookups, "REPORTED"));
  }
  return [...rows.values()].sort(compareRows);
}

export function buildArchivedScheduleResult(
  rows: Archived2026ScheduleRow[],
  totalOfficialMatches: number,
  lastUpdatedLabel?: string,
): Archived2026ScheduleResult {
  return {
    mode: "ARCHIVE",
    tournamentComplete: true,
    totalOfficialMatches,
    capturedMatches: rows.length,
    rows,
    unresolvedCount: rows.filter(
      (row) => row.status === "RESULT_UNDER_REVIEW" || row.status === "INCOMPLETE",
    ).length,
    verifiedCount: rows.filter((row) => row.verification === "VERIFIED").length,
    lastUpdatedLabel,
  };
}

// ---------------------------------------------------------------------------
// display-schedule.json (generated artifact) schema
// ---------------------------------------------------------------------------

const archivedRowSchema = z.object({
  id: z.string().min(1),
  matchId: z.string().min(1),
  date: z.string().nullable(),
  dateLabel: z.string().min(1),
  timeLabel: z.string().nullish(),
  stageKey: z.string().min(1),
  stage: z.string().min(1),
  groupName: z.string().nullish(),
  homeTeamCode: z.string().nullish(),
  homeTeamName: z.string().nullish(),
  awayTeamCode: z.string().nullish(),
  awayTeamName: z.string().nullish(),
  homeScore: z.number().int().nullish(),
  awayScore: z.number().int().nullish(),
  homePenaltyScore: z.number().int().nullish(),
  awayPenaltyScore: z.number().int().nullish(),
  winnerTeamCode: z.string().nullish(),
  venueId: z.string().nullish(),
  venueName: z.string().nullish(),
  cityName: z.string().nullish(),
  status: z.enum([
    "FULL_TIME",
    "AFTER_EXTRA_TIME",
    "PENALTIES",
    "RESULT_UNDER_REVIEW",
    "INCOMPLETE",
  ]),
  verification: z.enum([
    "VERIFIED",
    "REPORTED",
    "PARTIAL",
    "UNVERIFIED",
    "NEEDS_REVIEW",
  ]),
  sources: z.array(z.string()),
  notes: z.string().nullish(),
});

export const displayScheduleFileSchema = z
  .object({
    schema: z.literal("display-schedule/v1"),
    generatedAt: z.string().min(1),
    sourcePack: z.string().min(1),
    sourcePackHash: z.string().nullish(),
    officialMatchCount: z.number().int(),
    capturedMatchCount: z.number().int(),
    unresolvedCount: z.number().int(),
    verifiedCount: z.number().int(),
    warnings: z.array(z.string()),
    rows: z.array(archivedRowSchema),
  })
  .loose();

export type DisplayScheduleFile = z.infer<typeof displayScheduleFileSchema>;

// ---------------------------------------------------------------------------
// File-backed entry point
// ---------------------------------------------------------------------------

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    // Missing file OR unreadable/invalid JSON — callers treat both as "not
    // usable" and fall through to the next source.
    return null;
  }
}

async function loadReviewDecisions(
  filePath: string,
): Promise<ReviewDecisionsFile | null> {
  const raw = await readJsonIfExists(filePath);
  if (raw === null) return null;
  const parsed = reviewDecisionsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type Archived2026ScheduleOptions = {
  /** Override the data root (tests). Defaults to `data/2026` under cwd. */
  dataDir?: string;
};

/**
 * Loads the archived 2026 schedule for display. File-backed only — no
 * database, no providers, no sync. Falls through the documented source order
 * and degrades to an empty ARCHIVE result when nothing is available (the page
 * shows an honest empty state).
 */
export async function getArchived2026Schedule(
  options: Archived2026ScheduleOptions = {},
): Promise<Archived2026ScheduleResult> {
  const dataDir = options.dataDir ?? DATA_2026_DIR;
  const finalizedDir = path.join(dataDir, "approved", "finalized");
  const packDir =
    options.dataDir !== undefined
      ? path.join(dataDir, "reference", "manual-verified-v1")
      : MANUAL_PACK_DIR;
  const decisionsPath = path.join(dataDir, "review", "review-decisions.json");

  // 1. Approved finalized matches (pack match format) — highest priority.
  const finalizedMatchesRaw = await readJsonIfExists(
    path.join(finalizedDir, "matches.json"),
  );
  if (finalizedMatchesRaw !== null) {
    const parsed = packMatchesFileSchema.safeParse(finalizedMatchesRaw);
    if (parsed.success) {
      const packResult = await loadManualReferencePack(packDir);
      const pack = packResult?.ok === true ? packResult.pack : null;
      const rows = buildArchivedScheduleRows(parsed.data.matches, pack);
      return buildArchivedScheduleResult(
        rows,
        parsed.data.official_match_count,
        "Approved finalized 2026 match data",
      );
    }
  }

  // 2. Generated display schedule artifact.
  const displayRaw = await readJsonIfExists(
    path.join(finalizedDir, "display-schedule.json"),
  );
  if (displayRaw !== null) {
    const parsed = displayScheduleFileSchema.safeParse(displayRaw);
    if (parsed.success) {
      const rows = [...parsed.data.rows].sort(compareRows);
      return {
        mode: "ARCHIVE",
        tournamentComplete: true,
        totalOfficialMatches: parsed.data.officialMatchCount,
        capturedMatches: rows.length,
        rows,
        unresolvedCount: parsed.data.unresolvedCount,
        verifiedCount: parsed.data.verifiedCount,
        lastUpdatedLabel: `Display schedule · ${parsed.data.sourcePack} · ${archivedDateLabel(parsed.data.generatedAt.slice(0, 10))}`,
      };
    }
  }

  // 3. Manual verified reference pack + approved review gap-fills.
  const packResult = await loadManualReferencePack(packDir);
  if (packResult?.ok === true) {
    const pack = packResult.pack;
    const decisions = await loadReviewDecisions(decisionsPath);
    const rows = buildArchivedScheduleRows(
      pack.matches,
      pack,
      approvedGapFills(decisions),
    );
    return buildArchivedScheduleResult(
      rows,
      pack.officialMatchCount,
      `Reference pack ${pack.manifest.packId} · ${archivedDateLabel(pack.manifest.createdAt.slice(0, 10))}`,
    );
  }

  // 4. Nothing available — empty but honest.
  return buildArchivedScheduleResult([], 104, undefined);
}
