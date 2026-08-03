// Report generation for the 2026 candidate providers (Phase 1).
//
// Produces the human-facing provider reports plus the machine-readable
// enrichment coverage/conflict reports under data/2026/reports/. Reports
// describe candidate data only: neither provider is imported, neither is
// rendered publicly, and the manual verified reference pack remains
// authoritative for tournament outcome, the final, awards, and known
// conflicts.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { REPORTS_2026_DIR } from "../sourceRegistry";
import { BUSTAMI_IMPORT_BLOCKED_REASON } from "./bustamiEfiDataset";
import type {
  ProviderEnrichmentResult,
  ProviderEnrichmentStats,
} from "./enrichmentPipeline";

function pushCommonHeader(
  lines: string[],
  title: string,
  result: ProviderEnrichmentResult,
): void {
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push("");
  lines.push(
    "**Status: candidate data only.** This provider was NOT imported. No " +
      "database writes occurred, nothing is rendered publicly, and the " +
      "`data/2026/approved/approval.json` gate is untouched. The manual " +
      "verified reference pack remains authoritative for the tournament " +
      "outcome, the final, awards, and known conflicts.",
  );
  lines.push("");
}

function pushFileTable(lines: string[], stats: ProviderEnrichmentStats): void {
  lines.push("## Files");
  lines.push("");
  lines.push(
    `Fetched: ${stats.filesFetched} ok, ${stats.filesFailed} failed. ` +
      `Parsed: ${stats.filesParsed} candidate files.`,
  );
  lines.push("");
  lines.push("| File | Rows | Columns detected |");
  lines.push("| --- | ---: | ---: |");
  for (const [file, rows] of Object.entries(stats.rowCounts).sort()) {
    lines.push(
      `| ${file} | ${rows} | ${stats.columnsDetected[file]?.length ?? 0} |`,
    );
  }
  lines.push("");
  lines.push(
    `Row-level parse quality across all files: ${stats.parseWarnRows} WARN rows, ` +
      `${stats.parseErrorRows} ERROR rows (kept with their raw payloads — never silently dropped).`,
  );
  lines.push("");
}

function pushResolution(
  lines: string[],
  label: string,
  resolution: ProviderEnrichmentStats["matchResolution"],
): void {
  if (resolution.total === 0) {
    lines.push(`- ${label}: no linkable rows.`);
    return;
  }
  const pct = Math.round((resolution.resolved / resolution.total) * 100);
  const detail = Object.entries(resolution.byConfidence)
    .sort()
    .map(([confidence, count]) => `${confidence}: ${count}`)
    .join(", ");
  lines.push(
    `- ${label}: ${resolution.resolved}/${resolution.total} rows resolved (${pct}%) — ${detail}.`,
  );
}

function pushNotes(lines: string[], stats: ProviderEnrichmentStats): void {
  if (stats.notes.length === 0) return;
  lines.push("## Notes");
  lines.push("");
  for (const note of stats.notes) lines.push(`- ${note}`);
  lines.push("");
}

