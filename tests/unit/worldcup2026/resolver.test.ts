import { describe, expect, it } from "vitest";

import {
  canonicalCityKey,
  canonicalTeamKey,
  comparableDateLabel,
  comparableTimeLabel,
  conflictFromField,
  findDuplicateMatchNumbers,
  isPlaceholderTeamName,
  mergeField,
  normalizeSlug,
  normalizeStage,
} from "../../../src/server/agents/worldcup2026/resolver";

describe("normalizeSlug", () => {
  it("slugifies names with diacritics and punctuation", () => {
    expect(normalizeSlug("Côte d'Ivoire")).toBe("cote-d-ivoire");
    expect(normalizeSlug("Bosnia & Herzegovina")).toBe("bosnia-herzegovina");
    expect(normalizeSlug("  USA  ")).toBe("usa");
  });
  it("is null-safe", () => {
    expect(normalizeSlug(null)).toBeNull();
    expect(normalizeSlug("")).toBeNull();
  });
});

describe("canonicalTeamKey (team name normalization)", () => {
  it("resolves aliases of the same country to one key", () => {
    expect(canonicalTeamKey("USA")).toBe(canonicalTeamKey("United States"));
    expect(canonicalTeamKey("Ivory Coast")).toBe(
      canonicalTeamKey("Côte d'Ivoire"),
    );
    expect(canonicalTeamKey("South Korea")).toBe(
      canonicalTeamKey("Korea Republic"),
    );
  });
  it("uses codes when the name alone does not resolve", () => {
    expect(canonicalTeamKey("Team X", { fifaCode: "MEX" })).toBe("flag:mx");
  });
  it("falls back to a slug key for non-countries", () => {
    expect(canonicalTeamKey("UEFA Path A Winner")).toBe(
      "slug:uefa-path-a-winner",
    );
  });
});

describe("isPlaceholderTeamName", () => {
  it("detects qualification placeholders", () => {
    expect(isPlaceholderTeamName("UEFA Path A Winner")).toBe(true);
    expect(isPlaceholderTeamName("Winner Group C")).toBe(true);
    expect(isPlaceholderTeamName("TBD")).toBe(true);
  });
  it("leaves real teams alone", () => {
    expect(isPlaceholderTeamName("Mexico")).toBe(false);
    expect(isPlaceholderTeamName("New Zealand")).toBe(false);
  });
});

describe("normalizeStage", () => {
  it("maps labels onto stages", () => {
    expect(normalizeStage("group", "Matchday 3", "Group A")).toBe("GROUP");
    expect(normalizeStage(null, "Round of 32", null)).toBe("ROUND_OF_32");
    expect(normalizeStage(null, "Quarter-final", null)).toBe("QUARTER_FINAL");
    expect(normalizeStage(null, "Match for third place", null)).toBe(
      "THIRD_PLACE",
    );
    expect(normalizeStage(null, "Final", null)).toBe("FINAL");
    expect(normalizeStage(null, null, null)).toBe("UNKNOWN");
  });
});

describe("comparable labels", () => {
  it("normalizes both date formats to ISO", () => {
    expect(comparableDateLabel("06/11/2026")).toBe("2026-06-11");
    expect(comparableDateLabel("2026-06-11")).toBe("2026-06-11");
  });
  it("compares only the HH:MM part of times", () => {
    expect(comparableTimeLabel("13:00 UTC-6")).toBe("13:00");
    expect(comparableTimeLabel("13:00")).toBe("13:00");
    expect(comparableTimeLabel("9.30")).toBe("09:30");
  });
  it("drops parenthetical qualifiers from cities", () => {
    expect(canonicalCityKey("Guadalajara (Zapopan)")).toBe(
      canonicalCityKey("Guadalajara"),
    );
  });
});

describe("mergeField", () => {
  it("marks two agreeing independent sources as MULTI", () => {
    const merged = mergeField([
      { sourceId: "openfootball_worldcup_2026", value: "Group A" },
      { sourceId: "worldcup2026_repo", value: "Group A" },
    ]);
    expect(merged.agreement).toBe("MULTI");
    expect(merged.value).toBe("Group A");
    expect(merged.sourceIds).toHaveLength(2);
  });

  it("marks a single voter as SINGLE and ignores abstentions", () => {
    const merged = mergeField([
      { sourceId: "openfootball_worldcup_2026", value: "Group A" },
      { sourceId: "worldcup2026_repo", value: null },
    ]);
    expect(merged.agreement).toBe("SINGLE");
    expect(merged.value).toBe("Group A");
  });

  it("produces a conflict entry when sources disagree", () => {
    const merged = mergeField([
      { sourceId: "worldcup2026_repo", value: "Group B" },
      { sourceId: "openfootball_worldcup_2026", value: "Group A" },
    ]);
    expect(merged.agreement).toBe("CONFLICT");
    // Highest-priority source (openfootball, priority 2) wins…
    expect(merged.value).toBe("Group A");
    // …but the disagreement is fully reported.
    const conflict = conflictFromField("teams", "flag:mx", "groupName", merged);
    expect(conflict.values).toEqual([
      { sourceId: "openfootball_worldcup_2026", value: "Group A" },
      { sourceId: "worldcup2026_repo", value: "Group B" },
    ]);
    expect(conflict.resolution).toBe("KEPT_HIGHEST_PRIORITY");
  });

  it("detects intra-source disagreement between endpoints", () => {
    const merged = mergeField([
      { sourceId: "worldcup2026_repo", value: "2026-06-13" },
      { sourceId: "worldcup2026_repo", value: "2026-06-25" },
    ]);
    expect(merged.agreement).toBe("CONFLICT");
  });
});

describe("findDuplicateMatchNumbers", () => {
  it("finds duplicates and ignores nulls", () => {
    expect(findDuplicateMatchNumbers([1, 2, 2, 3, null, null, 3, 3])).toEqual([
      2, 3,
    ]);
  });
  it("returns empty for unique numbers", () => {
    expect(findDuplicateMatchNumbers([1, 2, 3])).toEqual([]);
  });
});
