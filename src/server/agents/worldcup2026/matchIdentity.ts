// Match identity resolution for the 2026 candidate providers (Phase 1).
//
// Resolves a provider match row onto a reference match (manual verified pack
// match or normalized archive match) with an explicit confidence level.
// Pure and deterministic: same reference set + same query → same resolution.
// Ambiguity never guesses — anything not uniquely resolvable is UNRESOLVED.

import { canonicalTeamKey, normalizeStage } from "./resolver";
import type { MatchStage } from "./types";

export const MATCH_RESOLUTION_CONFIDENCES = [
  "EXACT_MATCH_ID",
  "EXACT_FIFA_ID",
  "EXACT_TEAM_DATE_STAGE",
  "PROBABLE",
  "UNRESOLVED",
] as const;
export type MatchResolutionConfidence =
  (typeof MATCH_RESOLUTION_CONFIDENCES)[number];

/** A match the archive already knows about, indexed for resolution. */
export type ReferenceMatch = {
  /** Stable key the resolution points back to (e.g. pack match_id "M104"). */
  key: string;
  /** Source-specific match ids this match is known under (any source). */
  matchIds?: Array<string | number | null | undefined>;
  /** Official FIFA match id, when known. */
  fifaMatchId?: string | number | null;
  /** ISO date (yyyy-mm-dd) of the kickoff, when known. */
  date?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  stage?: string | null;
};

export type MatchQuery = {
  matchId?: string | number | null;
  fifaMatchId?: string | number | null;
  date?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  stage?: string | null;
};

export type MatchResolution = {
  confidence: MatchResolutionConfidence;
  /** Reference key of the resolved match; null when UNRESOLVED. */
  referenceKey: string | null;
  note?: string;
};

const UNRESOLVED: MatchResolution = { confidence: "UNRESOLVED", referenceKey: null };

function idKey(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  return text === "" ? null : text;
}

const MONTH_NUMBERS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05",
  june: "06", july: "07", august: "08", september: "09", october: "10",
  november: "11", december: "12",
};

function dateKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  // Accept "yyyy-mm-dd", "yyyy-mm-ddTHH:MM…", "yyyy/mm/dd".
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(trimmed);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // "m/d/yyyy" (US style used by some providers).
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdy !== null) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  // "June 11, 2026" / "11 June 2026".
  const monthFirst = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(trimmed);
  const dayFirst = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/i.exec(trimmed);
  const monthName = (monthFirst?.[1] ?? dayFirst?.[2])?.toLowerCase();
  const day = monthFirst?.[2] ?? dayFirst?.[1];
  const year = monthFirst?.[3] ?? dayFirst?.[3];
  if (monthName !== undefined && day !== undefined && year !== undefined) {
    const month = MONTH_NUMBERS[monthName];
    if (month !== undefined) return `${year}-${month}-${day.padStart(2, "0")}`;
  }
  return null;
}

/** Accepts display names AND FIFA-style codes ("Spain" and "ESP" → flag:es). */
function teamIdentityKey(value: string | null | undefined): string | null {
  return canonicalTeamKey(value, { code: value ?? null, fifaCode: value ?? null });
}

/** yyyy-mm-dd shifted by whole days (UTC arithmetic — no DST surprises). */
function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function teamPairKey(
  home: string | null | undefined,
  away: string | null | undefined,
): string | null {
  const homeKey = teamIdentityKey(home);
  const awayKey = teamIdentityKey(away);
  if (homeKey === null || awayKey === null) return null;
  // Order-insensitive: providers disagree about which side is "home".
  return [homeKey, awayKey].sort().join("|");
}

function stageKey(stage: string | null | undefined): MatchStage {
  return normalizeStage(stage, stage, null);
}

/**
 * Team-pair + date signature of a match, for deduplicating reference sets
 * built from multiple layers (manual pack + normalized archive) that describe
 * the same real-world match under different keys. Null when either the pair
 * or the date is unknown.
 */
export function referenceMatchSignature(match: {
  date?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
}): string | null {
  const teams = teamPairKey(match.homeTeam, match.awayTeam);
  const date = dateKey(match.date);
  return teams !== null && date !== null ? `${teams}@${date}` : null;
}

/** Multi-map helper: only unique entries can resolve, duplicates poison. */
export class UniqueIndex {
  private map = new Map<string, string | null>();

  add(key: string | null, referenceKey: string): void {
    if (key === null) return;
    // Second occurrence of the same key → ambiguous → never resolves.
    this.map.set(key, this.map.has(key) ? null : referenceKey);
  }

  get(key: string | null): string | null {
    if (key === null) return null;
    return this.map.get(key) ?? null;
  }
}

export type MatchIdentityIndex = {
  byMatchId: UniqueIndex;
  byFifaId: UniqueIndex;
  byTeamsDateStage: UniqueIndex;
  byTeamsDate: UniqueIndex;
  byTeamsStage: UniqueIndex;
  /** Reference key → its team pair key, to corroborate id-based hits. */
  teamPairByKey: Map<string, string>;
};

