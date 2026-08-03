// Archive coverage — the single source of truth for "what span does the
// archive cover" in STATIC copy (meta descriptions, about/sources prose).
// Numeric stats (tournament/match/goal counts, the span shown in the homepage
// stat band) are still COMPUTED from the database — see
// src/server/archive/stats.ts — never from this constant. Update endYear only
// when a completed tournament's data is actually integrated.

export const ARCHIVE_COVERAGE = {
  startYear: 1930,
  endYear: 2026,
  label: "1930–2026",
  latestCompletedTournamentYear: 2026,
  includes2026: true,
  /** Live fixture mode stays off — 2026 is completed archive data. */
  liveModeEnabled: false,
} as const;
