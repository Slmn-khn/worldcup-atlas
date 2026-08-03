# Feature: 2026 World Cup Schedule & Scores

The "Latest Matches / 2026 Schedule & Scores" feature adds a live-ish,
database-backed view of the 2026 FIFA World Cup: the homepage shows latest /
live / today / recent / upcoming fixtures, and `/schedule/2026` shows the full
fixture list grouped by date.

> WORLDCUP Nexus is an independent historical archive and is **not affiliated
> with FIFA**. No official FIFA logos or branding are used.

## Status: post-tournament archive mode (current default)

The 2026 tournament is complete (final played 2026-07-19). Live mode is
**switched off by configuration, not by code removal** — the fixture models,
providers, sync orchestration, and homepage section all remain in the repo and
can be re-enabled for a future tournament.

Feature flags (`src/config/features.ts`, server-only — never `NEXT_PUBLIC_*`):

| Flag | Default | Effect when default |
| --- | --- | --- |
| `FEATURE_LATEST_MATCHES_SECTION` | unset → **off** | Homepage renders a static "2026 Tournament Archive" CTA (`TournamentArchiveCtaSection`) instead of the live Latest Matches band; the home view model skips the fixture queries. |
| `FEATURE_2026_FIXTURE_SYNC` | unset → **off** | Cron/manual sync route answers `200 { ok: true, disabled: true }` and does **no** work (no provider fetch, no `FixtureSyncLog` write). `pnpm fixtures:sync` prints a notice and exits 0. |
| `FEATURE_2026_ARCHIVE_MODE` | unset → **on** | `/schedule/2026` uses archive wording ("Archived 2026 fixture data") and drops the stale-data warning — the data is final. Set to `"false"` to restore live wording. |

What still works in archive mode:

- `/schedule/2026` is now the **2026 Match Schedule & Results** archive page.
  It renders the file-backed verified archive schedule
  (`src/server/worldcup2026/archiveSchedule.ts` — reference pack + approved
  finalized artifacts), **not** the `Fixture` table; unresolved results show
  as "Under review", never "Scheduled". Regenerate its display artifact with
  `pnpm data:2026:display-schedule`.
- The read APIs (`/api/fixtures/2026`, `/latest`, `/today`, `/upcoming`)
  keep serving archived DB data — they never called providers.
- The Vercel cron entry was removed from `vercel.json` (the route is kept and
  is harmless if something still calls it).

### Re-enabling live mode (future tournament)

1. Set in the hosting platform env (e.g. Vercel):
   `FEATURE_LATEST_MATCHES_SECTION="true"`, `FEATURE_2026_FIXTURE_SYNC="true"`,
   plus the provider vars (`OPENFOOTBALL_2026_URL`,
   `FIXTURE_SYNC_PROVIDER_MODE`, optionally `WORLDCUP26_API_BASE_URL`) and a
   strong `CRON_SECRET`.
2. Restore the cron entry in `vercel.json`:

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "crons": [
       { "path": "/api/cron/sync-2026-fixtures", "schedule": "0,30 * * * *" }
     ]
   }
   ```

3. Redeploy. For a one-off manual sync without flipping the env flag:
   `pnpm fixtures:sync -- --force` (or
   `FEATURE_2026_FIXTURE_SYNC=true pnpm fixtures:sync`).

Everything below documents the live-mode behaviour as built.

## Why the data is stored in the database before rendering

External fixture data is **never** fetched from the browser, and **never**
fetched inside a React render. The flow is strictly:

```
external provider
  → server-side fetch (timeout + Zod validation)
  → normalize to a shared internal shape
  → upsert into PostgreSQL (one row per [source, sourceId])
  → render from the database
  → refresh via a protected cron / manual sync route
