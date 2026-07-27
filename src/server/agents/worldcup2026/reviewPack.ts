// Human review pack generation for the 2026 data steward agent (Phase 2A).
//
// Converts the pipeline's conflicts, gap-fill candidates, and enrichment
// candidates into deterministic, reviewable items under data/2026/review/.
// Generation is read-only with respect to its inputs (the validation and
// enrichment reports are never mutated), writes no database, imports
// nothing, and approves nothing: every item starts decision:null /
// status:PENDING and waits for an explicit human decision.
//
// The manual verified reference pack remains authoritative: where it voted,
// its value is surfaced as manualPackValue and the standing recommendation
// keeps it preferred.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { MANUAL_PACK_SOURCE_ID } from "./manualReferencePack";
import { BUSTAMI_IMPORT_BLOCKED_REASON } from "./providers/bustamiEfiDataset";
import {
  BUSTAMI_SOURCE_ID,
  MOMINUL_NORMALIZED_DIR,
  MOMINUL_SOURCE_ID,
  REPORTS_2026_DIR,
  REVIEW_2026_DIR,
  REVIEW_OUTPUT_2026_DIR,
  REVIEW_TEMPLATES_2026_DIR,
  VALIDATION_2026_DIR,
} from "./sourceRegistry";
import type { ConflictEntry } from "./types";
import type {
  ReviewDecisionsFile,
  ReviewEvidence,
  ReviewItem,
  ReviewItemType,
  ReviewPackFile,
  ReviewSeverity,
} from "./reviewTypes";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type EnrichmentProviderCoverage = {
  sourceId: string;
  rowCounts: Record<string, number>;
  classificationCounts: Record<string, number>;
  importRecommendation: string;
  importBlockedReason: string | null;
};

export type GapFillRecord = {
  referenceKey: string;
  sourceId: string;
  sourceFile: string;
  sourceRowNumber: number;
  /** Compact match summary (teams/score/date) when available. */
  summary?: string | null;
};

export type ReviewPackInputs = {
  /** data/2026/validation/conflict-report.json entries. */
  conflictEntries: ConflictEntry[];
  /** data/2026/reports/enrichment-conflict-report.json entries. */
  enrichmentConflicts: ConflictEntry[];
  /** data/2026/reports/enrichment-coverage-report.json provider slices. */
  enrichmentProviders: EnrichmentProviderCoverage[];
  /** GAP_FILL_CANDIDATE matches from the Mominul enriched output. */
  gapFillRecords: GapFillRecord[];
  /** File names the items were derived from (for the pack envelope). */
  inputFiles: string[];
};

// ---------------------------------------------------------------------------
// Deterministic ids and classification (pure — unit-tested)
// ---------------------------------------------------------------------------

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ENTITY_SHORT: Record<string, string> = {
  matches: "match",
  teams: "team",
  groups: "group",
  venues: "venue",
  standings: "standings",
  tournament: "tournament",
  bracket: "bracket",
};

/** Deterministic id for a conflict-derived item. */
export function conflictReviewId(conflict: ConflictEntry): string {
  // Manual-pack known conflicts keep their C-00x identity.
  const packConflict = /:C-(\d+)$/.exec(conflict.entityKey);
  if (packConflict !== null) {
    // C-004 is the well-known unresolved 48th participant.
    return packConflict[1] === "004"
      ? "review-team-unverified-48th"
      : `review-pack-C-${packConflict[1]}`;
  }
  const entity = ENTITY_SHORT[conflict.entityType] ?? slug(conflict.entityType);
  return `review-${entity}-${slug(conflict.entityKey)}-${slug(conflict.field)}`;
}

/** Fields that carry a match result (score/winner/penalties). */
const RESULT_FIELDS = /score|penalt|winner/i;
/** Fields naming the tournament outcome / top four. */
const OUTCOME_FIELDS = /champion|winner|runner|third|fourth|top.?four/i;
/** Minor display/label fields — non-blocking source disagreements. */
const LABEL_FIELDS = /^(status|cityName|kickoffTimeLabel|kickoffDateLabel|venueName)$/;

