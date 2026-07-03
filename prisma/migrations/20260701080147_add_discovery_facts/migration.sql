-- CreateEnum
CREATE TYPE "FactCategory" AS ENUM ('FUN_FACT', 'RECORD', 'HISTORY', 'PLAYER_COMPARISON', 'COUNTRY_COMPARISON', 'FINAL', 'PENALTY', 'HOST', 'FORMAT', 'ICONIC_MOMENT', 'SCHEDULE_2026');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FactDifficulty" AS ENUM ('CASUAL', 'FAN', 'EXPERT');

-- CreateEnum
CREATE TYPE "FactVerificationStatus" AS ENUM ('UNVERIFIED', 'DB_VERIFIED', 'SOURCE_VERIFIED', 'MANUALLY_VERIFIED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "FactRelationEntityType" AS ENUM ('PLAYER', 'COUNTRY', 'TOURNAMENT', 'MATCH', 'FIXTURE', 'RECORD', 'GENERIC');

-- CreateEnum
CREATE TYPE "FactRelationType" AS ENUM ('PRIMARY', 'MENTIONED', 'COMPARISON', 'SOURCE_DATA', 'RELATED');

-- CreateEnum
CREATE TYPE "FactSourceType" AS ENUM ('WORLDCUP_NEXUS_DB', 'FJELSTUL', 'OPENFOOTBALL', 'WIKIDATA', 'OFFICIAL', 'MANUAL_RESEARCH', 'OTHER');

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" "FactCategory" NOT NULL,
    "difficulty" "FactDifficulty" NOT NULL DEFAULT 'CASUAL',
    "status" "FactStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationStatus" "FactVerificationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "eraStartYear" INTEGER,
    "eraEndYear" INTEGER,
    "readTimeMinutes" INTEGER NOT NULL DEFAULT 2,
    "rotationWeight" INTEGER NOT NULL DEFAULT 100,
    "qualityScore" INTEGER NOT NULL DEFAULT 50,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "lastFeaturedAt" TIMESTAMP(3),
    "contentBlocks" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactRelation" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "entityType" "FactRelationEntityType" NOT NULL,
    "entityId" TEXT,
    "entitySlug" TEXT,
    "entityLabel" TEXT,
    "relationType" "FactRelationType" NOT NULL DEFAULT 'RELATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactSource" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceType" "FactSourceType" NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fact_slug_key" ON "Fact"("slug");

-- CreateIndex
CREATE INDEX "Fact_category_idx" ON "Fact"("category");

-- CreateIndex
CREATE INDEX "Fact_status_idx" ON "Fact"("status");

-- CreateIndex
CREATE INDEX "Fact_difficulty_idx" ON "Fact"("difficulty");

-- CreateIndex
CREATE INDEX "Fact_verificationStatus_idx" ON "Fact"("verificationStatus");

-- CreateIndex
CREATE INDEX "Fact_publishedAt_idx" ON "Fact"("publishedAt");

-- CreateIndex
CREATE INDEX "Fact_isFeatured_idx" ON "Fact"("isFeatured");

-- CreateIndex
CREATE INDEX "Fact_eraStartYear_idx" ON "Fact"("eraStartYear");

-- CreateIndex
CREATE INDEX "Fact_eraEndYear_idx" ON "Fact"("eraEndYear");

-- CreateIndex
CREATE INDEX "FactRelation_factId_idx" ON "FactRelation"("factId");

-- CreateIndex
CREATE INDEX "FactRelation_entityType_idx" ON "FactRelation"("entityType");

-- CreateIndex
CREATE INDEX "FactRelation_entitySlug_idx" ON "FactRelation"("entitySlug");

-- CreateIndex
CREATE INDEX "FactRelation_relationType_idx" ON "FactRelation"("relationType");

-- CreateIndex
CREATE INDEX "FactSource_factId_idx" ON "FactSource"("factId");

-- CreateIndex
CREATE INDEX "FactSource_sourceType_idx" ON "FactSource"("sourceType");

-- AddForeignKey
ALTER TABLE "FactRelation" ADD CONSTRAINT "FactRelation_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSource" ADD CONSTRAINT "FactSource_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
