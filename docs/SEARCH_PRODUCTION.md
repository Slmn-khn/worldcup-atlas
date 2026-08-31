# WORLDCUP Nexus — Search Production Notes

Search is **Postgres-backed**: it runs entirely on the existing
PostgreSQL/Supabase database using full-text search (a generated
`tsvector` column) plus `pg_trgm` trigram fuzzy matching. There is **no
external search service** — Meilisearch was removed because its cloud
pricing was not justified by current traffic (see "History" below).

The search index is a derived artifact — the `SearchDocument` table can
always be rebuilt from the database.

## Architecture

- `SearchDocument` table (Prisma model + migration
  `20260831065432_add_postgres_search_documents`): one row per
  searchable entity — tournaments, countries, players, matches, records,
  events, Discovery Vault facts (PUBLISHED only), and the 2026 archive
  (teams, matches, players, venues).
- `searchVector` is a `GENERATED ALWAYS … STORED` tsvector column
  (title/keywords weight A, subtitle B, body C) with a GIN index;
  `pg_trgm` GIN indexes on title/subtitle/body power typo-tolerant
  matching ("Maradna" → Diego Maradona).
- Query path: browser → `GET /api/search` →
  `src/server/search/postgresSearch.ts` (`websearch_to_tsquery` +
  `word_similarity`, parameterized SQL via Prisma `$queryRaw`). The
  browser never talks to the database directly and no API key is
  involved.
- Ranking: exact title match, full-text rank, title similarity, per-type
  priority (lower = more important), recency.

## Requirements

- `DATABASE_URL` — the only variable search needs (the same database the
  app already uses). **No `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY`.**
- The migration enables the `pg_trgm` extension
  (`create extension if not exists pg_trgm`) — supported out of the box
  on Supabase and standard Postgres. Deploy migrations with
  `pnpm db:deploy` (use the direct/session 5432 connection, not the
  pooled endpoint).

## Indexing workflow

From a trusted admin environment with the production `DATABASE_URL`:

```bash
pnpm search:index     # atomically rebuilds the SearchDocument table
pnpm search:verify    # common queries through the same module the app uses
```

- Re-run `pnpm search:index` after **every** data import — the table is
  a snapshot of the database and does not update itself.
- The rebuild runs inside one transaction (delete + batched insert), so
  concurrent readers see either the old or the new index, never a
  half-built one. The script is idempotent and safe to re-run.
- Index documents are derived from the normalized database tables via
  the query layer only — **RawSourceRecord is never indexed** (and
  `pnpm export:verify` / `pnpm data:verify:queries` assert it never
  leaks elsewhere either).

## Failure behavior

If the database is unreachable, `/api/search` returns a 503 with a
generic message (no connection details in production) and every page
keeps working — search is an enhancement, not a dependency. An empty or
stale `SearchDocument` table simply returns fewer results.

## Rollback

- The index is rebuildable at any time from the database: re-run
  `pnpm search:index` (takes seconds for this dataset).
- After a database restore, always reindex so search matches the data.

## History (Meilisearch removal)

Meilisearch was the original search backend. It was removed
(2026-08-31) because Meilisearch Cloud pricing was too expensive for the
site's traffic; Postgres full-text + `pg_trgm` on the existing database
is free and covers the same queries. If future scale demands a dedicated
engine, Meilisearch or Typesense can be reintroduced behind the same
`/api/search` contract — the document builders
(`src/server/search/documents.ts`) are storage-agnostic.

After the migration is deployed and verified, remove `MEILISEARCH_HOST`
and `MEILISEARCH_API_KEY` from the hosting platform env (e.g. Vercel)
and delete or downgrade the Meilisearch Cloud project to stop billing.
