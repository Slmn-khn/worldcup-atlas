// Pure, deterministic fact-candidate builders — one per data-template
// category. No Prisma import, no AI, no randomness: given the same plain
// input data, a builder always produces the same candidate. The DB-touching
// query layer (./queries.ts) fetches rows and hands them to these functions.
//
// "Most appearances" is deliberately generated as "most squad selections" —
// this archive only imports World Cup squad selections, never match-level
// lineups/appearances (see docs/DATA_MODEL.md and UI_STYLE_GUIDE.md), so a
// literal "most appearances" claim would be unsupported by our own data.
//
// Every template scopes to men's World Cup tournaments only (see
// queries.ts) so a generated fact never silently mixes men's and women's
// records under one number — the same rule the hand-written starter facts
// and the /records page already follow.

import { formatStage } from "@/lib/format";
import { FINAL_STAGE, formatFinalScore, formatScore } from "@/server/queries/helpers";
import type {
  GeneratedFactCandidate,
  GeneratedFactSourceInput,
  MatchFactInput,
} from "./types";

const GENERATOR_LABEL = "WORLDCUP Nexus data-template generator";
const MENS_SCOPE_NOTE =
  "Scoped to men's World Cup tournaments only, so this number never silently mixes in the women's World Cup archive.";

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function eraLabel(eraStartYear: number | null, eraEndYear: number | null): string | null {
  if (eraStartYear === null && eraEndYear === null) return null;
  if (eraStartYear !== null && eraEndYear !== null) {
    return eraStartYear === eraEndYear
      ? String(eraStartYear)
      : `${eraStartYear}–${eraEndYear}`;
  }
  return String(eraStartYear ?? eraEndYear);
}

function generatorSource(
  templateId: string,
  queryDescription: string,
): GeneratedFactSourceInput {
  return {
    label: `${GENERATOR_LABEL} — ${templateId}`,
    sourceType: "WORLDCUP_NEXUS_DB",
    notes: `${queryDescription} ${MENS_SCOPE_NOTE}`,
  };
}

/**
 * Which side won a decisive match (regulation score, or penalties if the
 * match was decided by a shootout). Returns null for a genuine unresolved
 * draw — the match-based templates only ever feed in decisive matches, so
 * this is a defensive fallback, not an expected path.
 */
export function pickMatchWinner(
  match: MatchFactInput,
): { winner: MatchFactInput["home"]; loser: MatchFactInput["home"] } | null {
  if (match.homeScore > match.awayScore) return { winner: match.home, loser: match.away };
  if (match.awayScore > match.homeScore) return { winner: match.away, loser: match.home };
  if (
    match.decidedByPenalties &&
    match.homeScorePenalties !== null &&
    match.awayScorePenalties !== null
  ) {
    return match.homeScorePenalties > match.awayScorePenalties
      ? { winner: match.home, loser: match.away }
      : { winner: match.away, loser: match.home };
  }
  return null;
}

/**
 * True when a tournament's host name and its winning team's name refer to
 * the same nation. Matched both directions and case-insensitively so a
 * co-host string ("Korea, Japan") still matches a single-nation winner name
 * that appears anywhere inside it.
 */
export function doesHostMatchWinner(hostName: string, winnerTeamName: string): boolean {
  const host = hostName.trim().toLowerCase();
  const winner = winnerTeamName.trim().toLowerCase();
  if (host === "" || winner === "") return false;
  return host.includes(winner) || winner.includes(host);
}

