// Zod contracts for the 2026 data steward normalized outputs (Phase 1).
//
// Every file written to data/2026/normalized/ is validated against these
// schemas before it is written, and again by the validator when it reads the
// files back. The schemas mirror the DTO types in ./types exactly — keep the
// two in sync (the `satisfies` checks below make drift a compile error).

import { z } from "zod";

import {
  CONFIDENCE_LEVELS,
  MATCH_STAGES,
  STEWARD_DATA_KINDS,
  VERIFICATION_STATUSES,
  type ConflictEntry,
  type Normalized2026Group,
  type Normalized2026Match,
  type Normalized2026Standing,
  type Normalized2026Team,
  type Normalized2026Tournament,
  type Normalized2026Venue,
} from "./types";

export const confidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const matchStageSchema = z.enum(MATCH_STAGES);

const candidateMatchStatusSchema = z.enum([
  "SCHEDULED",
  "LIVE",
  "FINISHED",
  "POSTPONED",
  "CANCELLED",
  "UNKNOWN",
]);

const rawSourceRefSchema = z.object({
  sourceId: z.string().min(1),
  endpointId: z.string().min(1),
  ref: z.string().min(1),
});

/** Fields every normalized record carries. */
const stewardMetaShape = {
  sourceIds: z.array(z.string().min(1)).min(1),
  confidence: confidenceLevelSchema,
  verificationStatus: verificationStatusSchema,
};

export const normalized2026TournamentSchema = z.object({
  tournamentYear: z.number().int(),
  name: z.string().min(1),
  hostCountries: z.array(z.string().min(1)),
  teamsCount: z.number().int().nonnegative(),
  groupsCount: z.number().int().nonnegative(),
  matchesCount: z.number().int().nonnegative(),
  venuesCount: z.number().int().nonnegative(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  winner: z.string().nullish(),
  runnerUp: z.string().nullish(),
  thirdPlace: z.string().nullish(),
  fourthPlace: z.string().nullish(),
  ...stewardMetaShape,
});

export const normalized2026TeamSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  code: z.string().nullish(),
  fifaCode: z.string().nullish(),
  flagCode: z.string().nullish(),
  groupName: z.string().nullish(),
  ...stewardMetaShape,
});

export const normalized2026GroupSchema = z.object({
  name: z.string().min(1),
  teams: z.array(z.string().min(1)),
  ...stewardMetaShape,
});

export const normalized2026VenueSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  cityName: z.string().nullish(),
  countryName: z.string().nullish(),
  capacity: z.number().int().positive().nullish(),
  ...stewardMetaShape,
});

export const normalized2026MatchSchema = z.object({
  matchNumber: z.number().int().positive().nullish(),
  sourceMatchId: z.string().nullish(),
  stage: matchStageSchema,
  round: z.string().nullish(),
  groupName: z.string().nullish(),
  kickoffAtUtc: z.string().nullish(),
  kickoffDateLabel: z.string().nullish(),
  kickoffTimeLabel: z.string().nullish(),
  homeTeamName: z.string().nullish(),
  awayTeamName: z.string().nullish(),
  homeTeamCode: z.string().nullish(),
  awayTeamCode: z.string().nullish(),
  homeScore: z.number().int().nonnegative().nullish(),
  awayScore: z.number().int().nonnegative().nullish(),
  homePenaltyScore: z.number().int().nonnegative().nullish(),
  awayPenaltyScore: z.number().int().nonnegative().nullish(),
  winnerTeamName: z.string().nullish(),
  venueName: z.string().nullish(),
  cityName: z.string().nullish(),
  status: candidateMatchStatusSchema,
  rawSourceRefs: z.array(rawSourceRefSchema),
  ...stewardMetaShape,
});

export const normalized2026StandingSchema = z.object({
  groupName: z.string().min(1),
  teamName: z.string().min(1),
  played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  goalDifference: z.number().int(),
  points: z.number().int().nonnegative(),
  rank: z.number().int().positive().nullish(),
  ...stewardMetaShape,
});

export const conflictEntrySchema = z.object({
  entityType: z.enum(STEWARD_DATA_KINDS),
  entityKey: z.string().min(1),
  field: z.string().min(1),
  values: z
    .array(z.object({ sourceId: z.string().min(1), value: z.string() }))
    .min(1),
  resolution: z.enum(["KEPT_HIGHEST_PRIORITY", "UNRESOLVED"]),
  note: z.string().optional(),
});

// Compile-time drift guards: a schema output must be assignable to its DTO.
// (zod nullish() yields `T | null | undefined`, matching the optional DTO
// fields; if the shapes ever diverge these lines stop compiling.)
type AssertAssignable<T, U extends T> = U;
export type _TournamentContractCheck = AssertAssignable<
  Normalized2026Tournament,
  z.infer<typeof normalized2026TournamentSchema>
>;
export type _TeamContractCheck = AssertAssignable<
  Normalized2026Team,
  z.infer<typeof normalized2026TeamSchema>
>;
export type _GroupContractCheck = AssertAssignable<
  Normalized2026Group,
  z.infer<typeof normalized2026GroupSchema>
>;
export type _VenueContractCheck = AssertAssignable<
  Normalized2026Venue,
  z.infer<typeof normalized2026VenueSchema>
>;
export type _MatchContractCheck = AssertAssignable<
  Normalized2026Match,
  z.infer<typeof normalized2026MatchSchema>
>;
export type _StandingContractCheck = AssertAssignable<
  Normalized2026Standing,
  z.infer<typeof normalized2026StandingSchema>
>;
export type _ConflictContractCheck = AssertAssignable<
  ConflictEntry,
  z.infer<typeof conflictEntrySchema>
>;
