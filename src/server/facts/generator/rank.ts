// Pure ranking/selection over an already-fetched match list — no Prisma
// import, so this is unit testable on its own. Ties always break by match
// slug ascending so re-running the generator against unchanged data produces
// the exact same order.

import { FINAL_STAGE } from "@/server/queries/helpers";
import { rankStageImportance } from "./format";
import type { MatchFactInput } from "./types";

export function rankBiggestWins(matches: MatchFactInput[], limit: number): MatchFactInput[] {
  return [...matches]
    .sort((a, b) => {
      const marginA = Math.abs(a.homeScore - a.awayScore);
      const marginB = Math.abs(b.homeScore - b.awayScore);
      return marginB - marginA || a.slug.localeCompare(b.slug);
    })
    .slice(0, limit);
}

export function rankHighestScoringMatches(
  matches: MatchFactInput[],
  limit: number,
): MatchFactInput[] {
  return [...matches]
    .sort((a, b) => {
      const totalA = a.homeScore + a.awayScore;
      const totalB = b.homeScore + b.awayScore;
      return totalB - totalA || a.slug.localeCompare(b.slug);
    })
    .slice(0, limit);
}

/**
 * Penalty shootouts, most narratively important stage first (final > semi >
 * third-place > quarter > round of 16 > earlier), most recent first within a
 * stage. Capped at `limit` so the review queue doesn't get flooded — a World
 * Cup archive can easily have 40+ shootouts across every knockout round.
 */
export function rankPenaltyShootouts(
  matches: MatchFactInput[],
  limit: number,
): MatchFactInput[] {
  return matches
    .filter((match) => match.decidedByPenalties)
    .sort((a, b) => {
      const importance = rankStageImportance(b.stage) - rankStageImportance(a.stage);
      if (importance !== 0) return importance;
      if (b.year !== a.year) return b.year - a.year;
      return a.slug.localeCompare(b.slug);
    })
    .slice(0, limit);
}

/** Every tournament's final match, oldest first — one candidate per tournament. */
export function selectFinalMatches(matches: MatchFactInput[]): MatchFactInput[] {
  return matches
    .filter((match) => match.stage.trim().toLowerCase() === FINAL_STAGE)
    .sort((a, b) => a.year - b.year || a.slug.localeCompare(b.slug));
}
