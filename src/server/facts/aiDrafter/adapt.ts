// Pure converters: the same raw, DB-verified input shapes the deterministic
// generator (../generator) consumes, reshaped into the flat facts+context
// form the AI is allowed to draft from (see ./types.ts AiDraftInput). No AI
// call and no Prisma import here — this module only shapes data that has
// already been fetched by ../generator/queries.ts.
//
// Each converter mirrors its deterministic counterpart in ../generator/format.ts
// (same slug, same category/difficulty/tags/relations/stat_grid), so an
// AI-drafted candidate always lands on the exact same Fact row the
// deterministic generator would have produced — one candidate per record in
// the review queue, not two competing drafts.

import { formatStage } from "@/lib/format";
import { formatFinalScore, formatScore } from "@/server/queries/helpers";
import {
  eraLabel,
  type HostWinnerInput,
  ordinal,
  pickMatchWinner,
  type SquadSelectionsInput,
  type TopScorerInput,
} from "@/server/facts/generator/format";
import type { MatchFactInput } from "@/server/facts/generator/types";
import type { AiDraftInput } from "./types";

const MENS_SCOPE_NOTE =
  "Scoped to men's World Cup tournaments only, so this number never silently mixes in the women's World Cup archive.";

// ---------------------------------------------------------------------------
// 1. Top scorers
// ---------------------------------------------------------------------------

export function topScorerToAiDraftInput(input: TopScorerInput): AiDraftInput {
  const { rank, player, goals } = input;
  const era = eraLabel(input.eraStartYear, input.eraEndYear);
  return {
    templateId: "top-scorers",
    slug: `auto-top-scorer-${player.slug}`,
    facts: [
      { label: "Player", value: player.name },
      { label: "Goals scored (men's World Cup, own goals excluded)", value: goals },
      { label: "Archive rank for most goals", value: rank },
      ...(era ? [{ label: "Career era (years active)", value: era }] : []),
    ],
    context: `${player.name} ranks #${rank} on the WORLDCUP Nexus men's World Cup all-time goalscorer list.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: input.eraStartYear,
    eraEndYear: input.eraEndYear,
    tags: [
      "auto-generated",
      "ai-drafted",
      "goals",
      "record",
      ...(player.countrySlug ? [player.countrySlug] : []),
    ],
    relations: [
      { entityType: "PLAYER", entitySlug: player.slug, entityLabel: player.name, relationType: "PRIMARY" },
      ...(player.countrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: player.countrySlug,
              entityLabel: player.countryName ?? undefined,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
    ],
    statGrid: [
      { label: "Goals", value: String(goals) },
      { label: "Archive rank", value: `#${rank}` },
      ...(era ? [{ label: "Era", value: era }] : []),
    ],
    queryDescription: `Goal.groupBy by playerId (isOwnGoal=false), ordered by count desc. Rank ${rank}. ${MENS_SCOPE_NOTE}`,
  };
}

// ---------------------------------------------------------------------------
// 2. Squad selections
// ---------------------------------------------------------------------------

