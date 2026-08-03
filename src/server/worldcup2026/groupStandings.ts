// Pure group-standings computation for the imported 2026 archive. No
// database, no imports — safe for tsx scripts and unit tests. Standings are
// always COMPUTED from the imported group-stage results, never hardcoded.

export type Wc2026StandingsMatchInput = {
  groupLetter: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

export type Wc2026GroupStandingRow = {
  teamName: string;
  teamCode: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

export type Wc2026Group = {
  letter: string;
  rows: Wc2026GroupStandingRow[];
};

/**
 * Final tables per group: 3 pts/win, 1/draw; ranked by points, then goal
 * difference, then goals for, then name. Matches without a group letter or a
 * final score are ignored (never guessed).
 */
export function computeGroupStandings(
  matches: Wc2026StandingsMatchInput[],
): Wc2026Group[] {
  const byLetter = new Map<string, Map<string, Wc2026GroupStandingRow>>();
  for (const match of matches) {
    if (match.groupLetter === null) continue;
    if (match.homeScore === null || match.awayScore === null) continue;
    if (match.homeTeamName === null || match.awayTeamName === null) continue;
    const group =
      byLetter.get(match.groupLetter) ??
      new Map<string, Wc2026GroupStandingRow>();
    byLetter.set(match.groupLetter, group);
    const rowFor = (name: string, code: string | null): Wc2026GroupStandingRow => {
      const existing = group.get(name);
      if (existing !== undefined) return existing;
      const created: Wc2026GroupStandingRow = {
        teamName: name,
        teamCode: code,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      };
      group.set(name, created);
      return created;
    };
    const home = rowFor(match.homeTeamName, match.homeTeamCode);
    const away = rowFor(match.awayTeamName, match.awayTeamCode);
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (match.awayScore > match.homeScore) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, rows]) => ({
      letter,
      rows: [...rows.values()].sort(
        (a, b) =>
          b.points - a.points ||
          b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
          b.goalsFor - a.goalsFor ||
          a.teamName.localeCompare(b.teamName),
      ),
    }));
}
