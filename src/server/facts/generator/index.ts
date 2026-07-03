// Entry point for the deterministic data-template fact generator. No AI, no
// randomness — every candidate is mechanically derived from a database
// query. See docs/DISCOVERY_VAULT.md and scripts/facts/generate-fact-candidates.ts
// (which writes these candidates to the database as NEEDS_REVIEW).

import {
  generateBiggestWinCandidates,
  generateFinalScoreCandidates,
  generateHighestScoringCandidates,
  generateHostWinnerCandidates,
  generatePenaltyShootoutCandidates,
  generateSquadSelectionCandidates,
  generateTopScorerCandidates,
  getAllMensMatches,
} from "./queries";
import type { FactTemplateId, GeneratedFactCandidate } from "./types";

export type { FactTemplateId, GeneratedFactCandidate } from "./types";

export type GenerateFactCandidatesResult = {
  candidates: GeneratedFactCandidate[];
  countsByTemplate: Record<FactTemplateId, number>;
};

function countByTemplate(candidates: GeneratedFactCandidate[]): Record<FactTemplateId, number> {
  const counts: Record<FactTemplateId, number> = {
    "top-scorers": 0,
    "squad-selections": 0,
    "biggest-wins": 0,
    "highest-scoring-matches": 0,
    "host-winners": 0,
    "penalty-shootouts": 0,
    "final-scores": 0,
  };
  for (const candidate of candidates) counts[candidate.templateId] += 1;
  return counts;
}

/** Runs every template and returns the combined candidate list. Read-only. */
export async function generateFactCandidates(): Promise<GenerateFactCandidatesResult> {
  const [topScorers, squadSelections, hostWinners, matches] = await Promise.all([
    generateTopScorerCandidates(),
    generateSquadSelectionCandidates(),
    generateHostWinnerCandidates(),
    getAllMensMatches(),
  ]);

  const candidates = [
    ...topScorers,
    ...squadSelections,
    ...generateBiggestWinCandidates(matches),
    ...generateHighestScoringCandidates(matches),
    ...hostWinners,
    ...generatePenaltyShootoutCandidates(matches),
    ...generateFinalScoreCandidates(matches),
  ];

  return { candidates, countsByTemplate: countByTemplate(candidates) };
}
