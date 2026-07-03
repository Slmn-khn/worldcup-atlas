// Discovery Vault badges — five lightweight, entirely client-computed
// achievements. A badge is "earned" once the visitor has discovered enough
// facts matching its criteria (category and/or tags, both already known
// from the discovered-fact records in discoveryProgress.ts) — no server
// round trip, no accounts.

import type { DiscoveredFactRecord, DiscoveryProgressState } from "./discoveryProgress";

export type BadgeId =
  | "finals-expert"
  | "penalty-historian"
  | "golden-boot-hunter"
  | "brazil-archive-explorer"
  | "2026-scout";

type BadgeCriteria = Pick<DiscoveredFactRecord, "category" | "tags">;

export type BadgeDefinition = {
  id: BadgeId;
  label: string;
  description: string;
  /** How many matching facts must be discovered to earn the badge. */
  threshold: number;
  matches: (fact: BadgeCriteria) => boolean;
};

// No dedicated FactCategory for "top scorer" stories — matched by tag
// instead. Kept broad so future starter facts can opt in just by tagging.
const GOLDEN_BOOT_TAGS = new Set(["goals", "golden-boot", "top-scorer", "scorer"]);

export const BADGE_DEFINITIONS: readonly BadgeDefinition[] = [
  {
    id: "finals-expert",
    label: "Finals Expert",
    description: "Discover World Cup final stories.",
    threshold: 1,
    matches: (fact) => fact.category === "FINAL",
  },
  {
    id: "penalty-historian",
    label: "Penalty Historian",
    description: "Discover penalty shootout history.",
    threshold: 1,
    matches: (fact) => fact.category === "PENALTY",
  },
  {
    id: "golden-boot-hunter",
    label: "Golden Boot Hunter",
    description: "Discover the archive's great goalscoring records.",
    threshold: 1,
    matches: (fact) => fact.tags.some((tag) => GOLDEN_BOOT_TAGS.has(tag)),
  },
  {
    id: "brazil-archive-explorer",
    label: "Brazil Archive Explorer",
    description: "Discover three or more stories from Brazil's World Cup history.",
    threshold: 3,
    matches: (fact) => fact.tags.includes("brazil"),
  },
  {
    id: "2026-scout",
    label: "2026 Scout",
    description: "Discover stories about the 2026 World Cup.",
    threshold: 2,
    matches: (fact) => fact.category === "SCHEDULE_2026" || fact.tags.includes("2026"),
  },
] as const;

export type BadgeProgress = BadgeDefinition & {
  /** Matching facts discovered so far, capped at `threshold` for display. */
  matchedCount: number;
  isEarned: boolean;
};

/** Progress toward every defined badge, given the visitor's discovered facts. */
export function getBadgeProgress(
  state: Pick<DiscoveryProgressState, "discovered">,
): BadgeProgress[] {
  return BADGE_DEFINITIONS.map((definition) => {
    const matchedCount = state.discovered.filter(definition.matches).length;
    return {
      ...definition,
      matchedCount,
      isEarned: matchedCount >= definition.threshold,
    };
  });
}

export function getEarnedBadges(
  state: Pick<DiscoveryProgressState, "discovered">,
): BadgeProgress[] {
  return getBadgeProgress(state).filter((badge) => badge.isEarned);
}
