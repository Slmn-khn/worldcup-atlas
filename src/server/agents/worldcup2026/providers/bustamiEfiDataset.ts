// Bustami FIFA EFI Data WC 2026 — candidate adapter (Phase 1).
//
// Parses the raw snapshots under data/2026/raw/bustami_fifa_efi_2026/ into
// provider candidate records: FIFA match IDs, FIFA player IDs, and player-
// level Enhanced Football Intelligence metrics.
//
// Trust level: RESEARCH_ANALYTICS_CANDIDATE (priority 5). The upstream README
// scopes the data to analytical/research purposes only, so EVERY normalized
// record derived from this provider carries
// importBlockedReason: RESEARCH_ONLY_UNTIL_LICENSE_REVIEW — it is never
// import-ready, never merged into the core public archive, and never rendered
// publicly until a license/usage review explicitly clears it.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { BUSTAMI_SOURCE_ID, RAW_2026_DIR, getApprovedSource } from "../sourceRegistry";
import type { ProviderCandidateFile } from "../types";
import { parseProviderCsv, type TolerantCsvResult } from "./tolerantCsv";

export { BUSTAMI_SOURCE_ID };

/** Standing legal/usage restriction on every Bustami-derived record. */
export const BUSTAMI_IMPORT_BLOCKED_REASON = "RESEARCH_ONLY_UNTIL_LICENSE_REVIEW";

const BUSTAMI_CSV_REQUIRED: Record<string, string[]> = {
  "wc2026_efi.csv": ["match_id", "fifa_match_id", "player_id", "fifa_player_id", "player_name", "player"],
  "wc2026_matches.csv": ["match_id", "fifa_match_id", "id"],
  "wc2026_players.csv": ["player_id", "fifa_player_id", "id", "player_name", "name"],
};

/** Parses one Bustami CSV body. Pure — unit-tested with inline fixtures. */
export function parseBustamiFile(
  sourceFile: string,
  body: string,
): TolerantCsvResult {
  const candidates = BUSTAMI_CSV_REQUIRED[sourceFile] ?? [];
  const headerProbe = parseProviderCsv({
    sourceId: BUSTAMI_SOURCE_ID,
    sourceFile,
    body,
  });
  const present = candidates.filter((column) =>
    headerProbe.columns.includes(column),
  );
  if (present.length === 0) return headerProbe;
  return parseProviderCsv({
    sourceId: BUSTAMI_SOURCE_ID,
    sourceFile,
    body,
    requiredColumns: present,
  });
}

async function readRawIfPresent(
  rawDir: string,
  outputFile: string,
): Promise<string | null> {
  const filePath = path.join(rawDir, BUSTAMI_SOURCE_ID, outputFile);
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) return null;
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Reads every collected Bustami snapshot and builds one candidate file per
 * source file. Missing snapshots are skipped (recorded by the collector and
 * the provider report). No database writes.
 */
export async function buildBustamiCandidates(
  rawDir: string = RAW_2026_DIR,
): Promise<ProviderCandidateFile[]> {
  const source = getApprovedSource(BUSTAMI_SOURCE_ID);
  const out: ProviderCandidateFile[] = [];
  for (const endpoint of source?.endpoints ?? []) {
    const body = await readRawIfPresent(rawDir, endpoint.outputFile);
    if (body === null) continue;
    const parsed = parseBustamiFile(endpoint.outputFile, body);
    out.push({
      sourceId: BUSTAMI_SOURCE_ID,
      endpointId: endpoint.id,
      sourceFile: endpoint.outputFile,
      generatedAt: new Date().toISOString(),
      columns: parsed.columns,
      fileError: parsed.fileError,
      records: parsed.records,
    });
  }
  return out;
}
