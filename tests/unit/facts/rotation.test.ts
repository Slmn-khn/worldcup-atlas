import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  getUtcHourBucket,
  selectHourlyFact,
} from "../../../src/server/facts/rotation";
import type { FactSummary } from "../../../src/server/facts/types";

const HOUR_MS = 60 * 60 * 1000;

function makeFact(overrides: Partial<FactSummary>): FactSummary {
  return {
    id: overrides.slug ?? "fact-id",
    slug: "fact-slug",
    title: "A World Cup fact",
    summary: "A short summary.",
    category: "FUN_FACT",
    difficulty: "CASUAL",
    eraStartYear: null,
    eraEndYear: null,
    readTimeMinutes: 2,
    qualityScore: 50,
    isFeatured: false,
    tags: [],
    publishedAt: null,
    relations: [],
    ...overrides,
  };
}

const factA = makeFact({ id: "a", slug: "a-history-fact", category: "HISTORY" });
const factB = makeFact({ id: "b", slug: "b-record-fact", category: "RECORD" });
const factC = makeFact({
  id: "c",
  slug: "c-history-fact-2",
  category: "HISTORY",
});
const pool = [factA, factB, factC];

describe("getUtcHourBucket", () => {
  it("is the floor of whole hours since the epoch", () => {
    expect(getUtcHourBucket(new Date(0))).toBe(0);
    expect(getUtcHourBucket(new Date(HOUR_MS - 1))).toBe(0);
    expect(getUtcHourBucket(new Date(HOUR_MS))).toBe(1);
  });
});

describe("selectHourlyFact", () => {
  it("returns null for an empty pool", () => {
    expect(selectHourlyFact([], new Date())).toBeNull();
  });

  it("always returns a fact from the given pool", () => {
    const result = selectHourlyFact(pool, new Date("2026-07-01T08:00:00Z"));
    expect(result).not.toBeNull();
    expect(pool.some((fact) => fact.id === result?.fact.id)).toBe(true);
  });

  it("changes which category is featured as the hour changes", () => {
    // hourBucket 0 → CATEGORY_ORDER[0] = HISTORY (only factA/factC qualify).
    const atHourZero = selectHourlyFact(pool, new Date(0));
    expect(atHourZero?.fact.category).toBe("HISTORY");

    // hourBucket 1 → CATEGORY_ORDER[1] = RECORD (only factB qualifies).
    const atHourOne = selectHourlyFact(pool, new Date(HOUR_MS));
    expect(atHourOne?.fact.slug).toBe("b-record-fact");

    expect(atHourZero?.fact.slug).not.toBe(atHourOne?.fact.slug);
  });

  it("cycles through multiple facts in the same category over time", () => {
    // Equal quality scores tie-break by slug ascending: factA before factC.
    const firstPass = selectHourlyFact(pool, new Date(0));
    expect(firstPass?.fact.slug).toBe("a-history-fact");

    // One full trip around CATEGORY_ORDER later, HISTORY comes up again and
    // should advance to the next fact in that category.
    const secondPass = selectHourlyFact(
      pool,
      new Date(CATEGORY_ORDER.length * HOUR_MS),
    );
    expect(secondPass?.fact.category).toBe("HISTORY");
    expect(secondPass?.fact.slug).toBe("c-history-fact-2");
  });

  it("falls back to the whole pool when the hour's category has no facts", () => {
    // hourBucket 2 → CATEGORY_ORDER[2] = ICONIC_MOMENT, absent from `pool`.
    const result = selectHourlyFact(pool, new Date(2 * HOUR_MS));
    expect(result).not.toBeNull();
    expect(pool.some((fact) => fact.id === result?.fact.id)).toBe(true);
  });

  it("reports the next rotation as exactly one hour after the bucket start", () => {
    const result = selectHourlyFact(pool, new Date(0));
    expect(result?.nextRotationAt.toISOString()).toBe(
      new Date(HOUR_MS).toISOString(),
    );
    expect(result?.hourBucket).toBe(0);
  });
});
