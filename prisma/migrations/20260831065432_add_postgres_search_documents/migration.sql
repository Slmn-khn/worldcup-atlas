-- CreateTable
CREATE TABLE "SearchDocument" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "slug" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "countryCode" TEXT,
    "imageUrl" TEXT,
    "source" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchDocument_entityType_idx" ON "SearchDocument"("entityType");

-- CreateIndex
CREATE INDEX "SearchDocument_year_idx" ON "SearchDocument"("year");

-- CreateIndex
CREATE INDEX "SearchDocument_countryCode_idx" ON "SearchDocument"("countryCode");

-- CreateIndex
CREATE INDEX "SearchDocument_priority_idx" ON "SearchDocument"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "SearchDocument_entityType_entityId_key" ON "SearchDocument"("entityType", "entityId");

-- Postgres-backed search (replaces Meilisearch). pg_trgm powers fuzzy/typo
-- matching; the generated tsvector column powers ranked full-text search.
-- Supabase supports both out of the box (pg_trgm ships with Postgres contrib).
create extension if not exists pg_trgm;

-- array_to_string() is only STABLE, but generated columns require IMMUTABLE
-- expressions — wrap it (safe: text[] joining is deterministic).
create or replace function search_document_keywords_text(keywords text[])
returns text
language sql
immutable
parallel safe
return coalesce(array_to_string(keywords, ' '), '');

alter table "SearchDocument"
add column if not exists "searchVector" tsvector
generated always as (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("subtitle", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("body", '')), 'C') ||
  setweight(to_tsvector('english', search_document_keywords_text("keywords")), 'A')
) stored;

create index if not exists "SearchDocument_searchVector_idx"
on "SearchDocument"
using gin ("searchVector");

create index if not exists "SearchDocument_title_trgm_idx"
on "SearchDocument"
using gin ("title" gin_trgm_ops);

create index if not exists "SearchDocument_subtitle_trgm_idx"
on "SearchDocument"
using gin ("subtitle" gin_trgm_ops);

create index if not exists "SearchDocument_body_trgm_idx"
on "SearchDocument"
using gin ("body" gin_trgm_ops);
