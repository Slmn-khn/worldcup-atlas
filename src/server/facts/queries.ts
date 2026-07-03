// Read-side query layer for the Discovery Vault. Every function here filters
// to `status: PUBLISHED` — draft/needs-review/archived/rejected facts are
// never returned by these queries, so nothing unverified can leak publicly.
// See docs/DISCOVERY_VAULT.md.

import { prisma } from "@/server/db/prisma";
import { FactStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { FactCategory, FactDifficulty } from "@/generated/prisma/enums";
import { parseContentBlocks } from "./types";
import type { FactDetail, FactSourceSummary, FactSummary } from "./types";

const factWithRelationsInclude = {
  relations: true,
} satisfies Prisma.FactInclude;

type FactWithRelations = Prisma.FactGetPayload<{
  include: typeof factWithRelationsInclude;
}>;

type FactWithRelationsAndSources = Prisma.FactGetPayload<{
  include: { relations: true; sources: true };
}>;

/** Maps a Fact row (with relations loaded) to its public DTO. Exported for
 * reuse by rotationSchedule.ts, which needs the identical mapping when
 * reading a scheduled fact straight off a FactRotation row. */
export function factToSummary(fact: FactWithRelations): FactSummary {
  return {
    id: fact.id,
    slug: fact.slug,
    title: fact.title,
    summary: fact.summary,
    category: fact.category,
    difficulty: fact.difficulty,
    eraStartYear: fact.eraStartYear,
    eraEndYear: fact.eraEndYear,
    readTimeMinutes: fact.readTimeMinutes,
    qualityScore: fact.qualityScore,
    isFeatured: fact.isFeatured,
    tags: fact.tags,
    publishedAt: fact.publishedAt?.toISOString() ?? null,
    relations: fact.relations.map((relation) => ({
      entityType: relation.entityType,
      entitySlug: relation.entitySlug,
      entityLabel: relation.entityLabel,
    })),
  };
}

function toSource(source: FactWithRelationsAndSources["sources"][number]): FactSourceSummary {
  return {
    id: source.id,
    label: source.label,
    sourceType: source.sourceType,
    url: source.url,
    notes: source.notes,
  };
}

function toDetail(fact: FactWithRelationsAndSources): FactDetail {
  return {
    ...factToSummary(fact),
    contentBlocks: parseContentBlocks(fact.contentBlocks),
    sources: fact.sources.map(toSource),
  };
}

export type GetPublishedFactsOptions = {
  category?: FactCategory;
  difficulty?: FactDifficulty;
  q?: string;
  limit?: number;
};

/** Published facts, newest first. Powers the /facts archive listing and rotation pool. */
export async function getPublishedFacts(
  options: GetPublishedFactsOptions = {},
): Promise<FactSummary[]> {
  const where: Prisma.FactWhereInput = { status: FactStatus.PUBLISHED };
  if (options.category !== undefined) where.category = options.category;
  if (options.difficulty !== undefined) where.difficulty = options.difficulty;

  const q = options.q?.trim();
  if (q !== undefined && q !== "") {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
      { tags: { has: q.toLowerCase() } },
    ];
  }

  const facts = await prisma.fact.findMany({
    where,
    include: factWithRelationsInclude,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: options.limit,
  });
  return facts.map(factToSummary);
}

/** A single published fact with full content blocks + sources, or null. */
export async function getFactBySlug(slug: string): Promise<FactDetail | null> {
  const fact = await prisma.fact.findUnique({
    where: { slug },
    include: { relations: true, sources: true },
  });
  if (fact === null || fact.status !== FactStatus.PUBLISHED) return null;
  return toDetail(fact);
}

/** A random published fact, optionally excluding one slug (the current page). */
export async function getRandomFact(
  options: { excludeSlug?: string } = {},
): Promise<FactSummary | null> {
  const facts = await getPublishedFacts();
  if (facts.length === 0) return null;
  const pool =
    options.excludeSlug !== undefined
      ? facts.filter((fact) => fact.slug !== options.excludeSlug)
      : facts;
  const finalPool = pool.length > 0 ? pool : facts;
  const index = Math.floor(Math.random() * finalPool.length);
  return finalPool[index];
}

/**
 * Facts related to `factId` — first by shared relation entities (same
 * player/country/tournament/…), then padded out with facts from the same
 * category. Always excludes the fact itself and always PUBLISHED-only.
 */
export async function getRelatedFacts(
  factId: string,
  limit = 3,
): Promise<FactSummary[]> {
  const current = await prisma.fact.findUnique({
    where: { id: factId },
    include: { relations: true },
  });
  if (current === null) return [];

  const entityKeys = current.relations
    .filter((relation) => relation.entitySlug !== null)
    .map((relation) => ({
      entityType: relation.entityType,
      entitySlug: relation.entitySlug as string,
    }));

  let related: FactWithRelations[] = [];
  if (entityKeys.length > 0) {
    related = await prisma.fact.findMany({
      where: {
        status: FactStatus.PUBLISHED,
        id: { not: factId },
        relations: { some: { OR: entityKeys } },
      },
      include: factWithRelationsInclude,
      orderBy: [{ qualityScore: "desc" }, { publishedAt: "desc" }],
      take: limit,
    });
  }

  if (related.length < limit) {
    const more = await prisma.fact.findMany({
      where: {
        status: FactStatus.PUBLISHED,
        id: { notIn: [factId, ...related.map((fact) => fact.id)] },
        category: current.category,
      },
      include: factWithRelationsInclude,
      orderBy: [{ qualityScore: "desc" }, { publishedAt: "desc" }],
      take: limit - related.length,
    });
    related = [...related, ...more];
  }

  return related.map(factToSummary);
}

/** Distinct tags across published facts, for lightweight search hints. */
export async function getPublishedFactCategories(): Promise<FactCategory[]> {
  const grouped = await prisma.fact.groupBy({
    by: ["category"],
    where: { status: FactStatus.PUBLISHED },
  });
  return grouped.map((group) => group.category);
}
