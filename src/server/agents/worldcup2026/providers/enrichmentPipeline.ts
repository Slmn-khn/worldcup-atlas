// Provider enrichment pipeline for the 2026 data steward agent (Phase 1).
//
// raw snapshots → provider candidates → normalized enrichment files under
// data/2026/normalized/mominul/ and data/2026/normalized/bustami/, plus the
// per-provider stats consumed by the enrichment reports.
//
// Hard guarantees, same as the rest of the steward:
//   - no database writes, no network calls — files under data/2026/ only,
//   - the manual verified reference pack stays authoritative (providers can
//     corroborate, conflict, or gap-fill; they never override),
//   - nothing produced here is import-ready or publicly rendered; the
//     data/2026/approved/approval.json gate is untouched.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildMatchIdentityIndex,
  referenceMatchSignature,
  type ReferenceMatch,
} from "../matchIdentity";
import {
  buildPlayerIdentityIndex,
  resolvePlayer,
  type ReferencePlayer,
} from "../playerIdentity";
import {
  loadManualReferencePack,
  type ManualReferencePack,
} from "../manualReferencePack";
import { canonicalTeamKey } from "../resolver";
import {
  BUSTAMI_NORMALIZED_DIR,
  BUSTAMI_SOURCE_ID,
  MOMINUL_NORMALIZED_DIR,
  MOMINUL_SOURCE_ID,
  NORMALIZED_2026_DIR,
  RAW_2026_DIR,
} from "../sourceRegistry";
import type {
  ConflictEntry,
  ProviderCandidateFile,
  ProviderCandidateRecord,
  SnapshotMeta,
  StewardDataKind,
} from "../types";
import { BUSTAMI_IMPORT_BLOCKED_REASON, buildBustamiCandidates } from "./bustamiEfiDataset";
import {
  classifyBustamiRow,
  classifyProviderMatch,
  extractPackFacts,
  type EnrichedFile,
  type EnrichedRecord,
  type EnrichmentClassification,
} from "./enrichment";
import { buildMominulCandidates } from "./mominulDataset";
import { pickInt, pickString } from "./tolerantCsv";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type ProviderEnrichmentStats = {
  sourceId: string;
  /** From the collector's .meta.json sidecars. */
  filesFetched: number;
  filesFailed: number;
  /** Candidate files successfully parsed (fileError === null). */
  filesParsed: number;
  rowCounts: Record<string, number>;
  parseWarnRows: number;
  parseErrorRows: number;
  columnsDetected: Record<string, string[]>;
  classificationCounts: Record<EnrichmentClassification, number>;
  matchResolution: { total: number; resolved: number; byConfidence: Record<string, number> };
  playerResolution: { total: number; resolved: number; byConfidence: Record<string, number> };
  conflictsWithManualPack: number;
  gapFillCandidates: number;
  importRecommendation: string;
  importBlockedReason: string | null;
  notes: string[];
};

export type ProviderEnrichmentResult = {
  generatedAt: string;
  manualPackPresent: boolean;
  mominul: ProviderEnrichmentStats;
  bustami: ProviderEnrichmentStats;
  conflicts: ConflictEntry[];
  /** Enriched files written, keyed by repo-relative path. */
  writtenFiles: string[];
};

export const MOMINUL_IMPORT_RECOMMENDATION =
  "CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION";
export const BUSTAMI_IMPORT_RECOMMENDATION =
  "RESEARCH_ONLY_UNTIL_LICENSE_REVIEW";

const SHARED_POLICY = [
  "Candidate/normalized/report output only — never written to the database.",
  "Never rendered publicly in this phase.",
  "Never auto-approved: any future import requires data/2026/approved/approval.json.",
  "The manual verified reference pack remains authoritative for tournament outcome, the final, awards, and known conflicts.",
];

