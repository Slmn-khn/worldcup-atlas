// Builds the approved Mominul import pack:
//   data/2026/raw/mominul_2026_dataset/ → data/2026/approved/mominul/finalized/
//
// Mominul-only by policy (data/2026/approved/mominul-import-policy.json).
// File-in/file-out: no database writes, no network. Fails non-zero when the
// policy or any hard validation invariant fails — the importer requires this
// pack to exist and re-validates it before any write.
//
// Usage: pnpm data:2026:mominul:approved-pack

import {
  buildMominulApprovedPack,
  validateMominulApprovedPack,
  writeMominulApprovedPack,
  MOMINUL_APPROVED_PACK_DIR,
} from "../../src/server/agents/worldcup2026/mominulApprovedPack";
import { loadMominulImportPolicy } from "../../src/server/agents/worldcup2026/mominulImportPolicy";

async function main(): Promise<void> {
  console.log("WORLDCUP Nexus — Mominul approved pack builder\n");

  const policy = await loadMominulImportPolicy();
  if (!policy.ok) {
    console.error("Import policy check FAILED:");
    for (const error of policy.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Policy: ${policy.policy.sourceId} · ${policy.policy.status}`);

  const { pack, warnings, errors } = await buildMominulApprovedPack();
  const validation = validateMominulApprovedPack(pack);
  const allErrors = [...errors, ...validation.errors];
  const allWarnings = [...warnings, ...validation.warnings];

  console.log("\nRecord counts:");
  for (const [key, count] of Object.entries(pack.manifest.recordCounts)) {
    console.log(`  ${key.padEnd(16)} ${count}`);
  }
  console.log(`\nChampion: ${pack.tournament.championTeamName ?? "—"}`);
  console.log(`Final:    ${pack.tournament.finalScoreLine ?? "—"}`);

  for (const warning of allWarnings) console.log(`  [WARN] ${warning}`);
  if (allErrors.length > 0) {
    console.error("\nValidation FAILED:");
    for (const error of allErrors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const written = await writeMominulApprovedPack(pack);
  console.log(
    `\nWrote ${written.length} files to ${MOMINUL_APPROVED_PACK_DIR}`,
  );
}

main().catch((error) => {
  console.error(
    "\nApproved pack build failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
