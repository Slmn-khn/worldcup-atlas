// Approved Mominul 2026 import CLI.
//
//   pnpm data:2026:mominul:import          → DRY-RUN (default; zero DB access)
//   pnpm data:2026:mominul:import:write    → WRITE (gated)
//
// Write mode refuses unless CONFIRM_2026_MOMINUL_IMPORT="true", and under
// NODE_ENV=production additionally requires --confirm-production. Reports are
// written to data/2026/reports/ either way.

import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createScriptPrismaClient } from "../import/utils/db";
import {
  runMominulImport,
  type MominulImportResult,
} from "../../src/server/agents/worldcup2026/mominulImporter";
import { DATA_2026_DIR } from "../../src/server/agents/worldcup2026/sourceRegistry";

const REPORTS_DIR = path.join(DATA_2026_DIR, "reports");

function renderMarkdown(result: MominulImportResult, generatedAt: string): string {
  const lines: string[] = [
    `# Mominul 2026 approved import — ${result.mode === "DRY_RUN" ? "dry-run preview" : "write result"}`,
    "",
    `- Generated: ${generatedAt}`,
    `- Source: \`${result.sourceId}\``,
    `- Outcome: ${result.ok ? "OK" : `REFUSED/FAILED${result.refusedBy !== null ? ` (${result.refusedBy})` : ""}`}`,
    result.batchId !== null ? `- Import batch: \`${result.batchId}\`` : "- Import batch: none (no writes)",
    "",
    "| Entity | Planned | Created | Updated | Skipped |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [entity, row] of Object.entries(result.counts)) {
    lines.push(
      `| ${entity} | ${row.planned} | ${row.created} | ${row.updated} | ${row.skipped} |`,
    );
  }
  if (result.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...result.warnings.map((w) => `- ${w}`));
  }
  if (result.errors.length > 0) {
    lines.push("", "## Errors", "", ...result.errors.map((e) => `- ${e}`));
  }
  lines.push(
    "",
    "Mominul-only import policy: no OpenFootball, worldcup26, Bustami EFI,",
    "manual-pack, or ML prediction-feature rows are imported.",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const dryRun = !write;
  const confirmProduction = args.includes("--confirm-production");

  console.log(
    `WORLDCUP Nexus — Mominul 2026 import (${dryRun ? "DRY-RUN" : "WRITE"})\n`,
  );

  // Dry-run never constructs a database client at all.
  const prisma = dryRun ? null : createScriptPrismaClient();
  let result: MominulImportResult;
  try {
    result = await runMominulImport(prisma, { dryRun, confirmProduction });
  } finally {
    await prisma?.$disconnect();
  }

  console.log(`Outcome: ${result.ok ? "OK" : "REFUSED/FAILED"}`);
  if (result.refusedBy !== null) console.log(`Gate: ${result.refusedBy}`);
  for (const [entity, row] of Object.entries(result.counts)) {
    console.log(
      `  ${entity.padEnd(16)} planned ${String(row.planned).padStart(5)}  created ${String(row.created).padStart(5)}  updated ${String(row.updated).padStart(5)}  skipped ${String(row.skipped).padStart(3)}`,
    );
  }
  for (const warning of result.warnings) console.log(`  [WARN] ${warning}`);
  for (const error of result.errors) console.error(`  [ERROR] ${error}`);

  const generatedAt = new Date().toISOString();
  const baseName = dryRun
    ? "mominul-approved-import-preview"
    : "mominul-approved-import-result";
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(
    path.join(REPORTS_DIR, `${baseName}.json`),
    `${JSON.stringify({ generatedAt, ...result }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(REPORTS_DIR, `${baseName}.md`),
    renderMarkdown(result, generatedAt),
    "utf8",
  );
  console.log(`\nReport: data/2026/reports/${baseName}.md`);

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "\nImport run failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
