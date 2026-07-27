// Mominul FIFA World Cup 2026 Dataset — candidate adapter (Phase 1).
//
// Parses the raw snapshots under data/2026/raw/mominul_2026_dataset/ into
// provider candidate records. Candidate extraction only: rows are coerced
// (empty → null, safe numerics → numbers) but never merged, never imported,
// and never rendered publicly. Malformed rows become WARN/ERROR records —
// they are kept, not dropped.
//
// Trust level: OPEN_DATA_CANDIDATE (priority 3). Core matches may become
// gap-fill candidates when they resolve cleanly against the archive; player/
// event/lineup/stat rows remain enrichment candidates only. The manual
// verified reference pack stays authoritative for tournament outcome, the
// final, awards, and known conflicts.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { MOMINUL_SOURCE_ID, RAW_2026_DIR, getApprovedSource } from "../sourceRegistry";
import type { ProviderCandidateFile } from "../types";
import {
  parseProviderCsv,
  parseProviderJson,
  type TolerantCsvResult,
} from "./tolerantCsv";

export { MOMINUL_SOURCE_ID };

/**
 * Per-file parse configuration. `requiredColumns` lists the column-name
 * candidates that identify a usable row (matched against whichever are
 * actually present in the header — community CSV headers drift).
 */
const MOMINUL_CSV_REQUIRED: Record<string, string[]> = {
  "teams.csv": ["team_id", "id", "team_name", "name", "team"],
  "venues.csv": ["venue_id", "id", "venue_name", "name", "stadium"],
  "tournament_stages.csv": ["stage_id", "id", "stage_name", "name", "stage"],
  "referees.csv": ["referee_id", "id", "referee_name", "name"],
  "matches.csv": ["match_id", "id", "home_team", "home_team_id", "home"],
  "matches_detailed.csv": ["match_id", "id", "home_team", "home_team_id", "home"],
  "squads_and_players.csv": ["player_id", "id", "player_name", "name", "player"],
  "match_events.csv": ["event_id", "id", "match_id", "event_type", "event"],
  "match_team_stats.csv": ["match_id", "id", "team_id", "team"],
  "match_lineups.csv": ["match_id", "id", "player_id", "player_name", "player"],
  "player_stats.csv": ["player_id", "id", "player_name", "name", "player"],
};

/**
 * Parses one Mominul file body. Pure — unit-tested with inline fixtures.
 * Required columns are narrowed to the ones the header actually carries, so
 * a rename in the upstream repo degrades to warnings, not mass ERROR rows.
 */
export function parseMominulFile(
  sourceFile: string,
  body: string,
): TolerantCsvResult {
  if (sourceFile.endsWith(".json")) {
    return parseProviderJson({ sourceId: MOMINUL_SOURCE_ID, sourceFile, body });
  }
  const candidates = MOMINUL_CSV_REQUIRED[sourceFile] ?? [];
  const headerProbe = parseProviderCsv({
    sourceId: MOMINUL_SOURCE_ID,
    sourceFile,
    body,
  });
  const present = candidates.filter((column) =>
    headerProbe.columns.includes(column),
  );
  if (present.length === 0) return headerProbe;
  return parseProviderCsv({
    sourceId: MOMINUL_SOURCE_ID,
    sourceFile,
    body,
    requiredColumns: present,
  });
}

async function readRawIfPresent(
  rawDir: string,
  outputFile: string,
): Promise<string | null> {
  const filePath = path.join(rawDir, MOMINUL_SOURCE_ID, outputFile);
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) return null;
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Reads every collected Mominul snapshot and builds one candidate file per
 * source file. Missing snapshots (failed/never-collected endpoints) are
 * skipped — the collector's .meta.json sidecars and the provider report
 * already record them. No database writes.
 */
export async function buildMominulCandidates(
  rawDir: string = RAW_2026_DIR,
): Promise<ProviderCandidateFile[]> {
  const source = getApprovedSource(MOMINUL_SOURCE_ID);
  const out: ProviderCandidateFile[] = [];
  for (const endpoint of source?.endpoints ?? []) {
    const body = await readRawIfPresent(rawDir, endpoint.outputFile);
    if (body === null) continue;
    const parsed = parseMominulFile(endpoint.outputFile, body);
    out.push({
      sourceId: MOMINUL_SOURCE_ID,
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