export function classifyConflictSeverity(conflict: ConflictEntry): ReviewSeverity {
  const { entityType, entityKey, field } = conflict;
  if (
    entityType === "tournament" ||
    OUTCOME_FIELDS.test(field) ||
    /^final\./.test(field) ||
    /\bM104\b/.test(entityKey)
  ) {
    // Tournament winner / final / top-four territory.
    return entityType === "tournament" || /\bM104\b/.test(entityKey) || OUTCOME_FIELDS.test(field)
      ? "CRITICAL"
      : "HIGH";
  }
  if (entityType === "matches" && RESULT_FIELDS.test(field)) return "HIGH";
  if (LABEL_FIELDS.test(field)) return "LOW";
  // Team/group/venue/standings conflicts, identifier disputes, pack data gaps.
  return "MEDIUM";
}

export function conflictReviewItemType(conflict: ConflictEntry): ReviewItemType {
  const { entityType, field } = conflict;
  if (entityType === "teams" || field === "teams") return "TEAM_CONFLICT";
  if (entityType === "groups") return "GROUP_CONFLICT";
  if (entityType === "venues" || /^venues\./.test(field)) return "VENUE_CONFLICT";
  if (entityType === "bracket") return "BRACKET_CONFLICT";
  if (entityType === "standings") return "SOURCE_CONFLICT";
  if (entityType === "matches" && RESULT_FIELDS.test(field)) {
    return "MATCH_RESULT_CONFLICT";
  }
  if (entityType === "matches" && LABEL_FIELDS.test(field)) return "SOURCE_CONFLICT";
  if (entityType === "matches") return "MATCH_RESULT_CONFLICT";
  if (entityType === "tournament") return "OTHER";
  return "OTHER";
}

// ---------------------------------------------------------------------------
// Item builders (pure — unit-tested)
// ---------------------------------------------------------------------------

function evidenceOf(conflict: ConflictEntry): ReviewEvidence[] {
  return conflict.values.map((vote) => ({
    sourceId: vote.sourceId,
    value: vote.value,
  }));
}

function manualValueOf(evidence: ReviewEvidence[]): unknown {
  return evidence.find((entry) =>
    entry.sourceId.startsWith(MANUAL_PACK_SOURCE_ID),
  )?.value;
}

function providerVoteOf(
  evidence: ReviewEvidence[],
): { sourceId: string; value: unknown } | null {
  const vote = evidence.find(
    (entry) => !entry.sourceId.startsWith(MANUAL_PACK_SOURCE_ID),
  );
  return vote === undefined ? null : { sourceId: vote.sourceId, value: vote.value };
}

function pendingItem(
  partial: Omit<ReviewItem, "decision" | "reviewerNote" | "status">,
): ReviewItem {
  return { ...partial, decision: null, reviewerNote: null, status: "PENDING" };
}

/** One review item per deduplicated conflict. */
export function reviewItemFromConflict(conflict: ConflictEntry): ReviewItem {
  const severity = classifyConflictSeverity(conflict);
  const evidence = evidenceOf(conflict);
  const manualPackValue = manualValueOf(evidence);
  const provider = providerVoteOf(evidence);
  const hasManualVote = manualPackValue !== undefined;
  const unresolvedPackConflict = conflict.resolution === "UNRESOLVED";

  return pendingItem({
    id: conflictReviewId(conflict),
    type: conflictReviewItemType(conflict),
    severity,
    entityType: conflict.entityType,
    entityKey: conflict.entityKey,
    field: conflict.field,
    manualPackValue,
    providerValue: provider?.value,
    providerSourceId: provider?.sourceId ?? null,
    preferredSourceId:
      conflict.resolution === "KEPT_HIGHEST_PRIORITY"
        ? (evidence[0]?.sourceId ?? null)
        : null,
    currentRecommendation: unresolvedPackConflict
      ? "NEEDS_SOURCE"
      : hasManualVote
        ? "KEEP_MANUAL_VERIFIED"
        : severity === "LOW"
          ? "IGNORE_NON_BLOCKING_CANDIDATE"
          : "KEEP_HIGHEST_PRIORITY_SOURCE",
    reason:
      conflict.note != null && conflict.note !== ""
        ? conflict.note
        : `Sources disagree on ${conflict.entityType}.${conflict.field} for ${conflict.entityKey}.`,
    evidence,
  });
}

