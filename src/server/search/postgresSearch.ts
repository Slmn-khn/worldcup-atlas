// Postgres-backed global search (replaces Meilisearch — free, runs on the
// existing PostgreSQL/Supabase database). Ranked full-text search over the
// SearchDocument table's generated tsvector column, with pg_trgm fuzzy
// matching so typos like "Maradna" still find "Diego Maradona".
// Server-only — the browser talks to /api/search.

import { prisma } from "@/server/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  SEARCH_DOCUMENT_TYPES,
  type SearchDocumentType,
  type SearchResult,
} from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
export const MIN_QUERY_LENGTH = 2;
// Long queries are truncated server-side, never rejected.
export const MAX_QUERY_LENGTH = 200;
// word_similarity() threshold for fuzzy title matches. Low enough to catch
// one-or-two-letter typos, high enough to keep noise out.
const WORD_SIMILARITY_THRESHOLD = 0.4;

/**
 * Normalizes raw user input into a query string that is safe to hand to
 * websearch_to_tsquery/pg_trgm: strips null bytes and control characters,
 * collapses whitespace, and caps the length. Never throws.
 */
export function sanitizeSearchQuery(raw: string): string {
  const controlChars = /[\u0000-\u001f\u007f]/g;
  return raw
    .replace(controlChars, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}

/** Keeps only known entity types (defense in depth on top of parameterization). */
export function normalizeEntityTypes(
  entityTypes: string[] | undefined,
): SearchDocumentType[] {
  if (entityTypes === undefined) return [];
  return entityTypes.filter((type): type is SearchDocumentType =>
    SEARCH_DOCUMENT_TYPES.includes(type as SearchDocumentType),
  );
}

type SearchRow = {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  url: string;
  year: number | null;
  countryCode: string | null;
  imageUrl: string | null;
  source: string | null;
  score: number;
};

export function toSearchResult(row: SearchRow): SearchResult {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    subtitle: row.subtitle,
    url: row.url,
    year: row.year,
    countryCode: row.countryCode,
    imageUrl: row.imageUrl,
    source: row.source,
    score: Number(row.score),
  };
}

export type SearchDocumentsInput = {
  query: string;
  entityTypes?: string[];
  year?: number;
  limit?: number;
};

/**
 * Ranked search over the SearchDocument table.
 *
 * Matching: websearch_to_tsquery('english', …) against the generated
 * tsvector (title/keywords weight A, subtitle B, body C), OR'd with pg_trgm
 * word_similarity + substring matches on the title for fuzzy/typo queries.
 *
 * Ranking: exact title match, then full-text rank, then title similarity,
 * then priority (lower = more important), then recency.
 */
export async function searchDocuments(
  input: SearchDocumentsInput,
): Promise<SearchResult[]> {
  const query = sanitizeSearchQuery(input.query);
  if (query.length < MIN_QUERY_LENGTH) return [];

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIMIT)),
  );
  const entityTypes = normalizeEntityTypes(input.entityTypes);
  const typeFilter =
    entityTypes.length > 0
      ? Prisma.sql`and "entityType" in (${Prisma.join(entityTypes)})`
      : Prisma.empty;
  const yearFilter =
    input.year !== undefined && Number.isInteger(input.year)
      ? Prisma.sql`and "year" = ${input.year}`
      : Prisma.empty;

  try {
    const rows = await prisma.$queryRaw<
      (SearchRow & {
        exactTitle: boolean;
        textRank: number;
        titleSimilarity: number;
      })[]
    >`
      select
        "id",
        "entityType",
        "entityId",
        "title",
        "subtitle",
        "url",
        "year",
        "countryCode",
        "imageUrl",
        "source",
        (
          ts_rank("searchVector", websearch_to_tsquery('english', ${query})) * 4
          + similarity("title", ${query})
          + word_similarity(${query}, "title")
        )::float8 as "score",
        (lower("title") = lower(${query})) as "exactTitle",
        ts_rank("searchVector", websearch_to_tsquery('english', ${query}))::float8 as "textRank",
        similarity("title", ${query})::float8 as "titleSimilarity"
      from "SearchDocument"
      where (
        "searchVector" @@ websearch_to_tsquery('english', ${query})
        or word_similarity(${query}, "title") >= ${WORD_SIMILARITY_THRESHOLD}
        or "title" ilike '%' || ${query} || '%'
      )
      ${typeFilter}
      ${yearFilter}
      order by
        "exactTitle" desc,
        "textRank" desc,
        "titleSimilarity" desc,
        "priority" asc,
        "updatedAt" desc
      limit ${limit}
    `;
    return rows.map(toSearchResult);
  } catch (error) {
    // A malformed query must never take a page down: log server-side and
    // degrade to "no results". Connectivity errors still propagate so the
    // API route can answer 503.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2010"
    ) {
      console.error("[search] query failed, returning empty results", error);
      return [];
    }
    throw error;
  }
}
