// Approved sources for the 2026 World Cup data steward agent (Phase 1).
//
// ONLY the sources listed here may ever be fetched by the collector. Adding a
// source is a reviewed change: update this file AND data/2026/source-registry.json
// (the collector rewrites the JSON mirror from this registry on every run so
// the two cannot drift), and document it in docs/DATA_SOURCES.md.
//
// No FIFA scraping. Official pages remain manual verification references
// only (see docs/DATA_SOURCES.md). The MANUAL_REFERENCE tier is implemented
// by the human-authenticated reference pack below: files placed by a human
// under data/2026/reference/, never fetched by the collector.

import type { Approved2026Source, SourceReliability } from "./types";

export type { Approved2026Source, SourceReliability };

/** Directory layout shared by all Phase 1 scripts. */
export const DATA_2026_DIR = "data/2026";
export const RAW_2026_DIR = `${DATA_2026_DIR}/raw`;
export const CANDIDATES_2026_DIR = `${DATA_2026_DIR}/candidates`;
export const NORMALIZED_2026_DIR = `${DATA_2026_DIR}/normalized`;
export const VALIDATION_2026_DIR = `${DATA_2026_DIR}/validation`;
export const REPORTS_2026_DIR = `${DATA_2026_DIR}/reports`;
export const SOURCE_REGISTRY_JSON_PATH = `${DATA_2026_DIR}/source-registry.json`;

/** Candidate-provider sub-folders (candidate + normalized enrichment output). */
export const MOMINUL_CANDIDATES_DIR = `${CANDIDATES_2026_DIR}/mominul`;
export const BUSTAMI_CANDIDATES_DIR = `${CANDIDATES_2026_DIR}/bustami`;
export const MOMINUL_NORMALIZED_DIR = `${NORMALIZED_2026_DIR}/mominul`;
export const BUSTAMI_NORMALIZED_DIR = `${NORMALIZED_2026_DIR}/bustami`;

const OPENFOOTBALL_RAW_BASE =
  "https://raw.githubusercontent.com/openfootball";
const WORLDCUP2026_RAW_BASE =
  "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/master";
const WORLDCUP2026_API_BASE = "https://worldcup26.ir";
const MOMINUL_RAW_BASE =
  "https://raw.githubusercontent.com/mominullptr/FIFA-World-Cup-2026-Dataset/main";
const BUSTAMI_RAW_BASE =
  "https://raw.githubusercontent.com/Bustami/efi-fifa-data-wc-2026/master";

export const MOMINUL_SOURCE_ID = "mominul_2026_dataset";
export const BUSTAMI_SOURCE_ID = "bustami_fifa_efi_2026";

