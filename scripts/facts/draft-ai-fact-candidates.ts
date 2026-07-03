// AI-assisted fact candidate writer — CLI entry point.
//
// Drafts title/summary/paragraph text with Claude for the same structured,
// DB-verified inputs the deterministic generator (facts:generate) uses — see
// src/server/facts/aiDrafter/. The AI never invents facts: every candidate's
// structured input is fetched straight from the database first, and every
// numeric claim in the AI's drafted text is checked against that input
// before the candidate is accepted. A draft that fails this check is never
// written to the database.
//
// This script is the ONLY place in the codebase that is allowed to invoke
// src/server/facts/aiDrafter — it must never be imported from a route
// handler, page, or anything else that serves public traffic. See
// docs/DISCOVERY_VAULT.md "Why AI is not used at runtime".
//
// Safety rules (see docs/DISCOVERY_VAULT.md):
// - Every accepted candidate is written with status = NEEDS_REVIEW, never
//   PUBLISHED — the same rule the deterministic generator follows.
// - Never touches a Fact whose status is not NEEDS_REVIEW (shared upsert
//   helper — see scripts/facts/utils/upsertGeneratedFactCandidate.ts).
// - A candidate that fails numeric validation, or that the Anthropic API
//   call fails for, is skipped and logged — never silently written.
// - There is no admin/review UI yet. Review generated candidates via
//   `pnpm db:studio` until that workflow is built.

import "dotenv/config";

import { createScriptPrismaClient } from "../import/utils/db";
import { draftAiFactCandidates } from "../../src/server/facts/aiDrafter";
import type { AiDraftResult } from "../../src/server/facts/aiDrafter";
import {
  createUpsertSummary,
  upsertGeneratedFactCandidate,
} from "./utils/upsertGeneratedFactCandidate";

type Summary = ReturnType<typeof createUpsertSummary> & {
  totalDrafted: number;
  validationFailed: number;
  aiErrors: number;
};

async function main() {
  console.log("WORLDCUP Nexus — Discovery Vault AI-assisted fact drafter\n");

  if (process.env.ANTHROPIC_API_KEY === undefined || process.env.ANTHROPIC_API_KEY === "") {
    console.log(
      "ANTHROPIC_API_KEY is not set. Set it in your environment (see .env.example) to run " +
        "the AI-assisted drafter. Nothing to do — exiting.",
    );
    return;
  }

  const { results } = await draftAiFactCandidates();

  if (results.length === 0) {
    console.log("No draft inputs could be built from the current database. Nothing to do.");
    return;
  }

  const drafted = results.filter(
    (result): result is Extract<AiDraftResult, { status: "drafted" }> => result.status === "drafted",
  );
  const validationFailed = results.filter(
    (result): result is Extract<AiDraftResult, { status: "validation_failed" }> =>
      result.status === "validation_failed",
  );
  const aiErrors = results.filter(
    (result): result is Extract<AiDraftResult, { status: "ai_error" }> => result.status === "ai_error",
  );

  for (const failure of validationFailed) {
    console.log(
      `[REJECTED] ${failure.slug} (${failure.templateId}) — drafted text stated a number not present ` +
        `in its input: ${failure.invalidNumbers.join(", ")}. Left untouched, not saved.`,
    );
  }
  for (const failure of aiErrors) {
    console.log(`[AI ERROR] ${failure.slug} (${failure.templateId}) — ${failure.message}`);
  }

  if (drafted.length === 0) {
    console.log("\nNo candidates passed AI drafting + validation. Nothing to save.");
    return;
  }

  const prisma = createScriptPrismaClient();
  const summary: Summary = {
    totalDrafted: results.length,
    validationFailed: validationFailed.length,
    aiErrors: aiErrors.length,
    ...createUpsertSummary(),
  };

  try {
    for (const result of drafted) {
      await upsertGeneratedFactCandidate(prisma, result.candidate, summary);
    }

    console.log(
      "\nDone.\n" +
        `  inputsProcessed:   ${summary.totalDrafted}\n` +
        `  validationFailed:  ${summary.validationFailed}\n` +
        `  aiErrors:          ${summary.aiErrors}\n` +
        `  created:           ${summary.created}\n` +
        `  updated:           ${summary.updated}\n` +
        `  protectedSkipped:  ${summary.protectedSkipped}\n` +
        `  relationsResolved: ${summary.relationsResolved}\n\n` +
        "Every saved candidate was written as NEEDS_REVIEW. None are publicly visible " +
        "until a human reviews and publishes them. There is no review UI yet — inspect " +
        "candidates with `pnpm db:studio`.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "\nAI-assisted fact drafter failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
