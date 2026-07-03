// Discovery Vault Phase 2 — scheduled hourly rotation slots.
//
// `planFactRotationSlots` (and its helpers) are pure — no Prisma/DB imports at
// the top level — so they can be unit tested directly. The DB-touching
// functions below them (`generateFactRotationSlots`, `getCurrentFactRotationSlot`)
// import Prisma/queries dynamically inside their bodies, the same pattern used
// in rotation.ts, so importing this module in a test never touches the DB.
//
// See docs/DISCOVERY_VAULT.md for the generation rules.

import type { FactCategory } from "@/generated/prisma/enums";
import type { FactSummary, HourlyFactResult } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const DEFAULT_SLOT_COUNT = 72;
export const DEFAULT_LOOKBACK_DAYS = 30;

/** Start of the UTC hour containing `now`. */
export function startOfUtcHour(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

export type FactRotationTypeValue = "SCHEDULED" | "MANUAL" | "FALLBACK";

export type RotationSlotPlan = {
  slotStartAt: Date;
  slotEndAt: Date;
  fact: FactSummary;
  rotationType: FactRotationTypeValue;
};

export type PlanFactRotationSlotsParams = {
  /** Published fact pool to schedule from. */
  facts: FactSummary[];
  now: Date;
  slotCount: number;
  /** Fact ids featured within the lookback window — avoided when possible. */
  recentlyFeaturedFactIds?: ReadonlySet<string>;
  /** Category of the slot immediately before this batch, if known — keeps
   * category variety continuous across cron runs instead of resetting. */
  initialPreviousCategory?: FactCategory | null;
};

/** isFeatured first, then qualityScore desc, then slug asc for determinism. */
function sortByPreference(facts: FactSummary[]): FactSummary[] {
  return [...facts].sort((a, b) => {
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return a.slug.localeCompare(b.slug);
  });
}

/**
 * Picks a fact for one slot via a soft-constraint waterfall:
 *   1. fresh (not excluded) AND a different category than the previous slot
 *   2. fresh, any category (small pools run out of category variety first)
 *   3. any fact with a different category (freshness exhausted — still avoid
 *      two identical-category slots back to back)
 *   4. any fact at all (last resort — a single-category or single-fact pool)
 * Tiers 1–2 are reported as SCHEDULED; 3–4 fall back and are reported as
 * FALLBACK so the generated schedule is honest about where it had to relax.
 */
function pickFactForSlot(
  facts: FactSummary[],
  excluded: ReadonlySet<string>,
  previousCategory: FactCategory | null,
): { fact: FactSummary; rotationType: FactRotationTypeValue } {
  const isFresh = (fact: FactSummary) => !excluded.has(fact.id);
  const isDifferentCategory = (fact: FactSummary) =>
    previousCategory === null || fact.category !== previousCategory;

  const tier1 = sortByPreference(
    facts.filter((fact) => isFresh(fact) && isDifferentCategory(fact)),
  );
  if (tier1.length > 0) return { fact: tier1[0], rotationType: "SCHEDULED" };

  const tier2 = sortByPreference(facts.filter(isFresh));
  if (tier2.length > 0) return { fact: tier2[0], rotationType: "SCHEDULED" };

  const tier3 = sortByPreference(facts.filter(isDifferentCategory));
  if (tier3.length > 0) return { fact: tier3[0], rotationType: "FALLBACK" };

  return { fact: sortByPreference(facts)[0], rotationType: "FALLBACK" };
}

/**
 * Plans `slotCount` consecutive hourly slots starting at the UTC hour
 * containing `now`. Pure — the caller supplies the published pool and the
 * "recently featured" exclusion set; nothing here touches the database.
 */
export function planFactRotationSlots(
  params: PlanFactRotationSlotsParams,
): RotationSlotPlan[] {
  const {
    facts,
    now,
    slotCount,
    recentlyFeaturedFactIds = new Set<string>(),
    initialPreviousCategory = null,
  } = params;
  if (facts.length === 0 || slotCount <= 0) return [];

  const windowStart = startOfUtcHour(now);
  const excluded = new Set(recentlyFeaturedFactIds);
  let previousCategory = initialPreviousCategory;
  const plans: RotationSlotPlan[] = [];

  for (let i = 0; i < slotCount; i += 1) {
    const slotStartAt = new Date(windowStart.getTime() + i * HOUR_MS);
    const slotEndAt = new Date(slotStartAt.getTime() + HOUR_MS);
    const { fact, rotationType } = pickFactForSlot(
      facts,
      excluded,
      previousCategory,
    );
    plans.push({ slotStartAt, slotEndAt, fact, rotationType });
    excluded.add(fact.id);
    previousCategory = fact.category;
  }

  return plans;
}

// ---------------------------------------------------------------------------
// DB-touching orchestration. Dynamic imports keep the pure functions above
// free of any top-level Prisma dependency.
// ---------------------------------------------------------------------------

export type GenerateFactRotationSlotsSummary = {
  windowStart: string;
  windowEnd: string;
  slotsWritten: number;
  scheduled: number;
  fallback: number;
  publishedFactsConsidered: number;
};

/** Fact ids that appeared in a slot within the lookback window before `windowStart`. */
async function getRecentlyFeaturedFactIds(
  windowStart: Date,
  lookbackDays: number,
): Promise<Set<string>> {
  const { prisma } = await import("@/server/db/prisma");
  const lookbackStart = new Date(windowStart.getTime() - lookbackDays * DAY_MS);
  const rows = await prisma.factRotation.findMany({
    where: { slotStartAt: { gte: lookbackStart, lt: windowStart } },
    select: { factId: true },
    distinct: ["factId"],
  });
  return new Set(rows.map((row) => row.factId));
}

/** The category of the most recent already-scheduled slot before `windowStart`, if any. */
async function getPreviousCategory(
  windowStart: Date,
): Promise<FactCategory | null> {
  const { prisma } = await import("@/server/db/prisma");
  const previous = await prisma.factRotation.findFirst({
    where: { slotStartAt: { lt: windowStart } },
    orderBy: { slotStartAt: "desc" },
    include: { fact: { select: { category: true } } },
  });
  return previous?.fact.category ?? null;
}

/**
 * Generates (upserts) the next `slotCount` hourly rotation slots starting at
 * the current UTC hour. Safe to run repeatedly — each slot is keyed by its
 * unique `slotStartAt`, so re-running just re-plans the same window.
 */
export async function generateFactRotationSlots(
  now: Date = new Date(),
  slotCount: number = DEFAULT_SLOT_COUNT,
): Promise<GenerateFactRotationSlotsSummary> {
  const { prisma } = await import("@/server/db/prisma");
  const { getPublishedFacts } = await import("./queries");

  const windowStart = startOfUtcHour(now);
  const [facts, recentlyFeaturedFactIds, initialPreviousCategory] =
    await Promise.all([
      getPublishedFacts(),
      getRecentlyFeaturedFactIds(windowStart, DEFAULT_LOOKBACK_DAYS),
      getPreviousCategory(windowStart),
    ]);

  const plans = planFactRotationSlots({
    facts,
    now,
    slotCount,
    recentlyFeaturedFactIds,
    initialPreviousCategory,
  });

  for (const plan of plans) {
    await prisma.factRotation.upsert({
      where: { slotStartAt: plan.slotStartAt },
      create: {
        factId: plan.fact.id,
        slotStartAt: plan.slotStartAt,
        slotEndAt: plan.slotEndAt,
        rotationType: plan.rotationType,
      },
      update: {
        factId: plan.fact.id,
        slotEndAt: plan.slotEndAt,
        rotationType: plan.rotationType,
      },
    });
  }

  const windowEnd =
    plans.length > 0 ? plans[plans.length - 1].slotEndAt : windowStart;
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    slotsWritten: plans.length,
    scheduled: plans.filter((plan) => plan.rotationType === "SCHEDULED").length,
    fallback: plans.filter((plan) => plan.rotationType === "FALLBACK").length,
    publishedFactsConsidered: facts.length,
  };
}

/**
 * The scheduled fact for the slot containing `now`, or null if no slot has
 * been generated yet or its fact is no longer published (e.g. archived after
 * scheduling). Callers should fall back to the deterministic Phase 1
 * rotation (`selectHourlyFact`) when this returns null.
 */
export async function getCurrentFactRotationSlot(
  now: Date,
): Promise<HourlyFactResult | null> {
  const { prisma } = await import("@/server/db/prisma");
  const { FactStatus } = await import("@/generated/prisma/enums");
  const { factToSummary } = await import("./queries");

  const row = await prisma.factRotation.findFirst({
    where: { slotStartAt: { lte: now }, slotEndAt: { gt: now } },
    include: { fact: { include: { relations: true } } },
  });
  if (row === null || row.fact.status !== FactStatus.PUBLISHED) return null;

  return {
    fact: factToSummary(row.fact),
    nextRotationAt: row.slotEndAt,
    hourBucket: Math.floor(now.getTime() / HOUR_MS),
  };
}
