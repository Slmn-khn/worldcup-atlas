// Normalizer for the 2026 data steward agent (Phase 1).
//
// Reads the per-source candidate files, resolves entities across sources
// (via resolver.ts), merges duplicates, assigns confidence + verification
// metadata, derives group standings, and writes the normalized output files
// under data/2026/normalized/. Deterministic, database-free.
//
// Confidence policy (see docs/2026_DATA_STEWARD_AGENT.md):
//   - MULTI_SOURCE_VERIFIED  two+ independent sources agree
//   - SINGLE_SOURCE          only one source knows the value
//   - CONFLICTED             sources disagree on a MAJOR field
//   - DERIVED                computed from other normalized values
// Major fields (teams, scores, stage, group membership) conflict → the whole
// record is CONFLICTED. Minor fields (status, kickoff labels, city) conflict →
// the record stays but is NEEDS_REVIEW. Either way the disagreement is
// written to conflicts.json — conflicts are reported, never silently resolved.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ZodType } from "zod";

import {
  conflictEntrySchema,
  normalized2026GroupSchema,
  normalized2026MatchSchema,
  normalized2026StandingSchema,
  normalized2026TeamSchema,
  normalized2026TournamentSchema,
  normalized2026VenueSchema,
} from "./contracts";
import {
  canonicalCityKey,
  canonicalTeamKey,
  canonicalVenueKey,
  comparableDateLabel,
  comparableTimeLabel,
  conflictFromField,
  isPlaceholderTeamName,
  mergeField,
  normalizeSlug,
  normalizeStage,
  type FieldVote,
} from "./resolver";
import {
  APPROVED_2026_SOURCES,
  CANDIDATES_2026_DIR,
  NORMALIZED_2026_DIR,
  RAW_2026_DIR,
  sourcePriority,
} from "./sourceRegistry";
import {
  MANUAL_PACK_SOURCE_ID,
  buildManualPackStats,
  loadManualReferencePack,
  manualPackToCandidates,
  type ManualPackStats,
} from "./manualReferencePack";
import {
  compareStandingsWithProvider,
  computeGroupStandings,
  type ProviderStandingRow,
} from "./standings";
import type {
  CandidateFile,
  CandidateGroup,
  CandidateMatch,
  CandidateStanding,
  CandidateTeam,
  CandidateVenue,
  ConfidenceLevel,
  ConflictEntry,
  MatchStage,
  Normalized2026Group,
  Normalized2026Match,
  Normalized2026Standing,
  Normalized2026Team,
  Normalized2026Tournament,
  Normalized2026Venue,
  SnapshotMeta,
  VerificationStatus,
} from "./types";

