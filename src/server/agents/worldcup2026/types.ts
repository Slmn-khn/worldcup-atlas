// Shared types for the 2026 World Cup data steward agent (Phase 1).
//
// Phase 1 is deterministic and read-only with respect to the database: it
// collects approved source snapshots, extracts per-source candidates,
// normalizes them into merged records, and validates the result. Nothing in
// this module (or the whole agents/worldcup2026 graph) touches Prisma or any
// production table.
//
// NOTE ON IMPORTS: like the fixtures sync graph, every module under
// src/server/agents/worldcup2026 uses RELATIVE runtime imports so the CLI
// scripts in scripts/2026/* can run under tsx (which does not resolve the
// "@/" tsconfig alias at runtime).
//
// All DTOs are JSON-serializable: dates are ISO strings, never Date objects.

// ---------------------------------------------------------------------------
// Confidence and verification metadata
// ---------------------------------------------------------------------------

/** How confident the steward is in a normalized record/value. */
export const CONFIDENCE_LEVELS = [
  "OFFICIAL_VERIFIED",
  "MULTI_SOURCE_VERIFIED",
  "SINGLE_SOURCE",
  "DERIVED",
  "MANUAL_OVERRIDE",
  "UNVERIFIED",
  "CONFLICTED",
] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Review state of a normalized record. */
export const VERIFICATION_STATUSES = [
  "READY",
  "NEEDS_REVIEW",
  "CONFLICTED",
  "INCOMPLETE",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------

export type SourceReliability =
  | "OFFICIAL"
  | "OPEN_DATA"
  | "COMMUNITY_API"
  | "MANUAL_REFERENCE"
  // Open-licensed candidate provider: enrichment/gap-fill evidence only,
  // never authoritative, never auto-approved for import.
  | "OPEN_DATA_CANDIDATE"
  // Research/analytics candidate provider: data usable for internal analysis
  // only until a license/usage review explicitly clears it. Never imported,
  // never rendered publicly.
  | "RESEARCH_ANALYTICS_CANDIDATE";

export const STEWARD_DATA_KINDS = [
  "tournament",
  "teams",
  "groups",
  "venues",
  "fixtures",
  "matches",
  "standings",
  "bracket",
  // Enrichment kinds carried by candidate providers (Phase 1: candidate/
  // normalized/report files only — none of these have an import model yet).
  "referees",
  "players",
  "squads",
  "lineups",
  "match_events",
  "player_stats",
  "team_match_stats",
  // Research/analytics kinds (Bustami EFI provider).
  "fifa_match_ids",
  "fifa_player_ids",
  "efi_player_match_metrics",
  "advanced_performance_metrics",
] as const;
export type StewardDataKind = (typeof STEWARD_DATA_KINDS)[number];

export type SourceEndpointFormat = "json" | "csv" | "txt";

export type SourceEndpoint = {
  id: string;
  label: string;
  url: string;
  /** File name the raw body is saved under (data/2026/raw/<sourceId>/...). */
  outputFile: string;
  format: SourceEndpointFormat;
};

export type Approved2026Source = {
  id: string;
  name: string;
  reliability: SourceReliability;
  /** Lower wins when merged values disagree (mirrors fixtures SOURCE_PRIORITY). */
  priority: number;
  licenseLabel?: string;
  baseUrl?: string;
  description: string;
  allowedFor: Array<StewardDataKind>;
  endpoints?: Array<SourceEndpoint>;
};

// ---------------------------------------------------------------------------
// Raw snapshot metadata (written next to each raw body file)
// ---------------------------------------------------------------------------

export type SnapshotStatus = "OK" | "FAILED";

export type SnapshotMeta = {
  sourceId: string;
  endpointId: string;
  url: string;
  format: SourceEndpointFormat;
  /** ISO timestamp of the fetch. */
  fetchedAt: string;
  /** sha256 hex digest of the raw body ("" when the fetch failed). */
  contentHash: string;
  status: SnapshotStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  /** Raw body size in bytes (0 when the fetch failed). */
  contentLength: number;
};

// ---------------------------------------------------------------------------
// Source references carried on every candidate / normalized record
// ---------------------------------------------------------------------------

/** Pointer from a record back into a specific raw snapshot. */
export type RawSourceRef = {
  sourceId: string;
  endpointId: string;
  /** e.g. a CSV row number, a match id, or a cup.txt line number. */
  ref: string;
};

// ---------------------------------------------------------------------------
// Candidate records (per-source, minimally transformed)
// ---------------------------------------------------------------------------

export type CandidateParseError = {
  sourceId: string;
  endpointId: string;
  ref: string;
  message: string;
  rawLine?: string;
};

export type CandidateTeam = {
  name: string;
  code?: string | null;
  fifaCode?: string | null;
  iso2Code?: string | null;
  groupName?: string | null;
  /** Team id used by this source (for joining games rows to teams). */
  sourceTeamId?: string | null;
  sourceRef: RawSourceRef;
};

export type CandidateGroup = {
  name: string;
  teamNames: string[];
  sourceRef: RawSourceRef;
};

export type CandidateVenue = {
  name: string;
  cityName?: string | null;
  countryName?: string | null;
  capacity?: number | null;
  sourceVenueId?: string | null;
  sourceRef: RawSourceRef;
};

export type CandidateMatchStatus =
  | "SCHEDULED"
  | "LIVE"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED"
  | "UNKNOWN";

export type CandidateMatch = {
  matchNumber?: number | null;
  sourceMatchId?: string | null;
  /** Free-form stage/round labels as this source wrote them. */
  stageLabel?: string | null;
  roundLabel?: string | null;
  groupName?: string | null;
  /** ISO UTC instant when the source provides one that is safely UTC. */
  kickoffAtUtc?: string | null;
  kickoffDateLabel?: string | null;
  kickoffTimeLabel?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  status: CandidateMatchStatus;
  venueName?: string | null;
  cityName?: string | null;
  sourceRef: RawSourceRef;
};

export type CandidateStanding = {
  groupName: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rank?: number | null;
  sourceRef: RawSourceRef;
};

/** Envelope for every candidates file. */
export type CandidateFile<T> = {
  kind: StewardDataKind;
  generatedAt: string;
  records: T[];
  errors: CandidateParseError[];
};

// ---------------------------------------------------------------------------
// Candidate-provider records (Mominul / Bustami EFI enrichment providers)
// ---------------------------------------------------------------------------

/**
 * Row-level parse verdict for candidate-provider rows. ERROR rows are still
 * emitted (with their raw payload) — malformed rows are never silently
 * discarded, they just cannot contribute parsed values.
 */
export type ProviderParseStatus = "OK" | "WARN" | "ERROR";

/**
 * One row from a candidate-provider file, minimally transformed. `raw` keeps
 * the untouched cell values; `parsed` holds the tolerant coercion (empty
 * string → null, safe numeric strings → numbers). Candidate output only —
 * these records are never imported and never rendered publicly.
 */
export type ProviderCandidateRecord = {
  sourceId: string;
  sourceFile: string;
  /** 1-based data-row ordinal (header excluded). */
  sourceRowNumber: number;
  raw: Record<string, unknown>;
  parsed: Record<string, unknown>;
  parseStatus: ProviderParseStatus;
  warnings: string[];
};

/** Envelope for every provider candidates file (one per source file). */
export type ProviderCandidateFile = {
  sourceId: string;
  endpointId: string;
  sourceFile: string;
  generatedAt: string;
  columns: string[];
  /** File-level failure (unreadable/unparseable document), null when parsed. */
  fileError: string | null;
  records: ProviderCandidateRecord[];
};

// ---------------------------------------------------------------------------
// Normalized records (merged across sources, Zod-validated in contracts.ts)
// ---------------------------------------------------------------------------

export type Normalized2026Tournament = {
  tournamentYear: number;
  name: string;
  hostCountries: string[];
  teamsCount: number;
  groupsCount: number;
  matchesCount: number;
  venuesCount: number;
  startDate?: string | null;
  endDate?: string | null;
  winner?: string | null;
  runnerUp?: string | null;
  thirdPlace?: string | null;
  fourthPlace?: string | null;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
};

export type Normalized2026Team = {
  name: string;
  slug: string;
  code?: string | null;
  fifaCode?: string | null;
  flagCode?: string | null;
  groupName?: string | null;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
};

export type Normalized2026Group = {
  name: string;
  teams: string[];
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
};

export type Normalized2026Venue = {
  name: string;
  slug: string;
  cityName?: string | null;
  countryName?: string | null;
  capacity?: number | null;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
};

export const MATCH_STAGES = [
  "GROUP",
  "ROUND_OF_32",
  "ROUND_OF_16",
  "QUARTER_FINAL",
  "SEMI_FINAL",
  "THIRD_PLACE",
  "FINAL",
  "UNKNOWN",
] as const;
export type MatchStage = (typeof MATCH_STAGES)[number];

export type Normalized2026Match = {
  matchNumber?: number | null;
  sourceMatchId?: string | null;
  stage: MatchStage;
  round?: string | null;
  groupName?: string | null;
  kickoffAtUtc?: string | null;
  kickoffDateLabel?: string | null;
  kickoffTimeLabel?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  winnerTeamName?: string | null;
  venueName?: string | null;
  cityName?: string | null;
  status: CandidateMatchStatus;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  rawSourceRefs: RawSourceRef[];
};

export type Normalized2026Standing = {
  groupName: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rank?: number | null;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
};

// ---------------------------------------------------------------------------
// Conflicts — never silently resolved, always reported
// ---------------------------------------------------------------------------

export type ConflictEntry = {
  entityType: StewardDataKind;
  /** Canonical key of the entity the conflict is about (e.g. team slug). */
  entityKey: string;
  field: string;
  /** The disagreeing values, one per source. */
  values: Array<{ sourceId: string; value: string }>;
  /** Which value the normalizer carried forward (by source priority). */
  resolution: "KEPT_HIGHEST_PRIORITY" | "UNRESOLVED";
  note?: string;
};
