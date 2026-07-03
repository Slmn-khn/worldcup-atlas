// Deterministic data-template fact generator — CLI entry point.
//
// Mechanically derives Fact candidates from database queries (top scorers,
// squad selections, biggest wins, highest-scoring matches, host winners,
// penalty shootouts, final scores — see src/server/facts/generator/). No AI
// is called anywhere in this pipeline.
//
// Safety rules (see docs/DISCOVERY_VAULT.md):
// - Every candidate is written with status = NEEDS_REVIEW, never PUBLISHED —
//   regardless of how confident the underlying numbers are. The generated
//   NUMBERS are DB_VERIFIED (computed straight from our own database); the
//   generated PROSE still needs a human editorial pass before it can go
//   public, exactly like a hand-written NEEDS_REVIEW draft.
// - Never touches a Fact whose status is not NEEDS_REVIEW. Once a human has
//   reviewed a generated candidate (published it, archived it, rejected it,
//   or started hand-editing it as a DRAFT), re-running this generator must
//   never silently overwrite that decision.
// - Every candidate's slug is prefixed `auto-` so it can never collide with
//   a hand-curated starter fact's slug.
// - Every candidate carries FactSource rows describing exactly which query
//   produced it, for full audit trail during review.

import "dotenv/config";

import { createScriptPrismaClient } from "../import/utils/db";
import { generateFactCandidates } from "../../src/server/facts/generator";
import {
  createUpsertSummary,
  upsertGeneratedFactCandidate,
} from "./utils/upsertGeneratedFactCandidate";

type Summary = ReturnType<typeof createUpsertSummary> & { candidatesGenerated: number };

async function main() {
  console.log("WORLDCUP Nexus — Discovery Vault data-template fact generator\n");

  const { candidates, countsByTemplate } = await generateFactCandidates();

  if (candidates.length === 0) {
    console.log("No candidates could be generated from the current database. Nothing to do.");
    return;
  }

  const prisma = createScriptPrismaClient();
  const summary: Summary = { candidatesGenerated: candidates.length, ...createUpsertSummary() };

  try {
    for (const candidate of candidates) {
      await upsertGeneratedFactCandidate(prisma, candidate, summary);
    }

    console.log(
      "\nBy template:\n" +
        Object.entries(countsByTemplate)
          .map(([templateId, count]) => `  ${templateId}: ${count}`)
          .join("\n"),
    );
    console.log(
      "\nDone.\n" +
        `  candidatesGenerated: ${summary.candidatesGenerated}\n` +
        `  created:             ${summary.created}\n` +
        `  updated:             ${summary.updated}\n` +
        `  protectedSkipped:    ${summary.protectedSkipped}\n` +
        `  relationsResolved:   ${summary.relationsResolved}\n\n` +
        "Every candidate was written as NEEDS_REVIEW. None are publicly visible " +
        "until a human reviews and publishes them.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "\nGenerator failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
