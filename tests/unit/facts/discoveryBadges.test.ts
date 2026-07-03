import { describe, expect, it } from "vitest";
import {
  BADGE_DEFINITIONS,
  getBadgeProgress,
  getEarnedBadges,
} from "../../../src/lib/discoveryBadges";
import type { DiscoveredFactRecord } from "../../../src/lib/discoveryProgress";

function record(overrides: Partial<DiscoveredFactRecord>): DiscoveredFactRecord {
  return {
    slug: "fact",
    category: "FUN_FACT",
    tags: [],
    discoveredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getBadgeProgress", () => {
  it("earns nothing with no discovered facts", () => {
    const progress = getBadgeProgress({ discovered: [] });
    expect(progress).toHaveLength(BADGE_DEFINITIONS.length);
    expect(progress.every((badge) => !badge.isEarned)).toBe(true);
  });

  it("earns Finals Expert after one FINAL-category fact", () => {
    const progress = getBadgeProgress({
      discovered: [record({ slug: "final", category: "FINAL" })],
    });
    const finalsExpert = progress.find((badge) => badge.id === "finals-expert");
    expect(finalsExpert?.isEarned).toBe(true);
    expect(finalsExpert?.matchedCount).toBe(1);
  });

  it("earns Penalty Historian after one PENALTY-category fact", () => {
    const progress = getBadgeProgress({
      discovered: [record({ slug: "pens", category: "PENALTY" })],
    });
    expect(progress.find((badge) => badge.id === "penalty-historian")?.isEarned).toBe(
      true,
    );
  });

  it("earns Golden Boot Hunter via a goals/scorer tag regardless of category", () => {
    const progress = getBadgeProgress({
      discovered: [record({ slug: "klose", category: "RECORD", tags: ["goals"] })],
    });
    expect(
      progress.find((badge) => badge.id === "golden-boot-hunter")?.isEarned,
    ).toBe(true);
  });

  it("does not earn Golden Boot Hunter from unrelated tags", () => {
    const progress = getBadgeProgress({
      discovered: [record({ slug: "x", category: "RECORD", tags: ["titles"] })],
    });
    expect(
      progress.find((badge) => badge.id === "golden-boot-hunter")?.isEarned,
    ).toBe(false);
  });

  it("requires 3 Brazil-tagged facts for Brazil Archive Explorer", () => {
    const two = getBadgeProgress({
      discovered: [
        record({ slug: "a", tags: ["brazil"] }),
        record({ slug: "b", tags: ["brazil"] }),
      ],
    });
    expect(
      two.find((badge) => badge.id === "brazil-archive-explorer")?.isEarned,
    ).toBe(false);

    const three = getBadgeProgress({
      discovered: [
        record({ slug: "a", tags: ["brazil"] }),
        record({ slug: "b", tags: ["brazil"] }),
        record({ slug: "c", tags: ["brazil"] }),
      ],
    });
    const badge = three.find((b) => b.id === "brazil-archive-explorer");
    expect(badge?.isEarned).toBe(true);
    expect(badge?.matchedCount).toBe(3);
  });

  it("earns 2026 Scout via category or tag, requiring 2 matches", () => {
    const progress = getBadgeProgress({
      discovered: [
        record({ slug: "a", category: "SCHEDULE_2026" }),
        record({ slug: "b", category: "HOST", tags: ["2026"] }),
      ],
    });
    const badge = progress.find((b) => b.id === "2026-scout");
    expect(badge?.isEarned).toBe(true);
    expect(badge?.matchedCount).toBe(2);
  });

  it("getEarnedBadges only returns badges that have been earned", () => {
    const earned = getEarnedBadges({
      discovered: [record({ slug: "final", category: "FINAL" })],
    });
    expect(earned.map((badge) => badge.id)).toEqual(["finals-expert"]);
  });
});
