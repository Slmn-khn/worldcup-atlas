// Search document and result DTO types. Documents are derived from
// normalized application tables only — never from RawSourceRecord.

export const SEARCH_DOCUMENT_TYPES = [
  "tournament",
  "country",
  "player",
  "match",
  "record",
  "event",
  "venue",
  "fact",
] as const;

export type SearchDocumentType = (typeof SEARCH_DOCUMENT_TYPES)[number];

/**
 * Shape produced by the document builders (documents.ts). Rows in the
 * Postgres SearchDocument table are derived from this via
 * `toSearchDocumentRow` (indexing.ts).
 */
export type SearchDocument = {
  id: string;
  type: SearchDocumentType;
  title: string;
  subtitle: string | null;
  description: string | null;
  href: string;
  keywords: string[];
  tournamentYear?: number;
  countryName?: string;
  countryCode?: string;
  playerName?: string;
  stage?: string;
  sortYear?: number;
};

/** One ranked hit from Postgres full-text/trigram search. */
export type SearchResult = {
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

/** Response shape of GET /api/search. */
export type SearchApiResponse = {
  query: string;
  count: number;
  results: SearchResult[];
};

