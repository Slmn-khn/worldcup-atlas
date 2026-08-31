// Pure-function tests for the Postgres search module: query sanitizing,
// entity-type normalization, and row → DTO mapping. No database required.

import { describe, expect, it } from "vitest";

import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  normalizeEntityTypes,
  sanitizeSearchQuery,
  toSearchResult,
} from "@/server/search/postgresSearch";

describe("sanitizeSearchQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeSearchQuery("  spain   2026  ")).toBe("spain 2026");
  });

  it("strips control characters (null bytes never reach Postgres)", () => {
    const withNull = "mara" + String.fromCharCode(0) + "dona";
    expect(sanitizeSearchQuery(withNull)).toBe("mara dona");
    const ctl = "spain" + String.fromCharCode(1) + String.fromCharCode(31) + String.fromCharCode(127) + " 2026";
    expect(sanitizeSearchQuery(ctl)).toBe("spain 2026");
  });

  it("caps very long queries at MAX_QUERY_LENGTH", () => {
    const long = "maradona ".repeat(1200);
    expect(sanitizeSearchQuery(long).length).toBeLessThanOrEqual(
      MAX_QUERY_LENGTH,
    );
  });

  it("keeps punctuation-heavy queries safe (websearch handles them)", () => {
    expect(sanitizeSearchQuery('"unbalanced ( quote!')).toBe(
      '"unbalanced ( quote!',
    );
    expect(sanitizeSearchQuery("7–1")).toBe("7–1");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(sanitizeSearchQuery("   \t\n ")).toBe("");
    expect("".length).toBeLessThan(MIN_QUERY_LENGTH);
  });
});

describe("normalizeEntityTypes", () => {
  it("keeps only known entity types", () => {
    expect(
      normalizeEntityTypes(["player", "match", "nonsense", "PLAYER"]),
    ).toEqual(["player", "match"]);
  });

  it("returns empty for undefined", () => {
    expect(normalizeEntityTypes(undefined)).toEqual([]);
  });

  it("accepts the fact and 2026-relevant types", () => {
    expect(normalizeEntityTypes(["fact", "venue", "tournament"])).toEqual([
      "fact",
      "venue",
      "tournament",
    ]);
  });
});

describe("toSearchResult", () => {
  it("maps a row to the public DTO shape", () => {
    const result = toSearchResult({
      id: "cuid1",
      entityType: "match",
      entityId: "wc2026-match-abc",
      title: "Spain 1–0 Argentina",
      subtitle: "2026 · Final",
      url: "/matches/2026/104",
      year: 2026,
      countryCode: null,
      imageUrl: null,
      source: "mominul_2026_dataset",
      score: 4.5,
    });
    expect(result).toEqual({
      id: "cuid1",
      entityType: "match",
      entityId: "wc2026-match-abc",
      title: "Spain 1–0 Argentina",
      subtitle: "2026 · Final",
      url: "/matches/2026/104",
      year: 2026,
      countryCode: null,
      imageUrl: null,
      source: "mominul_2026_dataset",
      score: 4.5,
    });
  });
});
