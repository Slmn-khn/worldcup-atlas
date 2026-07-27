// Inspects the Bustami FIFA EFI Data WC 2026 candidate provider:
// raw snapshots, candidate files, and normalized enrichment output.
// Read-only — no database writes, no network calls.
//
// Usage:
//   pnpm data:2026:bustami:inspect

import { BUSTAMI_IMPORT_BLOCKED_REASON } from "../../src/server/agents/worldcup2026/providers/bustamiEfiDataset";
import {
  BUSTAMI_CANDIDATES_DIR,
  BUSTAMI_NORMALIZED_DIR,
  BUSTAMI_SOURCE_ID,
} from "../../src/server/agents/worldcup2026/sourceRegistry";
import {
  printCandidatesSummary,
  printEnrichedSummary,
  printRawSummary,
} from "./inspect-provider-common";

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: inspect Bustami EFI provider\n");
  console.log(
    "Trust level: RESEARCH_ANALYTICS_CANDIDATE (priority 5). License needs " +
      "review — upstream README scopes the data to analytical/research " +
      `purposes only. Every record carries importBlockedReason: ` +
      `${BUSTAMI_IMPORT_BLOCKED_REASON}; EFI metrics are never merged into ` +
      "the core public archive in this phase.\n",
  );
  await printRawSummary(BUSTAMI_SOURCE_ID);
  await printCandidatesSummary(BUSTAMI_CANDIDATES_DIR);
  await printEnrichedSummary(BUSTAMI_NORMALIZED_DIR);
  console.log(
    "\nFull report: data/2026/reports/bustami-efi-provider-report.md " +
      "(import recommendation: RESEARCH_ONLY_UNTIL_LICENSE_REVIEW).",
  );
}

main().catch((error) => {
  console.error("Inspection crashed unexpectedly:", error);
  process.exitCode = 1;
});
