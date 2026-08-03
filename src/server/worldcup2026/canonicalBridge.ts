// Bridge from the imported 2026 archive (WorldCup2026* tables, Mominul-only
// import) onto the CANONICAL read-model shapes the rest of the app renders:
// tournament cards, the homepage finals board, and archive-stat additions.
//
// PURE builders only — type-only imports, no database, no fs — so consumers
// (getTournamentCards, home queries, archive stats) fetch the 2026 overview
// themselves and pass it in, and unit tests stay hermetic. Every builder is
// derivation, not invention: champion, final score, counts all come from the
// imported match data.
//
// Double-counting guard: mergeWc2026TournamentCard refuses to add a synthetic
// 2026 card when the canonical Tournament table already has year 2026 (i.e.
// after a future promotion of 2026 into the canonical archive).

import {
  getFlagCodeForCountry,
  normalizeCountryKey,
} from "@/lib/media/flags";
import type { TournamentCardDto } from "@/server/queries/types";
import type { Wc2026MatchDto, Wc2026Overview } from "./queries";

/** Stable synthetic id for the bridged 2026 card (not a database id). */
export const WC2026_CARD_ID = "wc2026-archive";

const HOST_LABELS: Record<string, string> = {
  CAN: "Canada",
  MEX: "Mexico",
  USA: "USA",
};

export function wc2026HostLabel(hosts: readonly string[]): string {
  return hosts.map((code) => HOST_LABELS[code] ?? code).join(" · ");
}

function finalScoreLine(finalMatch: Wc2026MatchDto | null): string | null {
  if (
    finalMatch === null ||
    finalMatch.homeScore === null ||
    finalMatch.awayScore === null
  ) {
    return null;
  }
  const base = `${finalMatch.homeScore}–${finalMatch.awayScore}`;
  if (finalMatch.resultType === "Penalties") {
    return finalMatch.homePenaltyScore !== null &&
      finalMatch.awayPenaltyScore !== null
      ? `${base} (${finalMatch.homePenaltyScore}–${finalMatch.awayPenaltyScore} pens)`
      : `${base} (pens)`;
  }
  if (finalMatch.resultType === "AET") return `${base} AET`;
  return base;
}

/**
 * The imported 2026 tournament as a canonical-shaped card. Slugs are omitted
 * (2026 teams are not merged into canonical Country rows); flags resolve by
 * name/code. Null when the overview has no champion yet (import incomplete).
 */
export function buildWc2026TournamentCard(
  overview: Wc2026Overview,
): TournamentCardDto {
  return {
    id: WC2026_CARD_ID,
    year: 2026,
    name: "FIFA World Cup 2026",
    slug: "fifa-world-cup-2026",
    hostName: wc2026HostLabel(overview.hosts),
    teamsCount: overview.teamsCount,
    matchesCount: overview.matchesCount,
    goalsCount: overview.goalsCount,
    winner: overview.championName,
    winnerSlug: null,
    winnerCode: overview.championCode,
    runnerUp: overview.runnerUpName,
    runnerUpSlug: null,
    runnerUpCode: overview.runnerUpCode,
    finalScore: finalScoreLine(overview.finalMatch),
  };
}

/**
 * Inserts the bridged 2026 card into a year-descending canonical card list.
 * GUARD: if canonical cards already include year 2026 (promotion happened),
 * the synthetic card is dropped — never double-counted, never duplicated.
 */
export function mergeWc2026TournamentCard(
  canonicalCards: TournamentCardDto[],
  wc2026Card: TournamentCardDto | null,
): TournamentCardDto[] {
  if (wc2026Card === null) return canonicalCards;
  if (canonicalCards.some((card) => card.year === 2026)) return canonicalCards;
  return [wc2026Card, ...canonicalCards].sort((a, b) => b.year - a.year);
}

/** Homepage "Recent Finals" entry for the 2026 final. */
export type Wc2026FinalSummary = {
  id: string;
  /** Path suffix under /matches/ — routes to the 2026 match report page. */
  matchSlugPath: string;
  year: 2026;
  tournamentName: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  decidedByPenalties: boolean;
  venue: string | null;
};

export function buildWc2026FinalSummary(
  overview: Wc2026Overview,
): Wc2026FinalSummary | null {
  const final = overview.finalMatch;
  if (
    final === null ||
    final.homeTeamName === null ||
    final.awayTeamName === null
  ) {
    return null;
  }
  const score = finalScoreLine(final);
  if (score === null) return null;
  return {
    id: "wc2026-final",
    matchSlugPath: `2026/${final.sourceMatchId}`,
    year: 2026,
    tournamentName: "FIFA World Cup 2026",
    homeTeam: final.homeTeamName,
    awayTeam: final.awayTeamName,
    score,
    decidedByPenalties: final.resultType === "Penalties",
    venue: final.venueName,
  };
}

/**
 * Additions the imported 2026 archive contributes to the combined archive
 * stats when canonical 2026 is absent. Goals are summed from imported match
 * scores — never taken from player stats or invented.
 */
export type Wc2026StatAdditions = {
  tournaments: number;
  matches: number;
  goals: number;
  latestYear: number;
};

export function buildWc2026StatAdditions(
  overview: Wc2026Overview,
): Wc2026StatAdditions {
  return {
    tournaments: 1,
    matches: overview.matchesCount,
    goals: overview.goalsCount,
    latestYear: 2026,
  };
}

// ---------------------------------------------------------------------------
// Nations union
// ---------------------------------------------------------------------------

/**
 * Identity keys for one nation: a normalized-name key plus (when resolvable)
 * a flag-code key. Used ONLY to decide whether a 2026 participant already
 * exists in the canonical archive — never to merge distinct historical
 * nations (West Germany, East Germany, and Germany all stay separate rows;
 * any of their keys simply "claims" a 2026 Germany as already counted).
 */
export function nationIdentityKeys(
  name: string | null,
  code: string | null,
): string[] {
  const keys: string[] = [];
  if (name !== null && name.trim() !== "") {
    keys.push(`name:${normalizeCountryKey(name)}`);
  }
  if (code !== null && code.trim() !== "") {
    keys.push(`code:${code.trim().toUpperCase()}`);
  }
  const flag = getFlagCodeForCountry({ name, code, fifaCode: code });
  if (flag !== null) keys.push(`flag:${flag}`);
  return keys;
}

/**
 * How many 2026 participants are NEW nations relative to the canonical
 * archive (e.g. debutants like Jordan or Cape Verde). A team is "new" only
 * when none of its identity keys match any canonical nation's keys.
 */
export function countNewWc2026Nations(
  teams: { name: string; fifaCode: string | null }[],
  canonicalNations: { name: string | null; code: string | null }[],
): number {
  const canonicalKeys = new Set(
    canonicalNations.flatMap((nation) =>
      nationIdentityKeys(nation.name, nation.code),
    ),
  );
  return teams.filter(
    (team) =>
      !nationIdentityKeys(team.name, team.fifaCode).some((key) =>
        canonicalKeys.has(key),
      ),
  ).length;
}