/** Builds the lookup index once per reference set. */
export function buildMatchIdentityIndex(
  referenceMatches: ReferenceMatch[],
): MatchIdentityIndex {
  const index: MatchIdentityIndex = {
    byMatchId: new UniqueIndex(),
    byFifaId: new UniqueIndex(),
    byTeamsDateStage: new UniqueIndex(),
    byTeamsDate: new UniqueIndex(),
    byTeamsStage: new UniqueIndex(),
    teamPairByKey: new Map(),
  };
  for (const match of referenceMatches) {
    for (const id of match.matchIds ?? []) {
      index.byMatchId.add(idKey(id), match.key);
    }
    index.byFifaId.add(idKey(match.fifaMatchId), match.key);
    const teams = teamPairKey(match.homeTeam, match.awayTeam);
    if (teams !== null) index.teamPairByKey.set(match.key, teams);
    const date = dateKey(match.date);
    const stage = stageKey(match.stage);
    if (teams !== null) {
      if (date !== null) {
        index.byTeamsDate.add(`${teams}@${date}`, match.key);
        if (stage !== "UNKNOWN") {
          index.byTeamsDateStage.add(`${teams}@${date}#${stage}`, match.key);
        }
      }
      if (stage !== "UNKNOWN") {
        index.byTeamsStage.add(`${teams}#${stage}`, match.key);
      }
    }
  }
  return index;
}

/**
 * Resolves a provider match row against the reference index.
 * Confidence ladder (first unique hit wins):
 *   EXACT_MATCH_ID       — provider match_id maps to a known id
 *   EXACT_FIFA_ID        — FIFA match id matches
 *   EXACT_TEAM_DATE_STAGE — team pair + date + stage all match
 *   PROBABLE             — team pair + date (stage missing/differs), or
 *                          team pair + stage (knockout without a date)
 *   UNRESOLVED           — anything else, including every ambiguity
 *
 * An id-based hit is only trusted when it is corroborated: if both the query
 * and the reference know their team pairs and they DISAGREE, the provider's
 * id numbering does not map onto the reference numbering — the hit is
 * discarded and resolution falls through to team/date/stage evidence.
 */
export function resolveMatch(
  index: MatchIdentityIndex,
  query: MatchQuery,
): MatchResolution {
  const teams = teamPairKey(query.homeTeam, query.awayTeam);
  const idCorroborated = (referenceKey: string | null): boolean => {
    if (referenceKey === null) return false;
    if (teams === null) return true; // nothing to check against
    const referenceTeams = index.teamPairByKey.get(referenceKey);
    return referenceTeams === undefined || referenceTeams === teams;
  };

  const byId = index.byMatchId.get(idKey(query.matchId));
  if (byId !== null && idCorroborated(byId)) {
    return { confidence: "EXACT_MATCH_ID", referenceKey: byId };
  }

  const byFifa = index.byFifaId.get(idKey(query.fifaMatchId));
  if (byFifa !== null && idCorroborated(byFifa)) {
    return { confidence: "EXACT_FIFA_ID", referenceKey: byFifa };
  }

  if (teams === null) return UNRESOLVED;
  const date = dateKey(query.date);
  const stage = stageKey(query.stage);

  if (date !== null && stage !== "UNKNOWN") {
    const exact = index.byTeamsDateStage.get(`${teams}@${date}#${stage}`);
    if (exact !== null) {
      return { confidence: "EXACT_TEAM_DATE_STAGE", referenceKey: exact };
    }
  }
  if (date !== null) {
    const probable = index.byTeamsDate.get(`${teams}@${date}`);
    if (probable !== null) {
      return {
        confidence: "PROBABLE",
        referenceKey: probable,
        note: "Matched on team pair + date; stage missing or differing.",
      };
    }
    // UTC-recorded kickoffs roll over the local calendar date for evening
    // matches — a ±1 day team-pair hit is probable, never exact.
    for (const delta of [-1, 1]) {
      const shifted = index.byTeamsDate.get(`${teams}@${shiftDate(date, delta)}`);
      if (shifted !== null) {
        return {
          confidence: "PROBABLE",
          referenceKey: shifted,
          note: "Matched on team pair + adjacent calendar date (likely UTC vs local-date drift).",
        };
      }
    }
  }
  // Knockout matches are unique per team pair per stage; group matches are
  // not guaranteed unique (theoretical rematches), so the UniqueIndex only
  // resolves when the pair+stage combination occurs exactly once.
  if (stage !== "UNKNOWN" && stage !== "GROUP") {
    const probable = index.byTeamsStage.get(`${teams}#${stage}`);
    if (probable !== null) {
      return {
        confidence: "PROBABLE",
        referenceKey: probable,
        note: "Matched on team pair + knockout stage without a date.",
      };
    }
  }
  return UNRESOLVED;
}
