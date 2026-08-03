// Shared read-only inspection helpers for the 2026 candidate providers.
// Reads raw snapshot sidecars, candidate files, and normalized enrichment
// files and prints a summary. Inspection only — no database writes, no
// network calls, no file mutations.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { RAW_2026_DIR } from "../../src/server/agents/worldcup2026/sourceRegistry";
import type {
  ProviderCandidateFile,
  SnapshotMeta,
} from "../../src/server/agents/worldcup2026/types";
import type { EnrichedFile } from "../../src/server/agents/worldcup2026/providers/enrichment";

export async function printRawSummary(sourceId: string): Promise<void> {
  console.log(`Raw snapshots (${RAW_2026_DIR}/${sourceId}):`);
  let files: string[] = [];
  try {
    files = await readdir(path.join(RAW_2026_DIR, sourceId));
  } catch {
    console.log("  (none — run `pnpm data:2026:collect` first)");
    return;
  }
  for (const file of files.filter((f) => f.endsWith(".meta.json")).sort()) {
    try {
      const meta = JSON.parse(
        await readFile(path.join(RAW_2026_DIR, sourceId, file), "utf8"),
      ) as SnapshotMeta;
      console.log(
        `  [${meta.status}] ${meta.endpointId} — ${meta.contentLength} bytes` +
          `${meta.errorMessage !== null ? ` (${meta.errorMessage})` : ""}`,
      );
    } catch {
      console.log(`  [?] ${file} — unreadable sidecar`);
    }
  }
}

export async function printCandidatesSummary(candidatesDir: string): Promise<void> {
  console.log(`\nCandidate files (${candidatesDir}):`);
  let files: string[] = [];
  try {
    files = await readdir(candidatesDir);
  } catch {
    console.log("  (none — run `pnpm data:2026:candidates` first)");
    return;
  }
  for (const file of files.filter((f) => f.endsWith(".candidates.json")).sort()) {
    try {
      const payload = JSON.parse(
        await readFile(path.join(candidatesDir, file), "utf8"),
      ) as ProviderCandidateFile;
      const warn = payload.records.filter((r) => r.parseStatus === "WARN").length;
      const error = payload.records.filter((r) => r.parseStatus === "ERROR").length;
      console.log(
        `  ${file}: ${payload.records.length} rows ` +
          `(${warn} WARN, ${error} ERROR), ${payload.columns.length} columns` +
          `${payload.fileError !== null ? ` — FILE ERROR: ${payload.fileError}` : ""}`,
      );
    } catch {
      console.log(`  ${file}: unreadable`);
    }
  }
}

export async function printEnrichedSummary(normalizedDir: string): Promise<void> {
  console.log(`\nNormalized enrichment files (${normalizedDir}):`);
  let files: string[] = [];
  try {
    files = await readdir(normalizedDir);
  } catch {
    console.log("  (none — run `pnpm data:2026:normalize` first)");
    return;
  }
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const payload = JSON.parse(
        await readFile(path.join(normalizedDir, file), "utf8"),
      ) as EnrichedFile;
      const byClassification = new Map<string, number>();
      for (const record of payload.records) {
        byClassification.set(
          record.classification,
          (byClassification.get(record.classification) ?? 0) + 1,
        );
      }
      const detail = [...byClassification.entries()]
        .sort()
        .map(([classification, count]) => `${classification}: ${count}`)
        .join(", ");
      console.log(
        `  ${file}: ${payload.records.length} records (${detail || "empty"})`,
      );
    } catch {
      console.log(`  ${file}: unreadable`);
    }
  }
}
