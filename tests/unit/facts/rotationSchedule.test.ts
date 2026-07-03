import { describe, expect, it } from "vitest";
import {
  planFactRotationSlots,
  startOfUtcHour,
} from "../../../src/server/facts/rotationSchedule";
import type { FactSummary } from "../../../src/server/facts/types";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-07-01T08:00:00Z");

function makeFact(overrides: Partial<FactSummary> & { id: string }): FactSummary {
  return {
    slug: overrides.id,
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

describe("startOfUtcHour", () => {
  it("rounds down to the start of the current UTC hour", () => {
    expect(startOfUtcHour(new Date("2026-01-01T05:37:12.345Z")).toISOString()).toBe(
      "2026-01-01T05:00:00.000Z",
    );
  });
});

describe("planFactRotationSlots", () => {
  it("returns [] for an empty pool or a non-positive slot count", () => {
    expect(planFactRotationSlots({ facts: [], now: NOW, slotCount: 72 })).toEqual(
      [],
    );
    const facts = [makeFact({ id: "a" })];
    expect(planFactRotationSlots({ facts, now: NOW, slotCount: 0 })).toEqual([]);
  });

  it("produces exactly slotCount consecutive one-hour slots from the start of the hour", () => {
    const facts = [makeFact({ id: "a" }), makeFact({ id: "b", category: "RECORD" })];
    const plans = planFactRotationSlots({ facts, now: NOW, slotCount: 5 });
    expect(plans).toHaveLength(5);
    expect(plans[0].slotStartAt.toISOString()).toBe(startOfUtcHour(NOW).toISOString());
    for (let i = 0; i < plans.length; i += 1) {
      expect(plans[i].slotEndAt.getTime() - plans[i].slotStartAt.getTime()).toBe(
        HOUR_MS,
      );
      if (i > 0) {
        expect(plans[i].slotStartAt.getTime()).toBe(plans[i - 1].slotEndAt.getTime());
      }
    }
  });

  it("prefers higher qualityScore when nothing else distinguishes candidates", () => {
    const low = makeFact({ id: "low", qualityScore: 10 });
    const high = makeFact({ id: "high", qualityScore: 90 });
    const [slot0] = planFactRotationSlots({
      facts: [low, high],
      now: NOW,
      slotCount: 1,
    });
    expect(slot0.fact.id).toBe("high");
    expect(slot0.rotationType).toBe("SCHEDULED");
  });

  it("prefers isFeatured facts even over a higher qualityScore", () => {
    const featuredButLowQuality = makeFact({
      id: "featured",
      qualityScore: 10,
      isFeatured: true,
    });
    const plainHighQuality = makeFact({ id: "plain", qualityScore: 90 });
    const [slot0] = planFactRotationSlots({
      facts: [featuredButLowQuality, plainHighQuality],
      now: NOW,
      slotCount: 1,
    });
    expect(slot0.fact.id).toBe("featured");
  });

  it("avoids a fact in recentlyFeaturedFactIds when a fresh alternative exists", () => {
    const recentlyShown = makeFact({ id: "recent", qualityScore: 90 });
    const fresh = makeFact({ id: "fresh", qualityScore: 10 });
    const [slot0] = planFactRotationSlots({
      facts: [recentlyShown, fresh],
      now: NOW,
      slotCount: 1,
      recentlyFeaturedFactIds: new Set(["recent"]),
    });
    expect(slot0.fact.id).toBe("fresh");
    expect(slot0.rotationType).toBe("SCHEDULED");
  });

  it("avoids repeating the same category in adjacent slots when possible", () => {
    const history = makeFact({ id: "h", category: "HISTORY", qualityScore: 90 });
    const record = makeFact({ id: "r", category: "RECORD", qualityScore: 10 });
    const plans = planFactRotationSlots({
      facts: [history, record],
      now: NOW,
      slotCount: 2,
    });
    expect(plans[0].fact.category).toBe("HISTORY");
    expect(plans[1].fact.category).toBe("RECORD");
    expect(plans[1].fact.category).not.toBe(plans[0].fact.category);
  });

  it("honors initialPreviousCategory for the very first slot", () => {
    const history = makeFact({ id: "h", category: "HISTORY", qualityScore: 90 });
    const record = makeFact({ id: "r", category: "RECORD", qualityScore: 10 });
    const [slot0] = planFactRotationSlots({
      facts: [history, record],
      now: NOW,
      slotCount: 1,
      initialPreviousCategory: "HISTORY",
    });
    // Despite lower quality, "record" is picked because "history" repeats the
    // category of the slot that aired right before this batch started.
    expect(slot0.fact.id).toBe("r");
  });

  it("falls back to FALLBACK once the pool is exhausted, but keeps alternating category", () => {
    const history = makeFact({ id: "h", category: "HISTORY" });
    const record = makeFact({ id: "r", category: "RECORD" });
    const plans = planFactRotationSlots({
      facts: [history, record],
      now: NOW,
      slotCount: 6,
    });
    expect(plans.map((plan) => plan.rotationType)).toEqual([
      "SCHEDULED",
      "SCHEDULED",
      "FALLBACK",
      "FALLBACK",
      "FALLBACK",
      "FALLBACK",
    ]);
    for (let i = 1; i < plans.length; i += 1) {
      expect(plans[i].fact.category).not.toBe(plans[i - 1].fact.category);
    }
  });

  it("never leaves a slot unfilled even with a single fact in the pool", () => {
    const onlyFact = makeFact({ id: "solo" });
    const plans = planFactRotationSlots({
      facts: [onlyFact],
      now: NOW,
      slotCount: 3,
    });
    expect(plans).toHaveLength(3);
    expect(plans.every((plan) => plan.fact.id === "solo")).toBe(true);
    expect(plans[1].rotationType).toBe("FALLBACK");
  });
});
