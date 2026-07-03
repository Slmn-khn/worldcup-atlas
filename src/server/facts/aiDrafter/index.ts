// Entry point for the AI-assisted fact candidate writer.
//
// Unlike the deterministic generator (../generator), this module drafts
// title/summary/paragraph TEXT with Claude — but only from structured,
// already-DB-verified input (see ./adapt.ts, which reuses the exact same
// query layer as the deterministic generator). Every numeric claim in the
// draft is then checked against that same input (see ./validate.ts) before
// the candidate is accepted. A draft that states a number not present in its
// input is treated as a generation failure and is never written to the
// database — there is no partial-trust path; see docs/DISCOVERY_VAULT.md.
//
// This module makes real network calls to the Anthropic API and must only
// ever be invoked from an offline script — see
// scripts/facts/draft-ai-fact-candidates.ts. Never import this module from a
// route handler, page, or anything else that serves public traffic.

import {
  biggestWinToAiDraftInput,
  finalScoreToAiDraftInput,
  highestScoringToAiDraftInput,
  hostWinnerToAiDraftInput,
  penaltyShootoutToAiDraftInput,
  squadSelectionsToAiDraftInput,
  topScorerToAiDraftInput,
} from "./adapt";
import { buildCandidateFromDraft } from "./build";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { AiDraftInput, AiDraftResult } from "./types";
import { validateDraftNumbers } from "./validate";

export type { AiDraftInput, AiDraftResult } from "./types";

/** Fetches the same structured, DB-verified input the deterministic
 * generator uses, for every template, reshaped as AiDraftInput objects ready
 * to hand to Claude. Read-only — no Fact rows are written here. */
export async function generateAiDraftInputs(): Promise<AiDraftInput[]> {
  const queries = await import("@/server/facts/generator/queries");
  const rank = await import("@/server/facts/generator/rank");

  const [topScorers, squadSelections, hostWinners, matches] = await Promise.all([
    queries.fetchTopScorerInputs(),
    queries.fetchSquadSelectionInputs(),
    queries.fetchHostWinnerInputs(),
    queries.getAllMensMatches(),
  ]);

  const biggestWins = rank.rankBiggestWins(matches, queries.BIGGEST_WINS_LIMIT);
  const highestScoring = rank.rankHighestScoringMatches(matches, queries.HIGHEST_SCORING_LIMIT);
  const penaltyShootouts = rank.rankPenaltyShootouts(matches, queries.PENALTY_SHOOTOUT_LIMIT);
  const finals = rank.selectFinalMatches(matches);

  return [
    ...topScorers.map(topScorerToAiDraftInput),
    ...squadSelections.map(squadSelectionsToAiDraftInput),
    ...hostWinners.map(hostWinnerToAiDraftInput),
    ...biggestWins.flatMap((match, index) => {
      const input = biggestWinToAiDraftInput(match, index + 1);
      return input ? [input] : [];
    }),
    ...highestScoring.map((match, index) => highestScoringToAiDraftInput(match, index + 1)),
    ...penaltyShootouts.flatMap((match) => {
      const input = penaltyShootoutToAiDraftInput(match);
      return input ? [input] : [];
    }),
    ...finals.flatMap((match) => {
      const input = finalScoreToAiDraftInput(match);
      return input ? [input] : [];
    }),
  ];
}

/**
 * Drafts and validates one candidate. Never throws — both AI/network
 * failures and numeric-validation failures are reported as result statuses
 * so the CLI can keep going and print a clean summary at the end instead of
 * aborting on the first bad draft.
 */
export async function draftAiFactCandidate(input: AiDraftInput): Promise<AiDraftResult> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);

  let draft;
  try {
    const { draftFactText } = await import("./client");
    draft = await draftFactText(systemPrompt, userPrompt);
  } catch (error) {
    return {
      status: "ai_error",
      slug: input.slug,
      templateId: input.templateId,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const validation = validateDraftNumbers(draft, input.facts);
  if (!validation.valid) {
    return {
      status: "validation_failed",
      slug: input.slug,
      templateId: input.templateId,
      draft,
      invalidNumbers: validation.invalidNumbers,
    };
  }

  return {
    status: "drafted",
    slug: input.slug,
    templateId: input.templateId,
    candidate: buildCandidateFromDraft(input, draft),
  };
}

/** Drafts every candidate sequentially (one Anthropic API call at a time,
 * to keep this predictable and easy to log) and returns every result,
 * success or failure — the caller decides what to do with each. */
export async function draftAiFactCandidates(): Promise<{ results: AiDraftResult[] }> {
  const inputs = await generateAiDraftInputs();
  const results: AiDraftResult[] = [];
  for (const input of inputs) {
    results.push(await draftAiFactCandidate(input));
  }
  return { results };
}
