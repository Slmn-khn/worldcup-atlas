import { describe, expect, it } from "vitest";

import type {
  Normalized2026Match,
  Normalized2026Team,
} from "../../../src/server/agents/worldcup2026/types";
import {
  validateNormalizedDataSet,
  type NormalizedDataSet,
} from "../../../src/server/agents/worldcup2026/validator";

function team(name: string, groupName: string): Normalized2026Team {
  return {
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    groupName,
    sourceIds: ["openfootball_worldcup_2026", "worldcup2026_repo"],
    confidence: "MULTI_SOURCE_VERIFIED",
    verificationStatus: "READY",
  };
}

function finishedGroupMatch(
  matchNumber: number,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
): Normalized2026Match {
  return {
    matchNumber,
    stage: "GROUP",
    groupName: "Group A",
    homeTeamName: home,
    awayTeamName: away,
    homeScore,
    awayScore,
    status: "FINISHED",
    sourceIds: ["openfootball_worldcup_2026"],
    confidence: "SINGLE_SOURCE",
    verificationStatus: "NEEDS_REVIEW",
    rawSourceRefs: [],
  };
}

function baseDataSet(): NormalizedDataSet {
  const matches = [
    finishedGroupMatch(1, "Mexico", "South Africa", 2, 0),
    finishedGroupMatch(2, "South Korea", "Czech Republic", 2, 1),
    finishedGroupMatch(3, "Mexico", "South Korea", 1, 0),
    finishedGroupMatch(4, "Czech Republic", "South Africa", 1, 1),
    finishedGroupMatch(5, "Czech Republic", "Mexico", 0, 3),
    finishedGroupMatch(6, "South Africa", "South Korea", 1, 0),
  ];
  return {
    tournament: {
      tournamentYear: 2026,
      name: "World Cup 2026",
      hostCountries: ["Canada", "Mexico", "United States"],
      teamsCount: 4,
      groupsCount: 1,
      matchesCount: 6,
      venuesCount: 0,
      sourceIds: ["openfootball_worldcup_2026"],
      confidence: "DERIVED",
      verificationStatus: "NEEDS_REVIEW",
    },
    teams: [
      team("Mexico", "Group A"),
      team("South Africa", "Group A"),
      team("South Korea", "Group A"),
      team("Czech Republic", "Group A"),
    ],
    groups: [
      {
        name: "Group A",
        teams: ["Mexico", "South Africa", "South Korea", "Czech Republic"],
        sourceIds: ["openfootball_worldcup_2026", "worldcup2026_repo"],
        confidence: "MULTI_SOURCE_VERIFIED",
        verificationStatus: "READY",
      },
    ],
    venues: [],
    matches,
    standings: ["Mexico", "South Africa", "South Korea", "Czech Republic"].map(
      (name, index) => ({
        groupName: "Group A",
        teamName: name,
        played: 3,
        wins: 1,
        draws: 0,
        losses: 2,
        goalsFor: 3,
        goalsAgainst: 3,
        goalDifference: 0,
        points: 3,
        rank: index + 1,
        sourceIds: ["openfootball_worldcup_2026"],
        confidence: "DERIVED",
        verificationStatus: "NEEDS_REVIEW",
      }),
    ),
    conflicts: [],
  };
}

