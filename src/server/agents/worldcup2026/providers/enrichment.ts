// Enrichment classification for the 2026 candidate providers (Phase 1).
//
// Pure functions that compare candidate-provider rows against the manual
// verified reference pack (and the normalized archive baseline) and classify
// each enriched record. The manual pack remains AUTHORITATIVE for tournament
// outcome, the final, awards, and known conflicts:
//   - provider agrees with a verified manual field → SUPPORTING_EVIDENCE
//   - provider disagrees → CONFLICT (reported; the manual pack value stays
//     preferred — providers never override verified records)
//   - provider fills a manual gap and resolves cleanly → GAP_FILL_CANDIDATE
//   - detail the archive has no verified reference for → ENRICHMENT_CANDIDATE
//   - Bustami EFI metrics → ADVANCED_ANALYTICS_CANDIDATE, always blocked
//     from import (RESEARCH_ONLY_UNTIL_LICENSE_REVIEW)
//
// Nothing here is import-ready output: every record carries importReady:false.

import { resolveMatch, type MatchIdentityIndex, type MatchQuery, type MatchResolution } from "../matchIdentity";
import { canonicalTeamKey } from "../resolver";
import type { PlayerResolution } from "../playerIdentity";
import type { ManualReferencePack } from "../manualReferencePack";
import { MANUAL_PACK_SOURCE_ID } from "../manualReferencePack";
import type { ConflictEntry, StewardDataKind } from "../types";

export const ENRICHMENT_CLASSIFICATIONS = [
  "SUPPORTING_EVIDENCE",
  "GAP_FILL_CANDIDATE",
  "ENRICHMENT_CANDIDATE",
  "ADVANCED_ANALYTICS_CANDIDATE",
  "CONFLICT",
  "UNRESOLVED",
] as const;
export type EnrichmentClassification =
  (typeof ENRICHMENT_CLASSIFICATIONS)[number];

/** One normalized enrichment record (candidate output — never imported). */
export type EnrichedRecord = {
  sourceId: string;
  kind: StewardDataKind;
  sourceFile: string;
  sourceRowNumber: number;
  data: Record<string, unknown>;
  classification: EnrichmentClassification;
  matchResolution?: MatchResolution | null;
  playerResolution?: PlayerResolution | null;
  /** Always false in this phase — there is no import path for enrichment. */
  importReady: false;
  /** Standing legal/usage block (Bustami: RESEARCH_ONLY_UNTIL_LICENSE_REVIEW). */
  importBlockedReason: string | null;
  warnings: string[];
};

/** Envelope for every enriched output file. */
export type EnrichedFile = {
  sourceId: string;
  kind: StewardDataKind;
  generatedAt: string;
  policy: string[];
  records: EnrichedRecord[];
};

// ---------------------------------------------------------------------------
// Manual-pack verified facts (the authoritative comparison target)
// ---------------------------------------------------------------------------

export type PackMatchFact = {
  /** Pack match id, e.g. "M104" — also the reference key. */
  matchId: string;
  stage: string;
  date: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  verified: boolean;
};

export type PackVerifiedFacts = {
  present: boolean;
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  fourth: string | null;
  awards: Record<string, { winner: string | null; team: string | null }>;
  matchFacts: Map<string, PackMatchFact>;
  knownConflicts: number;
};

/** Extracts the verified comparison facts from a loaded manual pack. */
export function extractPackFacts(
  pack: ManualReferencePack | null,
): PackVerifiedFacts {
  if (pack === null) {
    return {
      present: false,
      champion: null,
      runnerUp: null,
      third: null,
      fourth: null,
      awards: {},
      matchFacts: new Map(),
      knownConflicts: 0,
    };
  }
  const nameByCode = new Map<string, string>();
  for (const team of pack.teams) {
    if (team.code !== null && team.name !== null) nameByCode.set(team.code, team.name);
  }
  const displayName = (code: string | null | undefined): string | null =>
    code == null ? null : (nameByCode.get(code) ?? code);

  const matchFacts = new Map<string, PackMatchFact>();
  for (const match of pack.matches) {
    matchFacts.set(match.match_id, {
      matchId: match.match_id,
      stage: match.stage,
      date: match.date ?? null,
      homeTeam: displayName(match.home),
      awayTeam: displayName(match.away),
      homeScore: match.score?.home ?? null,
      awayScore: match.score?.away ?? null,
      verified: match.verification === "verified",
    });
  }
  const awards: PackVerifiedFacts["awards"] = {};
  for (const [name, award] of Object.entries(pack.awards)) {
    awards[name] = { winner: award.winner ?? null, team: award.team ?? null };
  }
  return {
    present: true,
    champion: pack.tournament?.champion ?? null,
    runnerUp: pack.tournament?.runner_up ?? null,
    third: pack.tournament?.third ?? null,
    fourth: pack.tournament?.fourth ?? null,
    awards,
    matchFacts,
    knownConflicts: pack.conflicts.length,
  };
}

// ---------------------------------------------------------------------------
// Classification (pure — unit-tested)
// ---------------------------------------------------------------------------

export type ProviderMatchRow = {
  sourceId: string;
  sourceFile: string;
  sourceRowNumber: number;
  query: MatchQuery;
  homeScore: number | null;
  awayScore: number | null;
};

export type MatchClassificationResult = {
  classification: EnrichmentClassification;
  resolution: MatchResolution;
  conflict: ConflictEntry | null;
  warnings: string[];
};

