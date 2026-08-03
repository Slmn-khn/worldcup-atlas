// Server-side feature flags for the post-tournament lifecycle. The 2026
// tournament is complete, so the live-style surfaces (homepage "Latest
// Matches" band, provider fixture sync) default OFF and the archive mode
// defaults ON — all reversible via environment variables, no code changes.
//
// These read process.env at call time and are server-only by design: never
// import them from client components and never mirror them as NEXT_PUBLIC_*
// (the values would be inlined into the browser bundle at build time).
// This module must stay import-free so the tsx scripts (no "@/" alias) and
// unit tests can load it via a relative path.

/**
 * Homepage "Latest Matches & Scores" band. OFF unless explicitly "true" —
 * missing/empty env means the archive CTA renders instead.
 */
export function isLatestMatchesSectionEnabled(): boolean {
  return process.env.FEATURE_LATEST_MATCHES_SECTION === "true";
}

/**
 * OpenFootball/worldcup26 provider sync (cron route + manual script). OFF
 * unless explicitly "true" — the disabled cron route acknowledges with
 * `{ ok: true, disabled: true }` and performs no fetches or writes.
 */
export function isFixtureSyncEnabled(): boolean {
  return process.env.FEATURE_2026_FIXTURE_SYNC === "true";
}

/**
 * Post-tournament archive presentation (archive wording instead of live/sync
 * language). ON unless explicitly set to "false".
 */
export function isPostTournamentArchiveMode(): boolean {
  return process.env.FEATURE_2026_ARCHIVE_MODE !== "false";
}
