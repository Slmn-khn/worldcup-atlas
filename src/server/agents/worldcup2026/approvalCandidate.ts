// Approval candidate generation for the 2026 data steward agent (Phase 2A).
//
// When (and only when) the human review is complete enough — every
// CRITICAL/HIGH item decided, no BLOCK_IMPORT decision, no NEEDS_SOURCE on a
// CRITICAL/HIGH item, decisions file schema-valid — this produces
// data/2026/approved/approval.candidate.json.
//
// The candidate is NOT an approval:
//   - it is never named approval.json (a human must rename it),
//   - approvedForImport is ALWAYS false (a human must set it true),
//   - approvedBy/approvedAt are left empty (a human must fill them).
// Phase 2A has no importer; the future Phase 2B importer refuses to run
// without a human-completed approval.json. No database is ever written here.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseReviewDecisionsFile,
  parseReviewPackFile,
  validateReviewDecisions,
} from "./reviewDecisionValidator";
import {
  APPROVED_2026_DIR,
  NORMALIZED_2026_DIR,
  REVIEW_2026_DIR,
  REVIEW_OUTPUT_2026_DIR,
  VALIDATION_2026_DIR,
} from "./sourceRegistry";
import type { ReviewDecisionsFile, ReviewItem } from "./reviewTypes";

export const APPROVAL_CANDIDATE_FILE_NAME = "approval.candidate.json";
export const DATA_PACK_VERSION = "2026.1.0";

export type ApprovalCandidate = {
  schema: "approval/v1";
  approvedBy: "";
  approvedAt: "";
  dataPackVersion: string;
  validationReportHash: string;
  reviewPackHash: string;
  reviewDecisionHash: string;
  finalizedDataPackHash: string;
  approvedForImport: false;
  notes: string;
};

export const APPROVAL_CANDIDATE_NOTES =
  "Generated candidate only. Human must fill approvedBy, approvedAt, set " +
  "approvedForImport=true, and rename to approval.json.";

// ---------------------------------------------------------------------------
// Eligibility + candidate shape (pure — unit-tested)
// ---------------------------------------------------------------------------

export type ApprovalEligibility = {
  eligible: boolean;
  reasons: string[];
};

/**
 * An approval candidate may be generated only when every CRITICAL/HIGH item
 * has a usable decision and nothing blocks import. Pending MEDIUM/LOW items
 * are allowed (they are noted, not blocking).
 */
export function evaluateApprovalEligibility(
  items: ReviewItem[],
  decisionsFile: ReviewDecisionsFile,
): ApprovalEligibility {
  const validation = validateReviewDecisions(items, decisionsFile);
  const reasons: string[] = [];

  if (!validation.schemaValid) {
    reasons.push(
      `review-decisions.json has ${validation.errors.length} validation error(s) — fix them first (pnpm data:2026:review-validate).`,
    );
  }
  const { summary } = validation;
  if (summary.bySeverityPending.CRITICAL > 0 || summary.bySeverityPending.HIGH > 0) {
    reasons.push(
      `${summary.bySeverityPending.CRITICAL} CRITICAL and ${summary.bySeverityPending.HIGH} HIGH review items are still PENDING.`,
    );
  }
  if (summary.blockImportDecisions > 0) {
    reasons.push(
      `${summary.blockImportDecisions} BLOCK_IMPORT decision(s) exist — import is explicitly blocked by the reviewer.`,
    );
  }
  const needsSourceBlocking =
    summary.importBlockingCount -
    summary.blockImportDecisions -
    summary.bySeverityPending.CRITICAL -
    summary.bySeverityPending.HIGH;
  if (needsSourceBlocking > 0) {
    reasons.push(
      `${needsSourceBlocking} CRITICAL/HIGH item(s) are decided NEEDS_SOURCE — a source must be found before approval.`,
    );
  }

  return { eligible: reasons.length === 0, reasons };
}

