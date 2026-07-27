// Generates data/2026/approved/approval.candidate.json when — and only
// when — the human review is complete enough: every CRITICAL/HIGH review
// item decided, no BLOCK_IMPORT decision, decisions file schema-valid.
//
// The candidate is NOT an approval and NOT an import:
//   - approvedForImport is always false,
//   - approvedBy/approvedAt are left empty,
//   - the file is never named approval.json — a human must review it, fill
//     in the fields, set approvedForImport=true, and rename it.
// No database writes occur. Phase 2A has no importer.
//
// Usage:
//   pnpm data:2026:approval-candidate

import { generateApprovalCandidate } from "../../src/server/agents/worldcup2026/approvalCandidate";

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: generate approval candidate\n");

  const result = await generateApprovalCandidate();

  if (!result.generated) {
    console.log("No approval candidate generated:");
    for (const reason of result.reasons) console.log(`  - ${reason}`);
    console.log(
      "\nThis is the expected outcome while review is incomplete. Finish the " +
        "blocking review items, re-run `pnpm data:2026:review-validate`, then " +
        "try again. Nothing was imported and no database was written.",
    );
    return;
  }

  console.log(`Candidate written: ${result.candidatePath}`);
  console.log(`  dataPackVersion:      ${result.candidate.dataPackVersion}`);
  console.log(`  validationReportHash: ${result.candidate.validationReportHash.slice(0, 23)}…`);
  console.log(`  reviewPackHash:       ${result.candidate.reviewPackHash.slice(0, 23)}…`);
  console.log(`  reviewDecisionHash:   ${result.candidate.reviewDecisionHash.slice(0, 23)}…`);
  console.log(`  approvedForImport:    ${result.candidate.approvedForImport} (always false here)`);
  console.log(
    "\nThis is a CANDIDATE, not an approval. A human must fill approvedBy/" +
      "approvedAt, set approvedForImport=true, and rename the file to " +
      "approval.json before any future Phase 2B importer can run. Phase 2A " +
      "never writes the database.",
  );
}

main().catch((error) => {
  console.error("Approval candidate generation crashed unexpectedly:", error);
  process.exitCode = 1;
});
