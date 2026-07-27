// Review decision types for the 2026 data steward agent (Phase 2A).
//
// Phase 2A converts provider conflicts and gap-fill/enrichment candidates
// into reviewable files under data/2026/review/. A human records explicit
// decisions in review-decisions.json; nothing is auto-approved, nothing is
// imported, and no database is touched. The manual verified reference pack
// remains authoritative — overriding a verified manual record requires an
// explicit decision plus a reviewer note.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Decisions, statuses, item types
// ---------------------------------------------------------------------------

export const REVIEW_DECISIONS = [
  "APPROVE_MANUAL",
  "APPROVE_MOMINUL",
  "APPROVE_OPENFOOTBALL",
  "APPROVE_DERIVED",
  "APPROVE_AS_ENRICHMENT_ONLY",
  "REJECT_PROVIDER",
  "NEEDS_SOURCE",
  "IGNORE_NON_BLOCKING",
  "BLOCK_IMPORT",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_STATUSES = [
  "PENDING",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
  "BLOCKED",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_ITEM_TYPES = [
  "MATCH_RESULT_CONFLICT",
  "MATCH_GAP_FILL",
  "TEAM_CONFLICT",
  "GROUP_CONFLICT",
  "VENUE_CONFLICT",
  "BRACKET_CONFLICT",
  "AWARD_CONFLICT",
  "PLAYER_EVENT_CANDIDATE",
  "LINEUP_CANDIDATE",
  "EFI_ANALYTICS_CANDIDATE",
  "SOURCE_CONFLICT",
  "OTHER",
] as const;
export type ReviewItemType = (typeof REVIEW_ITEM_TYPES)[number];

export const REVIEW_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// Review items
// ---------------------------------------------------------------------------

export type ReviewEvidence = {
  sourceId: string;
  value?: unknown;
  note?: string;
};

export type ReviewItem = {
  /** Deterministic id, e.g. "review-match-GB-5-score", "review-gap-M88". */
  id: string;
  type: ReviewItemType;
  severity: ReviewSeverity;
  entityType: string;
  entityKey: string;
  field?: string | null;
  manualPackValue?: unknown;
  providerValue?: unknown;
  providerSourceId?: string | null;
  preferredSourceId?: string | null;
  currentRecommendation: string;
  reason: string;
  evidence: ReviewEvidence[];
  decision: ReviewDecision | null;
  reviewerNote: string | null;
  status: ReviewStatus;
};

export const reviewEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  value: z.unknown().optional(),
  note: z.string().optional(),
});

export const reviewItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(REVIEW_ITEM_TYPES),
  severity: z.enum(REVIEW_SEVERITIES),
  entityType: z.string().min(1),
  entityKey: z.string().min(1),
  field: z.string().nullish(),
  manualPackValue: z.unknown().optional(),
  providerValue: z.unknown().optional(),
  providerSourceId: z.string().nullish(),
  preferredSourceId: z.string().nullish(),
  currentRecommendation: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.array(reviewEvidenceSchema),
  decision: z.enum(REVIEW_DECISIONS).nullable(),
  reviewerNote: z.string().nullable(),
  status: z.enum(REVIEW_STATUSES),
});

/** Envelope written to data/2026/review/output/review-items.json. */
export type ReviewPackFile = {
  schema: "review-pack/v1";
  generatedAt: string;
  /** sha256 over the canonical item list — pins the exact pack revision. */
  reviewPackHash: string;
  counts: {
    total: number;
    bySeverity: Record<ReviewSeverity, number>;
    byType: Record<string, number>;
  };
  /** Where the items came from (report file names). */
  inputs: string[];
  items: ReviewItem[];
};

export const reviewPackFileSchema = z.object({
  schema: z.literal("review-pack/v1"),
  generatedAt: z.string().min(1),
  reviewPackHash: z.string().min(1),
  counts: z.object({
    total: z.number().int().nonnegative(),
    bySeverity: z.record(z.string(), z.number().int().nonnegative()),
    byType: z.record(z.string(), z.number().int().nonnegative()),
  }),
  inputs: z.array(z.string()),
  items: z.array(reviewItemSchema),
});

// ---------------------------------------------------------------------------
// Reviewer decisions file (human-edited)
// ---------------------------------------------------------------------------

export type ReviewDecisionEntry = {
  reviewItemId: string;
  decision: ReviewDecision;
  reviewerNote: string | null;
  /** The concrete value the reviewer approves (required for value conflicts). */
  approvedValue?: unknown;
  /** Which source the approved value comes from (must appear in evidence). */
  approvedSourceId: string | null;
};

export type ReviewDecisionsFile = {
  schema: "review-decisions/v1";
  /** Hash of the review pack these decisions were made against ("" = unset). */
  reviewPackHash: string;
  reviewedBy: string;
  reviewedAt: string;
  decisions: ReviewDecisionEntry[];
};

export const reviewDecisionEntrySchema = z.object({
  reviewItemId: z.string().min(1),
  decision: z.enum(REVIEW_DECISIONS),
  reviewerNote: z.string().nullable(),
  approvedValue: z.unknown().optional(),
  approvedSourceId: z.string().nullable(),
});

export const reviewDecisionsFileSchema = z.object({
  schema: z.literal("review-decisions/v1"),
  reviewPackHash: z.string(),
  reviewedBy: z.string(),
  reviewedAt: z.string(),
  decisions: z.array(reviewDecisionEntrySchema),
});

// Compile-time drift guards between the Zod schemas and the TS types.
type AssertAssignable<T, U extends T> = U;
export type _ReviewItemContractCheck = AssertAssignable<
  ReviewItem,
  z.infer<typeof reviewItemSchema>
>;
export type _ReviewDecisionsContractCheck = AssertAssignable<
  ReviewDecisionsFile,
  z.infer<typeof reviewDecisionsFileSchema>
>;
