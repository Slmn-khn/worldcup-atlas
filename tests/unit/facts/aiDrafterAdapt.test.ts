import { describe, expect, it } from "vitest";
import {
  biggestWinToAiDraftInput,
  finalScoreToAiDraftInput,
  highestScoringToAiDraftInput,
  hostWinnerToAiDraftInput,
  penaltyShootoutToAiDraftInput,
  squadSelectionsToAiDraftInput,
  topScorerToAiDraftInput,
} from "../../../src/server/facts/aiDrafter/adapt";
import { getAllowedNumbers } from "../../../src/server/facts/aiDrafter/validate";
import type { MatchFactInput } from "../../../src/server/facts/generator/types";

function team(overrides: Partial<MatchFactInput["home"]> & { name: string; slug: string }) {
  return { countrySlug: null, countryName: null, ...overrides };
}

function match(overrides: Partial<MatchFactInput> = {}): MatchFactInput {
  return {
    slug: "match-slug",
    stage: "final",
    year: 2022,
    tournamentSlug: "2022",
    home: team({ name: "Argentina", slug: "argentina" }),
    away: team({ name: "France", slug: "france" }),
    homeScore: 3,
    awayScore: 3,
    homeScorePenalties: 4,
    awayScorePenalties: 2,
    decidedByPenalties: true,
    ...overrides,
  };
}

describe("topScorerToAiDraftInput", () => {
  it("matches the deterministic generator's slug scheme", () => {
    const input = topScorerToAiDraftInput({
      rank: 1,
      player: { slug: "miroslav-klose", name: "Miroslav Klose", countrySlug: "germany", countryName: "Germany" },
      goals: 16,
      eraStartYear: 2002,
      eraEndYear: 2014,
    });
    expect(input.slug).toBe("auto-top-scorer-miroslav-klose");
    expect(input.templateId).toBe("top-scorers");
    expect(getAllowedNumbers(input.facts)).toEqual(new Set([16, 1, 2002, 2014]));
    expect(input.relations.some((r) => r.entityType === "PLAYER" && r.entitySlug === "miroslav-klose")).toBe(true);
  });
});

describe("squadSelectionsToAiDraftInput", () => {
  it("never implies 'appearances' in its context text", () => {
    const input = squadSelectionsToAiDraftInput({
      rank: 2,
      player: { slug: "some-player", name: "Some Player", countrySlug: null, countryName: null },
      selections: 5,
      eraStartYear: 2010,
      eraEndYear: 2018,
    });
    expect(input.slug).toBe("auto-squad-selections-some-player");
    expect(getAllowedNumbers(input.facts)).toEqual(new Set([5, 2, 2010, 2018]));
    // Context explicitly instructs the model away from "appearances"/"caps" —
    // it should not itself claim either term as a fact.
    expect(input.context.toLowerCase()).not.toMatch(/\bhas \d+ appearances\b/);
  });
});

describe("hostWinnerToAiDraftInput", () => {
  it("builds a per-year slug with only the host/winner/year as numbers", () => {
    const input = hostWinnerToAiDraftInput({
      year: 1930,
      tournamentSlug: "1930",
      hostName: "Uruguay",
      winnerTeamName: "Uruguay",
      winnerCountrySlug: "uruguay",
    });
    expect(input.slug).toBe("auto-host-winner-1930");
    expect(getAllowedNumbers(input.facts)).toEqual(new Set([1930]));
  });
});

describe("biggestWinToAiDraftInput", () => {
  it("computes the margin and includes it in the allowed numbers", () => {
    const input = biggestWinToAiDraftInput(
      match({
        homeScore: 1,
        awayScore: 7,
        decidedByPenalties: false,
        homeScorePenalties: null,
        awayScorePenalties: null,
        home: team({ name: "Brazil", slug: "brazil-match" }),
        away: team({ name: "Germany", slug: "germany-match" }),
      }),
      1,
    );
    expect(input?.slug).toBe("auto-biggest-win-match-slug");
    expect(getAllowedNumbers(input!.facts)).toEqual(new Set([2022, 1, 7, 6]));
  });

  it("returns null for an undecided draw", () => {
    const input = biggestWinToAiDraftInput(
      match({ homeScore: 1, awayScore: 1, decidedByPenalties: false, homeScorePenalties: null, awayScorePenalties: null }),
      1,
    );
    expect(input).toBeNull();
  });
});

describe("highestScoringToAiDraftInput", () => {
  it("includes the total goals among the allowed numbers", () => {
    const input = highestScoringToAiDraftInput(match({ homeScore: 4, awayScore: 3 }), 2);
    expect(input.slug).toBe("auto-highest-scoring-match-slug");
    expect(getAllowedNumbers(input.facts)).toContain(7);
    expect(getAllowedNumbers(input.facts)).toContain(2);
  });
});

describe("penaltyShootoutToAiDraftInput", () => {
  it("builds a candidate for a shootout match", () => {
    const input = penaltyShootoutToAiDraftInput(match());
    expect(input?.category).toBe("PENALTY");
    expect(input?.slug).toBe("auto-penalty-shootout-match-slug");
  });

  it("returns null for an undecided draw", () => {
    const input = penaltyShootoutToAiDraftInput(
      match({ homeScore: 1, awayScore: 1, decidedByPenalties: false, homeScorePenalties: null, awayScorePenalties: null }),
    );
    expect(input).toBeNull();
  });
});

describe("finalScoreToAiDraftInput", () => {
  it("uses the tournament year in its slug", () => {
    const input = finalScoreToAiDraftInput(match());
    expect(input?.slug).toBe("auto-final-score-2022");
    expect(input?.category).toBe("FINAL");
  });
});
