import { describe, expect, it } from "vitest";

import {
  compareStandingsWithProvider,
  computeGroupStandings,
} from "../../../src/server/agents/worldcup2026/standings";
import { canonicalTeamKey } from "../../../src/server/agents/worldcup2026/resolver";
import type { Normalized2026Match } from "../../../src/server/agents/worldcup2026/types";

const SOURCES = ["openfootball_worldcup_2026"];

function groupMatch(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
): Normalized2026Match {
  return {
    stage: "GROUP",
    groupName: "Group A",
    homeTeamName: home,
    awayTeamName: away,
    homeScore,
    awayScore,
    status: "FINISHED",
    sourceIds: SOURCES,
    confidence: "SINGLE_SOURCE",
    verificationStatus: "NEEDS_REVIEW",
    rawSourceRefs: [],
  };
}

/** A complete 4-team round-robin with distinct results. */
const COMPLETE_GROUP: Normalized2026Match[] = [
  groupMatch("Mexico", "South Africa", 2, 0),
  groupMatch("South Korea", "Czech Republic", 2, 1),
  groupMatch("Mexico", "South Korea", 1, 0),
  groupMatch("Czech Republic", "South Africa", 1, 1),
  groupMatch("Czech Republic", "Mexico", 0, 3),
  groupMatch("South Africa", "South Korea", 1, 0),
];

describe("computeGroupStandings", () => {
  it("computes a 4-team group table with 3/1/0 points", () => {
    const { standings, incompleteGroups } = computeGroupStandings(
      COMPLETE_GROUP,
      SOURCES,
    );
    expect(incompleteGroups).toEqual([]);
    expect(standings).toHaveLength(4);

    const mexico = standings.find((row) => row.teamName === "Mexico");
    expect(mexico).toMatchObject({
      played: 3,
      wins: 3,
      draws: 0,
      losses: 0,
      goalsFor: 6,
      goalsAgainst: 0,
      goalDifference: 6,
      points: 9,
      rank: 1,
      confidence: "DERIVED",
    });

    const southAfrica = standings.find((row) => row.teamName === "South Africa");
    expect(southAfrica).toMatchObject({ points: 4, rank: 2 });

    const czech = standings.find((row) => row.teamName === "Czech Republic");
    expect(czech).toMatchObject({ points: 1, rank: 4, goalDifference: -4 });
  });

  it("ranks by points, then goal difference, then goals for", () => {
    const { standings } = computeGroupStandings(COMPLETE_GROUP, SOURCES);
    expect(standings.map((row) => row.teamName)).toEqual([
      "Mexico",
      "South Africa",
      "South Korea",
      "Czech Republic",
    ]);
    // South Africa and South Korea are separated by points (4 vs 3).
    expect(standings[1].points).toBe(4);
    expect(standings[2].points).toBe(3);
  });

  it("flags unresolvable ties as NEEDS_REVIEW instead of inventing an order", () => {
    const tied: Normalized2026Match[] = [
      groupMatch("Team Alpha", "Team Beta", 1, 1),
    ];
    const { standings, incompleteGroups } = computeGroupStandings(tied, SOURCES);
    // Identical records (1 draw each) tie on pts/gd/gf.
    expect(standings.every((row) => row.verificationStatus === "NEEDS_REVIEW")).toBe(
      true,
    );
    // And the 2-team group with 1 of 1 required games is complete; larger
    // incomplete groups are reported:
    expect(incompleteGroups).toEqual([]);
    const partial = computeGroupStandings(
      [groupMatch("A Team", "B Team", 1, 0), groupMatch("A Team", "C Team", 2, 0)],
      SOURCES,
    );
    expect(partial.incompleteGroups).toEqual(["Group A"]);
    expect(
      partial.standings.every((row) => row.verificationStatus === "NEEDS_REVIEW"),
    ).toBe(true);
  });

  it("ignores unfinished and knockout matches", () => {
    const noise: Normalized2026Match[] = [
      { ...groupMatch("Mexico", "South Africa", 2, 0), status: "SCHEDULED" },
      { ...groupMatch("Spain", "Argentina", 1, 0), stage: "FINAL", groupName: null },
    ];
    expect(computeGroupStandings(noise, SOURCES).standings).toHaveLength(0);
  });
});

describe("compareStandingsWithProvider", () => {
  const teamKey = (name: string) => canonicalTeamKey(name);

  it("is silent when derived and provider tables agree", () => {
    const { standings } = computeGroupStandings(COMPLETE_GROUP, SOURCES);
    const provider = standings.map((row) => ({
      groupName: row.groupName,
      teamName: row.teamName,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      points: row.points,
      sourceId: "worldcup2026_repo",
    }));
    expect(compareStandingsWithProvider(standings, provider, teamKey)).toEqual([]);
  });

  it("reports a conflict when the provider table disagrees", () => {
    const { standings } = computeGroupStandings(COMPLETE_GROUP, SOURCES);
    const provider = [
      {
        groupName: "Group A",
        teamName: "Mexico",
        played: 0, // stale snapshot
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        sourceId: "worldcup2026_repo",
      },
    ];
    const conflicts = compareStandingsWithProvider(standings, provider, teamKey);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      entityType: "standings",
      entityKey: "Group A",
      field: "table",
      resolution: "UNRESOLVED",
    });
    expect(conflicts[0].note).toContain("played derived=3 provider=0");
  });

  it("matches provider rows through team aliases", () => {
    const derived = computeGroupStandings(
      [groupMatch("United States", "Mexico", 1, 0)],
      SOURCES,
    ).standings;
    const provider = [
      {
        groupName: "Group A",
        teamName: "USA", // alias of United States
        played: 1,
        wins: 1,
        draws: 0,
        losses: 0,
        goalsFor: 1,
        goalsAgainst: 0,
        points: 3,
        sourceId: "worldcup2026_repo",
      },
    ];
    expect(compareStandingsWithProvider(derived, provider, teamKey)).toEqual([]);
  });
});
