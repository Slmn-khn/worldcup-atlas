// Review decision validation for the 2026 data steward agent (Phase 2A).
//
// Checks the human-edited review-decisions.json against the generated
// review-items.json: schema validity, known item ids, decision plausibility,
// required reviewer notes, and evidence-backed approved sources/values.
// Pure functions over loaded data — no database, no network, no mutation of
// the reviewer's file.
//
// Verdict semantics:
//   - malformed decisions (bad schema, unknown ids, missing required notes,
//     unbacked sources) are ERRORS — the decisions file must be fixed;
//   - pending items are NOT errors — review is allowed to be in progress —
//     but pending CRITICAL/HIGH items and BLOCK_IMPORT decisions block any
//     approval candidate, and that is reported loudly.

import type {
  ReviewDecision,
  ReviewDecisionEntry,
  ReviewDecisionsFile,
  ReviewItem,
  ReviewStatus,
} from "./reviewTypes";
import { reviewDecisionsFileSchema, reviewPackFileSchema } from "./reviewTypes";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type ReviewValidationIssue = {
  code: string;
  message: string;
  reviewItemId?: string;
};

export type ReviewValidationSummary = {
  totalItems: number;
  reviewedItems: number;
  pendingItems: number;
  /** CRITICAL/HIGH items without a usable decision + BLOCK_IMPORT items. */
  blockingItems: number;
  /** Items that currently prevent an approval candidate. */
  importBlockingCount: number;
  enrichmentOnlyCount: number;
  bySeverityPending: Record<string, number>;
  blockImportDecisions: number;
  needsSourceDecisions: number;
};

export type ReviewValidationResult = {
  schemaValid: boolean;
  errors: ReviewValidationIssue[];
  warnings: ReviewValidationIssue[];
  summary: ReviewValidationSummary;
  /** Item id → effective status after applying decisions. */
  itemStatus: Record<string, ReviewStatus>;
  /** True when an approval candidate may be generated from this state. */
  eligibleForApprovalCandidate: boolean;
};

// ---------------------------------------------------------------------------
// Decision semantics
// ---------------------------------------------------------------------------

/** Decisions that always demand a written justification. */
const NOTE_REQUIRED_ALWAYS: ReadonlySet<ReviewDecision> = new Set([
  "REJECT_PROVIDER",
  "BLOCK_IMPORT",
  "APPROVE_AS_ENRICHMENT_ONLY",
]);

/** APPROVE_* decisions that pick one side of a value conflict. */
const VALUE_PICKING_DECISIONS: ReadonlySet<ReviewDecision> = new Set([
  "APPROVE_MANUAL",
  "APPROVE_MOMINUL",
  "APPROVE_OPENFOOTBALL",
  "APPROVE_DERIVED",
]);

/** Item types that represent a value conflict needing a selected value. */
const VALUE_CONFLICT_TYPES = new Set([
  "MATCH_RESULT_CONFLICT",
  "TEAM_CONFLICT",
  "GROUP_CONFLICT",
  "VENUE_CONFLICT",
  "BRACKET_CONFLICT",
  "AWARD_CONFLICT",
]);

/** Effective item status implied by a decision. */
export function statusForDecision(decision: ReviewDecision): ReviewStatus {
  switch (decision) {
    case "APPROVE_MANUAL":
    case "APPROVE_MOMINUL":
    case "APPROVE_OPENFOOTBALL":
    case "APPROVE_DERIVED":
    case "APPROVE_AS_ENRICHMENT_ONLY":
      return "APPROVED";
    case "REJECT_PROVIDER":
      return "REJECTED";
    case "BLOCK_IMPORT":
      return "BLOCKED";
    case "NEEDS_SOURCE":
    case "IGNORE_NON_BLOCKING":
      return "REVIEWED";
  }
}

/**
 * True when this decided item still blocks an approval candidate:
 * BLOCK_IMPORT always blocks; NEEDS_SOURCE keeps blocking on CRITICAL/HIGH
 * items (the missing source must be found before approval).
 */
