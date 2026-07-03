// Discovery Vault domain types. Content blocks are validated with Zod so a
// malformed or partially-invalid `Fact.contentBlocks` JSON value can never
// crash a page — unrecognized/invalid blocks are dropped, valid ones render.
// See docs/DISCOVERY_VAULT.md.

import { z } from "zod";
import type {
  FactCategory,
  FactDifficulty,
  FactRelationEntityType,
  FactSourceType,
} from "@/generated/prisma/enums";

const statGridItemSchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  note: z.string().trim().min(1).optional(),
});

const timelineItemSchema = z.object({
  year: z.number().int().optional(),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
});

const comparisonItemSchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  note: z.string().trim().min(1).optional(),
});

const relatedLinkItemSchema = z.object({
  label: z.string().trim().min(1),
  href: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
});

export const factContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().trim().min(1) }),
  z.object({ type: z.literal("paragraph"), text: z.string().trim().min(1) }),
  z.object({
    type: z.literal("callout"),
    variant: z.enum(["gold", "cyan", "default"]).optional(),
    text: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("stat_grid"),
    items: z.array(statGridItemSchema).min(1),
  }),
  z.object({
    type: z.literal("timeline"),
    items: z.array(timelineItemSchema).min(1),
  }),
  z.object({
    type: z.literal("comparison"),
    title: z.string().trim().min(1).optional(),
    items: z.array(comparisonItemSchema).min(1),
  }),
  z.object({
    type: z.literal("related_links"),
    title: z.string().trim().min(1).optional(),
    items: z.array(relatedLinkItemSchema).min(1),
  }),
  z.object({ type: z.literal("source_note"), text: z.string().trim().min(1) }),
  z.object({
    type: z.literal("quiz"),
    question: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: z.string().trim().min(1).optional(),
  }),
]);

export type FactContentBlock = z.infer<typeof factContentBlockSchema>;

/**
 * Parses a Fact's raw `contentBlocks` JSON into a safe array of known block
 * types. Anything that isn't an array becomes `[]`; individual items that
 * don't match a known block shape are silently dropped rather than throwing,
 * so one bad block never takes down the rest of the page. A `quiz` block also
 * gets one extra check that a discriminated union can't express on its own:
 * `correctIndex` must actually reference one of `options`.
 */
export function parseContentBlocks(raw: unknown): FactContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: FactContentBlock[] = [];
  for (const item of raw) {
    const parsed = factContentBlockSchema.safeParse(item);
    if (!parsed.success) continue;
    if (
      parsed.data.type === "quiz" &&
      parsed.data.correctIndex >= parsed.data.options.length
    ) {
      continue;
    }
    blocks.push(parsed.data);
  }
  return blocks;
}

/** A related entity chip (player/country/tournament/…) shown on a fact card. */
export type FactRelationSummary = {
  entityType: FactRelationEntityType;
  entitySlug: string | null;
  entityLabel: string | null;
};

/** Lightweight fact shape used for cards, listings, and the hourly rotation. */
export type FactSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: FactCategory;
  difficulty: FactDifficulty;
  eraStartYear: number | null;
  eraEndYear: number | null;
  readTimeMinutes: number;
  qualityScore: number;
  isFeatured: boolean;
  tags: string[];
  publishedAt: string | null;
  relations: FactRelationSummary[];
};

export type FactSourceSummary = {
  id: string;
  label: string;
  sourceType: FactSourceType;
  url: string | null;
  notes: string | null;
};

/** Full fact shape for the detail page — adds content blocks and sources. */
export type FactDetail = FactSummary & {
  contentBlocks: FactContentBlock[];
  sources: FactSourceSummary[];
};

export type HourlyFactResult = {
  fact: FactSummary;
  nextRotationAt: Date;
  hourBucket: number;
};
