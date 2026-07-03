// Zod validation for the Discovery Vault starter-facts seed file. Pure (no
// Node/Prisma imports) so it is safe to unit test and shared between the seed
// script and its tests. Mirrors the enum values in prisma/schema.prisma as
// literal tuples, matching the convention in scripts/media/seed-curated-media.ts.

import { z } from "zod";
import { factContentBlockSchema } from "./types";

export const FACT_CATEGORIES = [
  "FUN_FACT",
  "RECORD",
  "HISTORY",
  "PLAYER_COMPARISON",
  "COUNTRY_COMPARISON",
  "FINAL",
  "PENALTY",
  "HOST",
  "FORMAT",
  "ICONIC_MOMENT",
  "SCHEDULE_2026",
] as const;

export const FACT_STATUSES = [
  "DRAFT",
  "NEEDS_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
  "REJECTED",
] as const;

export const FACT_DIFFICULTIES = ["CASUAL", "FAN", "EXPERT"] as const;

export const FACT_VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "DB_VERIFIED",
  "SOURCE_VERIFIED",
  "MANUALLY_VERIFIED",
  "NEEDS_REVIEW",
] as const;

export const FACT_RELATION_ENTITY_TYPES = [
  "PLAYER",
  "COUNTRY",
  "TOURNAMENT",
  "MATCH",
  "FIXTURE",
  "RECORD",
  "GENERIC",
] as const;

export const FACT_RELATION_TYPES = [
  "PRIMARY",
  "MENTIONED",
  "COMPARISON",
  "SOURCE_DATA",
  "RELATED",
] as const;

export const FACT_SOURCE_TYPES = [
  "WORLDCUP_NEXUS_DB",
  "FJELSTUL",
  "OPENFOOTBALL",
  "WIKIDATA",
  "OFFICIAL",
  "MANUAL_RESEARCH",
  "OTHER",
] as const;

/** A fact may only be marked PUBLISHED once it has been verified in one of these ways. */
const PUBLISHABLE_VERIFICATION_STATUSES = new Set<string>([
  "DB_VERIFIED",
  "SOURCE_VERIFIED",
  "MANUALLY_VERIFIED",
]);

const factSourceSchema = z
  .object({
    label: z.string().trim().min(1),
    sourceType: z.enum(FACT_SOURCE_TYPES),
    url: z.string().trim().url().optional(),
    notes: z.string().trim().min(1).optional(),
  })
  .refine((source) => source.url !== undefined || source.notes !== undefined, {
    message: "each source requires a url or notes so the claim can be checked",
    path: ["notes"],
  });

const factRelationSchema = z.object({
  entityType: z.enum(FACT_RELATION_ENTITY_TYPES),
  entityId: z.string().trim().min(1).optional(),
  entitySlug: z.string().trim().min(1).optional(),
  entityLabel: z.string().trim().min(1).optional(),
  relationType: z.enum(FACT_RELATION_TYPES).optional().default("RELATED"),
});

export const factSeedSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    category: z.enum(FACT_CATEGORIES),
    difficulty: z.enum(FACT_DIFFICULTIES).optional().default("CASUAL"),
    status: z.enum(FACT_STATUSES),
    verificationStatus: z.enum(FACT_VERIFICATION_STATUSES),
    eraStartYear: z.number().int().optional(),
    eraEndYear: z.number().int().optional(),
    readTimeMinutes: z.number().int().min(1).max(30).optional().default(2),
    contentBlocks: z.array(factContentBlockSchema).min(1),
    tags: z.array(z.string().trim().min(1)).optional().default([]),
    sources: z
      .array(factSourceSchema)
      .min(1, "every fact needs at least one source note"),
    relations: z.array(factRelationSchema).optional().default([]),
  })
  .refine(
    (fact) =>
      fact.status !== "PUBLISHED" ||
      PUBLISHABLE_VERIFICATION_STATUSES.has(fact.verificationStatus),
    {
      message:
        "PUBLISHED facts require verificationStatus DB_VERIFIED, SOURCE_VERIFIED, or MANUALLY_VERIFIED",
      path: ["status"],
    },
  );

export type FactSeedRecord = z.infer<typeof factSeedSchema>;
