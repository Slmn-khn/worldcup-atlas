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
] as const;

export type SearchDocumentType = (typeof SEARCH_DOCUMENT_TYPES)[number];

/** Shape stored in the Meilisearch index. */
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
  playerName?: string;
  stage?: string;
  sortYear?: number;
};

/** Frontend-friendly single result. */
export type SearchResultDto = {
  id: string;
  type: SearchDocumentType;
  title: string;
  subtitle: string | null;
  description: string | null;
  href: string;
};

export type SearchResponseDto = {
  query: string;
  total: number;
  groups: {
    tournaments: SearchResultDto[];
    countries: SearchResultDto[];
    players: SearchResultDto[];
    matches: SearchResultDto[];
    records: SearchResultDto[];
    events: SearchResultDto[];
    venues: SearchResultDto[];
  };
};

export function emptySearchResponse(query: string): SearchResponseDto {
  return {
    query,
    total: 0,
    groups: {
      tournaments: [],
      countries: [],
      players: [],
      matches: [],
      records: [],
      events: [],
      venues: [],
    },
  };
}