function emptyStats(
  sourceId: string,
  importRecommendation: string,
  importBlockedReason: string | null,
): ProviderEnrichmentStats {
  return {
    sourceId,
    filesFetched: 0,
    filesFailed: 0,
    filesParsed: 0,
    rowCounts: {},
    parseWarnRows: 0,
    parseErrorRows: 0,
    columnsDetected: {},
    classificationCounts: {
      SUPPORTING_EVIDENCE: 0,
      GAP_FILL_CANDIDATE: 0,
      ENRICHMENT_CANDIDATE: 0,
      ADVANCED_ANALYTICS_CANDIDATE: 0,
      CONFLICT: 0,
      UNRESOLVED: 0,
    },
    matchResolution: { total: 0, resolved: 0, byConfidence: {} },
    playerResolution: { total: 0, resolved: 0, byConfidence: {} },
    conflictsWithManualPack: 0,
    gapFillCandidates: 0,
    importRecommendation,
    importBlockedReason,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Raw snapshot sidecars (files fetched / failed)
// ---------------------------------------------------------------------------

async function readSnapshotMetas(
  rawDir: string,
  sourceId: string,
): Promise<SnapshotMeta[]> {
  const metas: SnapshotMeta[] = [];
  let files: string[] = [];
  try {
    files = await readdir(path.join(rawDir, sourceId));
  } catch {
    return metas;
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".meta.json")) continue;
    try {
      metas.push(
        JSON.parse(
          await readFile(path.join(rawDir, sourceId, file), "utf8"),
        ) as SnapshotMeta,
      );
    } catch {
      // Unreadable sidecar — the coverage numbers just miss this endpoint.
    }
  }
  return metas;
}

// ---------------------------------------------------------------------------
// Reference sets (manual pack + normalized archive baseline)
// ---------------------------------------------------------------------------

type NormalizedMatchRow = {
  matchNumber?: number | null;
  sourceMatchId?: string | null;
  stage?: string | null;
  kickoffDateLabel?: string | null;
  kickoffAtUtc?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
};

async function loadNormalizedMatches(
  normalizedDir: string,
): Promise<NormalizedMatchRow[]> {
  try {
    const payload = JSON.parse(
      await readFile(path.join(normalizedDir, "matches.json"), "utf8"),
    ) as { records?: NormalizedMatchRow[] };
    return Array.isArray(payload.records) ? payload.records : [];
  } catch {
    return [];
  }
}

/** Builds the combined reference match set. Pack keys are the pack match ids. */
export function buildReferenceMatches(
  pack: ManualReferencePack | null,
  normalizedMatches: NormalizedMatchRow[],
): ReferenceMatch[] {
  const references: ReferenceMatch[] = [];
  const nameByCode = new Map<string, string>();
  for (const team of pack?.teams ?? []) {
    if (team.code !== null && team.name !== null) nameByCode.set(team.code, team.name);
  }
  for (const match of pack?.matches ?? []) {
    const numeric = /^M(\d+)$/.exec(match.match_id);
    references.push({
      key: match.match_id,
      matchIds: numeric !== null ? [match.match_id, numeric[1]] : [match.match_id],
      date: match.date ?? null,
      homeTeam: match.home != null ? (nameByCode.get(match.home) ?? match.home) : null,
      awayTeam: match.away != null ? (nameByCode.get(match.away) ?? match.away) : null,
      stage: match.stage,
    });
  }
  const packKeys = new Set(references.map((reference) => reference.key));
  // Pack matches and normalized archive matches frequently describe the SAME
  // real-world match under different keys — dedupe by key AND by team-pair +
  // date signature, or the duplicate would poison the unique lookups.
  const packSignatures = new Set(
    references
      .map((reference) => referenceMatchSignature(reference))
      .filter((signature): signature is string => signature !== null),
  );
  normalizedMatches.forEach((match, index) => {
    const key =
      match.matchNumber != null
        ? `M${match.matchNumber}`
        : `norm:${match.sourceMatchId ?? index}`;
    if (packKeys.has(key)) return;
    const signature = referenceMatchSignature({
      date: match.kickoffDateLabel ?? match.kickoffAtUtc ?? null,
      homeTeam: match.homeTeamName ?? null,
      awayTeam: match.awayTeamName ?? null,
    });
    if (signature !== null && packSignatures.has(signature)) return;
    references.push({
      key,
      matchIds: [match.matchNumber, match.sourceMatchId],
      date: match.kickoffDateLabel ?? match.kickoffAtUtc ?? null,
      homeTeam: match.homeTeamName ?? null,
      awayTeam: match.awayTeamName ?? null,
      stage: match.stage ?? null,
    });
  });
  return references;
}

