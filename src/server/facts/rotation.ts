// Hourly rotation for the Discovery Vault "Fact of the Hour".
//
// Phase 2: `getHourlyFact` first checks for a scheduled `FactRotation` slot
// (generated ahead of time by /api/cron/generate-fact-rotations — see
// rotationSchedule.ts and docs/DISCOVERY_VAULT.md). If no slot has been
// scheduled yet for the current hour (or its fact is no longer published),
// it falls back to the original Phase 1 behavior below: a pure function of
// the current UTC hour and the published-fact pool, recomputed on every
// request, no DB writes.
//
// `selectHourlyFact` is exported separately from `getHourlyFact` so the
// selection logic can be unit tested without a database. `./queries` and
// `./rotationSchedule` (which touch Prisma) are imported dynamically inside
// `getHourlyFact` so this module has no top-level runtime dependency on the
// database and can be loaded in isolation by unit tests.

import type { FactCategory } from "@/generated/prisma/enums";
import type { FactSummary, HourlyFactResult } from "./types";

/**
 * Category rotation order. The active hour's category is
 * `CATEGORY_ORDER[hourBucket % CATEGORY_ORDER.length]`, so the archive cycles
 * through every category roughly once per half-day instead of repeating the
 * same kind of fact hour after hour.
 */
export const CATEGORY_ORDER: FactCategory[] = [
  "HISTORY",
  "RECORD",
  "ICONIC_MOMENT",
  "PLAYER_COMPARISON",
  "COUNTRY_COMPARISON",
  "FINAL",
  "PENALTY",
  "FORMAT",
  "HOST",
  "SCHEDULE_2026",
  "FUN_FACT",
];

const HOUR_MS = 60 * 60 * 1000;

/** Number of whole hours elapsed since the Unix epoch, in UTC. */
export function getUtcHourBucket(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS);
}

function sortByQualityThenSlug(facts: FactSummary[]): FactSummary[] {
  return [...facts].sort(
    (a, b) => b.qualityScore - a.qualityScore || a.slug.localeCompare(b.slug),
  );
}

/**
 * Pure selection: given the full published-fact pool and a timestamp, deducts
 * this hour's category and picks a deterministic fact within it (falling back
 * to the whole pool if that category currently has no facts). Never throws;
 * returns null only when the pool itself is empty.
 */
export function selectHourlyFact(
  facts: FactSummary[],
  now: Date,
): HourlyFactResult | null {
  if (facts.length === 0) return null;

  const hourBucket = getUtcHourBucket(now);
  const nextRotationAt = new Date((hourBucket + 1) * HOUR_MS);

  const categoryIndex = hourBucket % CATEGORY_ORDER.length;
  const category = CATEGORY_ORDER[categoryIndex];

  const inCategory = sortByQualityThenSlug(
    facts.filter((fact) => fact.category === category),
  );

  const pool = inCategory.length > 0 ? inCategory : sortByQualityThenSlug(facts);
  // How many times this category has cycled around — advances which fact in
  // the category is shown each time the category comes back up.
  const cycle = Math.floor(hourBucket / CATEGORY_ORDER.length);
  const index = cycle % pool.length;

  return { fact: pool[index], nextRotationAt, hourBucket };
}

/**
 * The current "Fact of the Hour": a scheduled `FactRotation` slot if one
 * exists for this hour, otherwise the deterministic Phase 1 fallback. Never
 * writes to the database.
 */
export async function getHourlyFact(
  now: Date = new Date(),
): Promise<HourlyFactResult | null> {
  const { getCurrentFactRotationSlot } = await import("./rotationSchedule");
  const scheduled = await getCurrentFactRotationSlot(now);
  if (scheduled !== null) return scheduled;

  const { getPublishedFacts } = await import("./queries");
  const facts = await getPublishedFacts();
  return selectHourlyFact(facts, now);
}
