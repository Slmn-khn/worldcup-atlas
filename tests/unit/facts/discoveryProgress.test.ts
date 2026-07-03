import { describe, expect, it } from "vitest";
import {
  getDiscoveredCount,
  getProgress,
  getViewedCategories,
  recordFactDiscovered,
  recordQuizAttempt,
  type MinimalStorage,
} from "../../../src/lib/discoveryProgress";

function fakeStorage(initial?: Record<string, string>): MinimalStorage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const KEY = "worldcup-nexus:discovery-progress";

describe("getProgress", () => {
  it("returns safe defaults when nothing is stored", () => {
    const state = getProgress(fakeStorage());
    expect(state.discovered).toEqual([]);
    expect(state.streak).toEqual({ current: 0, longest: 0, lastVisitDate: null });
    expect(state.quiz).toEqual({ attempts: 0, correct: 0 });
  });

  it("never throws on malformed storage contents", () => {
    expect(getProgress(fakeStorage({ [KEY]: "not json" })).discovered).toEqual([]);
    expect(getProgress(fakeStorage({ [KEY]: "42" })).discovered).toEqual([]);
    expect(
      getProgress(fakeStorage({ [KEY]: JSON.stringify({ discovered: "nope" }) }))
        .discovered,
    ).toEqual([]);
  });

  it("drops discovered entries missing required fields", () => {
    const raw = JSON.stringify({
      discovered: [
        { slug: "ok", category: "HISTORY", tags: ["a"], discoveredAt: "2026-01-01" },
        { slug: "missing-category" },
        "not-an-object",
      ],
    });
    const state = getProgress(fakeStorage({ [KEY]: raw }));
    expect(state.discovered).toEqual([
      { slug: "ok", category: "HISTORY", tags: ["a"], discoveredAt: "2026-01-01" },
    ]);
  });
});

describe("recordFactDiscovered", () => {
  const fact = { slug: "first-fact", category: "HISTORY" as const, tags: ["1930"] };

  it("adds a new discovered fact", () => {
    const storage = fakeStorage();
    const state = recordFactDiscovered(fact, new Date("2026-01-01T10:00:00"), storage);
    expect(state.discovered).toHaveLength(1);
    expect(state.discovered[0].slug).toBe("first-fact");
    expect(getDiscoveredCount(storage)).toBe(1);
  });

  it("never adds the same slug twice", () => {
    const storage = fakeStorage();
    recordFactDiscovered(fact, new Date("2026-01-01T10:00:00"), storage);
    recordFactDiscovered(fact, new Date("2026-01-01T11:00:00"), storage);
    expect(getDiscoveredCount(storage)).toBe(1);
  });

  it("starts a streak at 1 on the first visit", () => {
    const storage = fakeStorage();
    const state = recordFactDiscovered(fact, new Date("2026-01-01T10:00:00"), storage);
    expect(state.streak.current).toBe(1);
    expect(state.streak.longest).toBe(1);
    expect(state.streak.lastVisitDate).toBe("2026-01-01");
  });

  it("does not double-count multiple visits on the same day", () => {
    const storage = fakeStorage();
    recordFactDiscovered(fact, new Date("2026-01-01T09:00:00"), storage);
    const second = recordFactDiscovered(
      { slug: "second-fact", category: "RECORD" as const, tags: [] },
      new Date("2026-01-01T20:00:00"),
      storage,
    );
    expect(second.streak.current).toBe(1);
  });

  it("increments the streak on a consecutive calendar day", () => {
    const storage = fakeStorage();
    recordFactDiscovered(fact, new Date("2026-01-01T10:00:00"), storage);
    const day2 = recordFactDiscovered(
      { slug: "second-fact", category: "RECORD" as const, tags: [] },
      new Date("2026-01-02T09:00:00"),
      storage,
    );
    expect(day2.streak.current).toBe(2);
    expect(day2.streak.longest).toBe(2);
  });

  it("resets the streak after a missed day", () => {
    const storage = fakeStorage();
    recordFactDiscovered(fact, new Date("2026-01-01T10:00:00"), storage);
    const afterGap = recordFactDiscovered(
      { slug: "second-fact", category: "RECORD" as const, tags: [] },
      new Date("2026-01-05T09:00:00"),
      storage,
    );
    expect(afterGap.streak.current).toBe(1);
    expect(afterGap.streak.longest).toBe(1);
  });

  it("keeps the longest streak even after a reset", () => {
    const storage = fakeStorage();
    recordFactDiscovered({ slug: "a", category: "HISTORY" as const, tags: [] }, new Date("2026-01-01T10:00:00"), storage);
    recordFactDiscovered({ slug: "b", category: "HISTORY" as const, tags: [] }, new Date("2026-01-02T10:00:00"), storage);
    recordFactDiscovered({ slug: "c", category: "HISTORY" as const, tags: [] }, new Date("2026-01-03T10:00:00"), storage);
    // gap — streak resets to 1, but longest (3) is remembered.
    const afterGap = recordFactDiscovered(
      { slug: "d", category: "HISTORY" as const, tags: [] },
      new Date("2026-01-10T10:00:00"),
      storage,
    );
    expect(afterGap.streak.current).toBe(1);
    expect(afterGap.streak.longest).toBe(3);
  });
});

describe("recordQuizAttempt", () => {
  it("tracks attempts and correct answers separately", () => {
    const storage = fakeStorage();
    recordQuizAttempt(true, storage);
    recordQuizAttempt(false, storage);
    const state = recordQuizAttempt(true, storage);
    expect(state.quiz).toEqual({ attempts: 3, correct: 2 });
  });
});

describe("getViewedCategories", () => {
  it("returns distinct categories across discovered facts", () => {
    const storage = fakeStorage();
    recordFactDiscovered({ slug: "a", category: "HISTORY" as const, tags: [] }, new Date(), storage);
    recordFactDiscovered({ slug: "b", category: "HISTORY" as const, tags: [] }, new Date(), storage);
    recordFactDiscovered({ slug: "c", category: "RECORD" as const, tags: [] }, new Date(), storage);
    expect(getViewedCategories(storage).sort()).toEqual(["HISTORY", "RECORD"]);
  });
});
