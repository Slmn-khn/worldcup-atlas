// Generates the Phase 2A human review pack from the validation/enrichment
// reports and the manual verified reference pack context.
//
// Outputs (data/2026/review/):
//   output/review-items.json     — review items (decision:null, status:PENDING)
//   output/review-items.csv      — spreadsheet-friendly view
//   output/review-summary.md     — human-facing summary
//   templates/review-decisions.example.json
//   review-decisions.json        — created only if missing (or with --force)
//
// Read-only over its inputs. No database writes, no import, no approvals.
//
// Usage:
//   pnpm data:2026:review-pack             # never clobbers review-decisions.json
//   pnpm data:2026:review-pack -- --force  # regenerate review-decisions.json too

import { generateReviewPack } from "../../src/server/agents/worldcup2026/reviewPack";

const force = process.argv.includes("--force");

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: generate human review pack\n");

  const { pack, writtenFiles, decisionsFileCreated } = await generateReviewPack({
    force,
  });

  console.log(`Review items: ${pack.counts.total}`);
  for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const) {
    console.log(`  ${severity.padEnd(8)} ${pack.counts.bySeverity[severity]}`);
  }
  console.log(`Review pack hash: sha256:${pack.reviewPackHash.slice(0, 16)}…`);
  console.log(`Inputs: ${pack.inputs.join(", ")}`);
  console.log("\nFiles written:");
  for (const file of writtenFiles) console.log(`  ${file}`);
  if (!decisionsFileCreated) {
    console.log(
      "\nExisting data/2026/review/review-decisions.json preserved " +
        "(re-run with --force to replace it).",
    );
  }
  console.log(
    "\nNext: a human records decisions in data/2026/review/review-decisions.json, " +
      "then runs `pnpm data:2026:review-validate`. Nothing is imported and " +
      "nothing is auto-approved.",
  );
}

main().catch((error) => {
  console.error("Review pack generation crashed unexpectedly:", error);
  process.exitCode = 1;
});
