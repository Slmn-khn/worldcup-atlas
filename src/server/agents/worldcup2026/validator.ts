// Deterministic validator for the 2026 data steward normalized outputs.
//
// Reads data/2026/normalized/, re-validates every record against the Zod
// contracts, applies the Phase 1 rule set (counts, uniqueness, referential
// checks, result plausibility), and produces the three report files under
// data/2026/validation/. Pure rule functions — same input, same verdict.
//
// Verdict semantics:
//   FAIL — a hard rule is violated (wrong year, duplicate identifiers,
//          invalid results). The data pack must not move forward.
//   WARN — data is internally consistent but incomplete, single-source, or
//          carries reported conflicts. Human review required.
//   PASS — all rules hold and nothing is flagged. (Still not an import
//          approval — Phase 1 never imports.)

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  conflictEntrySchema,
  normalized2026GroupSchema,
  normalized2026MatchSchema,
  normalized2026StandingSchema,
  normalized2026TeamSchema,
  normalized2026TournamentSchema,
  normalized2026VenueSchema,
} from "./contracts";
import {
  buildManualPackStats,
  loadManualReferencePack,
  type ManualPackStats,
} from "./manualReferencePack";
import { canonicalTeamKey, findDuplicateMatchNumbers, isPlaceholderTeamName } from "./resolver";
import { NORMALIZED_2026_DIR } from "./sourceRegistry";
import type {
  ConflictEntry,
  Normalized2026Group,
  Normalized2026Match,
  Normalized2026Standing,
  Normalized2026Team,
  Normalized2026Tournament,
  Normalized2026Venue,
} from "./types";

// Expected full-tournament shape for 2026.
export const EXPECTED_2026 = {
  teams: 48,
  groups: 12,
  teamsPerGroup: 4,
  matches: 104,
  venues: 16,
  hostFlagCodes: ["ca", "mx", "us"] as const,
};

export type ValidationIssue = {
  code: string;
  message: string;
  entityKey?: string;
};

export type ValidationStatus = "PASS" | "WARN" | "FAIL";

export type ValidationReport = {
  status: ValidationStatus;
  generatedAt: string;
  counts: Record<string, number>;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  conflicts: Array<{
    entityType: string;
    entityKey: string;
    field: string;
    note?: string;
  }>;
  recommendations: string[];
  /** Coverage of the manual verified reference pack (present:false if none). */
  manualPack: ManualPackStats;
};

export type NormalizedDataSet = {
  tournament: Normalized2026Tournament | null;
  teams: Normalized2026Team[];
  groups: Normalized2026Group[];
  venues: Normalized2026Venue[];
  matches: Normalized2026Match[];
  standings: Normalized2026Standing[];
  conflicts: ConflictEntry[];
};

// ---------------------------------------------------------------------------
// Loading (with contract re-validation)
// ---------------------------------------------------------------------------

async function readJsonFile(dir: string, name: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, name), "utf8"));
  } catch {
    return null;
  }
}

function recordsOf(payload: unknown): unknown[] {
  if (payload !== null && typeof payload === "object") {
    const records = (payload as Record<string, unknown>).records;
    if (Array.isArray(records)) return records;
  }
  return [];
}

/**
 * Loads the normalized data set, re-validating against the Zod contracts.
 * Contract violations become validation errors (collected via `onError`)
 * rather than crashes, so a partially-broken directory still yields a report.
 */
export async function loadNormalizedDataSet(
  normalizedDir: string,
  onError: (issue: ValidationIssue) => void,
): Promise<NormalizedDataSet> {
  const parseAll = <T>(
    payload: unknown,
    schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { message: string } } },
    label: string,
  ): T[] => {
    const valid: T[] = [];
    recordsOf(payload).forEach((record, index) => {
      const result = schema.safeParse(record);
      if (result.success && result.data !== undefined) valid.push(result.data);
      else {
        onError({
          code: "CONTRACT_VIOLATION",
          message: `${label}[${index}] fails its Zod contract.`,
        });
      }
    });
    return valid;
  };

  const tournamentPayload = await readJsonFile(normalizedDir, "tournament.json");
  let tournament: Normalized2026Tournament | null = null;
  if (tournamentPayload !== null && typeof tournamentPayload === "object") {
    const record = (tournamentPayload as Record<string, unknown>).record;
    const result = normalized2026TournamentSchema.safeParse(record);
    if (result.success) tournament = result.data;
    else {
      onError({
        code: "CONTRACT_VIOLATION",
        message: "tournament.json record fails its Zod contract.",
      });
    }
  }

  return {
    tournament,
    teams: parseAll(await readJsonFile(normalizedDir, "teams.json"), normalized2026TeamSchema, "teams"),
    groups: parseAll(await readJsonFile(normalizedDir, "groups.json"), normalized2026GroupSchema, "groups"),
    venues: parseAll(await readJsonFile(normalizedDir, "venues.json"), normalized2026VenueSchema, "venues"),
    matches: parseAll(await readJsonFile(normalizedDir, "matches.json"), normalized2026MatchSchema, "matches"),
    standings: parseAll(await readJsonFile(normalizedDir, "standings.json"), normalized2026StandingSchema, "standings"),
    conflicts: parseAll(await readJsonFile(normalizedDir, "conflicts.json"), conflictEntrySchema, "conflicts"),
  };
}