export function squadSelectionsToAiDraftInput(input: SquadSelectionsInput): AiDraftInput {
  const { rank, player, selections } = input;
  const era = eraLabel(input.eraStartYear, input.eraEndYear);
  return {
    templateId: "squad-selections",
    slug: `auto-squad-selections-${player.slug}`,
    facts: [
      { label: "Player", value: player.name },
      { label: "Men's World Cup squad selections", value: selections },
      { label: "Archive rank for most squad selections", value: rank },
      ...(era ? [{ label: "Career era (years active)", value: era }] : []),
    ],
    context: `${player.name} ranks #${rank} on the WORLDCUP Nexus men's World Cup squad-selections list. This counts squad selections, not match appearances — appearance-level data is not imported, so never describe this as "appearances" or "caps".`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: input.eraStartYear,
    eraEndYear: input.eraEndYear,
    tags: [
      "auto-generated",
      "ai-drafted",
      "squads",
      "record",
      ...(player.countrySlug ? [player.countrySlug] : []),
    ],
    relations: [
      { entityType: "PLAYER", entitySlug: player.slug, entityLabel: player.name, relationType: "PRIMARY" },
      ...(player.countrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: player.countrySlug,
              entityLabel: player.countryName ?? undefined,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
    ],
    statGrid: [
      { label: "Squad selections", value: String(selections) },
      { label: "Archive rank", value: `#${rank}` },
      ...(era ? [{ label: "Era", value: era }] : []),
    ],
    queryDescription: `SquadPlayer.groupBy by playerId, ordered by count desc. Rank ${rank}. ${MENS_SCOPE_NOTE}`,
  };
}

// ---------------------------------------------------------------------------
// 3. Host winners
// ---------------------------------------------------------------------------

export function hostWinnerToAiDraftInput(input: HostWinnerInput): AiDraftInput {
  const { year, hostName, winnerTeamName } = input;
  return {
    templateId: "host-winners",
    slug: `auto-host-winner-${year}`,
    facts: [
      { label: "Year", value: year },
      { label: "Host", value: hostName },
      { label: "Winning team", value: winnerTeamName },
    ],
    context: `${hostName} both hosted and won the ${year} men's World Cup.`,
    category: "HOST",
    difficulty: "FAN",
    eraStartYear: year,
    eraEndYear: year,
    tags: [
      "auto-generated",
      "ai-drafted",
      "host",
      ...(input.winnerCountrySlug ? [input.winnerCountrySlug] : []),
    ],
    relations: [
      {
        entityType: "TOURNAMENT",
        entitySlug: input.tournamentSlug,
        entityLabel: `${year} FIFA World Cup`,
        relationType: "PRIMARY",
      },
      ...(input.winnerCountrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: input.winnerCountrySlug,
              entityLabel: winnerTeamName,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
    ],
    statGrid: [],
    queryDescription: `Tournament.hostName compared against the winning team's name for tournament year ${year}.`,
  };
}

// ---------------------------------------------------------------------------
// 4. Biggest wins
// ---------------------------------------------------------------------------

export function biggestWinToAiDraftInput(match: MatchFactInput, rank: number): AiDraftInput | null {
  const outcome = pickMatchWinner(match);
  if (outcome === null) return null;
  const { winner, loser } = outcome;
  const margin = Math.abs(match.homeScore - match.awayScore);
  const stageLabel = formatStage(match.stage) ?? match.stage;
  const score =
    winner === match.home
      ? formatScore(match.homeScore, match.awayScore)
      : formatScore(match.awayScore, match.homeScore);

  return {
    templateId: "biggest-wins",
    slug: `auto-biggest-win-${match.slug}`,
    facts: [
      { label: "Year", value: match.year },
      { label: "Winning team", value: winner.name },
      { label: "Losing team", value: loser.name },
      { label: "Final score", value: score },
      { label: "Winning margin (goals)", value: margin },
      { label: "Stage", value: stageLabel },
      { label: "Archive rank for biggest win margin", value: rank },
    ],
    context: `${winner.name} beat ${loser.name} by the ${ordinal(rank)}-largest margin in the WORLDCUP Nexus men's World Cup archive.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: match.year,
    eraEndYear: match.year,
    tags: ["auto-generated", "ai-drafted", "biggest-win", "record"],
    relations: [
      {
        entityType: "MATCH",
        entitySlug: match.slug,
        entityLabel: `${winner.name} ${score} ${loser.name}`,
        relationType: "PRIMARY",
      },
      {
        entityType: "TOURNAMENT",
        entitySlug: match.tournamentSlug,
        entityLabel: `${match.year} FIFA World Cup`,
        relationType: "MENTIONED",
      },
      ...(winner.countrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: winner.countrySlug,
              entityLabel: winner.countryName ?? undefined,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
      ...(loser.countrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: loser.countrySlug,
              entityLabel: loser.countryName ?? undefined,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
    ],
    statGrid: [
      { label: "Margin", value: `${margin} goals` },
      { label: "Stage", value: stageLabel },
      { label: "Archive rank", value: `#${rank}` },
    ],
    queryDescription: `Match goal-difference margin computed in-memory across all matches, ordered desc. Rank ${rank}. ${MENS_SCOPE_NOTE}`,
  };
}

// ---------------------------------------------------------------------------
// 5. Highest scoring matches
// ---------------------------------------------------------------------------

export function highestScoringToAiDraftInput(match: MatchFactInput, rank: number): AiDraftInput {
  const total = match.homeScore + match.awayScore;
  const stageLabel = formatStage(match.stage) ?? match.stage;
  const score = formatScore(match.homeScore, match.awayScore);

  return {
    templateId: "highest-scoring-matches",
    slug: `auto-highest-scoring-${match.slug}`,
    facts: [
      { label: "Year", value: match.year },
      { label: "Home team", value: match.home.name },
      { label: "Away team", value: match.away.name },
      { label: "Final score", value: score },
      { label: "Total goals", value: total },
      { label: "Stage", value: stageLabel },
      { label: "Archive rank for total goals in a match", value: rank },
    ],
    context: `${match.home.name} and ${match.away.name} produced the ${ordinal(rank)}-highest-scoring match in the WORLDCUP Nexus men's World Cup archive.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: match.year,
    eraEndYear: match.year,
    tags: ["auto-generated", "ai-drafted", "highest-scoring", "record"],
    relations: [
      {
        entityType: "MATCH",
        entitySlug: match.slug,
        entityLabel: `${match.home.name} ${score} ${match.away.name}`,
        relationType: "PRIMARY",
      },
      {
        entityType: "TOURNAMENT",
        entitySlug: match.tournamentSlug,
        entityLabel: `${match.year} FIFA World Cup`,
        relationType: "MENTIONED",
      },
    ],
    statGrid: [
      { label: "Total goals", value: String(total) },
      { label: "Stage", value: stageLabel },
      { label: "Archive rank", value: `#${rank}` },
    ],
    queryDescription: `Match total-goals sum computed in-memory across all matches, ordered desc. Rank ${rank}. ${MENS_SCOPE_NOTE}`,
  };
}

