// Maps builder documents (documents.ts) to SearchDocument table rows.
// Pure functions — no database access — so the mapping is unit-testable
// and `pnpm search:index` stays a thin orchestrator.

import type { Prisma } from "@/generated/prisma/client";
import type { SearchDocument, SearchDocumentType } from "./types";

/**
 * Ranking priority per entity type — LOWER is more important. Used as a
 * late tiebreaker after text relevance, so a player named exactly like a
 * venue still wins on title match, but ties break toward marquee content.
 */
export const SEARCH_PRIORITY_BY_TYPE: Record<SearchDocumentType, number> = {
  tournament: 5,
  country: 10,
  player: 15,
  match: 20,
  record: 25,
  venue: 30,
  event: 60,
  fact: 12,
};

/** 2026 archive docs get a small boost — it is the site's marquee content. */
const WC2026_PRIORITY_BOOST = 5;

export type SearchDocumentRow = Omit<
  Prisma.SearchDocumentCreateManyInput,
  "id" | "createdAt" | "updatedAt"
>;

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Last path segment of the doc URL (hash/query stripped), e.g. "pele". */
export function slugFromHref(href: string): string | null {
  const path = href.split("#")[0].split("?")[0];
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

export function isWorldCup2026Doc(doc: SearchDocument): boolean {
  return doc.id.startsWith("wc2026-");
}

export function toSearchDocumentRow(doc: SearchDocument): SearchDocumentRow {
  const basePriority = SEARCH_PRIORITY_BY_TYPE[doc.type] ?? 100;
  const priority = isWorldCup2026Doc(doc)
    ? Math.max(1, basePriority - WC2026_PRIORITY_BOOST)
    : basePriority;
  const keywords = [
    ...new Set(
      [...doc.keywords, doc.playerName, doc.countryName, doc.stage].filter(
        (keyword): keyword is string =>
          keyword !== undefined && keyword !== null && keyword.trim() !== "",
      ),
    ),
  ];
  return {
    entityType: doc.type,
    entityId: doc.id,
    slug: slugFromHref(doc.href),
    url: doc.href,
    title: doc.title,
    subtitle: emptyToNull(doc.subtitle),
    body: emptyToNull(doc.description),
    keywords,
    year: doc.tournamentYear ?? doc.sortYear ?? null,
    countryCode: emptyToNull(doc.countryCode),
    imageUrl: null,
    source: isWorldCup2026Doc(doc) ? "mominul_2026_dataset" : "fjelstul",
    priority,
  };
}

export function toSearchDocumentRows(
  docs: SearchDocument[],
): SearchDocumentRow[] {
  return docs.map(toSearchDocumentRow);
}

/** Document counts per entity type, sorted by type name, for script output. */
export function countByEntityType(
  rows: { entityType: string }[],
): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.entityType, (counts.get(row.entityType) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}
