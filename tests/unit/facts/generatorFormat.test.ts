import { describe, expect, it } from "vitest";
import {
  buildBiggestWinCandidate,
  buildFinalScoreCandidate,
  buildHostWinnerCandidate,
  buildPenaltyShootoutCandidate,
  buildSquadSelectionsCandidate,
  buildTopScorerCandidate,
  doesHostMatchWinner,
  pickMatchWinner,
  rankStageImportance,
} from "../../../src/server/facts/generator/format";
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

describe("pickMatchWinner", () => {
  it("picks the higher regulation score", () => {
    const outcome = pickMatchWinner(match({ homeScore: 2, awayScore: 1, decidedByPenalties: false, homeScorePenalties: null, awayScorePenalties: null }));
    expect(outcome?.winner.name).toBe("Argentina");
    expect(outcome?.loser.name).toBe("France");
  });

  it("falls back to penalties when regulation is tied", () => {
    const outcome = pickMatchWinner(match({ homeScore: 3, awayScore: 3, decidedByPenalties: true, homeScorePenalties: 4, awayScorePenalties: 2 }));
    expect(outcome?.winner.name).toBe("Argentina");
  });

  it("returns null for a genuine unresolved draw", () => {
    const outcome = pickMatchWinner(match({ homeScore: 1, awayScore: 1, decidedByPenalties: false, homeScorePenalties: null, awayScorePenalties: null }));
    expect(outcome).toBeNull();
  });
});

describe("doesHostMatchWinner", () => {
  it("matches identical names", () => {
    expect(doesHostMatchWinner("Uruguay", "Uruguay")).toBe(true);
  });
  it("matches case-insensitively", () => {
    expect(doesHostMatchWinner("FRANCE", "france")).toBe(true);
  });
  it("matches a co-host string containing the winner", () => {
    expect(doesHostMatchWinner("Korea, Japan", "Japan")).toBe(true);
  });
  it("does not match different nations", () => {
    expect(doesHostMatchWinner("Germany", "Italy")).toBe(false);
  });
  it("does not match empty strings", () => {
    expect(doesHostMatchWinner("", "Italy")).toBe(false);
    expect(doesHostMatchWinner("Italy", "")).toBe(false);
  });
});

describe("rankStageImportance", () => {
  it("ranks final highest and group-adjacent stages lowest", () => {
    expect(rankStageImportance("final")).toBeGreaterThan(rankStageImportance("semi-finals"));
    expect(rankStageImportance("semi-final")).toBeGreaterThan(rankStageImportance("quarter-finals"));
    expect(rankStageImportance("quarter-final")).toBeGreaterThan(rankStageImportance("round of 16"));
    expect(rankStageImportance("round of 16")).toBeGreaterThan(rankStageImportance("group stage"));
  });
});

describe("buildTopScorerCandidate", () => {
  it("produces a stable auto-prefixed slug and DB-honest text", () => {
    const candidate = buildTopScorerCandidate({
      rank: 1,
      player: { slug: "miroslav-klose", name: "Miroslav Klose", countrySlug: "germany", countryName: "Germany" },
      goals: 16,
      eraStartYear: 2002,
      eraEndYear: 2014,
    });
    expect(candidate.slug).toBe("auto-top-scorer-miroslav-klose");
    expect(candidate.category).toBe("RECORD");
    expect(candidate.title).toContain("16");
    expect(candidate.summary).toContain("Miroslav Klose");
    expect(candidate.tags).toContain("auto-generated");
    expect(candidate.relations.some((r) => r.entityType === "PLAYER" && r.entitySlug === "miroslav-klose")).toBe(true);
    expect(candidate.sources).toHaveLength(1);
    expect(candidate.sources[0].sourceType).toBe("WORLDCUP_NEXUS_DB");
  });
});

describe("buildSquadSelectionsCandidate", () => {
  it("headlines 'squad selections', never claiming an unsupported 'appearances' stat", () => {
    const candidate = buildSquadSelectionsCandidate({
      rank: 1,
      player: { slug: "some-player", name: "Some Player", countrySlug: null, countryName: null },
      selections: 5,
      eraStartYear: 2002,
      eraEndYear: 2014,
    });
    // The title/summary are the claim itself and must never say "appearances"
    // (data not imported); the content body may still explain the distinction.
    expect(candidate.title.toLowerCase()).not.toContain("appearance");
    expect(candidate.summary.toLowerCase()).not.toContain("appearance");
    expect(candidate.title).toContain("Squad Selections");
  });
});

describe("buildBiggestWinCandidate", () => {
  it("orders winner before loser regardless of home/away", () => {
    const candidate = buildBiggestWinCandidate(
      match({ homeScore: 1, awayScore: 7, decidedByPenalties: false, homeScorePenalties: null, awayScorePenalties: null, home: team({ name: "Brazil", slug: "brazil-match" }), away: team({ name: "Germany", slug: "germany-match" }) }),
      1,
    );
    expect(candidate?.title).toContain("Germany 7–1 Brazil");
    expect(candidate?.summary).toContain("6-goal margin");
  });

  it("returns null for an undecided draw", () => {
    const candidate = buildBiggestWinCandidate(
      match({ homeScore: 1, awayScore: 1, decidedByPenalties: false, homeScorePenalties: null, awayScorePenalties: null }),
      1,
    );
    expect(candidate).toBeNull();
  });
});

describe("buildHostWinnerCandidate", () => {
  it("builds a per-year slug", () => {
    const candidate = buildHostWinnerCandidate({
      year: 1930,
      tournamentSlug: "1930",
      hostName: "Uruguay",
      winnerTeamName: "Uruguay",
      winnerCountrySlug: "uruguay",
    });
    expect(candidate.slug).toBe("auto-host-winner-1930");
    expect(candidate.category).toBe("HOST");
  });
});

describe("buildPenaltyShootoutCandidate", () => {
  it("describes the shootout winner and loser", () => {
    const candidate = buildPenaltyShootoutCandidate(match());
    expect(candidate?.category).toBe("PENALTY");
    expect(candidate?.title).toContain("Argentina Beat France on Penalties");
  });
});

describe("buildFinalScoreCandidate", () => {
  it("uses the regulation score in the title and the full score (with pens) in the summary", () => {
    const candidate = buildFinalScoreCandidate(match());
    expect(candidate?.slug).toBe("auto-final-score-2022");
    expect(candidate?.title).toBe("2022 World Cup Final: Argentina 3–3 France");
    expect(candidate?.summary).toContain("(4–2 pens)");
  });
});