export const TOURNAMENT_YEAR = 2026;
/** Display title as used by the OpenFootball 2026 document ("World Cup 2026"). */
export const TOURNAMENT_NAME = "World Cup 2026";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Confidence for a record with no major conflicts. */
function agreementConfidence(independentSources: number): ConfidenceLevel {
  return independentSources >= 2 ? "MULTI_SOURCE_VERIFIED" : "SINGLE_SOURCE";
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export type TeamMergeResult = {
  teams: Normalized2026Team[];
  conflicts: ConflictEntry[];
  /** canonical team key → normalized display name */
  nameByKey: Map<string, string>;
};

export function mergeTeams(candidates: CandidateTeam[]): TeamMergeResult {
  const byKey = new Map<string, CandidateTeam[]>();
  for (const candidate of candidates) {
    const key = canonicalTeamKey(candidate.name, {
      fifaCode: candidate.fifaCode,
      iso2Code: candidate.iso2Code,
      code: candidate.code,
    });
    if (key === null) continue; // extractor guarantees non-empty names
    byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
  }

  const teams: Normalized2026Team[] = [];
  const conflicts: ConflictEntry[] = [];
  const nameByKey = new Map<string, string>();

  for (const [key, group] of [...byKey.entries()].sort()) {
    const sorted = [...group].sort(
      (a, b) =>
        sourcePriority(a.sourceRef.sourceId) - sourcePriority(b.sourceRef.sourceId),
    );
    const name = sorted[0].name;
    nameByKey.set(key, name);

    const groupField = mergeField(
      group.map((candidate) => ({
        sourceId: candidate.sourceRef.sourceId,
        value: candidate.groupName,
      })),
      (value) => value,
    );
    const fifaCode = mergeField(
      group.map((candidate) => ({
        sourceId: candidate.sourceRef.sourceId,
        value: candidate.fifaCode,
      })),
      (value) => value.toUpperCase(),
    );
    const iso2 = mergeField(
      group.map((candidate) => ({
        sourceId: candidate.sourceRef.sourceId,
        value: candidate.iso2Code,
      })),
      (value) => value.toUpperCase(),
    );

    const sourceIds = sortedUnique(group.map((c) => c.sourceRef.sourceId));
    const hasMajorConflict = groupField.agreement === "CONFLICT";
    if (hasMajorConflict) {
      conflicts.push(conflictFromField("teams", key, "groupName", groupField));
    }
    for (const [field, merged] of [
      ["fifaCode", fifaCode],
      ["code", iso2],
    ] as const) {
      if (merged.agreement === "CONFLICT") {
        conflicts.push(conflictFromField("teams", key, field, merged));
      }
    }

    const flagCode =
      key.startsWith("flag:") ? key.slice("flag:".length) : null;

    // Bracket/qualification placeholders ("UEFA Path A Winner", "TBD") are a
    // source's stale pre-qualification tokens, not countries. Preserve them,
    // but never as verified teams.
    const placeholder = isPlaceholderTeamName(name);

    let verificationStatus: VerificationStatus;
    if (hasMajorConflict) verificationStatus = "CONFLICTED";
    else if (placeholder) verificationStatus = "NEEDS_REVIEW";
    else if (groupField.value === null) verificationStatus = "INCOMPLETE";
    else if (sourceIds.length >= 2) verificationStatus = "READY";
    else verificationStatus = "NEEDS_REVIEW";

    teams.push({
      name,
      slug: normalizeSlug(name) ?? key,
      code: iso2.value,
      fifaCode: fifaCode.value,
      flagCode,
      groupName: groupField.value,
      sourceIds,
      confidence: hasMajorConflict
        ? "CONFLICTED"
        : placeholder
          ? "UNVERIFIED"
          : agreementConfidence(sourceIds.length),
      verificationStatus,
    });
  }

  return { teams, conflicts, nameByKey };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function mergeGroups(
  candidates: CandidateGroup[],
  nameByKey: Map<string, string>,
): { groups: Normalized2026Group[]; conflicts: ConflictEntry[] } {
  const byName = new Map<string, CandidateGroup[]>();
  for (const candidate of candidates) {
    byName.set(candidate.name, [...(byName.get(candidate.name) ?? []), candidate]);
  }

  const groups: Normalized2026Group[] = [];
  const conflicts: ConflictEntry[] = [];

  for (const [name, group] of [...byName.entries()].sort()) {
    const membership = mergeField(
      group.map((candidate) => ({
        sourceId: candidate.sourceRef.sourceId,
        value: candidate.teamNames,
      })),
      // Compare by canonical team keys so aliases don't fake a conflict.
      (teams) =>
        teams
          .map((team) => canonicalTeamKey(team) ?? team)
          .sort()
          .join("|"),
    );

    const sourceIds = sortedUnique(group.map((c) => c.sourceRef.sourceId));
    const hasConflict = membership.agreement === "CONFLICT";
    if (hasConflict) {
      conflicts.push(
        conflictFromField("groups", name, "teams", membership, "Group membership differs between sources."),
      );
    }

    // Canonical display names for members (falls back to the source spelling).
    const teams = (membership.value ?? []).map(
      (team) => nameByKey.get(canonicalTeamKey(team) ?? "") ?? team,
    );

    groups.push({
      name,
      teams,
      sourceIds,
      confidence: hasConflict ? "CONFLICTED" : agreementConfidence(sourceIds.length),
      verificationStatus: hasConflict
        ? "CONFLICTED"
        : teams.length !== 4
          ? "INCOMPLETE"
          : sourceIds.length >= 2
            ? "READY"
            : "NEEDS_REVIEW",
    });
  }

  return { groups, conflicts };
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

export function mergeVenues(
  candidates: CandidateVenue[],
): { venues: Normalized2026Venue[]; conflicts: ConflictEntry[] } {
  const byKey = new Map<string, CandidateVenue[]>();
  for (const candidate of candidates) {
    const key = canonicalVenueKey(candidate.name);
    if (key === null) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
  }

  // Alias pass: sponsor-prefixed names describe the same stadium (e.g.
  // "GEHA Field at Arrowhead Stadium" vs "Arrowhead Stadium"). Merge a key
  // into another when one slug contains the other at a hyphen boundary and
  // the containment target is unique — otherwise keep both (visible beats
  // wrongly merged).
  const containsAtBoundary = (longer: string, shorter: string): boolean =>
    longer !== shorter &&
    (longer.endsWith(`-${shorter}`) ||
      longer.startsWith(`${shorter}-`) ||
      longer.includes(`-${shorter}-`));
  for (const key of [...byKey.keys()].sort()) {
    const others = [...byKey.keys()].filter(
      (other) =>
        other !== key &&
        (containsAtBoundary(other, key) || containsAtBoundary(key, other)),
    );
    if (others.length === 1) {
      const [target] = others;
      // Merge the shorter-named group into the longer key's group (the
      // display name is still chosen by source priority below).
      const winner = key.length >= target.length ? key : target;
      const loser = winner === key ? target : key;
      const winnerGroup = byKey.get(winner);
      const loserGroup = byKey.get(loser);
      if (winnerGroup !== undefined && loserGroup !== undefined) {
        winnerGroup.push(...loserGroup);
        byKey.delete(loser);
      }
    }
  }

  const venues: Normalized2026Venue[] = [];
  const conflicts: ConflictEntry[] = [];

  for (const [key, group] of [...byKey.entries()].sort()) {
    const sorted = [...group].sort(
      (a, b) =>
        sourcePriority(a.sourceRef.sourceId) - sourcePriority(b.sourceRef.sourceId),
    );
    const city = mergeField(
      group.map((c) => ({ sourceId: c.sourceRef.sourceId, value: c.cityName })),
      (value) => canonicalCityKey(value) ?? value,
    );
    const country = mergeField(
      group.map((c) => ({ sourceId: c.sourceRef.sourceId, value: c.countryName })),
      (value) => canonicalCityKey(value) ?? value,
    );
    const capacity = mergeField(
      group.map((c) => ({ sourceId: c.sourceRef.sourceId, value: c.capacity })),
      (value) => value,
    );

    const sourceIds = sortedUnique(group.map((c) => c.sourceRef.sourceId));
    let hasConflict = false;
    for (const [field, merged] of [
      ["cityName", city],
      ["countryName", country],
      ["capacity", capacity],
    ] as const) {
      if (merged.agreement === "CONFLICT") {
        hasConflict = true;
        conflicts.push(conflictFromField("venues", key, field, merged as never));
      }
    }

    venues.push({
      name: sorted[0].name,
      // Slug follows the chosen display name (alias groups may carry a
      // longer sponsor-prefixed key).
      slug: normalizeSlug(sorted[0].name) ?? key,
      cityName: city.value,
      countryName: country.value,
      capacity: capacity.value,
      sourceIds,
      confidence: hasConflict ? "CONFLICTED" : agreementConfidence(sourceIds.length),
      verificationStatus: hasConflict
        ? "CONFLICTED"
        : sourceIds.length >= 2
          ? "READY"
          : "NEEDS_REVIEW",
    });
  }

  return { venues, conflicts };
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

type OrientedCandidate = CandidateMatch & {
  /** Candidate's scores viewed in the merged record's home/away orientation. */
  orientedHomeScore: number | null;
  orientedAwayScore: number | null;
  orientedHomePens: number | null;
  orientedAwayPens: number | null;
};

function matchIdentityKey(candidate: CandidateMatch): string | null {
  const homeKey = canonicalTeamKey(candidate.homeTeamName, {
    code: candidate.homeTeamCode,
  });
  const awayKey = canonicalTeamKey(candidate.awayTeamName, {
    code: candidate.awayTeamCode,
  });
  if (homeKey === null || awayKey === null) return null;
  const stage = normalizeStage(
    candidate.stageLabel,
    candidate.roundLabel,
    candidate.groupName,
  );
  const pair = [homeKey, awayKey].sort().join("~");
  return stage === "GROUP"
    ? `GROUP|${candidate.groupName ?? "?"}|${pair}`
    : `${stage}|${pair}`;
}

/**
 * True when exactly one side of the candidate is a qualification placeholder
 * ("South Korea v UEFA Path D Winner") — a stale source's alias for a real
 * fixture another source names fully.
 */
function hasSinglePlaceholderSide(candidate: CandidateMatch): boolean {
  const home = isPlaceholderTeamName(candidate.homeTeamName);
  const away = isPlaceholderTeamName(candidate.awayTeamName);
  return home !== away;
}

export function mergeMatches(
  candidates: CandidateMatch[],
  nameByKey: Map<string, string>,
): { matches: Normalized2026Match[]; conflicts: ConflictEntry[] } {
  const byKey = new Map<string, CandidateMatch[]>();
  const orphans: CandidateMatch[] = [];
  const placeholderSided: CandidateMatch[] = [];
  const groupUnknown: CandidateMatch[] = [];
  for (const candidate of candidates) {
    const key = matchIdentityKey(candidate);
    if (key === null) {
      orphans.push(candidate);
      continue;
    }
    if (hasSinglePlaceholderSide(candidate)) {
      placeholderSided.push(candidate);
      continue;
    }
    const candidateStage = normalizeStage(
      candidate.stageLabel,
      candidate.roundLabel,
      candidate.groupName,
    );
    if (candidateStage === "GROUP" && candidate.groupName == null) {
      // e.g. a manual reference row whose group letter is unconfirmed —
      // attach by team pair below (a pair meets at most once in the group
      // stage, so the pair alone is identifying).
      groupUnknown.push(candidate);
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
  }

  // Attach group-stage candidates with unknown group letters to the unique
  // fully-specified match with the same team pair. No unique target → keep
  // the record separate (visible, NEEDS_REVIEW) rather than guess.
  for (const candidate of groupUnknown) {
    const pair = [
      canonicalTeamKey(candidate.homeTeamName, { code: candidate.homeTeamCode }),
      canonicalTeamKey(candidate.awayTeamName, { code: candidate.awayTeamCode }),
    ]
      .sort()
      .join("~");
    const targets = [...byKey.keys()].filter(
      (key) => key.startsWith("GROUP|") && key.endsWith(`|${pair}`),
    );
    if (targets.length === 1) {
      byKey.get(targets[0])?.push(candidate);
    } else {
      const ownKey = matchIdentityKey(candidate) as string;
      byKey.set(ownKey, [...(byKey.get(ownKey) ?? []), candidate]);
    }
  }

  // Second pass: attach placeholder-sided candidates to the fully-named match
  // they alias — same GROUP-stage group, same comparable kickoff date, and the
  // real side appears in the target pairing. Only an UNAMBIGUOUS (exactly one)
  // target merges; anything else stays a separate record. Deterministic and
  // conservative: a wrong merge would hide data, an unmerged row is visible.
  for (const candidate of placeholderSided) {
    const realSide = isPlaceholderTeamName(candidate.homeTeamName)
      ? { name: candidate.awayTeamName, code: candidate.awayTeamCode }
      : { name: candidate.homeTeamName, code: candidate.homeTeamCode };
    const realKey = canonicalTeamKey(realSide.name, { code: realSide.code });
    const candidateDate = comparableDateLabel(candidate.kickoffDateLabel);
    const candidateStage = normalizeStage(
      candidate.stageLabel,
      candidate.roundLabel,
      candidate.groupName,
    );

    const targets =
      realKey === null || candidateDate === null || candidateStage !== "GROUP"
        ? []
        : [...byKey.entries()].filter(([key, group]) => {
            if (!key.startsWith(`GROUP|${candidate.groupName ?? "?"}|`)) {
              return false;
            }
            if (!key.includes(realKey)) return false;
            return group.some(
              (target) =>
                comparableDateLabel(target.kickoffDateLabel) === candidateDate,
            );
          });

    if (targets.length === 1) {
      targets[0][1].push(candidate);
    } else {
      const ownKey = matchIdentityKey(candidate) as string;
      byKey.set(ownKey, [...(byKey.get(ownKey) ?? []), candidate]);
    }
  }

  const matches: Normalized2026Match[] = [];
  const conflicts: ConflictEntry[] = [];

  for (const [key, group] of [...byKey.entries()].sort()) {
    const sorted = [...group].sort(
      (a, b) =>
        sourcePriority(a.sourceRef.sourceId) - sourcePriority(b.sourceRef.sourceId),
    );
    const primary = sorted[0];
    const homeKey = canonicalTeamKey(primary.homeTeamName, {
      code: primary.homeTeamCode,
    });

    // Align every candidate's scores to the primary orientation.
    const oriented: OrientedCandidate[] = sorted.map((candidate) => {
      const candidateHomeKey = canonicalTeamKey(candidate.homeTeamName, {
        code: candidate.homeTeamCode,
      });
      const flipped = candidateHomeKey !== null && candidateHomeKey !== homeKey;
      return {
        ...candidate,
        orientedHomeScore: (flipped ? candidate.awayScore : candidate.homeScore) ?? null,
        orientedAwayScore: (flipped ? candidate.homeScore : candidate.awayScore) ?? null,
        orientedHomePens:
          (flipped ? candidate.awayPenaltyScore : candidate.homePenaltyScore) ?? null,
        orientedAwayPens:
          (flipped ? candidate.homePenaltyScore : candidate.awayPenaltyScore) ?? null,
      };
    });

    const vote = <T>(read: (c: OrientedCandidate) => T | null | undefined): FieldVote<T | null | undefined>[] =>
      oriented.map((candidate) => ({
        sourceId: candidate.sourceRef.sourceId,
        value: read(candidate),
      }));

    const stageField = mergeField(
      vote((c) => normalizeStage(c.stageLabel, c.roundLabel, c.groupName)),
      (value) => value,
    );
    const groupField = mergeField(vote((c) => c.groupName), (value) => value);
    const homeScore = mergeField(vote((c) => c.orientedHomeScore));
    const awayScore = mergeField(vote((c) => c.orientedAwayScore));
    const homePens = mergeField(vote((c) => c.orientedHomePens));
    const awayPens = mergeField(vote((c) => c.orientedAwayPens));
    const matchNumber = mergeField(vote((c) => c.matchNumber));
    // UNKNOWN is "no claim", not a status vote — e.g. an unverified manual
    // reference row abstains rather than fake-conflicting with real statuses.
    const status = mergeField(
      vote((c) => (c.status === "UNKNOWN" ? null : c.status)),
      (value) => value,
    );
    const dateLabel = mergeField(
      vote((c) => c.kickoffDateLabel),
      (value) => comparableDateLabel(value) ?? value,
    );
    const timeLabel = mergeField(
      vote((c) => c.kickoffTimeLabel),
      (value) => comparableTimeLabel(value) ?? value,
    );
    const kickoffUtc = mergeField(vote((c) => c.kickoffAtUtc), (value) => value);
    const venueName = mergeField(vote((c) => c.venueName), (value) => canonicalVenueKey(value) ?? value);
    const cityName = mergeField(vote((c) => c.cityName), (value) => canonicalCityKey(value) ?? value);

    const sourceIds = sortedUnique(group.map((c) => c.sourceRef.sourceId));

    // Major fields: a disagreement here poisons the record.
    let hasMajorConflict = false;
    for (const [field, merged] of [
      ["stage", stageField],
      ["groupName", groupField],
      ["homeScore", homeScore],
      ["awayScore", awayScore],
      ["homePenaltyScore", homePens],
      ["awayPenaltyScore", awayPens],
      ["matchNumber", matchNumber],
    ] as const) {
      if (merged.agreement === "CONFLICT") {
        hasMajorConflict = true;
        conflicts.push(conflictFromField("matches", key, field, merged as never));
      }
    }
    // Minor fields: reported, but the record survives as NEEDS_REVIEW.
    let hasMinorConflict = false;
    for (const [field, merged, note] of [
      ["status", status, "Lower-priority snapshot may be stale (e.g. pre-tournament data)."],
      ["kickoffDateLabel", dateLabel, undefined],
      ["kickoffTimeLabel", timeLabel, undefined],
      ["kickoffAtUtc", kickoffUtc, undefined],
      ["venueName", venueName, undefined],
      ["cityName", cityName, undefined],
    ] as const) {
      if (merged.agreement === "CONFLICT") {
        hasMinorConflict = true;
        conflicts.push(conflictFromField("matches", key, field, merged as never, note));
      }
    }

    const stage: MatchStage = stageField.value ?? "UNKNOWN";
    const homeName =
      nameByKey.get(homeKey ?? "") ?? primary.homeTeamName ?? null;
    const awayKeyCanonical = canonicalTeamKey(primary.awayTeamName, {
      code: primary.awayTeamCode,
    });
    const awayName =
      nameByKey.get(awayKeyCanonical ?? "") ?? primary.awayTeamName ?? null;

    // Winner is derived, never guessed: decisive score, else penalties.
    let winnerTeamName: string | null = null;
    if (
      stage !== "GROUP" &&
      status.value === "FINISHED" &&
      homeScore.value !== null &&
      awayScore.value !== null
    ) {
      if (homeScore.value > awayScore.value) winnerTeamName = homeName;
      else if (homeScore.value < awayScore.value) winnerTeamName = awayName;
      else if (homePens.value !== null && awayPens.value !== null) {
        winnerTeamName = homePens.value > awayPens.value ? homeName : awayName;
      }
    }

    const incomplete =
      stage === "UNKNOWN" ||
      homeName === null ||
      awayName === null ||
      // A record still naming a qualification placeholder is unresolved.
      isPlaceholderTeamName(homeName) ||
      isPlaceholderTeamName(awayName);

    let verificationStatus: VerificationStatus;
    if (hasMajorConflict) verificationStatus = "CONFLICTED";
    else if (incomplete) verificationStatus = "INCOMPLETE";
    else if (hasMinorConflict || sourceIds.length < 2) verificationStatus = "NEEDS_REVIEW";
    else verificationStatus = "READY";

    // Result confidence: for finished matches the score must be multi-source
    // agreed; identity-only agreement is not enough.
    let confidence: ConfidenceLevel;
    if (hasMajorConflict) confidence = "CONFLICTED";
    else if (incomplete) confidence = "UNVERIFIED";
    else if (status.value === "FINISHED") {
      confidence = agreementConfidence(homeScore.sourceIds.length);
    } else {
      confidence = agreementConfidence(sourceIds.length);
    }

    // Round label: first non-null across priority-sorted candidates (the
    // manual reference pack often has no matchday label; the baseline does).
    const round =
      sorted.find((c) => c.roundLabel != null)?.roundLabel ?? null;

    matches.push({
      // An identifier in dispute is withheld, not guessed: carrying either
      // side's number would fabricate certainty and can collide with the
      // number of a different match. The disagreement stays in conflicts.
      matchNumber:
        matchNumber.agreement === "CONFLICT" ? null : matchNumber.value,
      sourceMatchId: primary.sourceMatchId ?? null,
      stage,
      round,
      groupName: groupField.value,
      kickoffAtUtc: kickoffUtc.value,
      kickoffDateLabel: comparableDateLabel(dateLabel.value),
      kickoffTimeLabel: timeLabel.value,
      homeTeamName: homeName,
      awayTeamName: awayName,
      homeTeamCode: primary.homeTeamCode ?? null,
      awayTeamCode: primary.awayTeamCode ?? null,
      homeScore: homeScore.value,
      awayScore: awayScore.value,
      homePenaltyScore: homePens.value,
      awayPenaltyScore: awayPens.value,
      winnerTeamName,
      venueName: venueName.value,
      cityName: cityName.value,
      status: status.value ?? "UNKNOWN",
      sourceIds,
      confidence,
      verificationStatus,
      rawSourceRefs: sorted.map((c) => c.sourceRef),
    });
  }

  // Orphans (no resolvable identity) are preserved as INCOMPLETE records —
  // never silently dropped.
  for (const orphan of orphans) {
    matches.push({
      matchNumber: orphan.matchNumber ?? null,
      sourceMatchId: orphan.sourceMatchId ?? null,
      stage: normalizeStage(orphan.stageLabel, orphan.roundLabel, orphan.groupName),
      round: orphan.roundLabel ?? null,
      groupName: orphan.groupName ?? null,
      kickoffAtUtc: orphan.kickoffAtUtc ?? null,
      kickoffDateLabel: comparableDateLabel(orphan.kickoffDateLabel),
      kickoffTimeLabel: orphan.kickoffTimeLabel ?? null,
      homeTeamName: orphan.homeTeamName ?? null,
      awayTeamName: orphan.awayTeamName ?? null,
      homeTeamCode: orphan.homeTeamCode ?? null,
      awayTeamCode: orphan.awayTeamCode ?? null,
      homeScore: orphan.homeScore ?? null,
      awayScore: orphan.awayScore ?? null,
      homePenaltyScore: orphan.homePenaltyScore ?? null,
      awayPenaltyScore: orphan.awayPenaltyScore ?? null,
      winnerTeamName: null,
      venueName: orphan.venueName ?? null,
      cityName: orphan.cityName ?? null,
      status: orphan.status,
      sourceIds: [orphan.sourceRef.sourceId],
      confidence: "UNVERIFIED",
      verificationStatus: "INCOMPLETE",
      rawSourceRefs: [orphan.sourceRef],
    });
  }

  // A stale source's unresolved placeholder row can still carry a match
  // number that a fully-resolved match already owns (pre-tournament schedule
  // numbering drift). The identifier is in dispute: withhold it on the
  // UNVERIFIED record and report the collision — a placeholder row must not
  // poison the resolved numbering, and the record itself stays visible.
  const numberOwners = new Map<number, Normalized2026Match[]>();
  for (const match of matches) {
    if (match.matchNumber != null) {
      numberOwners.set(match.matchNumber, [
        ...(numberOwners.get(match.matchNumber) ?? []),
        match,
      ]);
    }
  }
  for (const [num, owners] of numberOwners) {
    const resolved = owners.filter((m) => m.confidence !== "UNVERIFIED");
    const unresolved = owners.filter((m) => m.confidence === "UNVERIFIED");
    if (owners.length < 2 || resolved.length !== 1 || unresolved.length === 0) {
      continue; // genuine duplicates stay for the validator to flag
    }
    for (const match of unresolved) {
      conflicts.push({
        entityType: "matches",
        entityKey: `match-number-${num}`,
        field: "matchNumber",
        values: [
          {
            sourceId: resolved[0].sourceIds[0] ?? "unknown",
            value: `${num} (${resolved[0].homeTeamName ?? "?"} v ${resolved[0].awayTeamName ?? "?"})`,
          },
          {
            sourceId: match.sourceIds[0] ?? "unknown",
            value: `${num} (${match.homeTeamName ?? "?"} v ${match.awayTeamName ?? "?"}, unverified)`,
          },
        ],
        resolution: "KEPT_HIGHEST_PRIORITY",
        note:
          "Unverified/placeholder record claimed a match number owned by a " +
          "resolved match; the number is withheld on the unverified record.",
      });
      match.matchNumber = null;
    }
  }

  // Deterministic order: stage progression, then match number, then key data.
  const stageOrder: Record<MatchStage, number> = {
    GROUP: 0,
    ROUND_OF_32: 1,
    ROUND_OF_16: 2,
    QUARTER_FINAL: 3,
    SEMI_FINAL: 4,
    THIRD_PLACE: 5,
    FINAL: 6,
    UNKNOWN: 7,
  };
  matches.sort(
    (a, b) =>
      stageOrder[a.stage] - stageOrder[b.stage] ||
      (a.matchNumber ?? 9999) - (b.matchNumber ?? 9999) ||
      (a.kickoffDateLabel ?? "").localeCompare(b.kickoffDateLabel ?? "") ||
      (a.homeTeamName ?? "").localeCompare(b.homeTeamName ?? ""),
  );

  return { matches, conflicts };
}

// ---------------------------------------------------------------------------
// Tournament (fully derived from the other normalized outputs)
// ---------------------------------------------------------------------------

/** Verified podium reference from the manual pack (display names). */
export type ManualTournamentRef = {
  winner: string | null;
  runnerUp: string | null;
  thirdPlace: string | null;
  fourthPlace: string | null;
  verified: boolean;
};

export function buildTournament(input: {
  teams: Normalized2026Team[];
  groups: Normalized2026Group[];
  venues: Normalized2026Venue[];
  matches: Normalized2026Match[];
  conflictsCount: number;
  /** When present and verified, wins the podium fields (conflicts reported). */
  manualRef?: ManualTournamentRef | null;
}): { tournament: Normalized2026Tournament; conflicts: ConflictEntry[] } {
  const { teams, groups, venues, matches } = input;
  const conflicts: ConflictEntry[] = [];

  // Host countries, deduped by country identity (so "USA" and
  // "United States" collapse); the most frequent spelling wins, ties
  // alphabetically. Deterministic.
  const hostNameCounts = new Map<string, Map<string, number>>();
  for (const venue of venues) {
    const country = venue.countryName;
    if (country == null || country === "") continue;
    const key = canonicalTeamKey(country) ?? country;
    const spellings = hostNameCounts.get(key) ?? new Map<string, number>();
    spellings.set(country, (spellings.get(country) ?? 0) + 1);
    hostNameCounts.set(key, spellings);
  }
  const hostCountries = [...hostNameCounts.values()]
    .map(
      (spellings) =>
        [...spellings.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        )[0][0],
    )
    .sort();

  const dates = matches
    .map((match) => match.kickoffDateLabel)
    .filter((date): date is string => date != null && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();

  const final = matches.find(
    (match) => match.stage === "FINAL" && match.status === "FINISHED",
  );
  const thirdPlace = matches.find(
    (match) => match.stage === "THIRD_PLACE" && match.status === "FINISHED",
  );
  const loserOf = (match: Normalized2026Match | undefined): string | null => {
    if (match?.winnerTeamName == null) return null;
    return match.winnerTeamName === match.homeTeamName
      ? (match.awayTeamName ?? null)
      : (match.homeTeamName ?? null);
  };

  const sourceIds = sortedUnique(matches.flatMap((match) => match.sourceIds));

  // Counts describe the resolved tournament: qualification placeholders and
  // unresolved leftover records are excluded (they remain visible in
  // teams.json / matches.json and in the validator's total counts).
  const realTeamsCount = teams.filter(
    (team) => !isPlaceholderTeamName(team.name),
  ).length;
  const resolvedMatchesCount = matches.filter(
    (match) => match.verificationStatus !== "INCOMPLETE",
  ).length;

  // Podium: derived from match results, then checked against (and, when
  // verified, preferred from) the manual reference pack. A verified manual
  // value that AGREES with the derivation upgrades confidence; one that
  // DISAGREES is a reported conflict — never a silent override of evidence.
  const derivedPodium = {
    winner: final?.winnerTeamName ?? null,
    runnerUp: loserOf(final),
    thirdPlace: thirdPlace?.winnerTeamName ?? null,
    fourthPlace: loserOf(thirdPlace),
  };
  const manualRef = input.manualRef ?? null;
  const podium = { ...derivedPodium };
  let podiumAgreement = false;
  let podiumConflict = false;
  if (manualRef !== null && manualRef.verified) {
    podiumAgreement = true;
    for (const field of ["winner", "runnerUp", "thirdPlace", "fourthPlace"] as const) {
      const manualValue = manualRef[field];
      if (manualValue === null) continue;
      const derivedValue = derivedPodium[field];
      const sameTeam =
        derivedValue !== null &&
        canonicalTeamKey(manualValue) === canonicalTeamKey(derivedValue);
      if (derivedValue !== null && !sameTeam) {
        podiumConflict = true;
        podiumAgreement = false;
        conflicts.push({
          entityType: "tournament",
          entityKey: `${TOURNAMENT_YEAR}`,
          field,
          values: [
            { sourceId: "manual_verified_2026_pack_v1", value: manualValue },
            { sourceId: "derived-from-matches", value: derivedValue },
          ],
          resolution: "KEPT_HIGHEST_PRIORITY",
          note: "Verified manual reference disagrees with the match-derived value.",
        });
      }
      // Verified manual reference wins the recorded value either way.
      podium[field] = manualValue;
    }
  }

  const tournament: Normalized2026Tournament = {
    tournamentYear: TOURNAMENT_YEAR,
    name: TOURNAMENT_NAME,
    hostCountries,
    teamsCount: realTeamsCount,
    groupsCount: groups.length,
    matchesCount: resolvedMatchesCount,
    venuesCount: venues.length,
    startDate: dates[0] ?? null,
    endDate: dates[dates.length - 1] ?? null,
    winner: podium.winner,
    runnerUp: podium.runnerUp,
    thirdPlace: podium.thirdPlace,
    fourthPlace: podium.fourthPlace,
    sourceIds: sourceIds.length > 0 ? sourceIds : ["none"],
    // Derived by default; a verified manual reference that corroborates the
    // derivation makes the record multi-source verified; a disagreement
    // marks it conflicted.
    confidence: podiumConflict
      ? "CONFLICTED"
      : podiumAgreement
        ? "MULTI_SOURCE_VERIFIED"
        : "DERIVED",
    verificationStatus: podiumConflict ? "CONFLICTED" : "NEEDS_REVIEW",
  };
  return { tournament, conflicts };
}

// ---------------------------------------------------------------------------
// Orchestration (file IO)
// ---------------------------------------------------------------------------

export type Normalized2026Award = {
  award: string;
  winner: string | null;
  team: string | null;
  detail?: string | null;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
};

export type NormalizationRunResult = {
  tournament: Normalized2026Tournament;
  teams: Normalized2026Team[];
  groups: Normalized2026Group[];
  venues: Normalized2026Venue[];
  matches: Normalized2026Match[];
  standings: Normalized2026Standing[];
  conflicts: ConflictEntry[];
  awards: Normalized2026Award[];
  bracketStages: number;
  candidateErrors: number;
  manualPack: ManualPackStats;
  manualPackUnresolvedGroups: number;
};

async function readCandidateFile<T>(
  candidatesDir: string,
  fileName: string,
): Promise<CandidateFile<T> | null> {
  try {
    const body = await readFile(path.join(candidatesDir, fileName), "utf8");
    return JSON.parse(body) as CandidateFile<T>;
  } catch {
    return null;
  }
}

async function readSnapshotMetas(rawDir: string): Promise<SnapshotMeta[]> {
  const metas: SnapshotMeta[] = [];
  let sourceDirs: string[] = [];
  try {
    sourceDirs = await readdir(rawDir);
  } catch {
    return metas;
  }
  for (const sourceDir of sourceDirs.sort()) {
    let files: string[] = [];
    try {
      files = await readdir(path.join(rawDir, sourceDir));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      if (!file.endsWith(".meta.json")) continue;
      try {
        const body = await readFile(path.join(rawDir, sourceDir, file), "utf8");
        metas.push(JSON.parse(body) as SnapshotMeta);
      } catch {
        // Unreadable sidecar — coverage report will show the gap.
      }
    }
  }
  return metas;
}

function validateAll<T>(schema: ZodType<T>, records: unknown[], label: string): T[] {
  return records.map((record, index) => {
    const result = schema.safeParse(record);
    if (!result.success) {
      throw new Error(
        `Normalized ${label}[${index}] failed contract validation: ${result.error.message}`,
      );
    }
    return result.data;
  });
}

async function writeJson(dir: string, fileName: string, payload: unknown): Promise<void> {
  await writeFile(
    path.join(dir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Full Phase 1 normalization run: candidates → normalized files. Everything
 * is Zod-validated before writing. Incomplete data still produces output —
 * flagged NEEDS_REVIEW / INCOMPLETE — because "no silent gaps" beats "no
 * output". Never touches the database.
 */
export async function runNormalization(options?: {
  candidatesDir?: string;
  normalizedDir?: string;
  rawDir?: string;
  manualPackDir?: string;
}): Promise<NormalizationRunResult> {
  const candidatesDir = options?.candidatesDir ?? CANDIDATES_2026_DIR;
  const normalizedDir = options?.normalizedDir ?? NORMALIZED_2026_DIR;
  const rawDir = options?.rawDir ?? RAW_2026_DIR;

  const teamsFile = await readCandidateFile<CandidateTeam>(candidatesDir, "teams.candidates.json");
  const groupsFile = await readCandidateFile<CandidateGroup>(candidatesDir, "groups.candidates.json");
  const venuesFile = await readCandidateFile<CandidateVenue>(candidatesDir, "venues.candidates.json");
  const matchesFile = await readCandidateFile<CandidateMatch>(candidatesDir, "matches.candidates.json");
  const standingsFile = await readCandidateFile<CandidateStanding>(candidatesDir, "standings.candidates.json");

  const candidateErrors =
    (teamsFile?.errors.length ?? 0) +
    (groupsFile?.errors.length ?? 0) +
    (venuesFile?.errors.length ?? 0) +
    (matchesFile?.errors.length ?? 0) +
    (standingsFile?.errors.length ?? 0);

  // Optional human-authenticated reference pack (highest priority source).
  // Absent pack → pipeline runs exactly as before. Malformed pack → hard
  // error: a broken reference must be fixed, not silently skipped.
  const packLoad = await loadManualReferencePack(options?.manualPackDir);
  if (packLoad !== null && !packLoad.ok) {
    throw new Error(
      `Manual reference pack is malformed:\n- ${packLoad.errors.join("\n- ")}`,
    );
  }
  const pack = packLoad?.ok === true ? packLoad.pack : null;

  // Team-set → group name map from the fetched sources, used to resolve the
  // pack's unconfirmed group letters deterministically (exact set match).
  const letterByTeamSet = new Map<string, string>();
  for (const candidate of groupsFile?.records ?? []) {
    const key = candidate.teamNames
      .map((team) => canonicalTeamKey(team) ?? team)
      .sort()
      .join("|");
    if (!letterByTeamSet.has(key)) letterByTeamSet.set(key, candidate.name);
  }
  const packCandidates =
    pack !== null
      ? manualPackToCandidates(pack, letterByTeamSet, (name, code) =>
          canonicalTeamKey(name, { fifaCode: code ?? null }),
        )
      : null;

  const teamMerge = mergeTeams([
    ...(teamsFile?.records ?? []),
    ...(packCandidates?.teams ?? []),
  ]);
  const groupMerge = mergeGroups(
    [...(groupsFile?.records ?? []), ...(packCandidates?.groups ?? [])],
    teamMerge.nameByKey,
  );
  const venueMerge = mergeVenues([
    ...(venuesFile?.records ?? []),
    ...(packCandidates?.venues ?? []),
  ]);
  const matchMerge = mergeMatches(
    [...(matchesFile?.records ?? []), ...(packCandidates?.matches ?? [])],
    teamMerge.nameByKey,
  );

  // Derived standings from normalized group results.
  const standingSourceIds = sortedUnique(
    matchMerge.matches
      .filter((match) => match.stage === "GROUP")
      .flatMap((match) => match.sourceIds),
  );
  const derived = computeGroupStandings(matchMerge.matches, standingSourceIds);

  // Compare with provider/reference tables where supplied — one comparison
  // per source so a stale provider and the manual reference are judged
  // independently against the derived tables.
  const toProviderRow = (row: CandidateStanding): ProviderStandingRow => ({
    groupName: row.groupName,
    teamName: row.teamName,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    points: row.points,
    sourceId: row.sourceRef.sourceId,
  });
  const providerRowsBySource = new Map<string, ProviderStandingRow[]>();
  for (const row of [
    ...(standingsFile?.records ?? []),
    ...(packCandidates?.standings ?? []),
  ]) {
    const providerRow = toProviderRow(row);
    providerRowsBySource.set(providerRow.sourceId, [
      ...(providerRowsBySource.get(providerRow.sourceId) ?? []),
      providerRow,
    ]);
  }
  const standingConflictsBySource = new Map<string, ConflictEntry[]>();
  for (const [sourceId, rows] of [...providerRowsBySource.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    standingConflictsBySource.set(
      sourceId,
      compareStandingsWithProvider(derived.standings, rows, (name) =>
        canonicalTeamKey(name),
      ),
    );
  }
  const standingConflicts = [...standingConflictsBySource.values()].flat();

  // A group whose table disagrees with any provider is not READY…
  const conflictedGroups = new Set(standingConflicts.map((c) => c.entityKey));
  // …while a group the verified manual reference corroborates is upgraded.
  const manualStandingGroups = new Set(
    (packCandidates?.standings ?? []).map((row) => row.groupName),
  );
  const manualStandingConflictGroups = new Set(
    (standingConflictsBySource.get(MANUAL_PACK_SOURCE_ID) ?? []).map(
      (c) => c.entityKey,
    ),
  );
  const standings = derived.standings.map((row) => {
    if (
      manualStandingGroups.has(row.groupName) &&
      !manualStandingConflictGroups.has(row.groupName) &&
      !conflictedGroups.has(row.groupName)
    ) {
      // Derived table matches the human-authenticated reference table.
      return {
        ...row,
        confidence: "MULTI_SOURCE_VERIFIED" as const,
      };
    }
    return conflictedGroups.has(row.groupName) &&
      row.verificationStatus === "READY"
      ? { ...row, verificationStatus: "NEEDS_REVIEW" as const }
      : row;
  });

  const conflicts: ConflictEntry[] = [
    ...teamMerge.conflicts,
    ...groupMerge.conflicts,
    ...venueMerge.conflicts,
    ...matchMerge.conflicts,
    ...standingConflicts,
    // Known manual conflicts from the pack's own conflict registry —
    // preserved verbatim, never auto-resolved.
    ...(packCandidates?.conflicts ?? []),
  ];

  // Verified podium reference (pack codes → normalized display names).
  const codeToDisplay = (code: string | null | undefined): string | null => {
    if (code == null) return null;
    const key = canonicalTeamKey(code, { fifaCode: code });
    return teamMerge.nameByKey.get(key ?? "") ?? code;
  };
  const manualRef =
    pack?.tournament != null
      ? {
          winner: codeToDisplay(pack.tournament.champion),
          runnerUp: codeToDisplay(pack.tournament.runner_up),
          thirdPlace: codeToDisplay(pack.tournament.third),
          fourthPlace: codeToDisplay(pack.tournament.fourth),
          verified: pack.tournament.verification === "verified",
        }
      : null;

  const tournamentBuild = buildTournament({
    teams: teamMerge.teams,
    groups: groupMerge.groups,
    venues: venueMerge.venues,
    matches: matchMerge.matches,
    conflictsCount: conflicts.length,
    manualRef,
  });
  const tournament = tournamentBuild.tournament;
  conflicts.push(...tournamentBuild.conflicts);

  // Awards — reference-pack only (no archive award import in this phase).
  // Verified awards are human-set values: MANUAL_OVERRIDE; anything else
  // stays UNVERIFIED and review-required.
  const awards: Normalized2026Award[] = Object.entries(pack?.awards ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([award, entry]) => ({
      award,
      winner: entry.winner ?? null,
      team: codeToDisplay(entry.team) ?? entry.team ?? null,
      detail: typeof entry.detail === "string" ? entry.detail : null,
      sourceIds: [MANUAL_PACK_SOURCE_ID],
      confidence:
        entry.verification === "verified" ? "MANUAL_OVERRIDE" : "UNVERIFIED",
      verificationStatus:
        entry.verification === "verified" ? "READY" : "NEEDS_REVIEW",
    }));

  // Contract validation before anything is written.
  const validTournament = validateAll(normalized2026TournamentSchema, [tournament], "tournament")[0];
  const validTeams = validateAll(normalized2026TeamSchema, teamMerge.teams, "teams");
  const validGroups = validateAll(normalized2026GroupSchema, groupMerge.groups, "groups");
  const validVenues = validateAll(normalized2026VenueSchema, venueMerge.venues, "venues");
  const validMatches = validateAll(normalized2026MatchSchema, matchMerge.matches, "matches");
  const validStandings = validateAll(normalized2026StandingSchema, standings, "standings");
  const validConflicts = validateAll(conflictEntrySchema, conflicts, "conflicts");

  // Bracket view: knockout matches grouped by stage in play order.
  const knockoutStages = ["ROUND_OF_32", "ROUND_OF_16", "QUARTER_FINAL", "SEMI_FINAL", "THIRD_PLACE", "FINAL"] as const;
  const bracket = {
    generatedAt: new Date().toISOString(),
    stages: knockoutStages
      .map((stage) => ({
        stage,
        matches: validMatches
          .filter((match) => match.stage === stage)
          .map((match) => ({
            matchNumber: match.matchNumber ?? null,
            homeTeamName: match.homeTeamName ?? null,
            awayTeamName: match.awayTeamName ?? null,
            homeScore: match.homeScore ?? null,
            awayScore: match.awayScore ?? null,
            homePenaltyScore: match.homePenaltyScore ?? null,
            awayPenaltyScore: match.awayPenaltyScore ?? null,
            winnerTeamName: match.winnerTeamName ?? null,
            verificationStatus: match.verificationStatus,
          })),
      }))
      .filter((stageEntry) => stageEntry.matches.length > 0),
  };

  // Source usage snapshot for traceability — including the manual pack's
  // manifest, per-file hashes and pack hash plus its own source attributions.
  const snapshotMetas = await readSnapshotMetas(rawDir);
  const packStats = buildManualPackStats(pack);
  const sourcesPayload = {
    generatedAt: new Date().toISOString(),
    registry: APPROVED_2026_SOURCES,
    snapshots: snapshotMetas,
    manualReferencePack:
      pack === null
        ? null
        : {
            manifest: pack.manifest,
            packHash: pack.packHash,
            fileHashes: pack.fileHashes,
            stats: packStats,
            unresolvedGroups: packCandidates?.unresolvedGroups ?? 0,
            attributedSources: pack.sources?.sources ?? [],
          },
    recordCounts: {
      teams: validTeams.length,
      groups: validGroups.length,
      venues: validVenues.length,
      matches: validMatches.length,
      standings: validStandings.length,
      awards: awards.length,
      conflicts: validConflicts.length,
    },
  };

  await mkdir(normalizedDir, { recursive: true });
  const stamp = (records: unknown) => ({
    generatedAt: new Date().toISOString(),
    records,
  });
  await writeJson(normalizedDir, "tournament.json", {
    generatedAt: new Date().toISOString(),
    record: validTournament,
  });
  await writeJson(normalizedDir, "teams.json", stamp(validTeams));
  await writeJson(normalizedDir, "groups.json", stamp(validGroups));
  await writeJson(normalizedDir, "venues.json", stamp(validVenues));
  await writeJson(normalizedDir, "matches.json", stamp(validMatches));
  await writeJson(normalizedDir, "standings.json", stamp(validStandings));
  await writeJson(normalizedDir, "bracket.json", bracket);
  await writeJson(normalizedDir, "sources.json", sourcesPayload);
  await writeJson(normalizedDir, "conflicts.json", stamp(validConflicts));
  // Awards are reference data only (no archive award model yet) — written
  // for the report and future review, never imported.
  await writeJson(normalizedDir, "awards.json", stamp(awards));

  return {
    tournament: validTournament,
    teams: validTeams,
    groups: validGroups,
    venues: validVenues,
    matches: validMatches,
    standings: validStandings,
    conflicts: validConflicts,
    awards,
    bracketStages: bracket.stages.length,
    candidateErrors,
    manualPack: packStats,
    manualPackUnresolvedGroups: packCandidates?.unresolvedGroups ?? 0,
  };
}
