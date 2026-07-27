import { describe, expect, it } from "vitest";

import {
  buildApprovalCandidate,
  evaluateApprovalEligibility,
} from "../../../src/server/agents/worldcup2026/approvalCandidate";
import {
  parseReviewDecisionsFile,
  statusForDecision,
  validateReviewDecisions,
} from "../../../src/server/agents/worldcup2026/reviewDecisionValidator";
import type {
  ReviewDecisionEntry,
  ReviewDecisionsFile,
  ReviewItem,
} from "../../../src/server/agents/worldcup2026/reviewTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const item = (partial: Partial<ReviewItem> & { id: string }): ReviewItem => ({
  type: "MATCH_RESULT_CONFLICT",
  severity: "HIGH",
  entityType: "matches",
  entityKey: "GB-5",
  field: "score",
  manualPackValue: "Switzerland 3-1 Canada",
  providerValue: "Switzerland 2-1 Canada",
  providerSourceId: "mominul_2026_dataset",
  preferredSourceId: "manual_verified_2026_pack_v1",
  currentRecommendation: "KEEP_MANUAL_VERIFIED",
  reason: "Sources disagree.",
  evidence: [
    { sourceId: "manual_verified_2026_pack_v1", value: "Switzerland 3-1 Canada" },
    { sourceId: "mominul_2026_dataset", value: "Switzerland 2-1 Canada" },
  ],
  decision: null,
  reviewerNote: null,
  status: "PENDING",
  ...partial,
});

const decisionsFile = (
  decisions: ReviewDecisionEntry[],
  reviewPackHash = "",
): ReviewDecisionsFile => ({
  schema: "review-decisions/v1",
  reviewPackHash,
  reviewedBy: "reviewer",
  reviewedAt: "2026-07-27T00:00:00.000Z",
  decisions,
});