/** Narrative importance of a knockout stage, for capping shootout candidates. */
export function rankStageImportance(stage: string): number {
  const normalized = stage.trim().toLowerCase();
  if (normalized === FINAL_STAGE) return 5;
  if (normalized.startsWith("semi-final")) return 4;
  if (normalized === "third-place match") return 3;
  if (normalized.startsWith("quarter-final")) return 2;
  if (normalized === "round of 16") return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// 1. Top scorers
// ---------------------------------------------------------------------------

export type TopScorerInput = {
  rank: number;
  player: { slug: string; name: string; countrySlug: string | null; countryName: string | null };
  goals: number;
  eraStartYear: number | null;
  eraEndYear: number | null;
};

export function buildTopScorerCandidate(input: TopScorerInput): GeneratedFactCandidate {
  const { rank, player, goals } = input;
  const era = eraLabel(input.eraStartYear, input.eraEndYear);
  return {
    slug: `auto-top-scorer-${player.slug}`,
    title: `${player.name} — ${goals} Men's World Cup Goals`,
    summary: `${player.name} has scored ${goals} goals across the men's World Cup, the ${ordinal(rank)}-most in the WORLDCUP Nexus archive.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: input.eraStartYear,
    eraEndYear: input.eraEndYear,
    readTimeMinutes: 2,
    tags: ["auto-generated", "goals", "record", ...(player.countrySlug ? [player.countrySlug] : [])],
    contentBlocks: [
      { type: "heading", text: `${player.name}'s World Cup scoring record` },
      {
        type: "paragraph",
        text: `Across the imported men's World Cup matches, ${player.name} has scored ${goals} goals (own goals excluded), ranking #${rank} in the WORLDCUP Nexus goals archive.`,
      },
      {
        type: "stat_grid",
        items: [
          { label: "Goals", value: String(goals) },
          { label: "Archive rank", value: `#${rank}` },
          ...(era ? [{ label: "Era", value: era }] : []),
        ],
      },
      {
        type: "source_note",
        text: "Computed from the WORLDCUP Nexus goals archive. Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "PLAYER", entitySlug: player.slug, entityLabel: player.name, relationType: "PRIMARY" },
      ...(player.countrySlug
        ? [{ entityType: "COUNTRY" as const, entitySlug: player.countrySlug, entityLabel: player.countryName ?? undefined, relationType: "MENTIONED" as const }]
        : []),
    ],
    sources: [
      generatorSource(
        "top-scorers",
        `Goal.groupBy by playerId (isOwnGoal=false), ordered by count desc. Rank ${rank}.`,
      ),
    ],
    templateId: "top-scorers",
  };
}

// ---------------------------------------------------------------------------
// 2. Squad selections ("most appearances", honestly reframed)
// ---------------------------------------------------------------------------

export type SquadSelectionsInput = {
  rank: number;
  player: { slug: string; name: string; countrySlug: string | null; countryName: string | null };
  selections: number;
  eraStartYear: number | null;
  eraEndYear: number | null;
};

export function buildSquadSelectionsCandidate(
  input: SquadSelectionsInput,
): GeneratedFactCandidate {
  const { rank, player, selections } = input;
  const era = eraLabel(input.eraStartYear, input.eraEndYear);
  return {
    slug: `auto-squad-selections-${player.slug}`,
    title: `${player.name} — ${selections} Men's World Cup Squad Selections`,
    summary: `${player.name} has been selected to ${selections} men's World Cup squads, the ${ordinal(rank)}-most in the WORLDCUP Nexus archive.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: input.eraStartYear,
    eraEndYear: input.eraEndYear,
    readTimeMinutes: 2,
    tags: ["auto-generated", "squads", "record", ...(player.countrySlug ? [player.countrySlug] : [])],
    contentBlocks: [
      { type: "heading", text: `${player.name}'s World Cup squad selections` },
      {
        type: "paragraph",
        text: `${player.name} has been named to ${selections} men's World Cup squads in the WORLDCUP Nexus archive, ranking #${rank}. This counts squad selections, not match appearances — appearance-level data is not imported.`,
      },
      {
        type: "stat_grid",
        items: [
          { label: "Squad selections", value: String(selections) },
          { label: "Archive rank", value: `#${rank}` },
          ...(era ? [{ label: "Era", value: era }] : []),
        ],
      },
      {
        type: "source_note",
        text: "Computed from the WORLDCUP Nexus squad archive. Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "PLAYER", entitySlug: player.slug, entityLabel: player.name, relationType: "PRIMARY" },
      ...(player.countrySlug
        ? [{ entityType: "COUNTRY" as const, entitySlug: player.countrySlug, entityLabel: player.countryName ?? undefined, relationType: "MENTIONED" as const }]
        : []),
    ],
    sources: [
      generatorSource(
        "squad-selections",
        `SquadPlayer.groupBy by playerId, ordered by count desc. Rank ${rank}.`,
      ),
    ],
    templateId: "squad-selections",
  };
}

// ---------------------------------------------------------------------------
// 3. Biggest wins
// ---------------------------------------------------------------------------

export function buildBiggestWinCandidate(
  match: MatchFactInput,
  rank: number,
): GeneratedFactCandidate | null {
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
    slug: `auto-biggest-win-${match.slug}`,
    title: `${match.year}: ${winner.name} ${score} ${loser.name}`,
    summary: `${winner.name} beat ${loser.name} ${score} at the ${match.year} men's World Cup, a ${margin}-goal margin — the ${ordinal(rank)}-biggest win in the WORLDCUP Nexus archive.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: match.year,
    eraEndYear: match.year,
    readTimeMinutes: 2,
    tags: ["auto-generated", "biggest-win", "record"],
    contentBlocks: [
      { type: "heading", text: `${match.year} — ${winner.name} ${score} ${loser.name}` },
      {
        type: "paragraph",
        text: `${winner.name} beat ${loser.name} ${score} in the ${stageLabel} at the ${match.year} men's World Cup — a margin of ${margin} goals, ranking #${rank} for biggest win margin in the WORLDCUP Nexus archive.`,
      },
      {
        type: "stat_grid",
        items: [
          { label: "Margin", value: `${margin} goals` },
          { label: "Stage", value: stageLabel },
          { label: "Archive rank", value: `#${rank}` },
        ],
      },
      {
        type: "source_note",
        text: "Computed from the WORLDCUP Nexus match archive. Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "MATCH", entitySlug: match.slug, entityLabel: `${winner.name} ${score} ${loser.name}`, relationType: "PRIMARY" },
      { entityType: "TOURNAMENT", entitySlug: match.tournamentSlug, entityLabel: `${match.year} FIFA World Cup`, relationType: "MENTIONED" },
      ...(winner.countrySlug ? [{ entityType: "COUNTRY" as const, entitySlug: winner.countrySlug, entityLabel: winner.countryName ?? undefined, relationType: "MENTIONED" as const }] : []),
      ...(loser.countrySlug ? [{ entityType: "COUNTRY" as const, entitySlug: loser.countrySlug, entityLabel: loser.countryName ?? undefined, relationType: "MENTIONED" as const }] : []),
    ],
    sources: [
      generatorSource(
        "biggest-wins",
        `Match goal-difference margin computed in-memory across all matches, ordered desc. Rank ${rank}.`,
      ),
    ],
    templateId: "biggest-wins",
  };
}