/**
 * Deduplicates conflicts by (entityType, entityKey, field), merging evidence
 * from every duplicate (e.g. the same score conflict reported by both
 * matches.csv and matches_detailed.csv).
 */
export function dedupeConflicts(conflicts: ConflictEntry[]): ConflictEntry[] {
  const byKey = new Map<string, ConflictEntry>();
  for (const conflict of conflicts) {
    const key = `${conflict.entityType}|${conflict.entityKey}|${conflict.field}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...conflict, values: [...conflict.values] });
      continue;
    }
    for (const vote of conflict.values) {
      const duplicate = existing.values.some(
        (known) => known.sourceId === vote.sourceId && known.value === vote.value,
      );
      if (!duplicate) existing.values.push(vote);
    }
  }
  return [...byKey.values()];
}

/**
 * LOW-severity label conflicts (status / city / kickoff labels) are the same
 * stale-snapshot disagreement repeated per match — they are reviewed as one
 * class-level item per (entityType, field) with sample evidence, not as
 * hundreds of rows.
 */
export function aggregateLabelConflicts(conflicts: ConflictEntry[]): {
  individual: ConflictEntry[];
  aggregated: ReviewItem[];
} {
  const individual: ConflictEntry[] = [];
  const classes = new Map<string, ConflictEntry[]>();
  for (const conflict of conflicts) {
    if (classifyConflictSeverity(conflict) === "LOW") {
      const key = `${conflict.entityType}|${conflict.field}`;
      classes.set(key, [...(classes.get(key) ?? []), conflict]);
    } else {
      individual.push(conflict);
    }
  }

  const aggregated: ReviewItem[] = [];
  for (const [key, group] of [...classes.entries()].sort()) {
    const [entityType, field] = key.split("|");
    const sourceIds = [
      ...new Set(group.flatMap((c) => c.values.map((v) => v.sourceId))),
    ].sort();
    const samples: ReviewEvidence[] = group.slice(0, 5).map((conflict) => ({
      sourceId: conflict.values[0]?.sourceId ?? "unknown",
      value: conflict.values.map((v) => `${v.sourceId}: ${v.value}`).join(" | "),
      note: `sample: ${conflict.entityKey}`,
    }));
    aggregated.push(
      pendingItem({
        id: `review-labels-${slug(entityType)}-${slug(field)}`,
        type: "SOURCE_CONFLICT",
        severity: "LOW",
        entityType,
        entityKey: `${entityType}.${field} (${group.length} records)`,
        field,
        providerSourceId: null,
        preferredSourceId: null,
        currentRecommendation: "IGNORE_NON_BLOCKING_CANDIDATE",
        reason:
          `${group.length} ${entityType} records have minor "${field}" label ` +
          `disagreements between ${sourceIds.join(", ")} — display-level drift ` +
          "(stale snapshots, local-vs-UTC labels, sponsor aliases), not result data.",
        evidence: samples,
      }),
    );
  }
  return { individual, aggregated };
}

/** One review item per distinct gap-fill reference match. */
export function reviewItemsFromGapFills(records: GapFillRecord[]): ReviewItem[] {
  const byReference = new Map<string, GapFillRecord[]>();
  for (const record of records) {
    byReference.set(record.referenceKey, [
      ...(byReference.get(record.referenceKey) ?? []),
      record,
    ]);
  }
  return [...byReference.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([referenceKey, group]) =>
      pendingItem({
        id: `review-gap-${slug(referenceKey)}`,
        type: "MATCH_GAP_FILL",
        severity: "MEDIUM",
        entityType: "matches",
        entityKey: referenceKey,
        field: "result",
        providerSourceId: group[0]?.sourceId ?? null,
        providerValue: group[0]?.summary ?? undefined,
        preferredSourceId: null,
        currentRecommendation: "CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION",
        reason:
          `Provider data cleanly resolves match ${referenceKey}, for which the ` +
          "manual verified pack records no verified result (a documented gap). " +
          "Approving fills the gap; the manual pack is not overridden.",
        evidence: group.map((record) => ({
          sourceId: record.sourceId,
          value: record.summary ?? undefined,
          note: `${record.sourceFile} row ${record.sourceRowNumber}`,
        })),
      }),
    );
}

const ENRICHMENT_KIND_TYPE: Record<string, ReviewItemType> = {
  "match_events.csv": "PLAYER_EVENT_CANDIDATE",
  "player_stats.csv": "PLAYER_EVENT_CANDIDATE",
  "match_lineups.csv": "LINEUP_CANDIDATE",
  "wc2026_efi.csv": "EFI_ANALYTICS_CANDIDATE",
  "wc2026_matches.csv": "EFI_ANALYTICS_CANDIDATE",
  "wc2026_players.csv": "EFI_ANALYTICS_CANDIDATE",
};

/**
 * Enrichment-only candidates are reviewed per provider file class (one item
 * per file), plus one standing license item for the Bustami EFI provider.
 */
export function reviewItemsFromEnrichment(
  providers: EnrichmentProviderCoverage[],
): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const provider of providers) {
    const providerSlug =
      provider.sourceId === MOMINUL_SOURCE_ID
        ? "mominul"
        : provider.sourceId === BUSTAMI_SOURCE_ID
          ? "bustami"
          : slug(provider.sourceId);
    for (const [file, rows] of Object.entries(provider.rowCounts).sort()) {
      if (rows === 0) continue;
      // Match files are covered by conflict/gap-fill items; enrichment items
      // cover the detail kinds that have no import model yet.
      if (/^(matches|matches_detailed|real_match_details|teams|venues)\./.test(file)) {
        continue;
      }
      items.push(
        pendingItem({
          id: `review-enrichment-${providerSlug}-${slug(file.replace(/\.[^.]+$/, ""))}`,
          type: ENRICHMENT_KIND_TYPE[file] ?? "OTHER",
          severity: "LOW",
          entityType: "enrichment",
          entityKey: `${provider.sourceId}/${file}`,
          field: null,
          providerSourceId: provider.sourceId,
          providerValue: `${rows} candidate rows`,
          preferredSourceId: null,
          currentRecommendation:
            provider.importBlockedReason ?? "ENRICHMENT_ONLY",
          reason:
            `${rows} enrichment-only candidate rows from ${file}. No import ` +
            "model exists for this kind; the only approvable outcome in this " +
            "phase is APPROVE_AS_ENRICHMENT_ONLY (or rejection).",
          evidence: [
            {
              sourceId: provider.sourceId,
              value: `${rows} rows`,
              note: provider.importRecommendation,
            },
          ],
        }),
      );
    }
  }

  // Standing license/usage review item for the Bustami EFI provider.
  const bustami = providers.find((p) => p.sourceId === BUSTAMI_SOURCE_ID);
  if (bustami !== undefined) {
    items.push(
      pendingItem({
        id: "review-efi-license",
        type: "EFI_ANALYTICS_CANDIDATE",
        severity: "MEDIUM",
        entityType: "source",
        entityKey: BUSTAMI_SOURCE_ID,
        field: "license",
        providerSourceId: BUSTAMI_SOURCE_ID,
        preferredSourceId: null,
        currentRecommendation: BUSTAMI_IMPORT_BLOCKED_REASON,
        reason:
          "The Bustami EFI dataset's upstream README scopes the data to " +
          "analytical/research purposes only, and the metrics derive from " +
          "the official FIFA platform. Until a documented license/usage " +
          "review clears it, every record stays research-only: no import, " +
          "no public rendering, never merged into the core archive.",
        evidence: [
          {
            sourceId: BUSTAMI_SOURCE_ID,
            note: `importBlockedReason: ${bustami.importBlockedReason ?? BUSTAMI_IMPORT_BLOCKED_REASON}`,
          },
        ],
      }),
    );
  }
  return items;
}

/** Builds the full, deduplicated, deterministically-ordered item list. */
export function buildReviewItems(inputs: ReviewPackInputs): ReviewItem[] {
  const conflicts = dedupeConflicts([
    ...inputs.conflictEntries,
    ...inputs.enrichmentConflicts,
  ]);
  const { individual, aggregated } = aggregateLabelConflicts(conflicts);
  const items = [
    ...individual.map((conflict) => reviewItemFromConflict(conflict)),
    ...aggregated,
    ...reviewItemsFromGapFills(inputs.gapFillRecords),
    ...reviewItemsFromEnrichment(inputs.enrichmentProviders),
  ];

  // Same id from two paths → merge evidence, keep the higher severity.
  const severityRank: Record<ReviewSeverity, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  const byId = new Map<string, ReviewItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (existing === undefined) {
      byId.set(item.id, item);
      continue;
    }
    if (severityRank[item.severity] > severityRank[existing.severity]) {
      existing.severity = item.severity;
    }
    for (const entry of item.evidence) {
      const duplicate = existing.evidence.some(
        (known) =>
          known.sourceId === entry.sourceId &&
          JSON.stringify(known.value) === JSON.stringify(entry.value),
      );
      if (!duplicate) existing.evidence.push(entry);
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Pack envelope, CSV, summary (pure)
// ---------------------------------------------------------------------------

export function sha256Of(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function buildReviewPackFile(
  items: ReviewItem[],
  inputFiles: string[],
  generatedAt: string,
): ReviewPackFile {
  const bySeverity: Record<ReviewSeverity, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
  const byType: Record<string, number> = {};
  for (const item of items) {
    bySeverity[item.severity] += 1;
    byType[item.type] = (byType[item.type] ?? 0) + 1;
  }
  return {
    schema: "review-pack/v1",
    generatedAt,
    // Hash over the items only (not generatedAt) so an unchanged pipeline
    // state re-generates to the identical hash.
    reviewPackHash: sha256Of(JSON.stringify(items)),
    counts: { total: items.length, bySeverity, byType },
    inputs: inputFiles,
    items,
  };
}

const CSV_COLUMNS = [
  "id",
  "type",
  "severity",
  "entityType",
  "entityKey",
  "field",
  "manualPackValue",
  "providerSourceId",
  "providerValue",
  "currentRecommendation",
  "decision",
  "reviewerNote",
  "status",
] as const;

/** Stringify + truncate a cell value; large raw objects never enter the CSV. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value) ?? "";
    } catch {
      text = String(value);
    }
  }
  if (text.length > 300) text = `${text.slice(0, 297)}…`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildReviewItemsCsv(items: ReviewItem[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const item of items) {
    lines.push(
      CSV_COLUMNS.map((column) => csvCell(item[column])).join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function buildReviewSummaryMarkdown(pack: ReviewPackFile): string {
  const lines: string[] = [];
  lines.push("# 2026 Human Review Pack — Summary");
  lines.push("");
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push(`Review pack hash: \`sha256:${pack.reviewPackHash}\``);
  lines.push("");
  lines.push(
    "**Phase 2A is review-only.** Nothing here has been imported, no " +
      "database was written, and nothing is auto-approved. The manual " +
      "verified reference pack remains authoritative; approving a provider " +
      "value over it requires an explicit decision with a reviewer note.",
  );
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push("| Severity | Items |");
  lines.push("| --- | ---: |");
  for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const) {
    lines.push(`| ${severity} | ${pack.counts.bySeverity[severity]} |`);
  }
  lines.push("");
  lines.push("| Type | Items |");
  lines.push("| --- | ---: |");
  for (const [type, count] of Object.entries(pack.counts.byType).sort()) {
    lines.push(`| ${type} | ${count} |`);
  }

  const blocking = pack.items.filter(
    (item) => item.severity === "CRITICAL" || item.severity === "HIGH",
  );
  lines.push("");
  lines.push("## Items requiring review before an approval candidate");
  lines.push("");
  if (blocking.length === 0) {
    lines.push(
      "No CRITICAL/HIGH items — MEDIUM/LOW items still deserve review, but " +
        "none of them block generating an approval candidate.",
    );
  } else {
    for (const item of blocking) {
      lines.push(
        `- **${item.id}** (${item.severity} ${item.type}) — ${item.reason}`,
      );
    }
  }

  const mediums = pack.items.filter((item) => item.severity === "MEDIUM");
  lines.push("");
  lines.push(`## Medium-severity items (${mediums.length})`);
  lines.push("");
  for (const item of mediums.slice(0, 15)) {
    lines.push(`- \`${item.id}\` — ${item.currentRecommendation}: ${item.reason.slice(0, 140)}`);
  }
  if (mediums.length > 15) {
    lines.push(`- …and ${mediums.length - 15} more (see review-items.json/csv).`);
  }

  lines.push("");
  lines.push("## How to review");
  lines.push("");
  lines.push("1. Open `review-items.csv` (or `review-items.json`).");
  lines.push(
    "2. Record decisions in `data/2026/review/review-decisions.json` " +
      "(template: `templates/review-decisions.example.json`).",
  );
  lines.push("3. Run `pnpm data:2026:review-validate`.");
  lines.push(
    "4. When all CRITICAL/HIGH items are decided (and nothing is " +
      "BLOCK_IMPORT), run `pnpm data:2026:approval-candidate`.",
  );
  lines.push(
    "5. A human fills in `approval.candidate.json`, sets " +
      "`approvedForImport: true`, and renames it to `approval.json` — only " +
      "then can a future Phase 2B importer run.",
  );
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Input loading (tolerant of missing files) and generation
// ---------------------------------------------------------------------------

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function loadReviewPackInputs(baseDirs?: {
  validationDir?: string;
  reportsDir?: string;
  mominulNormalizedDir?: string;
}): Promise<ReviewPackInputs> {
  const validationDir = baseDirs?.validationDir ?? VALIDATION_2026_DIR;
  const reportsDir = baseDirs?.reportsDir ?? REPORTS_2026_DIR;
  const mominulDir = baseDirs?.mominulNormalizedDir ?? MOMINUL_NORMALIZED_DIR;
  const inputFiles: string[] = [];

  const conflictReport = (await readJsonIfPresent(
    path.join(validationDir, "conflict-report.json"),
  )) as { entries?: ConflictEntry[] } | null;
  if (conflictReport !== null) inputFiles.push("validation/conflict-report.json");

  const enrichmentConflictReport = (await readJsonIfPresent(
    path.join(reportsDir, "enrichment-conflict-report.json"),
  )) as { entries?: ConflictEntry[] } | null;
  if (enrichmentConflictReport !== null) {
    inputFiles.push("reports/enrichment-conflict-report.json");
  }

  const coverage = (await readJsonIfPresent(
    path.join(reportsDir, "enrichment-coverage-report.json"),
  )) as { providers?: Record<string, EnrichmentProviderCoverage> } | null;
  if (coverage !== null) inputFiles.push("reports/enrichment-coverage-report.json");

  // Gap-fill detail lives in the (git-ignored, regenerable) enriched output;
  // when absent the review pack simply carries no per-match gap items.
  const enrichedMatches = (await readJsonIfPresent(
    path.join(mominulDir, "enriched-matches.json"),
  )) as {
    records?: Array<{
      sourceId: string;
      sourceFile: string;
      sourceRowNumber: number;
      classification: string;
      matchResolution?: { referenceKey: string | null } | null;
      data?: Record<string, unknown>;
    }>;
  } | null;
  const gapFillRecords: GapFillRecord[] = [];
  if (enrichedMatches !== null) {
    inputFiles.push("normalized/mominul/enriched-matches.json");
    for (const record of enrichedMatches.records ?? []) {
      if (
        record.classification !== "GAP_FILL_CANDIDATE" ||
        record.matchResolution?.referenceKey == null
      ) {
        continue;
      }
      const data = record.data ?? {};
      const home = data.home_team_name ?? data.home_team ?? data.home_team_id;
      const away = data.away_team_name ?? data.away_team ?? data.away_team_id;
      const score =
        data.home_score != null && data.away_score != null
          ? `${data.home_score}-${data.away_score}`
          : (data.score ?? "?");
      gapFillRecords.push({
        referenceKey: record.matchResolution.referenceKey,
        sourceId: record.sourceId,
        sourceFile: record.sourceFile,
        sourceRowNumber: record.sourceRowNumber,
        summary: `${String(home ?? "?")} ${String(score)} ${String(away ?? "?")} (${String(data.date ?? "?")})`,
      });
    }
  }

  return {
    conflictEntries: conflictReport?.entries ?? [],
    enrichmentConflicts: enrichmentConflictReport?.entries ?? [],
    enrichmentProviders: Object.values(coverage?.providers ?? {}),
    gapFillRecords,
    inputFiles,
  };
}

