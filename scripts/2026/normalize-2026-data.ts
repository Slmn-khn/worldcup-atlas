// Normalizes the 2026 candidate files into merged, Zod-validated records
// under data/2026/normalized/. Deterministic entity resolution and conflict
// reporting — no database writes, no external calls.
//
// Usage:
//   pnpm data:2026:normalize

import { runNormalization } from "../../src/server/agents/worldcup2026/normalizer";
import { runProviderEnrichment } from "../../src/server/agents/worldcup2026/providers/enrichmentPipeline";
import { writeEnrichmentReports } from "../../src/server/agents/worldcup2026/providers/providerReports";
import { NORMALIZED_2026_DIR } from "../../src/server/agents/worldcup2026/sourceRegistry";

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: normalize\n");

  const result = await runNormalization();

  console.log(`Normalized output: ${NORMALIZED_2026_DIR}\n`);
  console.log(`Teams:      ${result.teams.length}`);
  console.log(`Groups:     ${result.groups.length}`);
  console.log(`Venues:     ${result.venues.length}`);
  console.log(`Matches:    ${result.matches.length}`);
  console.log(`Standings:  ${result.standings.length}`);
  console.log(`Bracket:    ${result.bracketStages} knockout stages`);
  console.log(`Conflicts:  ${result.conflicts.length}`);
  if (result.candidateErrors > 0) {
    console.log(`Candidate parse errors carried over: ${result.candidateErrors}`);
  }

  const tournament = result.tournament;
  console.log(
    `\nTournament: ${tournament.name} — ${tournament.teamsCount} teams, ` +
      `${tournament.matchesCount} matches, hosts: ${tournament.hostCountries.join(", ") || "unknown"}`,
  );
  if (tournament.winner != null) {
    console.log(
      `Result: winner ${tournament.winner}, runner-up ${tournament.runnerUp ?? "?"} ` +
        `(third: ${tournament.thirdPlace ?? "?"}, fourth: ${tournament.fourthPlace ?? "?"})`,
    );
  }
  if (result.conflicts.length > 0) {
    console.log(
      `\n${result.conflicts.length} conflicts recorded in conflicts.json — ` +
        "review before any future import phase.",
    );
  }

  // Candidate-provider enrichment (Mominul / Bustami EFI): normalized
  // enrichment files + provider reports. Candidate output only — no DB
  // writes, no public rendering, manual pack stays authoritative.
  const enrichment = await runProviderEnrichment();
  const reportFiles = await writeEnrichmentReports(enrichment);
  console.log("\nCandidate-provider enrichment:");
  for (const stats of [enrichment.mominul, enrichment.bustami]) {
    const rows = Object.values(stats.rowCounts).reduce((sum, count) => sum + count, 0);
    console.log(
      `  ${stats.sourceId}: ${stats.filesParsed} files, ${rows} rows, ` +
        `${stats.gapFillCandidates} gap-fill candidates, ` +
        `${stats.conflictsWithManualPack} conflicts vs manual pack → ${stats.importRecommendation}`,
    );
  }
  console.log(`  Enriched files: ${enrichment.writtenFiles.length}`);
  console.log(`  Reports: ${reportFiles.join(", ")}`);
}

main().catch((error) => {
  console.error("Normalization failed:", error);
  process.exitCode = 1;
});