// ---------------------------------------------------------------------------
// Rule set (pure)
// ---------------------------------------------------------------------------

export function validateNormalizedDataSet(
  data: NormalizedDataSet,
  preloadErrors: ValidationIssue[] = [],
  manualPack: ManualPackStats = buildManualPackStats(null),
): ValidationReport {
  const errors: ValidationIssue[] = [...preloadErrors];
  const warnings: ValidationIssue[] = [];
  const recommendations: string[] = [];

  const realTeams = data.teams.filter(
    (team) => !isPlaceholderTeamName(team.name),
  );
  const placeholderTeams = data.teams.length - realTeams.length;
  const resolvedMatches = data.matches.filter(
    (match) => match.verificationStatus !== "INCOMPLETE",
  );
  const finishedMatches = data.matches.filter(
    (match) => match.status === "FINISHED",
  );

  // ── Tournament ───────────────────────────────────────────────────────────
  const tournament = data.tournament;
  if (tournament === null) {
    errors.push({ code: "TOURNAMENT_MISSING", message: "tournament.json is missing or invalid." });
  } else {
    if (tournament.tournamentYear !== 2026) {
      errors.push({
        code: "TOURNAMENT_YEAR",
        message: `tournamentYear is ${tournament.tournamentYear}, expected 2026.`,
      });
    }
    const countChecks: Array<[string, number, number]> = [
      ["teamsCount", tournament.teamsCount, EXPECTED_2026.teams],
      ["groupsCount", tournament.groupsCount, EXPECTED_2026.groups],
      ["matchesCount", tournament.matchesCount, EXPECTED_2026.matches],
      ["venuesCount", tournament.venuesCount, EXPECTED_2026.venues],
    ];
    for (const [field, actual, expected] of countChecks) {
      if (actual > 0 && actual !== expected) {
        warnings.push({
          code: "TOURNAMENT_COUNT",
          message: `tournament.${field} is ${actual}, expected ${expected}.`,
        });
      }
    }
    if (tournament.hostCountries.length > 0) {
      const hostCodes = new Set(
        tournament.hostCountries
          .map((host) => canonicalTeamKey(host))
          .filter((key): key is string => key !== null),
      );
      const missingHosts = EXPECTED_2026.hostFlagCodes.filter(
        (code) => !hostCodes.has(`flag:${code}`),
      );
      if (missingHosts.length > 0) {
        warnings.push({
          code: "TOURNAMENT_HOSTS",
          message: `Host countries should include Canada, Mexico and United States; missing flag codes: ${missingHosts.join(", ")}.`,
        });
      }
    }
  }

  // ── Teams & groups ───────────────────────────────────────────────────────
  if (realTeams.length !== EXPECTED_2026.teams) {
    warnings.push({
      code: "TEAMS_COUNT",
      message: `${realTeams.length} real teams normalized (plus ${placeholderTeams} placeholders), expected ${EXPECTED_2026.teams}.`,
    });
  }
  const slugCounts = new Map<string, number>();
  for (const team of data.teams) {
    slugCounts.set(team.slug, (slugCounts.get(team.slug) ?? 0) + 1);
  }
  for (const [slug, count] of [...slugCounts.entries()].sort()) {
    if (count > 1) {
      errors.push({
        code: "TEAM_SLUG_DUPLICATE",
        message: `Team slug "${slug}" occurs ${count} times.`,
        entityKey: slug,
      });
    }
  }

  if (data.groups.length !== EXPECTED_2026.groups) {
    warnings.push({
      code: "GROUPS_COUNT",
      message: `${data.groups.length} groups normalized, expected ${EXPECTED_2026.groups}.`,
    });
  }
  for (const group of data.groups) {
    const realMembers = group.teams.filter((team) => !isPlaceholderTeamName(team));
    if (realMembers.length !== EXPECTED_2026.teamsPerGroup) {
      warnings.push({
        code: "GROUP_SIZE",
        message: `${group.name} has ${realMembers.length} resolved teams, expected ${EXPECTED_2026.teamsPerGroup}.`,
        entityKey: group.name,
      });
    }
  }

  // ── Matches ──────────────────────────────────────────────────────────────
  if (resolvedMatches.length !== EXPECTED_2026.matches) {
    warnings.push({
      code: "MATCHES_COUNT",
      message:
        `${resolvedMatches.length} resolved matches normalized ` +
        `(${data.matches.length} total records), expected ${EXPECTED_2026.matches}.`,
    });
  }

  const duplicateNumbers = findDuplicateMatchNumbers(
    data.matches.map((match) => match.matchNumber),
  );
  for (const num of duplicateNumbers) {
    errors.push({
      code: "MATCH_NUMBER_DUPLICATE",
      message: `Match number ${num} is used by more than one match.`,
      entityKey: String(num),
    });
  }

  const venueSlugSet = new Set(data.venues.map((venue) => venue.slug));
  data.matches.forEach((match, index) => {
    const label =
      match.matchNumber != null
        ? `match #${match.matchNumber}`
        : `match[${index}] (${match.homeTeamName ?? "?"} v ${match.awayTeamName ?? "?"})`;

    if (match.stage === "UNKNOWN") {
      errors.push({ code: "MATCH_STAGE_UNKNOWN", message: `${label} has no recognizable stage.`, entityKey: label });
    }
    if (
      match.homeTeamName != null &&
      match.awayTeamName != null &&
      canonicalTeamKey(match.homeTeamName) === canonicalTeamKey(match.awayTeamName)
    ) {
      errors.push({ code: "MATCH_SAME_TEAM", message: `${label} lists the same team on both sides.`, entityKey: label });
    }
    if (match.stage === "GROUP" && (match.groupName == null || match.groupName === "")) {
      errors.push({ code: "MATCH_GROUP_MISSING", message: `${label} is group-stage but has no groupName.`, entityKey: label });
    }
    if (match.status === "FINISHED") {
      if (match.homeScore == null || match.awayScore == null) {
        errors.push({ code: "MATCH_SCORE_MISSING", message: `${label} is FINISHED without a full score.`, entityKey: label });
      } else if (
        match.stage !== "GROUP" &&
        match.homeScore === match.awayScore &&
        (match.homePenaltyScore == null || match.awayPenaltyScore == null) &&
        match.winnerTeamName == null
      ) {
        errors.push({
          code: "MATCH_UNRESOLVED_TIE",
          message: `${label} is a finished knockout tie without penalties/extra-time resolution or winner.`,
          entityKey: label,
        });
      }
    }
    if (match.venueName != null && data.venues.length > 0) {
      const matchVenueSlug = match.venueName
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      // Exact slug, or a sponsor-prefixed alias of a known venue at a hyphen
      // boundary ("geha-field-at-arrowhead-stadium" ↔ "arrowhead-stadium").
      const resolves =
        venueSlugSet.has(matchVenueSlug) ||
        [...venueSlugSet].some(
          (slug) =>
            matchVenueSlug.endsWith(`-${slug}`) ||
            matchVenueSlug.startsWith(`${slug}-`) ||
            slug.endsWith(`-${matchVenueSlug}`) ||
            slug.startsWith(`${matchVenueSlug}-`),
        );
      if (!resolves) {
        warnings.push({
          code: "MATCH_VENUE_UNRESOLVED",
          message: `${label} references venue "${match.venueName}" which is not in venues.json.`,
          entityKey: label,
        });
      }
    }
  });

  // ── Venues ───────────────────────────────────────────────────────────────
  const venueSlugCounts = new Map<string, number>();
  for (const venue of data.venues) {
    venueSlugCounts.set(venue.slug, (venueSlugCounts.get(venue.slug) ?? 0) + 1);
  }
  for (const [slug, count] of [...venueSlugCounts.entries()].sort()) {
    if (count > 1) {
      errors.push({ code: "VENUE_SLUG_DUPLICATE", message: `Venue slug "${slug}" occurs ${count} times.`, entityKey: slug });
    }
  }
  if (data.venues.length !== EXPECTED_2026.venues) {
    warnings.push({
      code: "VENUES_COUNT",
      message: `${data.venues.length} venues normalized, expected ${EXPECTED_2026.venues}.`,
    });
  }

  // ── Standings ────────────────────────────────────────────────────────────
  const groupsWithCompleteResults = new Set<string>();
  const groupMatchCounts = new Map<string, { total: number; finished: number }>();
  for (const match of resolvedMatches) {
    if (match.stage !== "GROUP" || match.groupName == null) continue;
    const entry = groupMatchCounts.get(match.groupName) ?? { total: 0, finished: 0 };
    entry.total += 1;
    if (match.status === "FINISHED" && match.homeScore != null && match.awayScore != null) {
      entry.finished += 1;
    }
    groupMatchCounts.set(match.groupName, entry);
  }
  for (const [groupName, entry] of groupMatchCounts) {
    if (entry.total > 0 && entry.total === entry.finished) {
      groupsWithCompleteResults.add(groupName);
    }
  }
  const standingsGroups = new Set(data.standings.map((row) => row.groupName));
  for (const groupName of [...groupsWithCompleteResults].sort()) {
    if (!standingsGroups.has(groupName)) {
      errors.push({
        code: "STANDINGS_MISSING",
        message: `Group ${groupName} has complete results but no computed standings.`,
        entityKey: groupName,
      });
    }
  }

  // ── Manual verified reference pack (optional, WARN-level coverage) ───────
  if (manualPack.present) {
    // Partial coverage is an expected, honestly-recorded property of a
    // human-curated pack — a warning for review, NEVER a hard failure.
    if (manualPack.capturedMatchCount < manualPack.officialMatchCount) {
      warnings.push({
        code: "MANUAL_PACK_PARTIAL_COVERAGE",
        message:
          `Manual reference pack captures ${manualPack.capturedMatchCount} of ` +
          `${manualPack.officialMatchCount} official matches — usable as ` +
          "high-priority supporting evidence, insufficient for a full import.",
      });
    }
    if (manualPack.unverifiedMatches > 0) {
      warnings.push({
        code: "MANUAL_PACK_UNVERIFIED_MATCHES",
        message:
          `${manualPack.unverifiedMatches} manual pack matches are not fully ` +
          "verified (missing scores/participants) — supporting evidence only, " +
          "never final values.",
      });
    }
    if (manualPack.unverifiedTeams > 0) {
      warnings.push({
        code: "MANUAL_PACK_UNVERIFIED_TEAMS",
        message:
          `${manualPack.unverifiedTeams} manual pack team records are not fully ` +
          "verified (including unconfirmed participant placeholders) — not " +
          "import-ready.",
      });
    }
  }

  // ── Conflicts (reported by the normalizer — never silently resolved) ─────
  const conflicts = data.conflicts.map((conflict) => ({
    entityType: conflict.entityType,
    entityKey: conflict.entityKey,
    field: conflict.field,
    ...(conflict.note !== undefined ? { note: conflict.note } : {}),
  }));

  // ── Verdict + recommendations ────────────────────────────────────────────
  const status: ValidationStatus =
    errors.length > 0 ? "FAIL" : warnings.length > 0 || conflicts.length > 0 ? "WARN" : "PASS";

  if (errors.length > 0) {
    recommendations.push("Fix hard validation errors before anything else — they indicate broken normalization or broken source data.");
  }
  if (conflicts.length > 0) {
    recommendations.push("Review conflicts.json: every entry is a real cross-source (or intra-source) disagreement that was reported, not silently resolved.");
  }
  const singleSourceFinished = finishedMatches.filter(
    (match) => match.confidence === "SINGLE_SOURCE",
  ).length;
  if (singleSourceFinished > 0) {
    recommendations.push(
      `${singleSourceFinished} finished matches have single-source results. Add an official/manual reference snapshot (Phase 2 TODO in sourceRegistry.ts) to upgrade confidence before import.`,
    );
  }
  if (status !== "FAIL" && errors.length === 0) {
    recommendations.push("Do NOT import in Phase 1. A future import phase must require data/2026/approved/approval.json (see data/2026/approved/README.md).");
  }

  return {
    status,
    generatedAt: new Date().toISOString(),
    counts: {
      teams: data.teams.length,
      realTeams: realTeams.length,
      placeholderTeams,
      groups: data.groups.length,
      venues: data.venues.length,
      matchRecords: data.matches.length,
      resolvedMatches: resolvedMatches.length,
      finishedMatches: finishedMatches.length,
      standings: data.standings.length,
      conflicts: conflicts.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
    conflicts,
    recommendations,
    manualPack,
  };
}

/**
 * Convenience: load + validate the default normalized directory, including
 * manual reference pack coverage when a pack is present. A structurally
 * malformed pack is a hard validation error (FAIL) — fix the pack, don't
 * skip it.
 */
export async function validateNormalizedDir(
  normalizedDir: string = NORMALIZED_2026_DIR,
  manualPackDir?: string,
): Promise<{ report: ValidationReport; data: NormalizedDataSet }> {
  const contractErrors: ValidationIssue[] = [];
  const data = await loadNormalizedDataSet(normalizedDir, (issue) =>
    contractErrors.push(issue),
  );

  const packLoad = await loadManualReferencePack(manualPackDir);
  let packStats = buildManualPackStats(null);
  if (packLoad !== null) {
    if (packLoad.ok) {
      packStats = buildManualPackStats(packLoad.pack);
    } else {
      for (const message of packLoad.errors) {
        contractErrors.push({ code: "MANUAL_PACK_MALFORMED", message });
      }
    }
  }

  return {
    report: validateNormalizedDataSet(data, contractErrors, packStats),
    data,
  };
}