describe("validateNormalizedDataSet", () => {
  it("does not FAIL on a consistent (but partial) data set", () => {
    const report = validateNormalizedDataSet(baseDataSet());
    expect(report.status).toBe("WARN"); // partial: counts below full-tournament
    expect(report.errors).toEqual([]);
    expect(
      report.warnings.some((warning) => warning.code === "TEAMS_COUNT"),
    ).toBe(true);
  });

  it("PASSes only when nothing at all is flagged", () => {
    const data = baseDataSet();
    // Strip everything the rule set inspects for expectations.
    data.tournament = null;
    const report = validateNormalizedDataSet({
      ...data,
      tournament: data.tournament,
    });
    // Missing tournament is a hard error:
    expect(report.status).toBe("FAIL");
    expect(report.errors.some((e) => e.code === "TOURNAMENT_MISSING")).toBe(true);
  });

  it("FAILs on a wrong tournament year", () => {
    const data = baseDataSet();
    data.tournament = { ...data.tournament!, tournamentYear: 2022 };
    const report = validateNormalizedDataSet(data);
    expect(report.status).toBe("FAIL");
    expect(report.errors.some((e) => e.code === "TOURNAMENT_YEAR")).toBe(true);
  });

  it("FAILs on duplicate match numbers", () => {
    const data = baseDataSet();
    data.matches[1] = { ...data.matches[1], matchNumber: 1 };
    const report = validateNormalizedDataSet(data);
    expect(report.status).toBe("FAIL");
    expect(
      report.errors.some((e) => e.code === "MATCH_NUMBER_DUPLICATE"),
    ).toBe(true);
  });

  it("FAILs when a finished match has no score", () => {
    const data = baseDataSet();
    data.matches[0] = { ...data.matches[0], homeScore: null, awayScore: null };
    const report = validateNormalizedDataSet(data);
    expect(report.status).toBe("FAIL");
    expect(report.errors.some((e) => e.code === "MATCH_SCORE_MISSING")).toBe(true);
  });

  it("FAILs on a finished knockout tie without resolution", () => {
    const data = baseDataSet();
    data.matches.push({
      matchNumber: 104,
      stage: "FINAL",
      homeTeamName: "Spain",
      awayTeamName: "Argentina",
      homeScore: 1,
      awayScore: 1,
      status: "FINISHED",
      sourceIds: ["openfootball_worldcup_2026"],
      confidence: "SINGLE_SOURCE",
      verificationStatus: "NEEDS_REVIEW",
      rawSourceRefs: [],
    });
    const report = validateNormalizedDataSet(data);
    expect(report.errors.some((e) => e.code === "MATCH_UNRESOLVED_TIE")).toBe(true);
  });

  it("accepts a finished knockout tie resolved on penalties", () => {
    const data = baseDataSet();
    data.matches.push({
      matchNumber: 104,
      stage: "FINAL",
      homeTeamName: "Spain",
      awayTeamName: "Argentina",
      homeScore: 1,
      awayScore: 1,
      homePenaltyScore: 4,
      awayPenaltyScore: 2,
      winnerTeamName: "Spain",
      status: "FINISHED",
      sourceIds: ["openfootball_worldcup_2026"],
      confidence: "SINGLE_SOURCE",
      verificationStatus: "NEEDS_REVIEW",
      rawSourceRefs: [],
    });
    const report = validateNormalizedDataSet(data);
    expect(report.errors.some((e) => e.code === "MATCH_UNRESOLVED_TIE")).toBe(false);
  });

  it("FAILs when a group with complete results has no standings", () => {
    const data = baseDataSet();
    data.standings = [];
    const report = validateNormalizedDataSet(data);
    expect(report.errors.some((e) => e.code === "STANDINGS_MISSING")).toBe(true);
  });

  it("FAILs on a match listing the same team twice (via alias)", () => {
    const data = baseDataSet();
    data.matches[0] = {
      ...data.matches[0],
      homeTeamName: "USA",
      awayTeamName: "United States",
    };
    const report = validateNormalizedDataSet(data);
    expect(report.errors.some((e) => e.code === "MATCH_SAME_TEAM")).toBe(true);
  });

  it("surfaces reported conflicts and keeps them out of PASS", () => {
    const data = baseDataSet();
    data.conflicts = [
      {
        entityType: "matches",
        entityKey: "GROUP|Group A|flag:mx~flag:za",
        field: "status",
        values: [
          { sourceId: "openfootball_worldcup_2026", value: "FINISHED" },
          { sourceId: "worldcup2026_repo", value: "SCHEDULED" },
        ],
        resolution: "KEPT_HIGHEST_PRIORITY",
      },
    ];
    const report = validateNormalizedDataSet(data);
    expect(report.status).toBe("WARN");
    expect(report.conflicts).toHaveLength(1);
    expect(
      report.recommendations.some((r) => r.includes("conflicts.json")),
    ).toBe(true);
  });
});