export const APPROVED_2026_SOURCES: Approved2026Source[] = [
  {
    id: "manual_verified_2026_pack_v1",
    name: "2026 Manual Verified Reference Pack",
    reliability: "MANUAL_REFERENCE",
    priority: 1,
    licenseLabel: "internal reference pack with source attribution",
    description:
      "Human-authenticated 2026 data pack (data/2026/reference/manual-verified-v1) " +
      "containing tournament, teams, groups, matches, standings, bracket, awards, " +
      "venues, sources, and conflicts. Highest-priority reference: `verified` " +
      "records win merged values; `reported`/`unverified` records are supporting " +
      "evidence only and never become final. NEVER fetched by the collector and " +
      "never imported directly — manifest.importAllowed is false and the " +
      "data/2026/approved/approval.json gate still applies to any future import.",
    allowedFor: [
      "tournament",
      "teams",
      "groups",
      "venues",
      "fixtures",
      "matches",
      "standings",
      "bracket",
    ],
    // No endpoints on purpose: the collector must never fetch this source.
    // Its files are placed by a human reviewer and read by the normalizer.
  },
  {
    id: "openfootball_worldcup_2026",
    name: "OpenFootball World Cup (2026)",
    reliability: "OPEN_DATA",
    priority: 2,
    licenseLabel: "CC0-1.0",
    baseUrl: OPENFOOTBALL_RAW_BASE,
    description:
      "Open public-domain World Cup data (openfootball/worldcup and " +
      "openfootball/worldcup.json). Stable baseline for the 2026 tournament: " +
      "groups, schedule, results, bracket in Football.TXT and JSON form. " +
      "Same family of data the existing fixture sync uses as its baseline.",
    allowedFor: [
      "tournament",
      "teams",
      "groups",
      "fixtures",
      "matches",
      "bracket",
    ],
    endpoints: [
      {
        id: "of26-cup-txt",
        label: "2026 cup.txt (Football.TXT, groups + all matches)",
        url: `${OPENFOOTBALL_RAW_BASE}/worldcup/master/2026--usa/cup.txt`,
        outputFile: "cup.txt",
        format: "txt",
      },
      {
        id: "of26-worldcup-json",
        label: "2026 worldcup.json (rounds + matches)",
        url: `${OPENFOOTBALL_RAW_BASE}/worldcup.json/master/2026/worldcup.json`,
        outputFile: "worldcup.json",
        format: "json",
      },
    ],
  },
  {
    id: "worldcup2026_repo",
    name: "worldcup2026 community repo/API (rezarahiminia)",
    reliability: "COMMUNITY_API",
    priority: 3,
    // License read from the repository's package metadata (ISC). Re-verify if
    // the repository changes its license file.
    licenseLabel: "ISC",
    baseUrl: WORLDCUP2026_API_BASE,
    description:
      "Structured 2026-specific community provider (rezarahiminia/worldcup2026): " +
      "teams, groups, stadiums, matches and group tables as CSV/JSON plus a " +
      "public API at worldcup26.ir. Community-maintained and non-authoritative; " +
      "never the sole source of truth. Failures are reported, never fatal.",
    allowedFor: [
      "teams",
      "groups",
      "venues",
      "fixtures",
      "matches",
      "standings",
    ],
    endpoints: [
      // Public API endpoints (no key required).
      {
        id: "wc26-api-games",
        label: "API: all matches",
        url: `${WORLDCUP2026_API_BASE}/get/games`,
        outputFile: "api-games.json",
        format: "json",
      },
      {
        id: "wc26-api-groups",
        label: "API: groups with standings",
        url: `${WORLDCUP2026_API_BASE}/get/groups`,
        outputFile: "api-groups.json",
        format: "json",
      },
      {
        id: "wc26-api-teams",
        label: "API: all teams",
        url: `${WORLDCUP2026_API_BASE}/get/teams`,
        outputFile: "api-teams.json",
        format: "json",
      },
      {
        id: "wc26-api-stadiums",
        label: "API: all stadiums",
        url: `${WORLDCUP2026_API_BASE}/get/stadiums`,
        outputFile: "api-stadiums.json",
        format: "json",
      },
      // GitHub raw CSV snapshots (repo root, master branch — verified paths).
      {
        id: "wc26-csv-teams",
        label: "CSV: teams",
        url: `${WORLDCUP2026_RAW_BASE}/worldcup2026.teams.csv`,
        outputFile: "teams.csv",
        format: "csv",
      },
      {
        id: "wc26-csv-groups",
        label: "CSV: groups + group tables",
        url: `${WORLDCUP2026_RAW_BASE}/worldcup2026.groups.csv`,
        outputFile: "groups.csv",
        format: "csv",
      },
      {
        id: "wc26-csv-games",
        label: "CSV: games",
        url: `${WORLDCUP2026_RAW_BASE}/worldcup2026.games.csv`,
        outputFile: "games.csv",
        format: "csv",
      },
      {
        id: "wc26-csv-stadia",
        label: "CSV: stadiums",
        url: `${WORLDCUP2026_RAW_BASE}/worldcup2026.stadia.csv`,
        outputFile: "stadia.csv",
        format: "csv",
      },
    ],
  },
  {
    id: MOMINUL_SOURCE_ID,
    name: "Mominul FIFA World Cup 2026 Dataset",
    reliability: "OPEN_DATA_CANDIDATE",
    priority: 3,
    licenseLabel: "CC0-1.0",
    baseUrl: MOMINUL_RAW_BASE,
    description:
      "Relational open dataset for FIFA World Cup 2026 with teams, venues, " +
      "stages, referees, matches, squads, match events, lineups, player " +
      "stats, team match stats, xG, and SQLite output. Candidate provider " +
      "only: core matches may become gap-fill candidates when they resolve " +
      "cleanly; player/event/lineup/stat rows remain enrichment candidates. " +
      "Never authoritative over the manual verified reference pack, never " +
      "auto-approved for import.",
    allowedFor: [
      "teams",
      "groups",
      "venues",
      "matches",
      "referees",
      "players",
      "squads",
      "lineups",
      "match_events",
      "player_stats",
      "team_match_stats",
    ],
    endpoints: [
      {
        id: "teams_csv",
        label: "CSV: teams",
        url: `${MOMINUL_RAW_BASE}/teams.csv`,
        outputFile: "teams.csv",
        format: "csv",
      },
      {
        id: "venues_csv",
        label: "CSV: venues",
        url: `${MOMINUL_RAW_BASE}/venues.csv`,
        outputFile: "venues.csv",
        format: "csv",
      },
      {
        id: "tournament_stages_csv",
        label: "CSV: tournament stages",
        url: `${MOMINUL_RAW_BASE}/tournament_stages.csv`,
        outputFile: "tournament_stages.csv",
        format: "csv",
      },
      {
        id: "referees_csv",
        label: "CSV: referees",
        url: `${MOMINUL_RAW_BASE}/referees.csv`,
        outputFile: "referees.csv",
        format: "csv",
      },
      {
        id: "matches_csv",
        label: "CSV: matches",
        url: `${MOMINUL_RAW_BASE}/matches.csv`,
        outputFile: "matches.csv",
        format: "csv",
      },
      {
        id: "matches_detailed_csv",
        label: "CSV: matches (detailed)",
        url: `${MOMINUL_RAW_BASE}/matches_detailed.csv`,
        outputFile: "matches_detailed.csv",
        format: "csv",
      },
      {
        id: "squads_and_players_csv",
        label: "CSV: squads and players",
        url: `${MOMINUL_RAW_BASE}/squads_and_players.csv`,
        outputFile: "squads_and_players.csv",
        format: "csv",
      },
      {
        id: "match_events_csv",
        label: "CSV: match events",
        url: `${MOMINUL_RAW_BASE}/match_events.csv`,
        outputFile: "match_events.csv",
        format: "csv",
      },
      {
        id: "match_team_stats_csv",
        label: "CSV: match team stats",
        url: `${MOMINUL_RAW_BASE}/match_team_stats.csv`,
        outputFile: "match_team_stats.csv",
        format: "csv",
      },
      {
        id: "match_lineups_csv",
        label: "CSV: match lineups",
        url: `${MOMINUL_RAW_BASE}/match_lineups.csv`,
        outputFile: "match_lineups.csv",
        format: "csv",
      },
      {
        id: "player_stats_csv",
        label: "CSV: player stats",
        url: `${MOMINUL_RAW_BASE}/player_stats.csv`,
        outputFile: "player_stats.csv",
        format: "csv",
      },
      {
        id: "real_match_details_json",
        label: "JSON: real match details",
        url: `${MOMINUL_RAW_BASE}/real_match_details.json`,
        outputFile: "real_match_details.json",
        format: "json",
      },
    ],
  },
  {
    id: BUSTAMI_SOURCE_ID,
    name: "Bustami FIFA EFI Data WC 2026",
    reliability: "RESEARCH_ANALYTICS_CANDIDATE",
    priority: 5,
    licenseLabel: "Needs review; README says analytical/research purposes only",
    baseUrl: BUSTAMI_RAW_BASE,
    description:
      "Player-level FIFA Enhanced Football Intelligence metrics collected " +
      "from the official FIFA platform, including identity, attacking, " +
      "physical, passing/progression, defending, receiving, and disciplinary " +
      "fields. Research/analytics candidate ONLY: usable for FIFA match/" +
      "player ID mapping and advanced-metric analysis, blocked from any " +
      "import or public rendering until a license/usage review explicitly " +
      "clears it (importBlockedReason: RESEARCH_ONLY_UNTIL_LICENSE_REVIEW).",
    allowedFor: [
      "fifa_match_ids",
      "fifa_player_ids",
      "efi_player_match_metrics",
      "advanced_performance_metrics",
    ],
    endpoints: [
      {
        id: "wc2026_efi_csv",
        label: "CSV: player-level EFI metrics",
        url: `${BUSTAMI_RAW_BASE}/data/wc2026_efi.csv`,
        outputFile: "wc2026_efi.csv",
        format: "csv",
      },
      {
        id: "wc2026_matches_csv",
        label: "CSV: FIFA match IDs",
        url: `${BUSTAMI_RAW_BASE}/data/wc2026_matches.csv`,
        outputFile: "wc2026_matches.csv",
        format: "csv",
      },
      {
        id: "wc2026_players_csv",
        label: "CSV: FIFA player IDs",
        url: `${BUSTAMI_RAW_BASE}/data/wc2026_players.csv`,
        outputFile: "wc2026_players.csv",
        format: "csv",
      },
    ],
  },
];

/** Registry lookup; returns undefined for anything not approved. */
export function getApprovedSource(
  sourceId: string,
): Approved2026Source | undefined {
  return APPROVED_2026_SOURCES.find((source) => source.id === sourceId);
}

/** Source priority lookup (lower wins). Unknown sources sort last. */
export function sourcePriority(sourceId: string): number {
  return getApprovedSource(sourceId)?.priority ?? Number.MAX_SAFE_INTEGER;
}

/** The JSON-mirror payload written to data/2026/source-registry.json. */
export function buildSourceRegistryJson(): {
  $comment: string;
  sources: Approved2026Source[];
} {
  return {
    $comment:
      "Generated mirror of src/server/agents/worldcup2026/sourceRegistry.ts. " +
      "Do not edit by hand — pnpm data:2026:collect rewrites it.",
    sources: APPROVED_2026_SOURCES,
  };
}
