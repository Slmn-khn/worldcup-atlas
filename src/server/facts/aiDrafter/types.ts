// Types for the AI-assisted fact candidate writer. Pure — no Prisma or
// Anthropic SDK import (Zod itself has no side effects, same as
// src/server/facts/types.ts) — so ./adapt.ts and ./validate.ts stay
// unit-testable without a database or API key. ./client.ts is the only file
// in this module that touches the Anthropic SDK; it is always reached via a
// dynamic import from ./index.ts, mirroring the pure/impure split already
// used throughout src/server/facts (see rotation.ts, discoveryProgress.ts).

import { z } from "zod";

import type { FactCategory, FactDifficulty } from "@/generated/prisma/enums";
import type {
  FactTemplateId,
  GeneratedFactCandidate,
  GeneratedFactRelationInput,
} from "@/server/facts/generator/types";

export type AiDraftFact = { label: string; value: string | number };

/**
 * Structured, DB-backed input handed to the AI. `facts` is the exhaustive
 * allow-list of numbers the AI may state in its draft — see ./validate.ts,
 * which rejects any digit sequence in the drafted text that doesn't trace
 * back to one of these values. `context` orients the AI narratively but must
 * never introduce a fact that isn't already present in `facts`.
 *
 * `slug` deliberately matches the slug the deterministic generator
 * (../generator) would produce for the same underlying record, so an
 * AI-drafted candidate lands on the same Fact row rather than creating a
 * duplicate entry in the review queue for the same fact.
 */
export type AiDraftInput = {
  templateId: FactTemplateId;
  slug: string;
  facts: AiDraftFact[];
  context: string;
  category: FactCategory;
  difficulty: FactDifficulty;
  eraStartYear: number | null;
  eraEndYear: number | null;
  tags: string[];
  relations: GeneratedFactRelationInput[];
  /** Rendered verbatim into the final stat_grid content block — deterministic,
   * never AI-authored, so the block's numbers are trivially correct. */
  statGrid: { label: string; value: string }[];
  /** Plain-English description of the query this input came from, for the
   * FactSource audit trail (same convention as the deterministic generator). */
  queryDescription: string;
};

export const aiDraftedTextSchema = z.object({
  title: z.string().trim().min(1).max(140),
  summary: z.string().trim().min(1).max(320),
  paragraph: z.string().trim().min(1).max(600),
});

export type AiDraftedText = z.infer<typeof aiDraftedTextSchema>;

export type NumericValidationResult = {
  valid: boolean;
  /** Numbers found in the draft that don't trace back to `facts` — the
   * signal that the model stated something not given to it. */
  invalidNumbers: number[];
  allowedNumbers: number[];
};

export type AiDraftResult =
  | { status: "drafted"; slug: string; templateId: FactTemplateId; candidate: GeneratedFactCandidate }
  | {
      status: "validation_failed";
      slug: string;
      templateId: FactTemplateId;
      draft: AiDraftedText;
      invalidNumbers: number[];
    }
  | { status: "ai_error"; slug: string; templateId: FactTemplateId; message: string };
