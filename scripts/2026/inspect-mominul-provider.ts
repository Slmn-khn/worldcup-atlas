// Inspects the Mominul FIFA World Cup 2026 Dataset candidate provider:
// raw snapshots, candidate files, and normalized enrichment output.
// Read-only — no database writes, no network calls.
//
// Usage:
//   pnpm data:2026:mominul:inspect

import {
  MOMINUL_CANDIDATES_DIR,
  MOMINUL_NORMALIZED_DIR,
  MOMINUL_SOURCE_ID,
} from "../../src/server/agents/worldcup2026/sourceRegistry";
import {
  printCandidatesSummary,
  printEnrichedSummary,
  printRawSummary,
} from "./inspect-provider-common";

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: inspect Mominul provider\n");
  console.log(
    "Trust level: OPEN_DATA_CANDIDATE (priority 3, CC0-1.0). Candidate data " +
      "only — never imported, never rendered publicly; the manual verified " +
      "reference pack remains authoritative.\n",
  );
  await printRawSummary(MOMINUL_SOURCE_ID);
  await printCandidatesSummary(MOMINUL_CANDIDATES_DIR);
  await printEnrichedSummary(MOMINUL_NORMALIZED_DIR);
  console.log(
    "\nFull report: data/2026/reports/mominul-provider-report.md " +
      "(import recommendation: CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION).",
  );
}

main().catch((error) => {
  console.error("Inspection crashed unexpectedly:", error);
  process.exitCode = 1;
});
