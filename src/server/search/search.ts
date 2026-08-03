// Global search service (Checkpoint 6A). Runs one sub-query per document
// type via multiSearch so every group is represented (a player profile is
// never crowded out by thousands of event documents), then returns grouped,
// frontend-friendly results.

import { getSearchClient, SEARCH_INDEX_UID } from "./client";
import {
  SEARCH_DOCUMENT_TYPES,
  emptySearchResponse,
  type SearchDocument,
  type SearchDocumentType,
  type SearchResponseDto,
} from "./types";

const DEFAULT_LIMIT = 18;
const MAX_LIMIT = 50;
// Server-side query length cap (Checkpoint 8B, P1.2) — applied here so every
// caller is covered; long queries are truncated, never rejected.
export const MAX_QUERY_LENGTH = 200;

const GROUP_BY_TYPE: Record<
  SearchDocumentType,
  keyof SearchResponseDto["groups"]
> = {
  tournament: "tournaments",
  country: "countries",
  player: "players",
  match: "matches",
  record: "records",
  event: "events",
  venue: "venues",
};

export async function searchWorldCupAtlas(
  query: string,
  options: { limit?: number; types?: SearchDocumentType[] } = {},
): Promise<SearchResponseDto> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed === "") return emptySearchResponse("");

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)),
  );
  const types =
    options.types !== undefined && options.types.length > 0
      ? options.types.filter((type) => SEARCH_DOCUMENT_TYPES.includes(type))
      : [...SEARCH_DOCUMENT_TYPES];
  if (types.length === 0) return emptySearchResponse(trimmed);

  const perTypeLimit = Math.max(2, Math.ceil(limit / types.length));
  const client = getSearchClient();
  const { results } = await client.multiSearch<
    {
      queries: { indexUid: string; q: string; limit: number; filter: string }[];
    },
    SearchDocument
  >({
    queries: types.map((type) => ({
      indexUid: SEARCH_INDEX_UID,
      q: trimmed,
      limit: perTypeLimit,
      filter: `type = ${type}`,
    })),
  });

  const response = emptySearchResponse(trimmed);
  for (const result of results) {
    for (const hit of result.hits) {
      const group = GROUP_BY_TYPE[hit.type];
      if (group === undefined) continue;
      response.groups[group].push({
        id: hit.id,
        type: hit.type,
        title: hit.title,
        subtitle: hit.subtitle ?? null,
        description: hit.description ?? null,
        href: hit.href,
      });
      response.total += 1;
    }
  }
  return response;
}
