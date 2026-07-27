// Inspects the manual verified 2026 reference pack: loads it, validates the
// structure, prints file hashes, coverage and warnings. Read-only — no
// database, no network, no writes.
//
// Exit codes: 0 when the pack is absent or structurally valid (warnings are
// fine — they are the pack's honestly-recorded gaps); 1 when malformed.
//
// Usage:
//   pnpm data:2026:manual-pack

import {
  MANUAL_PACK_DIR,
  buildManualPackStats,
  loadManualReferencePack,
} from "../../src/server/agents/worldcup2026/manualReferencePack";

async function main() {
  console.log("WORLDCUP Nexus — 2026 manual verified reference pack\n");
  console.log(`Pack folder: ${MANUAL_PACK_DIR}\n`);

  const result = await loadManualReferencePack();
  if (result === null) {
    console.log("No pack present (no manifest.json). Nothing to inspect.");
    return;
  }
  if (!result.ok) {
    console.error("Pack is MALFORMED:\n");
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const { pack, warnings } = result;
  const stats = buildManualPackStats(pack);

  console.log(`Pack:      ${pack.manifest.packId} — ${pack.manifest.label}`);
  console.log(`Created:   ${pack.manifest.createdAt} by ${pack.manifest.createdBy}`);
  console.log(`Level:     ${pack.manifest.verificationLevel}`);
  console.log(`Importable: ${pack.manifest.importAllowed} (must be false)`);
  console.log(`Pack hash: sha256:${pack.packHash}\n`);

  console.log("File hashes:");
  for (const [key, hash] of Object.entries(pack.fileHashes).sort()) {
    console.log(`  ${key.padEnd(11)} sha256:${hash}`);
  }

  console.log("\nCoverage:");
  console.log(`  tournament: ${pack.tournament !== null ? `present (${pack.tournament.verification ?? "?"})` : "absent"}`);
  console.log(`  teams:      ${pack.teams.length} (${stats.verifiedTeams} verified, ${stats.unverifiedTeams} other)`);
  console.log(`  groups:     ${pack.groups.length}`);
  console.log(
    `  matches:    ${stats.capturedMatchCount} of ${stats.officialMatchCount} official ` +
      `(${stats.verifiedMatches} verified, ${stats.unverifiedMatches} unverified)`,
  );
  console.log(`  standings:  final top four + ${(pack.standings?.group_tables ?? []).length} group tables`);
  console.log(`  bracket:    ${(pack.bracket?.rounds ?? []).length} rounds`);
  console.log(`  venues:     ${pack.venues.length}`);
  console.log(`  awards:     ${Object.keys(pack.awards).length}`);
  console.log(`  conflicts:  ${pack.conflicts.length} known manual conflicts`);
  console.log(`  sources:    ${pack.sources?.sources.length ?? 0} attributed sources`);

  if (warnings.length > 0) {
    console.log("\nWarnings (review-required, not errors):");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  console.log(
    "\nStructurally valid. Reminder: this pack is reference evidence only — " +
      "no import happens without data/2026/approved/approval.json.",
  );
}

main().catch((error) => {
  console.error("Inspection crashed unexpectedly:", error);
  process.exitCode = 1;
});