/** Human-facing report for the Mominul open-data candidate provider. */
export function buildMominulProviderReportMarkdown(
  result: ProviderEnrichmentResult,
): string {
  const stats = result.mominul;
  const lines: string[] = [];
  pushCommonHeader(lines, "Mominul FIFA World Cup 2026 Dataset — Provider Report", result);
  lines.push(
    "Reliability: `OPEN_DATA_CANDIDATE` (priority 3), license CC0-1.0. Core " +
      "matches may become gap-fill candidates when they resolve cleanly; " +
      "player/event/lineup/stat rows remain enrichment candidates only.",
  );
  lines.push("");
  pushFileTable(lines, stats);

  lines.push("## Row counts by area");
  lines.push("");
  const area = (file: string): number => stats.rowCounts[file] ?? 0;
  lines.push(`- Teams: ${area("teams.csv")}`);
  lines.push(`- Venues: ${area("venues.csv")}`);
  lines.push(
    `- Matches: ${area("matches.csv")} (+ ${area("matches_detailed.csv")} detailed, ` +
      `${area("real_match_details.json")} real-detail entries)`,
  );
  lines.push(`- Referees: ${area("referees.csv")}`);
  lines.push(`- Squad/player rows: ${area("squads_and_players.csv")}`);
  lines.push(`- Match events: ${area("match_events.csv")}`);
  lines.push(`- Lineup rows: ${area("match_lineups.csv")}`);
  lines.push(`- Player stat rows: ${area("player_stats.csv")}`);
  lines.push(`- Team match stat rows: ${area("match_team_stats.csv")}`);
  lines.push("");

  lines.push("## Comparison against the manual verified pack");
  lines.push("");
  lines.push(
    `- Supporting evidence (agrees with verified manual fields): ${stats.classificationCounts.SUPPORTING_EVIDENCE}`,
  );
  lines.push(
    `- Conflicts with the manual pack (manual pack preferred): ${stats.conflictsWithManualPack}`,
  );
  lines.push(`- Gap-fill candidates (cleanly resolved manual gaps): ${stats.gapFillCandidates}`);
  lines.push(
    `- Enrichment candidates: ${stats.classificationCounts.ENRICHMENT_CANDIDATE}; ` +
      `unresolved rows: ${stats.classificationCounts.UNRESOLVED}.`,
  );
  pushResolution(lines, "Match identity resolution", stats.matchResolution);
  pushResolution(lines, "Player identity resolution", stats.playerResolution);
  lines.push("");

  lines.push("## Import recommendation");
  lines.push("");
  lines.push(`**${stats.importRecommendation}**`);
  lines.push("");
  lines.push(
    "Not imported. Cleanly-resolved records are candidates for a future, " +
      "human-approved import only after validation review; conflicting " +
      "records are never applied over the manual verified pack.",
  );
  lines.push("");
  pushNotes(lines, stats);
  return lines.join("\n");
}

/** Human-facing report for the Bustami EFI research/analytics provider. */
export function buildBustamiProviderReportMarkdown(
  result: ProviderEnrichmentResult,
): string {
  const stats = result.bustami;
  const lines: string[] = [];
  pushCommonHeader(lines, "Bustami FIFA EFI Data WC 2026 — Provider Report", result);
  lines.push(
    "Reliability: `RESEARCH_ANALYTICS_CANDIDATE` (priority 5). License: " +
      "**needs review** — the upstream README scopes the data to " +
      "analytical/research purposes only.",
  );
  lines.push("");
  pushFileTable(lines, stats);

  lines.push("## Row counts");
  lines.push("");
  lines.push(`- wc2026_matches rows: ${stats.rowCounts["wc2026_matches.csv"] ?? 0}`);
  lines.push(`- wc2026_players rows: ${stats.rowCounts["wc2026_players.csv"] ?? 0}`);
  lines.push(`- wc2026_efi rows: ${stats.rowCounts["wc2026_efi.csv"] ?? 0}`);
  lines.push("");
  lines.push("Columns detected:");
  lines.push("");
  for (const [file, columns] of Object.entries(stats.columnsDetected).sort()) {
    lines.push(`- \`${file}\`: ${columns.length > 0 ? columns.join(", ") : "(none)"}`);
  }
  lines.push("");

  lines.push("## Mapping coverage");
  lines.push("");
  pushResolution(lines, "FIFA match ID mapping", stats.matchResolution);
  pushResolution(lines, "FIFA player ID mapping", stats.playerResolution);
  lines.push(
    `- Conflicts with verified manual facts (manual pack preferred): ${stats.conflictsWithManualPack}.`,
  );
  lines.push("");

  lines.push("## License / usage warning");
  lines.push("");
  lines.push(
    "⚠️ **The upstream README states this data is for analytical/research " +
      "purposes only.** Every record derived from this provider carries " +
      `\`importBlockedReason: ${BUSTAMI_IMPORT_BLOCKED_REASON}\`. EFI metrics ` +
      "are NOT merged into the core public archive, are NOT import-ready, " +
      "and must not be displayed publicly until a license/usage review " +
      "explicitly clears them.",
  );
  lines.push("");

  lines.push("## Import recommendation");
  lines.push("");
  lines.push(`**${stats.importRecommendation}**`);
  lines.push("");
  lines.push("Not imported. Research/analytics use only until the license review completes.");
  lines.push("");
  pushNotes(lines, stats);
  return lines.join("\n");
}