const entry = (
  partial: Partial<ReviewDecisionEntry> & { reviewItemId: string },
): ReviewDecisionEntry => ({
  decision: "APPROVE_MANUAL",
  reviewerNote: null,
  approvedValue: null,
  approvedSourceId: null,
  ...partial,
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("review decisions schema", () => {
  it("accepts a valid decisions file", () => {
    const parsed = parseReviewDecisionsFile(decisionsFile([entry({ reviewItemId: "x" })]));
    expect(parsed.ok).toBe(true);
  });
  it("rejects an invalid decision value", () => {
    const parsed = parseReviewDecisionsFile(
      decisionsFile([
        entry({ reviewItemId: "x", decision: "APPROVE_EVERYTHING" as never }),
      ]),
    );
    expect(parsed.ok).toBe(false);
  });
  it("rejects a wrong schema tag", () => {
    const parsed = parseReviewDecisionsFile({
      ...decisionsFile([]),
      schema: "something-else",
    });
    expect(parsed.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

describe("validateReviewDecisions", () => {
  it("fails on an unknown reviewItemId", () => {
    const result = validateReviewDecisions(
      [item({ id: "review-a" })],
      decisionsFile([entry({ reviewItemId: "review-does-not-exist" })]),
    );
    expect(result.schemaValid).toBe(false);
    expect(result.errors[0].code).toBe("UNKNOWN_REVIEW_ITEM");
  });

  it("requires a reviewerNote for REJECT_PROVIDER / BLOCK_IMPORT / enrichment-only", () => {
    for (const decision of [
      "REJECT_PROVIDER",
      "BLOCK_IMPORT",
      "APPROVE_AS_ENRICHMENT_ONLY",
    ] as const) {
      const result = validateReviewDecisions(
        [item({ id: "review-a" })],
        decisionsFile([entry({ reviewItemId: "review-a", decision })]),
      );
      expect(result.errors.some((e) => e.code === "REVIEWER_NOTE_REQUIRED")).toBe(true);
    }
  });

  it("requires a reviewerNote when APPROVE_MOMINUL overrides a manual pack value", () => {
    const noNote = validateReviewDecisions(
      [item({ id: "review-a" })],
      decisionsFile([entry({ reviewItemId: "review-a", decision: "APPROVE_MOMINUL" })]),
    );
    expect(noNote.errors.some((e) => e.code === "REVIEWER_NOTE_REQUIRED")).toBe(true);

    const withNote = validateReviewDecisions(
      [item({ id: "review-a" })],
      decisionsFile([
        entry({
          reviewItemId: "review-a",
          decision: "APPROVE_MOMINUL",
          reviewerNote: "Provider score verified against broadcast footage.",
        }),
      ]),
    );
    expect(withNote.schemaValid).toBe(true);
  });

  it("rejects an approvedSourceId that is not in the item evidence", () => {
    const result = validateReviewDecisions(
      [item({ id: "review-a" })],
      decisionsFile([
        entry({
          reviewItemId: "review-a",
          approvedSourceId: "some_random_source",
        }),
      ]),
    );
    expect(
      result.errors.some((e) => e.code === "APPROVED_SOURCE_NOT_IN_EVIDENCE"),
    ).toBe(true);
  });

  it("requires approvedValue for a value-picking approval without a recorded value", () => {
    const bare = item({ id: "review-a" });
    bare.manualPackValue = undefined;
    const result = validateReviewDecisions(
      [bare],
      decisionsFile([entry({ reviewItemId: "review-a", decision: "APPROVE_MANUAL" })]),
    );
    expect(result.errors.some((e) => e.code === "APPROVED_VALUE_REQUIRED")).toBe(true);
  });

  it("treats pending items as warnings, not errors", () => {
    const result = validateReviewDecisions(
      [item({ id: "review-a" }), item({ id: "review-b", severity: "LOW" })],
      decisionsFile([]),
    );
    expect(result.schemaValid).toBe(true);
    expect(result.summary.pendingItems).toBe(2);
    expect(result.summary.importBlockingCount).toBe(1); // only the HIGH one
    expect(result.warnings.some((w) => w.code === "IMPORT_BLOCKED")).toBe(true);
    expect(result.eligibleForApprovalCandidate).toBe(false);
  });

  it("maps decisions onto effective statuses", () => {
    expect(statusForDecision("APPROVE_MANUAL")).toBe("APPROVED");
    expect(statusForDecision("REJECT_PROVIDER")).toBe("REJECTED");
    expect(statusForDecision("BLOCK_IMPORT")).toBe("BLOCKED");
    expect(statusForDecision("NEEDS_SOURCE")).toBe("REVIEWED");
    expect(statusForDecision("IGNORE_NON_BLOCKING")).toBe("REVIEWED");
  });
});

// ---------------------------------------------------------------------------
// Approval candidate gating
// ---------------------------------------------------------------------------

describe("evaluateApprovalEligibility", () => {
  const highItem = item({ id: "review-high" });
  const lowItem = item({ id: "review-low", severity: "LOW", type: "EFI_ANALYTICS_CANDIDATE" });

  it("does not generate with pending CRITICAL/HIGH items", () => {
    const result = evaluateApprovalEligibility(
      [item({ id: "review-critical", severity: "CRITICAL" }), lowItem],
      decisionsFile([]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toContain("CRITICAL");
  });

  it("does not generate when a BLOCK_IMPORT decision exists", () => {
    const result = evaluateApprovalEligibility(
      [highItem],
      decisionsFile([
        entry({
          reviewItemId: "review-high",
          decision: "BLOCK_IMPORT",
          reviewerNote: "Blocking until federation confirmation.",
        }),
      ]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toContain("BLOCK_IMPORT");
  });

  it("does not generate when a HIGH item is stuck at NEEDS_SOURCE", () => {
    const result = evaluateApprovalEligibility(
      [highItem],
      decisionsFile([
        entry({ reviewItemId: "review-high", decision: "NEEDS_SOURCE" }),
      ]),
    );
    expect(result.eligible).toBe(false);
  });

  it("generates once required decisions exist (pending LOW items allowed)", () => {
    const result = evaluateApprovalEligibility(
      [highItem, lowItem],
      decisionsFile([
        entry({ reviewItemId: "review-high", decision: "APPROVE_MANUAL" }),
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("never sets approvedForImport=true on the candidate", () => {
    const candidate = buildApprovalCandidate({
      validationReportHash: "sha256:v",
      reviewPackHash: "sha256:p",
      reviewDecisionHash: "sha256:d",
      finalizedDataPackHash: "sha256:f",
    });
    expect(candidate.approvedForImport).toBe(false);
    expect(candidate.approvedBy).toBe("");
    expect(candidate.approvedAt).toBe("");
    expect(candidate.schema).toBe("approval/v1");
    expect(candidate.notes).toContain("rename to approval.json");
  });
});