// ---------------------------------------------------------------------------
// 4. Highest scoring matches
// ---------------------------------------------------------------------------

export function buildHighestScoringCandidate(
  match: MatchFactInput,
  rank: number,
): GeneratedFactCandidate {
  const total = match.homeScore + match.awayScore;
  const stageLabel = formatStage(match.stage) ?? match.stage;
  const score = formatScore(match.homeScore, match.awayScore);

  return {
    slug: `auto-highest-scoring-${match.slug}`,
    title: `${match.year}: ${match.home.name} ${score} ${match.away.name} — ${total} Goals`,
    summary: `${match.home.name} and ${match.away.name} combined for ${total} goals at the ${match.year} men's World Cup — the ${ordinal(rank)}-highest-scoring match in the WORLDCUP Nexus archive.`,
    category: "RECORD",
    difficulty: "FAN",
    eraStartYear: match.year,
    eraEndYear: match.year,
    readTimeMinutes: 2,
    tags: ["auto-generated", "highest-scoring", "record"],
    contentBlocks: [
      { type: "heading", text: `${match.year} — ${match.home.name} ${score} ${match.away.name}` },
      {
        type: "paragraph",
        text: `${match.home.name} and ${match.away.name} combined for ${total} goals in the ${stageLabel} at the ${match.year} men's World Cup, ranking #${rank} for total goals in a match in the WORLDCUP Nexus archive.`,
      },
      {
        type: "stat_grid",
        items: [
          { label: "Total goals", value: String(total) },
          { label: "Stage", value: stageLabel },
          { label: "Archive rank", value: `#${rank}` },
        ],
      },
      {
        type: "source_note",
        text: "Computed from the WORLDCUP Nexus match archive. Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "MATCH", entitySlug: match.slug, entityLabel: `${match.home.name} ${score} ${match.away.name}`, relationType: "PRIMARY" },
      { entityType: "TOURNAMENT", entitySlug: match.tournamentSlug, entityLabel: `${match.year} FIFA World Cup`, relationType: "MENTIONED" },
    ],
    sources: [
      generatorSource(
        "highest-scoring-matches",
        `Match total-goals sum computed in-memory across all matches, ordered desc. Rank ${rank}.`,
      ),
    ],
    templateId: "highest-scoring-matches",
  };
}

// ---------------------------------------------------------------------------
// 5. Host winners
// ---------------------------------------------------------------------------

export type HostWinnerInput = {
  year: number;
  tournamentSlug: string;
  hostName: string;
  winnerTeamName: string;
  winnerCountrySlug: string | null;
};

export function buildHostWinnerCandidate(input: HostWinnerInput): GeneratedFactCandidate {
  const { year, hostName, winnerTeamName } = input;
  return {
    slug: `auto-host-winner-${year}`,
    title: `${year}: ${hostName} Won on Home Soil`,
    summary: `${hostName} hosted and won the ${year} men's World Cup.`,
    category: "HOST",
    difficulty: "FAN",
    eraStartYear: year,
    eraEndYear: year,
    readTimeMinutes: 2,
    tags: ["auto-generated", "host", ...(input.winnerCountrySlug ? [input.winnerCountrySlug] : [])],
    contentBlocks: [
      { type: "heading", text: `${year} — hosts and champions` },
      {
        type: "paragraph",
        text: `${hostName} both hosted and won the ${year} men's World Cup, with the winning team recorded as "${winnerTeamName}" in the WORLDCUP Nexus archive.`,
      },
      {
        type: "source_note",
        text: "Computed by comparing each tournament's host and winning team. Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "TOURNAMENT", entitySlug: input.tournamentSlug, entityLabel: `${year} FIFA World Cup`, relationType: "PRIMARY" },
      ...(input.winnerCountrySlug
        ? [{ entityType: "COUNTRY" as const, entitySlug: input.winnerCountrySlug, entityLabel: winnerTeamName, relationType: "MENTIONED" as const }]
        : []),
    ],
    sources: [
      generatorSource(
        "host-winners",
        `Tournament.hostName compared against the winning team's name for tournament year ${year}.`,
      ),
    ],
    templateId: "host-winners",
  };
}

// ---------------------------------------------------------------------------
// 6. Penalty shootouts
// ---------------------------------------------------------------------------

export function buildPenaltyShootoutCandidate(
  match: MatchFactInput,
): GeneratedFactCandidate | null {
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
    slug: `auto-penalty-shootout-${match.slug}`,
    title: `${match.year} ${stageLabel}: ${winner.name} Beat ${loser.name} on Penalties`,
    summary: `${winner.name} beat ${loser.name} ${score} at the ${match.year} men's World Cup ${stageLabel}.`,
    category: "PENALTY",
    difficulty: "FAN",
    eraStartYear: match.year,
    eraEndYear: match.year,
    readTimeMinutes: 2,
    tags: ["auto-generated", "penalties"],
    contentBlocks: [
      { type: "heading", text: `${match.year} ${stageLabel} — decided on penalties` },
      {
        type: "paragraph",
        text: `${winner.name} beat ${loser.name} ${score} in the ${stageLabel} at the ${match.year} men's World Cup.`,
      },
      {
        type: "source_note",
        text: "Computed from the WORLDCUP Nexus match archive (Match.decidedByPenalties). Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "MATCH", entitySlug: match.slug, entityLabel: `${winner.name} ${score} ${loser.name}`, relationType: "PRIMARY" },
      { entityType: "TOURNAMENT", entitySlug: match.tournamentSlug, entityLabel: `${match.year} FIFA World Cup`, relationType: "MENTIONED" },
    ],
    sources: [
      generatorSource(
        "penalty-shootouts",
        `Match.decidedByPenalties = true, filtered to notable knockout stages.`,
      ),
    ],
    templateId: "penalty-shootouts",
  };
}

// ---------------------------------------------------------------------------
// 7. Final score facts
// ---------------------------------------------------------------------------

export function buildFinalScoreCandidate(match: MatchFactInput): GeneratedFactCandidate | null {
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
    slug: `auto-final-score-${match.year}`,
    title: `${match.year} World Cup Final: ${match.home.name} ${regulationScore} ${match.away.name}`,
    summary: `${winner.name} won the ${match.year} men's World Cup final ${score} against ${loser.name}.`,
    category: "FINAL",
    difficulty: "CASUAL",
    eraStartYear: match.year,
    eraEndYear: match.year,
    readTimeMinutes: 2,
    tags: ["auto-generated", "final"],
    contentBlocks: [
      { type: "heading", text: `${match.year} final — ${winner.name} champions` },
      {
        type: "paragraph",
        text: `${winner.name} beat ${loser.name} ${score} in the ${match.year} men's World Cup final.`,
      },
      {
        type: "source_note",
        text: "Computed from the WORLDCUP Nexus match archive (final stage). Pending editorial review before publishing.",
      },
    ],
    relations: [
      { entityType: "MATCH", entitySlug: match.slug, entityLabel: `${winner.name} ${score} ${loser.name}`, relationType: "PRIMARY" },
      { entityType: "TOURNAMENT", entitySlug: match.tournamentSlug, entityLabel: `${match.year} FIFA World Cup`, relationType: "PRIMARY" },
      ...(winner.countrySlug ? [{ entityType: "COUNTRY" as const, entitySlug: winner.countrySlug, entityLabel: winner.countryName ?? undefined, relationType: "MENTIONED" as const }] : []),
      ...(loser.countrySlug ? [{ entityType: "COUNTRY" as const, entitySlug: loser.countrySlug, entityLabel: loser.countryName ?? undefined, relationType: "MENTIONED" as const }] : []),
    ],
    sources: [
      generatorSource("final-scores", `Match.stage = "final" for tournament year ${match.year}.`),
    ],
    templateId: "final-scores",
  };
}
