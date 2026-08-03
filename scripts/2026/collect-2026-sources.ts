// Collects raw snapshots from the APPROVED 2026 sources into data/2026/raw/.
// Acquisition only — never touches the database. One endpoint failing never
// aborts the run; failures are reported in the summary and recorded in the
// snapshot .meta.json sidecars.
//
// Sources: see src/server/agents/worldcup2026/sourceRegistry.ts and
// docs/DATA_SOURCES.md (OpenFootball CC0 baseline + worldcup2026 community
// provider). No API keys required.
//
// Usage:
//   pnpm data:2026:collect

import { collectApprovedSources } from "../../src/server/agents/worldcup2026/collector";
import { RAW_2026_DIR } from "../../src/server/agents/worldcup2026/sourceRegistry";

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: collect raw snapshots\n");
  console.log(`Raw snapshot folder: ${RAW_2026_DIR}\n`);

  const summary = await collectApprovedSources();

  for (const result of summary.results) {
    if (result.status === "OK") {
      console.log(
        `[OK]     ${result.sourceId}/${result.endpointId} — ` +
          `${result.contentLength} bytes, sha256 ${result.contentHash.slice(0, 12)}…`,
      );
    } else {
      console.log(
        `[FAILED] ${result.sourceId}/${result.endpointId} — ${result.errorMessage}`,
      );
    }
  }

  console.log(
    `\nDone: ${summary.okCount} ok, ${summary.failedCount} failed, ` +
      `${summary.results.length} total endpoints.`,
  );
  if (summary.failedCount > 0) {
    console.log(
      "Failed endpoints are recorded in their .meta.json sidecars; " +
        "downstream steps continue with whatever was collected.",
    );
  }

  // Only a full wipeout is a script failure — partial data is expected and
  // handled downstream (the validator will surface missing coverage).
  if (summary.okCount === 0) {
    console.error("\nNo endpoint could be collected — check connectivity.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Collection crashed unexpectedly:", error);
  process.exitCode = 1;
});
