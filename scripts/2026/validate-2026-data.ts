// Validates the normalized 2026 data set and writes the validation reports
// plus the human-facing Markdown steward report. Deterministic — same inputs,
// same verdict. No database access, no network.
//
// Usage:
//   pnpm data:2026:validate                  # exit 1 on FAIL
//   pnpm data:2026:validate --allow-failures # always exit 0
//
// Outputs:
//   data/2026/validation/validation-report.json
//   data/2026/validation/conflict-report.json
//   data/2026/validation/source-coverage-report.json
//   data/2026/reports/2026-data-steward-report.md

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  loadManualReferencePack,
} from "../../src/server/agents/worldcup2026/manualReferencePack";
import {
  buildSourceCoverage,
  buildStewardReportMarkdown,
  importReadiness,
  type EnrichmentProviderSummary,
} from "../../src/server/agents/worldcup2026/reports";
import {
  APPROVED_2026_SOURCES,
  CANDIDATES_2026_DIR,
  RAW_2026_DIR,
  REPORTS_2026_DIR,
  VALIDATION_2026_DIR,
} from "../../src/server/agents/worldcup2026/sourceRegistry";
import type {
  CandidateFile,
  RawSourceRef,
  SnapshotMeta,
} from "../../src/server/agents/worldcup2026/types";
import { validateNormalizedDir } from "../../src/server/agents/worldcup2026/validator";

const allowFailures = process.argv.includes("--allow-failures");

async function readSnapshotMetas(): Promise<SnapshotMeta[]> {
  const metas: SnapshotMeta[] = [];
  let sourceDirs: string[] = [];
  try {
    sourceDirs = await readdir(RAW_2026_DIR);
  } catch {
    return metas;
  }
  for (const dir of sourceDirs.sort()) {
    let files: string[] = [];
    try {
      files = await readdir(path.join(RAW_2026_DIR, dir));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      if (!file.endsWith(".meta.json")) continue;
      try {
        metas.push(
          JSON.parse(
            await readFile(path.join(RAW_2026_DIR, dir, file), "utf8"),
          ) as SnapshotMeta,
        );
      } catch {
        // ignore unreadable sidecars; coverage shows the gap
      }
    }
  }
  return metas;
}

/** Per-source candidate record counts, for the coverage report. */
async function readCandidateCounts(): Promise<Record<string, Record<string, number>>> {
  const counts: Record<string, Record<string, number>> = {};
  const files: Array<[string, string]> = [
    ["teams", "teams.candidates.json"],
    ["groups", "groups.candidates.json"],
    ["venues", "venues.candidates.json"],
    ["matches", "matches.candidates.json"],
    ["standings", "standings.candidates.json"],
  ];
  for (const [kind, fileName] of files) {
    let payload: CandidateFile<{ sourceRef: RawSourceRef }> | null = null;
    try {
      payload = JSON.parse(
        await readFile(path.join(CANDIDATES_2026_DIR, fileName), "utf8"),
      ) as CandidateFile<{ sourceRef: RawSourceRef }>;
    } catch {
      continue;
    }
    for (const record of payload.records) {
      const sourceId = record.sourceRef?.sourceId ?? "unknown";
      counts[sourceId] = counts[sourceId] ?? {};
      counts[sourceId][kind] = (counts[sourceId][kind] ?? 0) + 1;
    }
  }
  return counts;
}

/** Reads the enrichment coverage report written by the normalize step. */
async function readEnrichmentProviders(): Promise<EnrichmentProviderSummary[]> {
  try {
    const payload = JSON.parse(
      await readFile(
        path.join(REPORTS_2026_DIR, "enrichment-coverage-report.json"),
        "utf8",
      ),
    ) as { providers?: Record<string, EnrichmentProviderSummary> };
    return Object.values(payload.providers ?? {});
  } catch {
    return [];
  }
}

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: validate\n");

  const { report, data } = await validateNormalizedDir();
  const snapshots = await readSnapshotMetas();
  const coverage = buildSourceCoverage(APPROVED_2026_SOURCES, snapshots);
  const candidateCounts = await readCandidateCounts();
  // Manual reference pack (read-only) for the report's pack section.
  const packLoad = await loadManualReferencePack();
  const manualReferencePack = packLoad?.ok === true ? packLoad.pack : null;

  await mkdir(VALIDATION_2026_DIR, { recursive: true });
  await mkdir(REPORTS_2026_DIR, { recursive: true });

  await writeFile(
    path.join(VALIDATION_2026_DIR, "validation-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(VALIDATION_2026_DIR, "conflict-report.json"),
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        total: data.conflicts.length,
        entries: data.conflicts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(VALIDATION_2026_DIR, "source-coverage-report.json"),
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        coverage,
        candidateCounts,
        manualPack: report.manualPack,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const markdown = buildStewardReportMarkdown({
    validation: report,
    data,
    coverage,
    candidateCounts,
    manualReferencePack,
    enrichmentProviders: await readEnrichmentProviders(),
  });
  await writeFile(
    path.join(REPORTS_2026_DIR, "2026-data-steward-report.md"),
    markdown,
    "utf8",
  );

  const readiness = importReadiness(report);
  console.log(`Status: ${report.status}`);
  console.log(
    `Errors: ${report.errors.length}  Warnings: ${report.warnings.length}  Conflicts: ${report.conflicts.length}`,
  );
  console.log(`Verdict: ${readiness.headline}`);
  console.log(`\nReports written to ${VALIDATION_2026_DIR} and ${REPORTS_2026_DIR}.`);

  if (report.status === "FAIL" && !allowFailures) {
    console.error(
      "\nValidation FAILED. Re-run with --allow-failures to exit 0 anyway.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Validation crashed unexpectedly:", error);
  process.exitCode = 1;
});
