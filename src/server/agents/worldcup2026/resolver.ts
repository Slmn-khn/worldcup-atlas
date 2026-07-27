// Entity resolution helpers for the 2026 data steward agent (Phase 1).
//
// Pure functions that decide when two records from different sources describe
// the same real-world entity, and how a field whose sources disagree is
// merged. Cross-source name aliases ("USA" vs "United States", "Ivory Coast"
// vs "Côte d'Ivoire") are resolved through the existing country/flag helpers
// so team identity does not depend on spelling.
//
// Conflicts are never hidden: a merged field always reports whether its
// sources agreed, and disagreements are returned as ConflictEntry records for
// data/2026/normalized/conflicts.json.

import { getFlagCodeForCountry, normalizeCountryKey } from "../../../lib/media/flags";
import { teamSlug } from "../../../lib/teamSlug";
import { sourcePriority } from "./sourceRegistry";
import type { ConflictEntry, MatchStage, StewardDataKind } from "./types";

// ---------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------

/** Normalized slug for any display name (teams, venues). Null-safe. */
export function normalizeSlug(name: string | null | undefined): string | null {
  return teamSlug(name);
}

/**
 * True for bracket/qualification placeholder "teams" a source may carry
 * instead of a real country — e.g. "UEFA Path A Winner", "Winner Group C",
 * "TBD". These are preserved (never invented data, just the source's own
 * tokens) but flagged UNVERIFIED and excluded from real-team counts.
 */
export function isPlaceholderTeamName(
  name: string | null | undefined,
): boolean {
  if (name == null || name.trim() === "") return false;
  return /\b(winner|loser|runner[- ]?up|play-?offs?|path|tbd|qualif)\b/i.test(
    name,
  );
}

/**
 * Canonical identity key for a team/country. Prefers the flag-icons country
 * code (alias-proof: "USA", "United States" and code "USA" all → `flag:us`);
 * falls back to the name slug when no country resolves.
 */
export function canonicalTeamKey(
  name: string | null | undefined,
  codes?: {
    code?: string | null;
    fifaCode?: string | null;
    iso2Code?: string | null;
  },
): string | null {
  const flagCode = getFlagCodeForCountry({
    name: name ?? null,
    code: codes?.code ?? null,
    fifaCode: codes?.fifaCode ?? null,
    iso2Code: codes?.iso2Code ?? null,
  });
  if (flagCode !== null) return `flag:${flagCode}`;
  const slug = teamSlug(name);
  return slug === null ? null : `slug:${slug}`;
}

/** Canonical key for a venue (slug of its name). */
export function canonicalVenueKey(name: string | null | undefined): string | null {
  return teamSlug(name);
}

/**
 * Canonical key for a host city. Parenthetical qualifiers are dropped so
 * "Guadalajara (Zapopan)" and "Guadalajara" compare equal.
 */
export function canonicalCityKey(name: string | null | undefined): string | null {
  if (name == null) return null;
  const base = name.replace(/\(.*?\)/g, " ");
  const key = normalizeCountryKey(base);
  return key === "" ? null : key.replace(/ /g, "-");
}

// ---------------------------------------------------------------------------
// Stage normalization
// ---------------------------------------------------------------------------

/** Maps free-form source stage/round labels onto the shared MatchStage enum. */
export function normalizeStage(
  stageLabel: string | null | undefined,
  roundLabel: string | null | undefined,
  groupName: string | null | undefined,
): MatchStage {
  const label = `${stageLabel ?? ""} ${roundLabel ?? ""}`.toLowerCase();
  if (groupName != null && groupName !== "") return "GROUP";
  // FIFA labels the group stage "First stage".
  if (label.includes("group") || label.includes("matchday") || label.includes("first stage")) return "GROUP";
  // Compact tokens ("r32", "qf") are used by the worldcup2026 API and some
  // candidate providers alongside the long-form labels.
  if (label.includes("round of 32") || label.includes("last 32") || /\br32\b/.test(label)) return "ROUND_OF_32";
  if (label.includes("round of 16") || label.includes("last 16") || /\br16\b/.test(label)) return "ROUND_OF_16";
  if (label.includes("quarter") || /\bqf\b/.test(label)) return "QUARTER_FINAL";
  if (label.includes("semi") || /\bsf\b/.test(label)) return "SEMI_FINAL";
  if (label.includes("third") || /\b3rd\b/.test(label)) return "THIRD_PLACE";
  if (/\bfinal\b/.test(label)) return "FINAL";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Comparable date/time labels
// ---------------------------------------------------------------------------

/** "2026-06-11" or "06/11/2026" (m/d/y) → "2026-06-11"; else trimmed input. */
export function comparableDateLabel(
  label: string | null | undefined,
): string | null {
  if (label == null) return null;
  const trimmed = label.trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdy !== null) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  return trimmed;
}