export function decisionStillBlocks(
  item: ReviewItem,
  decision: ReviewDecision,
): boolean {
  if (decision === "BLOCK_IMPORT") return true;
  if (
    decision === "NEEDS_SOURCE" &&
    (item.severity === "CRITICAL" || item.severity === "HIGH")
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation (pure — unit-tested)
// ---------------------------------------------------------------------------

export function validateReviewDecisions(
  items: ReviewItem[],
  decisionsFile: ReviewDecisionsFile,
  reviewPackHash?: string,
): ReviewValidationResult {
  const errors: ReviewValidationIssue[] = [];
  const warnings: ReviewValidationIssue[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));

  if (
    reviewPackHash !== undefined &&
    decisionsFile.reviewPackHash !== "" &&
    decisionsFile.reviewPackHash !== reviewPackHash
  ) {
    warnings.push({
      code: "REVIEW_PACK_HASH_MISMATCH",
      message:
        "review-decisions.json references a different review pack hash — the " +
        "pack was regenerated after these decisions were recorded. Re-check " +
        "the decisions against the current items.",
    });
  }

  const seenIds = new Set<string>();
  const decisionByItem = new Map<string, ReviewDecisionEntry>();
  for (const entry of decisionsFile.decisions) {
    if (seenIds.has(entry.reviewItemId)) {
      errors.push({
        code: "DUPLICATE_DECISION",
        message: `More than one decision for ${entry.reviewItemId}.`,
        reviewItemId: entry.reviewItemId,
      });
      continue;
    }
    seenIds.add(entry.reviewItemId);

    const item = itemById.get(entry.reviewItemId);
    if (item === undefined) {
      errors.push({
        code: "UNKNOWN_REVIEW_ITEM",
        message: `Decision references unknown reviewItemId "${entry.reviewItemId}".`,
        reviewItemId: entry.reviewItemId,
      });
      continue;
    }
    decisionByItem.set(entry.reviewItemId, entry);

    // Required reviewer notes: always for reject/block/enrichment-only, and
    // for approving a provider value OVER a verified manual pack value.
    const overridesManual =
      entry.decision === "APPROVE_MOMINUL" && item.manualPackValue !== undefined;
    const noteRequired =
      NOTE_REQUIRED_ALWAYS.has(entry.decision) || overridesManual;
    const hasNote =
      entry.reviewerNote !== null && entry.reviewerNote.trim() !== "";
    if (noteRequired && !hasNote) {
      errors.push({
        code: "REVIEWER_NOTE_REQUIRED",
        message: overridesManual
          ? `${entry.reviewItemId}: APPROVE_MOMINUL over a manual verified pack value requires a reviewerNote explaining the evidence.`
          : `${entry.reviewItemId}: decision ${entry.decision} requires a reviewerNote.`,
        reviewItemId: entry.reviewItemId,
      });
    }

    // approvedSourceId must be backed by the item's evidence.
    if (entry.approvedSourceId !== null) {
      const known = item.evidence.some(
        (evidence) => evidence.sourceId === entry.approvedSourceId,
      );
      if (!known) {
        errors.push({
          code: "APPROVED_SOURCE_NOT_IN_EVIDENCE",
          message: `${entry.reviewItemId}: approvedSourceId "${entry.approvedSourceId}" does not appear in the item's evidence.`,
          reviewItemId: entry.reviewItemId,
        });
      }
    }

    // Value-picking approvals on value conflicts need a concrete value —
    // either an explicit approvedValue, or the side's value already recorded
    // on the item (manualPackValue / providerValue).
    if (
      VALUE_PICKING_DECISIONS.has(entry.decision) &&
      VALUE_CONFLICT_TYPES.has(item.type)
    ) {
      const implicitValue =
        entry.decision === "APPROVE_MANUAL"
          ? item.manualPackValue
          : entry.decision === "APPROVE_MOMINUL"
            ? item.providerValue
            : undefined;
      const hasValue =
        (entry.approvedValue !== null && entry.approvedValue !== undefined) ||
        implicitValue !== undefined;
      if (!hasValue) {
        errors.push({
          code: "APPROVED_VALUE_REQUIRED",
          message: `${entry.reviewItemId}: ${entry.decision} on a ${item.type} requires approvedValue (no recorded value to fall back to).`,
          reviewItemId: entry.reviewItemId,
        });
      }
    }
  }

  // Effective per-item status + summary.
  const itemStatus: Record<string, ReviewStatus> = {};
  const bySeverityPending: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  let reviewedItems = 0;
  let pendingItems = 0;
  let blockingItems = 0;
  let importBlockingCount = 0;
  let enrichmentOnlyCount = 0;
  let blockImportDecisions = 0;
  let needsSourceDecisions = 0;

  for (const item of items) {
    const entry = decisionByItem.get(item.id);
    if (entry === undefined) {
      itemStatus[item.id] = "PENDING";
      pendingItems += 1;
      bySeverityPending[item.severity] += 1;
      if (item.severity === "CRITICAL" || item.severity === "HIGH") {
        blockingItems += 1;
        importBlockingCount += 1;
      }
      continue;
    }
    itemStatus[item.id] = statusForDecision(entry.decision);
    reviewedItems += 1;
    if (entry.decision === "APPROVE_AS_ENRICHMENT_ONLY") enrichmentOnlyCount += 1;
    if (entry.decision === "BLOCK_IMPORT") blockImportDecisions += 1;
    if (entry.decision === "NEEDS_SOURCE") needsSourceDecisions += 1;
    if (decisionStillBlocks(item, entry.decision)) {
      blockingItems += 1;
      importBlockingCount += 1;
    }
  }

  const schemaValid = errors.length === 0;
  const eligibleForApprovalCandidate = schemaValid && importBlockingCount === 0;

  if (pendingItems > 0) {
    warnings.push({
      code: "PENDING_ITEMS",
      message: `${pendingItems} review items are still PENDING (${bySeverityPending.CRITICAL} CRITICAL, ${bySeverityPending.HIGH} HIGH).`,
    });
  }
  if (!eligibleForApprovalCandidate) {
    warnings.push({
      code: "IMPORT_BLOCKED",
      message:
        `Import cannot proceed: ${importBlockingCount} blocking item(s) — ` +
        "pending CRITICAL/HIGH items, BLOCK_IMPORT decisions, or NEEDS_SOURCE " +
        "on CRITICAL/HIGH items. No approval candidate will be generated.",
    });
  }

  return {
    schemaValid,
    errors,
    warnings,
    summary: {
      totalItems: items.length,
      reviewedItems,
      pendingItems,
      blockingItems,
      importBlockingCount,
      enrichmentOnlyCount,
      bySeverityPending,
      blockImportDecisions,
      needsSourceDecisions,
    },
    itemStatus,
    eligibleForApprovalCandidate,
  };
}

// ---------------------------------------------------------------------------
// File-shape parsing helpers (shared by scripts)
// ---------------------------------------------------------------------------

export function parseReviewPackFile(
  payload: unknown,
): { ok: true; items: ReviewItem[]; reviewPackHash: string } | { ok: false; error: string } {
  const parsed = reviewPackFileSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `review-items.json is malformed: ${parsed.error.message}` };
  }
  return {
    ok: true,
    items: parsed.data.items,
    reviewPackHash: parsed.data.reviewPackHash,
  };
}