function sameTeam(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const keyA = canonicalTeamKey(a, { code: a, fifaCode: a });
  const keyB = canonicalTeamKey(b, { code: b, fifaCode: b });
  return keyA !== null && keyA === keyB;
}

/**
 * Compares provider scores against a verified pack match, tolerating flipped
 * home/away orientation (providers disagree about sides). Returns null when
 * the comparison is not possible (missing scores on either side).
 */
export function scoresAgreeWithPack(
  fact: PackMatchFact,
  row: { query: MatchQuery; homeScore: number | null; awayScore: number | null },
): boolean | null {
  if (
    fact.homeScore === null ||
    fact.awayScore === null ||
    row.homeScore === null ||
    row.awayScore === null
  ) {
    return null;
  }
  const sameOrientation =
    sameTeam(fact.homeTeam, row.query.homeTeam ?? null) ||
    sameTeam(fact.awayTeam, row.query.awayTeam ?? null);
  const flippedOrientation =
    sameTeam(fact.homeTeam, row.query.awayTeam ?? null) ||
    sameTeam(fact.awayTeam, row.query.homeTeam ?? null);
  if (sameOrientation) {
    return fact.homeScore === row.homeScore && fact.awayScore === row.awayScore;
  }
  if (flippedOrientation) {
    return fact.homeScore === row.awayScore && fact.awayScore === row.homeScore;
  }
  // Orientation unknowable — compare as an unordered score pair.
  const packPair = [fact.homeScore, fact.awayScore].sort().join("-");
  const rowPair = [row.homeScore, row.awayScore].sort().join("-");
  return packPair === rowPair;
}

const EXACT_CONFIDENCES = new Set([
  "EXACT_MATCH_ID",
  "EXACT_FIFA_ID",
  "EXACT_TEAM_DATE_STAGE",
]);

/**
 * Classifies one provider match row against the reference index + pack facts.
 *
 *   - resolves to a VERIFIED pack match and scores agree → SUPPORTING_EVIDENCE
 *   - resolves to a VERIFIED pack match and scores disagree → CONFLICT
 *     (reported; the manual pack value remains preferred)
 *   - resolves cleanly (exact confidence) to a match the pack does NOT have a
 *     verified result for → GAP_FILL_CANDIDATE
 *   - resolves only probabilistically → ENRICHMENT_CANDIDATE
 *   - does not resolve → UNRESOLVED
 */
export function classifyProviderMatch(
  index: MatchIdentityIndex,
  packFacts: PackVerifiedFacts,
  row: ProviderMatchRow,
): MatchClassificationResult {
  const resolution = resolveMatch(index, row.query);
  const warnings: string[] = [];

  if (resolution.confidence === "UNRESOLVED") {
    return { classification: "UNRESOLVED", resolution, conflict: null, warnings };
  }

  const fact =
    resolution.referenceKey !== null
      ? packFacts.matchFacts.get(resolution.referenceKey)
      : undefined;

  if (fact !== undefined && fact.verified) {
    const agrees = scoresAgreeWithPack(fact, row);
    if (agrees === true) {
      return { classification: "SUPPORTING_EVIDENCE", resolution, conflict: null, warnings };
    }
    if (agrees === false) {
      const conflict: ConflictEntry = {
        entityType: "matches",
        entityKey: fact.matchId,
        field: "score",
        values: [
          {
            sourceId: MANUAL_PACK_SOURCE_ID,
            value: `${fact.homeTeam ?? "?"} ${fact.homeScore}-${fact.awayScore} ${fact.awayTeam ?? "?"}`,
          },
          {
            sourceId: row.sourceId,
            value: `${row.query.homeTeam ?? "?"} ${row.homeScore}-${row.awayScore} ${row.query.awayTeam ?? "?"} (${row.sourceFile} row ${row.sourceRowNumber})`,
          },
        ],
        resolution: "KEPT_HIGHEST_PRIORITY",
        note: "Manual verified pack remains preferred; provider value reported, never applied.",
      };
      return { classification: "CONFLICT", resolution, conflict, warnings };
    }
    // Verified identity but no comparable score on one side — the provider
    // may be adding detail the pack holds elsewhere; identity corroborates.
    warnings.push("Verified pack match matched but scores were not comparable.");
    return { classification: "SUPPORTING_EVIDENCE", resolution, conflict: null, warnings };
  }

  if (EXACT_CONFIDENCES.has(resolution.confidence)) {
    // Cleanly resolved, but the pack has no verified result here (either an
    // unverified pack record or an archive-baseline match) — a manual gap.
    return { classification: "GAP_FILL_CANDIDATE", resolution, conflict: null, warnings };
  }
  return { classification: "ENRICHMENT_CANDIDATE", resolution, conflict: null, warnings };
}

/**
 * Classifies a Bustami row. Always a research/analytics candidate with a
 * standing import block; a disagreement with a verified manual fact is
 * additionally reported as a conflict (the manual pack stays preferred).
 */
export function classifyBustamiRow(
  index: MatchIdentityIndex,
  packFacts: PackVerifiedFacts,
  row: ProviderMatchRow,
): MatchClassificationResult {
  const base = classifyProviderMatch(index, packFacts, row);
  if (base.classification === "CONFLICT") {
    // Conflict is reported, and the record itself stays a research candidate.
    return base;
  }
  return {
    classification: "ADVANCED_ANALYTICS_CANDIDATE",
    resolution: base.resolution,
    conflict: null,
    warnings: base.warnings,
  };
}
