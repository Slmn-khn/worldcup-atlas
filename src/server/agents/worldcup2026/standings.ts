// Group-standings computation for the 2026 data steward agent (Phase 1).
//
// Pure and deterministic: standings are derived from normalized group-stage
// match results (win = 3, draw = 1, loss = 0). Phase 1 ranks by points, goal
// difference, then goals scored ONLY — FIFA's further tie-breakers
// (head-to-head, fair play, drawing of lots) are intentionally not modeled,
// so any rows still tied after goals-scored are flagged NEEDS_REVIEW instead
// of being silently ordered.
//
// Derived standings are compared against provider standings when a provider
// supplied its own group tables; every mismatch becomes a ConflictEntry.

import type {
  ConflictEntry,
  Normalized2026Match,
  Normalized2026Standing,
} from "./types";

export type StandingsComputation = {
  standings: Normalized2026Standing[];
  /** Groups whose match set was incomplete (fewer than all results in). */
  incompleteGroups: string[];
};

type MutableRow = {
  groupName: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

/** Matches usable for standings: finished group games with both scores. */
function isCompletedGroupMatch(match: Normalized2026Match): boolean {
  return (
    match.stage === "GROUP" &&
    match.status === "FINISHED" &&
    match.groupName != null &&
    match.homeTeamName != null &&
    match.awayTeamName != null &&
    typeof match.homeScore === "number" &&
    typeof match.awayScore === "number"
  );
}

/**
 * Computes group standings from normalized matches. Ranking within a group is
 * points desc, goal difference desc, goals for desc, then team name asc as a
 * deterministic (but NOT authoritative) final order; rows whose position was
 * decided only by the name fallback are marked NEEDS_REVIEW.
 *
 * A group is "complete" when every one of its teams has played every other
 * team once (n-1 games each); incomplete groups still produce rows but are
 * reported so the validator can flag them.
 */
export function computeGroupStandings(
  matches: Normalized2026Match[],
  sourceIds: string[],
): StandingsComputation {
  const rowsByGroup = new Map<string, Map<string, MutableRow>>();

  const rowFor = (groupName: string, teamName: string): MutableRow => {
    let group = rowsByGroup.get(groupName);
    if (group === undefined) {
      group = new Map();
      rowsByGroup.set(groupName, group);
    }
    let row = group.get(teamName);
    if (row === undefined) {
      row = {
        groupName,
        teamName,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      };
      group.set(teamName, row);
    }
    return row;
  };

  for (const match of matches) {
    if (!isCompletedGroupMatch(match)) continue;
    const home = rowFor(match.groupName as string, match.homeTeamName as string);
    const away = rowFor(match.groupName as string, match.awayTeamName as string);
    const homeScore = match.homeScore as number;
    const awayScore = match.awayScore as number;

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (homeScore < awayScore) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const standings: Normalized2026Standing[] = [];
  const incompleteGroups: string[] = [];

  for (const [groupName, group] of [...rowsByGroup.entries()].sort()) {
    const rows = [...group.values()];
    const expectedGames = rows.length - 1;
    const complete =
      rows.length >= 2 && rows.every((row) => row.played === expectedGames);
    if (!complete) incompleteGroups.push(groupName);

    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
        b.goalsFor - a.goalsFor ||
        a.teamName.localeCompare(b.teamName),
    );

    rows.forEach((row, index) => {
      // A row is only READY-rankable when it is NOT tied with a neighbor on
      // all modeled tie-breakers (pts, gd, gf).
      const tiedWithNeighbor = rows.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          Math.abs(otherIndex - index) === 1 &&
          other.points === row.points &&
          other.goalsFor - other.goalsAgainst === row.goalsFor - row.goalsAgainst &&
          other.goalsFor === row.goalsFor,
      );

      standings.push({
        groupName: row.groupName,
        teamName: row.teamName,
        played: row.played,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalsFor - row.goalsAgainst,
        points: row.points,
        rank: index + 1,
        sourceIds,
        confidence: "DERIVED",
        verificationStatus: !complete || tiedWithNeighbor ? "NEEDS_REVIEW" : "READY",
      });
    });
  }

  return { standings, incompleteGroups };
}

export type ProviderStandingRow = {
  groupName: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  sourceId: string;
};

/**
 * Compares derived standings with provider-supplied ones. Mismatches are
 * aggregated into ONE ConflictEntry per group (12 noisy per-team entries for
 * a stale provider snapshot would drown real conflicts) with the differing
 * team rows listed in the note.
 */
export function compareStandingsWithProvider(
  derived: Normalized2026Standing[],
  provider: ProviderStandingRow[],
  matchTeamKey: (name: string) => string | null,
): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];
  const groups = [...new Set(provider.map((row) => row.groupName))].sort();

  for (const groupName of groups) {
    const providerRows = provider.filter((row) => row.groupName === groupName);
    const derivedRows = derived.filter((row) => row.groupName === groupName);
    if (derivedRows.length === 0) continue;

    const mismatches: string[] = [];
    for (const providerRow of providerRows) {
      const key = matchTeamKey(providerRow.teamName);
      const derivedRow = derivedRows.find(
        (row) => matchTeamKey(row.teamName) === key,
      );
      if (derivedRow === undefined) {
        mismatches.push(`${providerRow.teamName}: not present in derived table`);
        continue;
      }
      const fields: Array<[string, number, number]> = [
        ["played", derivedRow.played, providerRow.played],
        ["wins", derivedRow.wins, providerRow.wins],
        ["draws", derivedRow.draws, providerRow.draws],
        ["losses", derivedRow.losses, providerRow.losses],
        ["goalsFor", derivedRow.goalsFor, providerRow.goalsFor],
        ["goalsAgainst", derivedRow.goalsAgainst, providerRow.goalsAgainst],
        ["points", derivedRow.points, providerRow.points],
      ];
      const diffs = fields.filter(([, a, b]) => a !== b);
      if (diffs.length > 0) {
        mismatches.push(
          `${providerRow.teamName}: ` +
            diffs.map(([field, a, b]) => `${field} derived=${a} provider=${b}`).join(", "),
        );
      }
    }

    if (mismatches.length > 0) {
      const sourceId = providerRows[0]?.sourceId ?? "unknown";
      conflicts.push({
        entityType: "standings",
        entityKey: groupName,
        field: "table",
        values: [
          { sourceId: "derived-from-matches", value: "computed from match results" },
          { sourceId, value: "provider group table" },
        ],
        resolution: "UNRESOLVED",
        note: `Derived vs provider mismatch — ${mismatches.join("; ")}`,
      });
    }
  }

  return conflicts;
}