// ---------------------------------------------------------------------------
// Field pickers (defensive against upstream header drift)
// ---------------------------------------------------------------------------

const MATCH_ID_KEYS = ["match_id", "matchid", "id"];
const FIFA_MATCH_ID_KEYS = ["fifa_match_id", "fifa_id", "fifa_matchid"];
const DATE_KEYS = ["date", "match_date", "utc_date", "datetime", "kickoff", "kickoff_utc"];
// "group" last: some providers reuse a `group` column for stage tokens
// ("Group A", "Round of 32"); a bare letter normalizes to UNKNOWN harmlessly.
const STAGE_KEYS = ["stage", "stage_name", "round", "phase", "type", "group"];
const HOME_KEYS = ["home_team", "home_team_name", "home", "team1", "home_team_code"];
const AWAY_KEYS = ["away_team", "away_team_name", "away", "team2", "away_team_code"];
const HOME_SCORE_KEYS = ["home_score", "home_goals", "score_home", "home_team_score"];
const AWAY_SCORE_KEYS = ["away_score", "away_goals", "score_away", "away_team_score"];
const TEAM_ID_KEYS = ["team_id", "id"];
const TEAM_NAME_KEYS = ["team_name", "name", "team", "country"];
const PLAYER_ID_KEYS = ["player_id", "fifa_player_id", "id_player", "id"];
const PLAYER_NAME_KEYS = ["player_name", "name", "player", "full_name"];
const PLAYER_TEAM_KEYS = ["team", "team_name", "team_code", "country", "nationality"];

function matchRowQuery(
  record: ProviderCandidateRecord,
  teamNameById: Map<string, string>,
): {
  query: {
    matchId: string | null;
    fifaMatchId: string | null;
    date: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    stage: string | null;
  };
  homeScore: number | null;
  awayScore: number | null;
} {
  const parsed = record.parsed;
  const teamFrom = (nameKeys: string[], idKeys: string[]): string | null => {
    const direct = pickString(parsed, nameKeys);
    if (direct !== null) return direct;
    const id = pickString(parsed, idKeys);
    return id !== null ? (teamNameById.get(id) ?? null) : null;
  };
  return {
    query: {
      matchId: pickString(parsed, MATCH_ID_KEYS),
      fifaMatchId: pickString(parsed, FIFA_MATCH_ID_KEYS),
      date: pickString(parsed, DATE_KEYS),
      homeTeam: teamFrom(HOME_KEYS, ["home_team_id"]),
      awayTeam: teamFrom(AWAY_KEYS, ["away_team_id"]),
      stage: pickString(parsed, STAGE_KEYS),
    },
    homeScore: pickInt(parsed, HOME_SCORE_KEYS),
    awayScore: pickInt(parsed, AWAY_SCORE_KEYS),
  };
}

// ---------------------------------------------------------------------------
// Enrichment builders
// ---------------------------------------------------------------------------

type StatsAccumulator = {
  stats: ProviderEnrichmentStats;
  conflicts: ConflictEntry[];
};

function countClassification(
  acc: StatsAccumulator,
  classification: EnrichmentClassification,
): void {
  acc.stats.classificationCounts[classification] += 1;
  if (classification === "GAP_FILL_CANDIDATE") acc.stats.gapFillCandidates += 1;
}

function recordFileStats(
  acc: StatsAccumulator,
  file: ProviderCandidateFile,
): void {
  acc.stats.rowCounts[file.sourceFile] = file.records.length;
  acc.stats.columnsDetected[file.sourceFile] = file.columns;
  if (file.fileError === null) acc.stats.filesParsed += 1;
  else acc.stats.notes.push(`${file.sourceFile}: ${file.fileError}`);
  for (const record of file.records) {
    if (record.parseStatus === "WARN") acc.stats.parseWarnRows += 1;
    if (record.parseStatus === "ERROR") acc.stats.parseErrorRows += 1;
  }
}

function usableRows(file: ProviderCandidateFile): ProviderCandidateRecord[] {
  return file.records.filter((record) => record.parseStatus !== "ERROR");
}