```

This keeps the UI fast and resilient (a provider outage never breaks a page
render), keeps provider URLs/secrets server-side, lets us validate and attribute
every value, and gives us an audit trail (`FixtureSyncLog`, `rawPayload`).

## Providers

| Provider | Role | Key | Priority | Trust |
| --- | --- | --- | --- | --- |
| **OpenFootball** `worldcup.json` | Stable baseline: schedule, venues, groups, basic results. **This is all production needs.** | none | 50 | Stable open data, not guaranteed live |
| **worldcup26.ir** API | Optional live/current scores. Disabled by default; only enabled after endpoint verification | none | 10 | Non-authoritative community source; must fail gracefully |
| Official FIFA fixtures page | Manual verification reference only | — | — | Not scraped |

Lower `sourcePriority` wins when both providers describe the same logical match
(see canonical selection below). The official FIFA page is a **human**
verification reference only — it is never scraped by this code.

### worldcup26 endpoint

When enabled, the games endpoint is built from `WORLDCUP26_API_BASE_URL` by
appending `/get/games` (trailing slashes on the base are normalized):

```
WORLDCUP26_API_BASE_URL="https://worldcup26.ir"  →  https://worldcup26.ir/get/games
```

Set the base URL to the **host only** — never include `/api`, `/matches`, or the
`/get/games` path yourself. The URL is built by `buildWorldcup26GamesUrl()`.

### Provider modes (`FIXTURE_SYNC_PROVIDER_MODE`)

| Mode | Behaviour |
| --- | --- |
| `openfootball-only` | **Default.** Only OpenFootball runs. worldcup26 is never called. |
| `openfootball-first` | OpenFootball, then worldcup26 if configured. A worldcup26 failure is a non-fatal warning — the baseline is kept. |
| `live-first` | worldcup26 first if configured, with OpenFootball as the always-present baseline fallback. |
| `worldcup26-only` | worldcup26 only — **debugging only.** |

A missing or invalid `FIXTURE_SYNC_PROVIDER_MODE` falls back to
`openfootball-only` (`parseFixtureProviderMode()`), so the pipeline is always
deployment-safe. When a mode would include worldcup26 but
`WORLDCUP26_API_BASE_URL` is unset, that provider is **skipped** (not failed).

## Source priority & canonical selection

Each provider row is stored separately (`Fixture.source` + `Fixture.sourceId`).
The canonical view per logical match is computed at **read time** in
`src/server/fixtures/normalize.ts` (`selectCanonicalFixtures`):

- Rows are grouped by a logical-match key (kick-off date + team slugs +
  stage/group).
- The primary row is the lowest `sourcePriority` (live provider wins), tie-broken
  toward rows that already have a score, then most-recently synced.
- Null display fields on the primary are backfilled from the other rows, so the
  live provider's scores combine with the baseline provider's venue/group data.

**Limitation:** matching is heuristic. If two providers name the same teams
differently, the rows may not merge and a duplicate can appear. That is a
visible duplicate, never corrupted data. This is intentionally simple for the
first implementation.

## Sync frequency

Configured in `vercel.json` (`/api/cron/sync-2026-fixtures`). **The cron entry
is currently removed** (post-tournament archive mode) — restore it as shown in
the status section above when live mode returns.

- **During the tournament:** every 15–30 minutes is reasonable (default:
  `0,30 * * * *`, i.e. every 30 min).
- **Outside live windows:** daily is plenty.
- **OpenFootball-only mode:** does not need frequent syncs — the baseline rarely
  changes between match windows.

Pick a cadence that respects the free/open providers; do not hammer them.

## How to sync locally

1. Copy env: `cp .env.example .env` and keep the fixture defaults.
2. Start the database: `docker compose up -d` then `pnpm db:migrate`.
3. Run a sync: `pnpm fixtures:sync`.

The script prints the resolved mode and a per-provider summary, and exits
non-zero **only if every provider that actually ran failed** (so an
OpenFootball-only run is a pass, and an OpenFootball success with a worldcup26
warning is still a pass). Lines read `[OK]`, `[WARN]` (optional provider
unavailable — falling back to the baseline), `[SKIP]` (disabled by mode or not
configured), or `[FAIL]` (the baseline failed).

With the default `openfootball-only` mode:

```
Mode: openfootball-only
Providers: 1/1 succeeded
Records fetched:  104
Records upserted: 104

  [OK]   openfootball — 104 upserted
  [SKIP] worldcup26 — disabled by FIXTURE_SYNC_PROVIDER_MODE=openfootball-only
```

With `openfootball-first` and worldcup26 unreachable:

```
Mode: openfootball-first
Providers: 1/2 succeeded
Records fetched:  104
Records upserted: 104

  [OK]   openfootball — 104 upserted
  [WARN] worldcup26 unavailable — falling back to OpenFootball baseline.
```

## Manual / cron sync route

`GET|POST /api/cron/sync-2026-fixtures`

- Protected by `CRON_SECRET` via `Authorization: Bearer <secret>` (Vercel Cron
  sets this automatically when `CRON_SECRET` is configured) or `?secret=<secret>`.
- Missing/invalid secret → `401`. With no secret configured the route is
  disabled (fail closed).
- Returns a JSON summary. Provider errors are sanitized (URLs stripped) so no
  host/secret leaks. Safe to run repeatedly (upserts).
- Uses the same `FIXTURE_SYNC_PROVIDER_MODE` logic as the CLI. In production
  (`openfootball-only`) the cron only syncs OpenFootball and never fails because
  worldcup26 is disabled.

## Read API (DB-backed, rate-limited)

- `GET /api/fixtures/2026` — `from`, `to`, `status`, `group`, `stage`, `q`,
  `limit`
- `GET /api/fixtures/2026/latest` — blended live / recent / upcoming
- `GET /api/fixtures/2026/today` — today's fixtures (`?tz=` IANA zone, default
  UTC)
- `GET /api/fixtures/2026/upcoming` — upcoming, kick-off ascending

All read endpoints query PostgreSQL only and never call a provider.

## Stale-data behaviour

`getFixtureFreshness2026()` reports "Last synced X ago". When the newest sync is
older than `STALE_AFTER_MINUTES` (180) the UI shows a quiet
"data may be stale" note (`FixtureFreshnessNote`). Data is never hidden — its age
is shown honestly.

## Time zones

OpenFootball kick-off times carry an explicit UTC offset (e.g. `13:00 UTC-6`),
so a true `kickoffAtUtc` instant is computed. When a source gives a date but no
offset, **no zone is assumed** — the labels are kept verbatim and the instant is
left null (those fixtures sort last). The displayed time is the source's own
local label, never silently re-zoned.

## Known limitations

- Heuristic canonical merge (see above).
- `worldcup26.ir` is optional and **disabled by default** (production runs
  `openfootball-only`). When enabled it calls `…/get/games`; its response shape
  is community-maintained and defensively normalized. A 404/500/network error
  logs a sanitized **warning** and the OpenFootball baseline still syncs — it is
  never a deployment blocker.
- `rawPayload` is stored for audit/re-normalization and is **never** rendered.

## Production deployment

Production does not require worldcup26. Recommended Vercel env:

```
OPENFOOTBALL_2026_URL="https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
FIXTURE_SYNC_PROVIDER_MODE="openfootball-only"
WORLDCUP26_API_BASE_URL=""
CRON_SECRET="<secure-secret>"
```