// ---------------------------------------------------------------------------
// 6. Penalty shootouts
// ---------------------------------------------------------------------------

export function penaltyShootoutToAiDraftInput(match: MatchFactInput): AiDraftInput | null {
  const outcome = pickMatchWinner(match);
  if (outcome === null) return null;
  const { winner, loser } = outcome;
  const stageLabel = formatStage(match.stage) ?? match.stage;
  const score = formatFinalScore({
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeScorePenalties: match.homeScorePenalties,
    awayScorePenalties: match.awayScorePenalties,
    decidedByPenalties: match.decidedByPenalties,
  });

  return {
    templateId: "penalty-shootouts",
    slug: `auto-penalty-shootout-${match.slug}`,
    facts: [
      { label: "Year", value: match.year },
      { label: "Stage", value: stageLabel },
      { label: "Winning team", value: winner.name },
      { label: "Losing team", value: loser.name },
      { label: "Final score (including penalties)", value: score },
    ],
    context: `${winner.name} beat ${loser.name} on penalties in the ${match.year} men's World Cup ${stageLabel}.`,
    category: "PENALTY",
    difficulty: "FAN",
    eraStartYear: match.year,
    eraEndYear: match.year,
    tags: ["auto-generated", "ai-drafted", "penalties"],
    relations: [
      {
        entityType: "MATCH",
        entitySlug: match.slug,
        entityLabel: `${winner.name} ${score} ${loser.name}`,
        relationType: "PRIMARY",
      },
      {
        entityType: "TOURNAMENT",
        entitySlug: match.tournamentSlug,
        entityLabel: `${match.year} FIFA World Cup`,
        relationType: "MENTIONED",
      },
    ],
    statGrid: [],
    queryDescription: "Match.decidedByPenalties = true, filtered to notable knockout stages.",
  };
}

// ---------------------------------------------------------------------------
// 7. Final score facts
// ---------------------------------------------------------------------------

export function finalScoreToAiDraftInput(match: MatchFactInput): AiDraftInput | null {
  const outcome = pickMatchWinner(match);
  if (outcome === null) return null;
  const { winner, loser } = outcome;
  const regulationScore = formatScore(match.homeScore, match.awayScore);
  const score = formatFinalScore({
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeScorePenalties: match.homeScorePenalties,
    awayScorePenalties: match.awayScorePenalties,
    decidedByPenalties: match.decidedByPenalties,
  });

  return {
    templateId: "final-scores",
    slug: `auto-final-score-${match.year}`,
    facts: [
      { label: "Year", value: match.year },
      { label: "Home team", value: match.home.name },
      { label: "Away team", value: match.away.name },
      { label: "Regulation-time score", value: regulationScore },
      { label: "Final score (including penalties, if any)", value: score },
    ],
    context: `${winner.name} won the ${match.year} men's World Cup final against ${loser.name}.`,
    category: "FINAL",
    difficulty: "CASUAL",
    eraStartYear: match.year,
    eraEndYear: match.year,
    tags: ["auto-generated", "ai-drafted", "final"],
    relations: [
      {
        entityType: "MATCH",
        entitySlug: match.slug,
        entityLabel: `${winner.name} ${score} ${loser.name}`,
        relationType: "PRIMARY",
      },
      {
        entityType: "TOURNAMENT",
        entitySlug: match.tournamentSlug,
        entityLabel: `${match.year} FIFA World Cup`,
        relationType: "PRIMARY",
      },
      ...(winner.countrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: winner.countrySlug,
              entityLabel: winner.countryName ?? undefined,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
      ...(loser.countrySlug
        ? [
            {
              entityType: "COUNTRY" as const,
              entitySlug: loser.countrySlug,
              entityLabel: loser.countryName ?? undefined,
              relationType: "MENTIONED" as const,
            },
          ]
        : []),
    ],
    statGrid: [],
    queryDescription: `Match.stage = "final" for tournament year ${match.year}.`,
  };
}