/** Builds the candidate payload. approvedForImport is false BY TYPE. */
export function buildApprovalCandidate(hashes: {
  validationReportHash: string;
  reviewPackHash: string;
  reviewDecisionHash: string;
  finalizedDataPackHash: string;
}): ApprovalCandidate {
  return {
    schema: "approval/v1",
    approvedBy: "",
    approvedAt: "",
    dataPackVersion: DATA_PACK_VERSION,
    validationReportHash: hashes.validationReportHash,
    reviewPackHash: hashes.reviewPackHash,
    reviewDecisionHash: hashes.reviewDecisionHash,
    finalizedDataPackHash: hashes.finalizedDataPackHash,
    approvedForImport: false,
    notes: APPROVAL_CANDIDATE_NOTES,
  };
}

// ---------------------------------------------------------------------------
// Generation (file IO)
// ---------------------------------------------------------------------------

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Hash over the core normalized data pack (the curated committable files),
 * used as finalizedDataPackHash. There is no separate finalization report in
 * this phase; this pins the exact normalized state the review was made on.
 */
export async function computeFinalizedDataPackHash(
  normalizedDir: string = NORMALIZED_2026_DIR,
): Promise<string> {
  const files = [
    "tournament.json",
    "teams.json",
    "groups.json",
    "venues.json",
    "matches.json",
    "standings.json",
    "bracket.json",
    "awards.json",
    "sources.json",
    "conflicts.json",
  ];
  const parts: string[] = [];
  for (const file of files) {
    const body = await readTextIfPresent(path.join(normalizedDir, file));
    if (body !== null) parts.push(`${file}:${sha256(body)}`);
  }
  return sha256(parts.join("\n"));
}

export type ApprovalCandidateResult =
  | { generated: true; candidatePath: string; candidate: ApprovalCandidate }
  | { generated: false; reasons: string[] };

export async function generateApprovalCandidate(): Promise<ApprovalCandidateResult> {
  const itemsBody = await readTextIfPresent(
    path.join(REVIEW_OUTPUT_2026_DIR, "review-items.json"),
  );
  if (itemsBody === null) {
    return {
      generated: false,
      reasons: ["review-items.json not found — run `pnpm data:2026:review-pack` first."],
    };
  }
  const pack = parseReviewPackFile(JSON.parse(itemsBody));
  if (!pack.ok) return { generated: false, reasons: [pack.error] };

  const decisionsBody = await readTextIfPresent(
    path.join(REVIEW_2026_DIR, "review-decisions.json"),
  );
  if (decisionsBody === null) {
    return {
      generated: false,
      reasons: ["review-decisions.json not found — run `pnpm data:2026:review-pack` first."],
    };
  }
  const decisions = parseReviewDecisionsFile(JSON.parse(decisionsBody));
  if (!decisions.ok) return { generated: false, reasons: [decisions.error] };

  const eligibility = evaluateApprovalEligibility(pack.items, decisions.decisions);
  if (!eligibility.eligible) {
    return { generated: false, reasons: eligibility.reasons };
  }

  const validationBody = await readTextIfPresent(
    path.join(VALIDATION_2026_DIR, "validation-report.json"),
  );
  if (validationBody === null) {
    return {
      generated: false,
      reasons: ["validation-report.json not found — run `pnpm data:2026:validate` first."],
    };
  }

  const candidate = buildApprovalCandidate({
    validationReportHash: `sha256:${sha256(validationBody)}`,
    reviewPackHash: `sha256:${pack.reviewPackHash}`,
    reviewDecisionHash: `sha256:${sha256(decisionsBody)}`,
    finalizedDataPackHash: `sha256:${await computeFinalizedDataPackHash()}`,
  });

  await mkdir(APPROVED_2026_DIR, { recursive: true });
  const candidatePath = path.join(APPROVED_2026_DIR, APPROVAL_CANDIDATE_FILE_NAME);
  await writeFile(
    candidatePath,
    `${JSON.stringify(candidate, null, 2)}\n`,
    "utf8",
  );
  return {
    generated: true,
    candidatePath: candidatePath.replace(/\\/g, "/"),
    candidate,
  };
}
