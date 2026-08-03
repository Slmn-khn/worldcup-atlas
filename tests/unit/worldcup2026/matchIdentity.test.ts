import { describe, expect, it } from "vitest";

import {
  buildMatchIdentityIndex,
  resolveMatch,
  type ReferenceMatch,
} from "../../../src/server/agents/worldcup2026/matchIdentity";

const REFERENCES: ReferenceMatch[] = [
  {
    key: "M104",
    matchIds: ["M104", "104"],
    fifaMatchId: "400104",
    date: "2026-07-19",
    homeTeam: "Spain",
    awayTeam: "Argentina",
    stage: "final",
  },
  {
    key: "M103",
    matchIds: ["M103", "103"],
    date: "2026-07-18",
    homeTeam: "England",
    awayTeam: "France",
    stage: "third_place",
  },
];

const index = buildMatchIdentityIndex(REFERENCES);

describe("resolveMatch", () => {
  it("resolves by provider match id first", () => {
    expect(resolveMatch(index, { matchId: 104 })).toMatchObject({
      confidence: "EXACT_MATCH_ID",
      referenceKey: "M104",
    });
    expect(resolveMatch(index, { matchId: "m104" }).confidence).toBe(
      "EXACT_MATCH_ID",
    );
  });

  it("resolves by FIFA match id", () => {
    expect(resolveMatch(index, { fifaMatchId: "400104" })).toMatchObject({
      confidence: "EXACT_FIFA_ID",
      referenceKey: "M104",
    });
  });

  it("resolves by team pair + date + stage, side-order-insensitively", () => {
    const result = resolveMatch(index, {
      date: "2026-07-19",
      homeTeam: "Argentina",
      awayTeam: "Spain",
      stage: "Final",
    });
    expect(result).toMatchObject({
      confidence: "EXACT_TEAM_DATE_STAGE",
      referenceKey: "M104",
    });
  });

  it("accepts FIFA codes as team identities", () => {
    const result = resolveMatch(index, {
      date: "2026-07-19",
      homeTeam: "ESP",
      awayTeam: "ARG",
      stage: "final",
    });
    expect(result.confidence).toBe("EXACT_TEAM_DATE_STAGE");
  });

  it("falls back to PROBABLE on team pair + date without a stage", () => {
    const result = resolveMatch(index, {
      date: "2026-07-18",
      homeTeam: "France",
      awayTeam: "England",
    });
    expect(result).toMatchObject({ confidence: "PROBABLE", referenceKey: "M103" });
  });

  it("resolves knockout team pair + stage without a date as PROBABLE", () => {
    const result = resolveMatch(index, {
      homeTeam: "Spain",
      awayTeam: "Argentina",
      stage: "final",
    });
    expect(result).toMatchObject({ confidence: "PROBABLE", referenceKey: "M104" });
  });

  it("returns UNRESOLVED for unknown matches", () => {
    expect(
      resolveMatch(index, {
        date: "2026-06-11",
        homeTeam: "Mexico",
        awayTeam: "Canada",
        stage: "group",
      }).confidence,
    ).toBe("UNRESOLVED");
    expect(resolveMatch(index, {}).confidence).toBe("UNRESOLVED");
  });

  it("discards an id hit contradicted by the team pair (offset provider numbering)", () => {
    // Provider match_id 103 with the M104 final's teams: the id points at the
    // third-place match, but the teams contradict it — resolution must fall
    // through to team/date/stage evidence instead of trusting the id.
    const result = resolveMatch(index, {
      matchId: "103",
      date: "2026-07-19",
      homeTeam: "Spain",
      awayTeam: "Argentina",
      stage: "final",
    });
    expect(result).toMatchObject({
      confidence: "EXACT_TEAM_DATE_STAGE",
      referenceKey: "M104",
    });
  });

  it("never resolves ambiguous keys", () => {
    const ambiguous = buildMatchIdentityIndex([
      { key: "A", matchIds: ["1"], homeTeam: "Spain", awayTeam: "France", stage: "semifinal" },
      { key: "B", matchIds: ["1"], homeTeam: "Spain", awayTeam: "France", stage: "semifinal" },
    ]);
    expect(resolveMatch(ambiguous, { matchId: "1" }).confidence).toBe("UNRESOLVED");
    expect(
      resolveMatch(ambiguous, {
        homeTeam: "Spain",
        awayTeam: "France",
        stage: "semifinal",
      }).confidence,
    ).toBe("UNRESOLVED");
  });
});
