// Pure: assembles the final GeneratedFactCandidate from an AiDraftInput and
// its already-validated AI-drafted text. No AI call, no Prisma import — by
// the time this runs, ./validate.ts has already confirmed every numeric
// claim in `draft` traces back to `input.facts`. The stat_grid block is
// rendered entirely from `input.statGrid`, never from the AI's text, so its
// numbers are correct by construction rather than by validation.

import type { GeneratedFactCandidate } from "@/server/facts/generator/types";
import type { AiDraftedText, AiDraftInput } from "./types";

const AI_SOURCE_LABEL_PREFIX = "WORLDCUP Nexus AI-assisted drafter";
const MODEL_LABEL = "claude-opus-4-8";

export function buildCandidateFromDraft(
  input: AiDraftInput,
  draft: AiDraftedText,
): GeneratedFactCandidate {
  return {
    slug: input.slug,
    title: draft.title,
    summary: draft.summary,
    category: input.category,
    difficulty: input.difficulty,
    eraStartYear: input.eraStartYear,
    eraEndYear: input.eraEndYear,
    readTimeMinutes: 2,
    tags: input.tags,
    contentBlocks: [
      { type: "heading", text: draft.title },
      { type: "paragraph", text: draft.paragraph },
      ...(input.statGrid.length > 0
        ? [{ type: "stat_grid" as const, items: input.statGrid }]
        : []),
      {
        type: "source_note",
        text: "Drafted with AI assistance from WORLDCUP Nexus data; every number in this draft was checked against the database before saving. Pending editorial review before publishing.",
      },
    ],
    relations: input.relations,
    sources: [
      {
        label: `${AI_SOURCE_LABEL_PREFIX} — ${input.templateId}`,
        sourceType: "WORLDCUP_NEXUS_DB",
        notes: `${input.queryDescription} Title/summary/paragraph text drafted by ${MODEL_LABEL} from these exact figures; every numeric claim in the draft was validated against them before this candidate was saved.`,
      },
    ],
    templateId: input.templateId,
  };
}
