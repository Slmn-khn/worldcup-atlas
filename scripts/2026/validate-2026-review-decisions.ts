// Validates the human-edited review-decisions.json against the generated
// review pack and writes the review validation reports.
//
// Exit semantics:
//   0 — decisions file is schema-valid (pending items are allowed; a clear
//       warning explains when import cannot proceed yet)
//   1 — decisions file (or review pack) is malformed and must be fixed
//
// No database writes, no import, no mutation of the reviewer's file.
//
// Usage:
//   pnpm data:2026:review-validate

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildReviewValidationMarkdown,
  parseReviewDecisionsFile,
  parseReviewPackFile,
  validateReviewDecisions,
} from "../../src/server/agents/worldcup2026/reviewDecisionValidator";
import {
  REVIEW_2026_DIR,
  REVIEW_OUTPUT_2026_DIR,
} from "../../src/server/agents/worldcup2026/sourceRegistry";

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: validate review decisions\n");

  const itemsPath = path.join(REVIEW_OUTPUT_2026_DIR, "review-items.json");
  const decisionsPath = path.join(REVIEW_2026_DIR, "review-decisions.json");

  let packPayload: unknown;
  try {
    packPayload = await readJson(itemsPath);
  } catch {
    console.error(
      `Cannot read ${itemsPath} — run \`pnpm data:2026:review-pack\` first.`,
    );
    process.exitCode = 1;
    return;
  }
  const pack = parseReviewPackFile(packPayload);
  if (!pack.ok) {
    console.error(pack.error);
    process.exitCode = 1;
    return;
  }

  let decisionsPayload: unknown;
  try {
    decisionsPayload = await readJson(decisionsPath);
  } catch {
    console.error(
      `Cannot read ${decisionsPath} — run \`pnpm data:2026:review-pack\` to create it.`,
    );
    process.exitCode = 1;
    return;
  }
  const decisions = parseReviewDecisionsFile(decisionsPayload);
  if (!decisions.ok) {
    console.error(decisions.error);
    process.exitCode = 1;
    return;
  }

  const result = validateReviewDecisions(
    pack.items,
    decisions.decisions,
    pack.reviewPackHash,
  );
  const generatedAt = new Date().toISOString();

  await mkdir(REVIEW_OUTPUT_2026_DIR, { recursive: true });
  await writeFile(
    path.join(REVIEW_OUTPUT_2026_DIR, "review-validation-report.json"),
    `${JSON.stringify({ generatedAt, ...result }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(REVIEW_OUTPUT_2026_DIR, "review-validation-report.md"),
    buildReviewValidationMarkdown(result, generatedAt),
    "utf8",
  );

  const { summary } = result;
  console.log(`Schema: ${result.schemaValid ? "VALID" : "INVALID"}`);
  console.log(
    `Items: ${summary.totalItems} total, ${summary.reviewedItems} reviewed, ` +
      `${summary.pendingItems} pending, ${summary.blockingItems} blocking.`,
  );
  for (const issue of result.errors) {
    console.error(`  ERROR ${issue.code}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    console.warn(`  WARN  ${issue.code}: ${issue.message}`);
  }
  console.log(
    result.eligibleForApprovalCandidate
      ? "\nEligible for an approval candidate — run `pnpm data:2026:approval-candidate`."
      : "\nIMPORT CANNOT PROCEED YET — blocking/pending items remain (see warnings above).",
  );
  console.log(`Reports written to ${REVIEW_OUTPUT_2026_DIR}.`);

  if (!result.schemaValid) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Review decision validation crashed unexpectedly:", error);
  process.exitCode = 1;
});
