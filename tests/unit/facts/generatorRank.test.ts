import { describe, expect, it } from "vitest";
import {
  rankBiggestWins,
  rankHighestScoringMatches,
  rankPenaltyShootouts,
  selectFinalMatches,
} from "../../../src/server/facts/generator/rank";
import type { MatchFactInput } from "../../../src/server/facts/generator/types";

function team(name: string, slug: string) {
  return { name, slug, countrySlug: null, countryName: null };
}

function match(overrides: Partial<MatchFactInput> & { slug: string }): MatchFactInput {
  return {
    stage: "group stage",
    year: 2022,
    tournamentSlug: "2022",
    home: team("Home", "home"),
    away: team("Away", "away"),
    homeScore: 1,
    awayScore: 0,
    homeScorePenalties: null,
    awayScorePenalties: null,
    decidedByPenalties: false,
    ...overrides,
  };
}

describe("rankBiggestWins", () => {
  it("orders by goal margin descending", () => {
    const matches = [
      match({ slug: "a", homeScore: 2, awayScore: 1 }),
      match({ slug: "b", homeScore: 7, awayScore: 1 }),
      match({ slug: "c", homeScore: 1, awayScore: 1 }),
    ];
    const ranked = rankBiggestWins(matches, 2);
    expect(ranked.map((m) => m.slug)).toEqual(["b", "a"]);
  });

  it("breaks ties by slug for determinism", () => {
    const matches = [match({ slug: "z", homeScore: 3, awayScore: 0 }), match({ slug: "a", homeScore: 3, awayScore: 0 })];
    expect(rankBiggestWins(matches, 2).map((m) => m.slug)).toEqual(["a", "z"]);
  });
});

describe("rankHighestScoringMatches", () => {
  it("orders by total goals descending", () => {
    const matches = [
      match({ slug: "a", homeScore: 2, awayScore: 2 }),
      match({ slug: "b", homeScore: 4, awayScore: 3 }),
      match({ slug: "c", homeScore: 1, awayScore: 0 }),
    ];
    expect(rankHighestScoringMatches(matches, 2).map((m) => m.slug)).toEqual(["b", "a"]);
  });
});

describe("rankPenaltyShootouts", () => {
  it("only includes matches decided by penalties", () => {
    const matches = [
      match({ slug: "a", decidedByPenalties: true, stage: "final" }),
      match({ slug: "b", decidedByPenalties: false }),
    ];
    expect(rankPenaltyShootouts(matches, 10).map((m) => m.slug)).toEqual(["a"]);
  });

  it("ranks final/semi-final above earlier rounds regardless of year", () => {
    const matches = [
      match({ slug: "old-final", decidedByPenalties: true, stage: "final", year: 1994 }),
      match({ slug: "recent-r16", decidedByPenalties: true, stage: "round of 16", year: 2022 }),
    ];
    expect(rankPenaltyShootouts(matches, 10).map((m) => m.slug)).toEqual(["old-final", "recent-r16"]);
  });

  it("breaks ties within the same stage by most recent year", () => {
    const matches = [
      match({ slug: "1990-semi", decidedByPenalties: true, stage: "semi-final", year: 1990 }),
      match({ slug: "2014-semi", decidedByPenalties: true, stage: "semi-final", year: 2014 }),
    ];
    expect(rankPenaltyShootouts(matches, 10).map((m) => m.slug)).toEqual(["2014-semi", "1990-semi"]);
  });

  it("caps at the given limit", () => {
    const matches = Array.from({ length: 15 }, (_, i) =>
      match({ slug: `shootout-${i}`, decidedByPenalties: true, stage: "round of 16" }),
    );
    expect(rankPenaltyShootouts(matches, 10)).toHaveLength(10);
  });
});

describe("selectFinalMatches", () => {
  it("selects only the final stage, sorted by year ascending", () => {
    const matches = [
      match({ slug: "2022-final", stage: "final", year: 2022 }),
      match({ slug: "1998-final", stage: "final", year: 1998 }),
      match({ slug: "1950-final-round", stage: "final round", year: 1950 }),
      match({ slug: "group-game", stage: "group stage", year: 2018 }),
    ];
    expect(selectFinalMatches(matches).map((m) => m.slug)).toEqual(["1998-final", "2022-final"]);
  });
});