function baseRecord(
  record: ProviderCandidateRecord,
  kind: StewardDataKind,
  classification: EnrichmentClassification,
  importBlockedReason: string | null,
): EnrichedRecord {
  return {
    sourceId: record.sourceId,
    kind,
    sourceFile: record.sourceFile,
    sourceRowNumber: record.sourceRowNumber,
    data: record.parsed,
    classification,
    importReady: false,
    importBlockedReason,
    warnings: [...record.warnings],
  };
}

function enrichedFile(
  sourceId: string,
  kind: StewardDataKind,
  records: EnrichedRecord[],
  extraPolicy: string[] = [],
): EnrichedFile {
  return {
    sourceId,
    kind,
    generatedAt: new Date().toISOString(),
    policy: [...SHARED_POLICY, ...extraPolicy],
    records,
  };
}

function trackResolution(
  target: { total: number; resolved: number; byConfidence: Record<string, number> },
  confidence: string,
): void {
  target.total += 1;
  target.byConfidence[confidence] = (target.byConfidence[confidence] ?? 0) + 1;
  if (confidence !== "UNRESOLVED") target.resolved += 1;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type ProviderEnrichmentOptions = {
  rawDir?: string;
  normalizedDir?: string;
  mominulOutDir?: string;
  bustamiOutDir?: string;
  manualPackDir?: string;
};

export async function runProviderEnrichment(
  options: ProviderEnrichmentOptions = {},
): Promise<ProviderEnrichmentResult> {
  const rawDir = options.rawDir ?? RAW_2026_DIR;
  const normalizedDir = options.normalizedDir ?? NORMALIZED_2026_DIR;
  const mominulOutDir = options.mominulOutDir ?? MOMINUL_NORMALIZED_DIR;
  const bustamiOutDir = options.bustamiOutDir ?? BUSTAMI_NORMALIZED_DIR;

  const packLoad = await loadManualReferencePack(options.manualPackDir);
  const pack = packLoad?.ok === true ? packLoad.pack : null;
  const packFacts = extractPackFacts(pack);
  const normalizedMatches = await loadNormalizedMatches(normalizedDir);
  const matchIndex = buildMatchIdentityIndex(
    buildReferenceMatches(pack, normalizedMatches),
  );

  const mominul: StatsAccumulator = {
    stats: emptyStats(MOMINUL_SOURCE_ID, MOMINUL_IMPORT_RECOMMENDATION, null),
    conflicts: [],
  };
  const bustami: StatsAccumulator = {
    stats: emptyStats(
      BUSTAMI_SOURCE_ID,
      BUSTAMI_IMPORT_RECOMMENDATION,
      BUSTAMI_IMPORT_BLOCKED_REASON,
    ),
    conflicts: [],
  };

  for (const [acc, sourceId] of [
    [mominul, MOMINUL_SOURCE_ID],
    [bustami, BUSTAMI_SOURCE_ID],
  ] as const) {
    const metas = await readSnapshotMetas(rawDir, sourceId);
    acc.stats.filesFetched = metas.filter((meta) => meta.status === "OK").length;
    acc.stats.filesFailed = metas.filter((meta) => meta.status === "FAILED").length;
    for (const meta of metas) {
      if (meta.status === "FAILED") {
        acc.stats.notes.push(
          `Fetch failed: ${meta.endpointId} (${meta.errorMessage ?? "unknown error"}).`,
        );
      }
    }
  }

  const writtenFiles: string[] = [];
  const writeEnriched = async (
    dir: string,
    fileName: string,
    payload: EnrichedFile,
  ): Promise<void> => {
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    writtenFiles.push(filePath.replace(/\\/g, "/"));
  };

  // ── Mominul ──────────────────────────────────────────────────────────────
  const mominulFiles = await buildMominulCandidates(rawDir);
  const byFile = new Map(mominulFiles.map((file) => [file.sourceFile, file]));
  for (const file of mominulFiles) recordFileStats(mominul, file);

  const teamNameById = new Map<string, string>();
  const verifiedPackTeamKeys = new Set<string>();
  for (const team of pack?.teams ?? []) {
    if (team.verification === "verified" && team.name !== null) {
      const key = canonicalTeamKey(team.name, { fifaCode: team.code });
      if (key !== null) verifiedPackTeamKeys.add(key);
    }
  }

  const simpleKinds: Array<{
    sourceFile: string;
    outFile: string;
    kind: StewardDataKind;
  }> = [
    { sourceFile: "teams.csv", outFile: "enriched-teams.json", kind: "teams" },
    { sourceFile: "venues.csv", outFile: "enriched-venues.json", kind: "venues" },
    { sourceFile: "referees.csv", outFile: "enriched-referees.json", kind: "referees" },
    { sourceFile: "squads_and_players.csv", outFile: "enriched-squads.json", kind: "squads" },
    { sourceFile: "match_lineups.csv", outFile: "enriched-lineups.json", kind: "lineups" },
    { sourceFile: "match_events.csv", outFile: "enriched-match-events.json", kind: "match_events" },
    { sourceFile: "player_stats.csv", outFile: "enriched-player-stats.json", kind: "player_stats" },
    { sourceFile: "match_team_stats.csv", outFile: "enriched-team-match-stats.json", kind: "team_match_stats" },
  ];

  // teams.csv id → name map feeds match/team-stat rows that reference ids.
  const teamsFile = byFile.get("teams.csv");
  for (const record of teamsFile !== undefined ? usableRows(teamsFile) : []) {
    const id = pickString(record.parsed, TEAM_ID_KEYS);
    const name = pickString(record.parsed, TEAM_NAME_KEYS);
    if (id !== null && name !== null) teamNameById.set(id, name);
  }

  // Mominul player identity index (from the squads file) for player-linked
  // rows. Ambiguous names resolve to UNRESOLVED and are never merged.
  const squadFile = byFile.get("squads_and_players.csv");
  const mominulPlayers: ReferencePlayer[] = [];
  for (const record of squadFile !== undefined ? usableRows(squadFile) : []) {
    const providerId = pickString(record.parsed, PLAYER_ID_KEYS);
    const name = pickString(record.parsed, PLAYER_NAME_KEYS);
    if (providerId === null && name === null) continue;
    mominulPlayers.push({
      key: `mominul:player:${providerId ?? `${name}#row${record.sourceRowNumber}`}`,
      providerIds: [providerId],
      name,
      team:
        pickString(record.parsed, PLAYER_TEAM_KEYS) ??
        (() => {
          const teamId = pickString(record.parsed, ["team_id"]);
          return teamId !== null ? (teamNameById.get(teamId) ?? null) : null;
        })(),
    });
  }
  const mominulPlayerIndex = buildPlayerIdentityIndex(mominulPlayers);

  for (const { sourceFile, outFile, kind } of simpleKinds) {
    const file = byFile.get(sourceFile);
    if (file === undefined) continue;
    const records: EnrichedRecord[] = file.records.map((record) => {
      if (record.parseStatus === "ERROR") {
        const enriched = baseRecord(record, kind, "UNRESOLVED", null);
        countClassification(mominul, "UNRESOLVED");
        return enriched;
      }
      let classification: EnrichmentClassification = "ENRICHMENT_CANDIDATE";
      const enriched = baseRecord(record, kind, classification, null);
      if (kind === "teams") {
        const key = canonicalTeamKey(pickString(record.parsed, TEAM_NAME_KEYS), {
          fifaCode: pickString(record.parsed, ["fifa_code", "team_code", "code"]),
        });
        if (key !== null && verifiedPackTeamKeys.has(key)) {
          classification = "SUPPORTING_EVIDENCE";
        }
      }
      if (kind === "squads" || kind === "lineups" || kind === "player_stats") {
        const resolution = resolvePlayer(mominulPlayerIndex, {
          providerId: pickString(record.parsed, PLAYER_ID_KEYS),
          name: pickString(record.parsed, PLAYER_NAME_KEYS),
          team: pickString(record.parsed, PLAYER_TEAM_KEYS),
        });
        enriched.playerResolution = resolution;
        trackResolution(mominul.stats.playerResolution, resolution.confidence);
        if (resolution.ambiguous) {
          enriched.warnings.push(resolution.note ?? "Ambiguous player identity — not merged.");
        }
      }
      enriched.classification = classification;
      countClassification(mominul, classification);
      return enriched;
    });
    await writeEnriched(
      mominulOutDir,
      outFile,
      enrichedFile(MOMINUL_SOURCE_ID, kind, records, [
        "Enrichment candidates only — no import model exists for this kind in Phase 1.",
      ]),
    );
  }

  // Matches: matches.csv + matches_detailed.csv + real_match_details.json.
  const matchRecords: EnrichedRecord[] = [];
  for (const sourceFile of ["matches.csv", "matches_detailed.csv", "real_match_details.json"]) {
    const file = byFile.get(sourceFile);
    if (file === undefined) continue;
    for (const record of file.records) {
      if (record.parseStatus === "ERROR") {
        matchRecords.push(baseRecord(record, "matches", "UNRESOLVED", null));
        countClassification(mominul, "UNRESOLVED");
        continue;
      }
      const { query, homeScore, awayScore } = matchRowQuery(record, teamNameById);
      const result = classifyProviderMatch(matchIndex, packFacts, {
        sourceId: MOMINUL_SOURCE_ID,
        sourceFile,
        sourceRowNumber: record.sourceRowNumber,
        query,
        homeScore,
        awayScore,
      });
      const enriched = baseRecord(record, "matches", result.classification, null);
      enriched.matchResolution = result.resolution;
      enriched.warnings.push(...result.warnings);
      matchRecords.push(enriched);
      countClassification(mominul, result.classification);
      trackResolution(mominul.stats.matchResolution, result.resolution.confidence);
      if (result.conflict !== null) mominul.conflicts.push(result.conflict);
    }
  }
  if (byFile.has("matches.csv") || byFile.has("matches_detailed.csv") || byFile.has("real_match_details.json")) {
    await writeEnriched(
      mominulOutDir,
      "enriched-matches.json",
      enrichedFile(MOMINUL_SOURCE_ID, "matches", matchRecords, [
        "Cleanly-resolved matches are gap-fill CANDIDATES only; verified manual pack results always win.",
      ]),
    );
  }

  // ── Bustami ──────────────────────────────────────────────────────────────
  const bustamiFiles = await buildBustamiCandidates(rawDir);
  const bustamiByFile = new Map(bustamiFiles.map((file) => [file.sourceFile, file]));
  for (const file of bustamiFiles) recordFileStats(bustami, file);

  const bustamiPlayers: ReferencePlayer[] = [];
  const playersFile = bustamiByFile.get("wc2026_players.csv");
  for (const record of playersFile !== undefined ? usableRows(playersFile) : []) {
    const providerId = pickString(record.parsed, PLAYER_ID_KEYS);
    const name = pickString(record.parsed, PLAYER_NAME_KEYS);
    if (providerId === null && name === null) continue;
    bustamiPlayers.push({
      key: `bustami:player:${providerId ?? `${name}#row${record.sourceRowNumber}`}`,
      providerIds: [providerId],
      name,
      team: pickString(record.parsed, PLAYER_TEAM_KEYS),
    });
  }
  const bustamiPlayerIndex = buildPlayerIdentityIndex(bustamiPlayers);

  const bustamiKinds: Array<{
    sourceFile: string;
    outFile: string;
    kind: StewardDataKind;
    matchLinked: boolean;
    playerLinked: boolean;
  }> = [
    {
      sourceFile: "wc2026_matches.csv",
      outFile: "enriched-fifa-matches.json",
      kind: "fifa_match_ids",
      matchLinked: true,
      playerLinked: false,
    },
    {
      sourceFile: "wc2026_players.csv",
      outFile: "enriched-fifa-players.json",
      kind: "fifa_player_ids",
      matchLinked: false,
      playerLinked: true,
    },
    {
      sourceFile: "wc2026_efi.csv",
      outFile: "enriched-efi-player-match-metrics.json",
      kind: "efi_player_match_metrics",
      matchLinked: true,
      playerLinked: true,
    },
  ];

  // The EFI metric rows carry only the FIFA match id; wc2026_matches.csv is
  // the mapping table (id → teams/date/stage). Rows the mapping table
  // resolves let EFI rows resolve transitively with EXACT_FIFA_ID.
  const fifaMatchResolutionByFifaId = new Map<string, string>();

  for (const { sourceFile, outFile, kind, matchLinked, playerLinked } of bustamiKinds) {
    const file = bustamiByFile.get(sourceFile);
    if (file === undefined) continue;
    const records: EnrichedRecord[] = file.records.map((record) => {
      if (record.parseStatus === "ERROR") {
        const enriched = baseRecord(record, kind, "UNRESOLVED", BUSTAMI_IMPORT_BLOCKED_REASON);
        countClassification(bustami, "UNRESOLVED");
        return enriched;
      }
      const enriched = baseRecord(
        record,
        kind,
        "ADVANCED_ANALYTICS_CANDIDATE",
        BUSTAMI_IMPORT_BLOCKED_REASON,
      );
      if (matchLinked) {
        const { query, homeScore, awayScore } = matchRowQuery(record, new Map());
        const mappedKey =
          sourceFile !== "wc2026_matches.csv" && query.matchId !== null
            ? fifaMatchResolutionByFifaId.get(query.matchId)
            : undefined;
        if (mappedKey !== undefined) {
          enriched.matchResolution = {
            confidence: "EXACT_FIFA_ID",
            referenceKey: mappedKey,
            note: "Resolved through the wc2026_matches.csv FIFA match ID mapping.",
          };
          trackResolution(bustami.stats.matchResolution, "EXACT_FIFA_ID");
        } else {
          const result = classifyBustamiRow(matchIndex, packFacts, {
            sourceId: BUSTAMI_SOURCE_ID,
            sourceFile,
            sourceRowNumber: record.sourceRowNumber,
            query,
            homeScore,
            awayScore,
          });
          enriched.matchResolution = result.resolution;
          enriched.classification = result.classification;
          enriched.warnings.push(...result.warnings);
          trackResolution(bustami.stats.matchResolution, result.resolution.confidence);
          if (result.conflict !== null) bustami.conflicts.push(result.conflict);
          if (
            sourceFile === "wc2026_matches.csv" &&
            result.resolution.referenceKey !== null
          ) {
            // The EFI rows join on result_id, other files on match_id —
            // register every id this row carries as a mapping alias.
            for (const alias of [
              query.matchId,
              pickString(record.parsed, ["result_id"]),
            ]) {
              if (alias !== null) {
                fifaMatchResolutionByFifaId.set(
                  alias,
                  result.resolution.referenceKey,
                );
              }
            }
          }
        }
      }
      if (playerLinked) {
        const resolution = resolvePlayer(bustamiPlayerIndex, {
          providerId: pickString(record.parsed, PLAYER_ID_KEYS),
          name: pickString(record.parsed, PLAYER_NAME_KEYS),
          team: pickString(record.parsed, PLAYER_TEAM_KEYS),
        });
        enriched.playerResolution = resolution;
        trackResolution(bustami.stats.playerResolution, resolution.confidence);
        if (resolution.ambiguous) {
          enriched.warnings.push(resolution.note ?? "Ambiguous player identity — not merged.");
        }
      }
      countClassification(bustami, enriched.classification);
      return enriched;
    });
    await writeEnriched(
      bustamiOutDir,
      outFile,
      enrichedFile(BUSTAMI_SOURCE_ID, kind, records, [
        `Research/analytics candidates only — importBlockedReason: ${BUSTAMI_IMPORT_BLOCKED_REASON}.`,
        "Upstream README scopes this data to analytical/research purposes; a license/usage review must clear it before any other use.",
        "EFI metrics are never merged into the core public archive in this phase.",
      ]),
    );
  }

  mominul.stats.conflictsWithManualPack = mominul.conflicts.length;
  bustami.stats.conflictsWithManualPack = bustami.conflicts.length;
  if (!packFacts.present) {
    const note =
      "Manual verified reference pack not loaded — pack comparisons skipped this run.";
    mominul.stats.notes.push(note);
    bustami.stats.notes.push(note);
  }

  return {
    generatedAt: new Date().toISOString(),
    manualPackPresent: packFacts.present,
    mominul: mominul.stats,
    bustami: bustami.stats,
    conflicts: [...mominul.conflicts, ...bustami.conflicts],
    writtenFiles,
  };
}