/** Empty decisions file a reviewer starts from. */
export function emptyDecisionsFile(reviewPackHash: string): ReviewDecisionsFile {
  return {
    schema: "review-decisions/v1",
    reviewPackHash,
    reviewedBy: "",
    reviewedAt: "",
    decisions: [],
  };
}

export type GenerateReviewPackResult = {
  pack: ReviewPackFile;
  writtenFiles: string[];
  decisionsFileCreated: boolean;
};

/**
 * Generates the full review pack under data/2026/review/. Never overwrites
 * an existing review-decisions.json unless force is set — reviewer work is
 * human-authored data.
 */
export async function generateReviewPack(options?: {
  force?: boolean;
}): Promise<GenerateReviewPackResult> {
  const inputs = await loadReviewPackInputs();
  const items = buildReviewItems(inputs);
  const pack = buildReviewPackFile(
    items,
    inputs.inputFiles,
    new Date().toISOString(),
  );

  await mkdir(REVIEW_OUTPUT_2026_DIR, { recursive: true });
  await mkdir(REVIEW_TEMPLATES_2026_DIR, { recursive: true });

  const writtenFiles: string[] = [];
  const write = async (filePath: string, body: string): Promise<void> => {
    await writeFile(filePath, body, "utf8");
    writtenFiles.push(filePath.replace(/\\/g, "/"));
  };

  await write(
    path.join(REVIEW_OUTPUT_2026_DIR, "review-items.json"),
    `${JSON.stringify(pack, null, 2)}\n`,
  );
  await write(
    path.join(REVIEW_OUTPUT_2026_DIR, "review-items.csv"),
    buildReviewItemsCsv(items),
  );
  await write(
    path.join(REVIEW_OUTPUT_2026_DIR, "review-summary.md"),
    buildReviewSummaryMarkdown(pack),
  );

  const example = {
    schema: "review-decisions/v1",
    reviewPackHash: pack.reviewPackHash,
    reviewedBy: "",
    reviewedAt: "",
    decisions: [
      {
        reviewItemId: "review-example",
        decision: "NEEDS_SOURCE",
        reviewerNote: "Add note here.",
        approvedValue: null,
        approvedSourceId: null,
      },
    ],
  };
  await write(
    path.join(REVIEW_TEMPLATES_2026_DIR, "review-decisions.example.json"),
    `${JSON.stringify(example, null, 2)}\n`,
  );

  // Working decisions file: created fresh when missing; an existing file is
  // reviewer-authored and is only replaced with an explicit --force.
  const decisionsPath = path.join(REVIEW_2026_DIR, "review-decisions.json");
  let decisionsFileCreated = false;
  let decisionsExists = false;
  try {
    decisionsExists = (await stat(decisionsPath)).isFile();
  } catch {
    decisionsExists = false;
  }
  if (!decisionsExists || options?.force === true) {
    await write(
      decisionsPath,
      `${JSON.stringify(emptyDecisionsFile(pack.reviewPackHash), null, 2)}\n`,
    );
    decisionsFileCreated = true;
  }

  return { pack, writtenFiles, decisionsFileCreated };
}