export function parseReviewDecisionsFile(
  payload: unknown,
): { ok: true; decisions: ReviewDecisionsFile } | { ok: false; error: string } {
  const parsed = reviewDecisionsFileSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `review-decisions.json is malformed: ${parsed.error.message}`,
    };
  }
  return { ok: true, decisions: parsed.data };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

export function buildReviewValidationMarkdown(
  result: ReviewValidationResult,
  generatedAt: string,
): string {
  const { summary } = result;
  const lines: string[] = [];
  lines.push("# 2026 Review Decisions — Validation Report");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(
    `Schema: **${result.schemaValid ? "VALID" : "INVALID"}** — ` +
      `${result.errors.length} errors, ${result.warnings.length} warnings.`,
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total items: ${summary.totalItems}`);
  lines.push(`- Reviewed: ${summary.reviewedItems}`);
  lines.push(
    `- Pending: ${summary.pendingItems} ` +
      `(CRITICAL: ${summary.bySeverityPending.CRITICAL}, HIGH: ${summary.bySeverityPending.HIGH}, ` +
      `MEDIUM: ${summary.bySeverityPending.MEDIUM}, LOW: ${summary.bySeverityPending.LOW})`,
  );
  lines.push(`- Blocking items: ${summary.blockingItems}`);
  lines.push(`- Import-blocking count: ${summary.importBlockingCount}`);
  lines.push(`- Enrichment-only approvals: ${summary.enrichmentOnlyCount}`);
  lines.push(`- BLOCK_IMPORT decisions: ${summary.blockImportDecisions}`);
  lines.push(`- NEEDS_SOURCE decisions: ${summary.needsSourceDecisions}`);
  lines.push("");
  lines.push(
    result.eligibleForApprovalCandidate
      ? "**Eligible for an approval candidate** — run `pnpm data:2026:approval-candidate`."
      : "**NOT eligible for an approval candidate** — resolve the blocking items first.",
  );

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("## Errors (must fix)");
    lines.push("");
    for (const issue of result.errors) {
      lines.push(`- \`${issue.code}\`: ${issue.message}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const issue of result.warnings) {
      lines.push(`- \`${issue.code}\`: ${issue.message}`);
    }
  }
  lines.push("");
  lines.push(
    "_Phase 2A is review-only: no database writes, no import, no " +
      "auto-approval. The manual verified reference pack remains " +
      "authoritative._",
  );
  lines.push("");
  return lines.join("\n");
}