/** "13:00 UTC-6" / "13.00" / "13:00" → "13:00" (local HH:MM only). */
export function comparableTimeLabel(
  label: string | null | undefined,
): string | null {
  if (label == null) return null;
  const match = /(\d{1,2})[.:](\d{2})/.exec(label);
  if (match === null) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

// ---------------------------------------------------------------------------
// Field merging
// ---------------------------------------------------------------------------

export type FieldVote<T> = {
  sourceId: string;
  value: T;
};

export type FieldAgreement = "MULTI" | "SINGLE" | "CONFLICT" | "EMPTY";

export type MergedField<T> = {
  /** Winning value (highest-priority source), null when nothing voted. */
  value: T | null;
  /** Distinct sources that contributed a non-null vote. */
  sourceIds: string[];
  agreement: FieldAgreement;
  /** One representative vote per source (for conflict reporting). */
  votes: FieldVote<T>[];
};

/**
 * Merges one field across sources. Null/undefined votes abstain. Votes are
 * compared through `comparable` (defaults to strict JSON equality); when the
 * remaining votes disagree — across sources OR between two endpoints of the
 * same source — the field is CONFLICT and the highest-priority vote wins,
 * but the disagreement is preserved in `votes` for reporting.
 */
export function mergeField<T>(
  votes: Array<FieldVote<T | null | undefined>>,
  comparable: (value: T) => unknown = (value) => JSON.stringify(value),
): MergedField<T> {
  const cast = votes.filter(
    (vote): vote is FieldVote<T> => vote.value !== null && vote.value !== undefined,
  );
  if (cast.length === 0) {
    return { value: null, sourceIds: [], agreement: "EMPTY", votes: [] };
  }

  const sorted = [...cast].sort(
    (a, b) =>
      sourcePriority(a.sourceId) - sourcePriority(b.sourceId) ||
      a.sourceId.localeCompare(b.sourceId),
  );
  const distinctKeys = new Set(sorted.map((vote) => String(comparable(vote.value))));
  const sourceIds = [...new Set(sorted.map((vote) => vote.sourceId))];

  // One representative vote per (source, comparable value) pair keeps the
  // conflict report readable while still exposing intra-source disagreement.
  const seen = new Set<string>();
  const representative: FieldVote<T>[] = [];
  for (const vote of sorted) {
    const key = `${vote.sourceId}::${String(comparable(vote.value))}`;
    if (!seen.has(key)) {
      seen.add(key);
      representative.push(vote);
    }
  }

  const agreement: FieldAgreement =
    distinctKeys.size > 1 ? "CONFLICT" : sourceIds.length > 1 ? "MULTI" : "SINGLE";

  return { value: sorted[0].value, sourceIds, agreement, votes: representative };
}

/** Builds the ConflictEntry for a CONFLICT-agreement merged field. */
export function conflictFromField<T>(
  entityType: StewardDataKind,
  entityKey: string,
  field: string,
  merged: MergedField<T>,
  note?: string,
): ConflictEntry {
  return {
    entityType,
    entityKey,
    field,
    values: merged.votes.map((vote) => ({
      sourceId: vote.sourceId,
      value: typeof vote.value === "string" ? vote.value : JSON.stringify(vote.value),
    })),
    resolution: "KEPT_HIGHEST_PRIORITY",
    ...(note !== undefined ? { note } : {}),
  };
}

/**
 * Deterministic duplicate-match-number check. Returns the numbers that occur
 * more than once (used by the validator and unit-tested directly).
 */
export function findDuplicateMatchNumbers(
  matchNumbers: Array<number | null | undefined>,
): number[] {
  const counts = new Map<number, number>();
  for (const num of matchNumbers) {
    if (num == null) continue;
    counts.set(num, (counts.get(num) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([num]) => num)
    .sort((a, b) => a - b);
}