/** Machine-readable coverage summary (enrichment-coverage-report.json). */
export function buildEnrichmentCoveragePayload(
  result: ProviderEnrichmentResult,
): Record<string, unknown> {
  const providerEntry = (stats: ProviderEnrichmentStats) => ({
    sourceId: stats.sourceId,
    filesFetched: stats.filesFetched,
    filesFailed: stats.filesFailed,
    filesParsed: stats.filesParsed,
    rowCounts: stats.rowCounts,
    parseWarnRows: stats.parseWarnRows,
    parseErrorRows: stats.parseErrorRows,
    columnsDetected: stats.columnsDetected,
    classificationCounts: stats.classificationCounts,
    matchResolution: stats.matchResolution,
    playerResolution: stats.playerResolution,
    conflictsWithManualPack: stats.conflictsWithManualPack,
    gapFillCandidates: stats.gapFillCandidates,
    importRecommendation: stats.importRecommendation,
    importBlockedReason: stats.importBlockedReason,
    notes: stats.notes,
  });
  return {
    generatedAt: result.generatedAt,
    manualPackPresent: result.manualPackPresent,
    policy: {
      databaseWrites: "NONE — Phase 1 never touches the database.",
      publicRendering: "NONE — provider records are not displayed publicly.",
      approvalGate: "data/2026/approved/approval.json remains required for any future import.",
      manualPackAuthority:
        "The manual verified reference pack remains authoritative; provider disagreements are reported as conflicts, never applied.",
    },
    providers: {
      mominul: providerEntry(result.mominul),
      bustami: providerEntry(result.bustami),
    },
    writtenFiles: result.writtenFiles,
  };
}

/** Machine-readable conflict list (enrichment-conflict-report.json). */
export function buildEnrichmentConflictPayload(
  result: ProviderEnrichmentResult,
): Record<string, unknown> {
  return {
    generatedAt: result.generatedAt,
    total: result.conflicts.length,
    resolutionPolicy:
      "Conflicts are reported, never silently resolved. The manual verified reference pack value remains preferred; provider values are never applied over verified records.",
    entries: result.conflicts,
  };
}

/** Writes all four enrichment report files under data/2026/reports/. */
export async function writeEnrichmentReports(
  result: ProviderEnrichmentResult,
  reportsDir: string = REPORTS_2026_DIR,
): Promise<string[]> {
  await mkdir(reportsDir, { recursive: true });
  const outputs: Array<[string, string]> = [
    ["mominul-provider-report.md", buildMominulProviderReportMarkdown(result)],
    ["bustami-efi-provider-report.md", buildBustamiProviderReportMarkdown(result)],
    [
      "enrichment-coverage-report.json",
      JSON.stringify(buildEnrichmentCoveragePayload(result), null, 2),
    ],
    [
      "enrichment-conflict-report.json",
      JSON.stringify(buildEnrichmentConflictPayload(result), null, 2),
    ],
  ];
  const written: string[] = [];
  for (const [fileName, body] of outputs) {
    const filePath = path.join(reportsDir, fileName);
    await writeFile(filePath, `${body}\n`, "utf8");
    written.push(filePath.replace(/\\/g, "/"));
  }
  return written;
}
