# WORLDCUP Nexus — Production Launch Runbook

Step-by-step launch procedure (Checkpoint 8C). Every write operation
(migrations, import, indexing) runs from a **trusted admin
environment** — a maintainer machine or a private CI job — never through
the public app. Nothing in this runbook is automated; each step is
deliberate.

Before starting: `pnpm prod:preflight` and `pnpm prod:validate` must be
green locally, and `pnpm audit` clean.

## 1. Prepare services

- [ ] Create the hosted PostgreSQL database (Supabase or equivalent;
      see [DATABASE_PRODUCTION.md](DATABASE_PRODUCTION.md)).
- [ ] Note both connection strings if the provider offers a pooler:
      pooled (runtime) and direct (migrations/import).
- [ ] No search service is needed: search is Postgres-backed and runs on
      the same database (see [SEARCH_PRODUCTION.md](SEARCH_PRODUCTION.md)).
- [ ] Configure automated database backups; verify one restore works.
- [ ] Configure the production domain and confirm HTTPS.

## 2. Configure environment variables

Set in the hosting platform (see the table in
[DEPLOYMENT.md](DEPLOYMENT.md) §3; placeholders in
`.env.production.example`):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | pooled production connection string |
| `DIRECT_URL` | direct connection string (or same as `DATABASE_URL`) |
| `NEXT_PUBLIC_SITE_URL` | `https://your-production-domain.com` |
| `NODE_ENV` | `production` (platform usually sets this) |
| `FEATURE_LATEST_MATCHES_SECTION` | leave **unset** (post-tournament: homepage shows the archive CTA, not live Latest Matches) |
| `FEATURE_2026_FIXTURE_SYNC` | leave **unset** (post-tournament: provider sync disabled; cron route answers `{ ok, disabled }` and does no work) |
| `FEATURE_2026_ARCHIVE_MODE` | leave unset or `true` (archive wording on `/schedule/2026`) |

The 2026 tournament is complete: live fixture sync and the homepage
"Latest Matches & Scores" band are **off by default**, the `vercel.json`
cron entry is removed, and finalized 2026 data comes from the archive
import pipeline — not live provider sync. Provider code is retained; to
re-enable live mode for a future tournament, follow
[FEATURE_2026_SCHEDULE.md](FEATURE_2026_SCHEDULE.md) ("Re-enabling live
mode": set both flags to `true`, restore the cron entry, redeploy).

`/schedule/2026` renders the **imported 2026 archive** (`WorldCup2026*`
tables, Mominul-only import) when populated, else the file-backed archive
chain committed under `data/2026/` — never the live `Fixture` table.
Unresolved results display as "Under review", never "Scheduled".

**2026 Mominul import (production sequence).** Never run the write import
against production before it has been verified locally/staging. From the
admin environment:

1. Deploy migrations: `pnpm db:deploy` (adds the `WorldCup2026*` tables).
2. Dry-run against the production DB: `pnpm data:2026:mominul:import`
   (dry-run performs zero database access; it validates policy + pack).
3. If clean:
   `CONFIRM_2026_MOMINUL_IMPORT=true pnpm data:2026:mominul:import:write -- --confirm-production`
4. Re-run `pnpm search:index` (adds 2026 teams, matches, players, venues
   to the Postgres search index).
5. Smoke test `/schedule/2026`, `/tournaments/2026`, one
   `/matches/2026/<id>`, and `/sources`.

The import is idempotent (source-id upserts; re-running converges and is
also the recovery path after a failed partial run) and writes ONLY the
quarantined `WorldCup2026*` tables — never the canonical historical archive,
never `Fixture` rows. Each run records a `WorldCup2026ImportBatch` audit row.
Use Supabase's direct/session connection on port 5432 where possible; avoid the
transaction pooler on port 6543 for this import. The importer still uses small,
independent transaction chunks with explicit timeouts. Optional overrides are
`--chunk-size`, `--transaction-timeout-ms`, `MOMINUL_IMPORT_CHUNK_SIZE`, and
`MOMINUL_IMPORT_TRANSACTION_TIMEOUT_MS`; do not print the database URL.

**App-wide 2026 coverage.** With the import in place the app presents the
archive as **1930–2026**: homepage stats/timeline/featured/finals, the
/tournaments list, sitemap, and search all bridge in the imported 2026
archive (`src/server/worldcup2026/canonicalBridge.ts` +
`src/server/archive/stats.ts`). To refresh 2026 data: re-run the approved
pack + write import (above), then `pnpm search:index`. If 2026 is ever
promoted into the canonical `Tournament`/`Match` tables, no cleanup is
needed — every bridge point detects canonical year 2026 and drops the
synthetic additions, so nothing is double-counted; then retire the bridge at
leisure.

In the **admin environment**, export the same variables per command run.
Never write production values into a committed file.

## Dependency audit overrides (2026-08-03)

`pnpm audit --audit-level moderate` is clean (all/prod/dev). Fixes applied:

- **Direct update:** `next`/`@next/third-parties`/`eslint-config-next`
  `16.2.6 → 16.2.12` — clears nine Next advisories (4 high SSRF/cache
  poisoning, 5 moderate) patched in `>=16.2.11`.
- **Overrides** (in `package.json` → `pnpm.overrides`; note this repo pins
  **pnpm 8**, which does NOT read overrides from `pnpm-workspace.yaml` — an
  inert overrides block there was removed):
  | Override | Advisory | Reason |
  | --- | --- | --- |
  | `hono` → 4.12.27 | GHSA-xgm2/hvrm/w62v | via `@prisma/dev` (prisma CLI, dev-time) |
  | `@hono/node-server` → 2.0.10 | GHSA-9mqv-5hh9-4cgg | via `@prisma/dev` |
  | `postcss@<8.5.18` → >=8.5.18 | GHSA-r28c-9q8g-f849 | source-map path traversal, via next |
  | `sharp@<0.35.0` → >=0.35.1 | GHSA-f88m-g3jw-g9cj | next's bundled sharp |
  | `fast-uri@3` → 3.1.4 | GHSA-v2hh / GHSA-4c8g | via ajv in `@prisma/dev` chain |
  | `valibot@1` → 1.4.2 | GHSA-5qjj-4xww-7phc | via `@prisma/dev` |
  | `js-yaml@4` → 4.3.0 | GHSA-52cp-r559-cp3m | via eslint (dev) |
  | `brace-expansion@1` → 1.1.17, `@5` → 5.0.8 | GHSA-3jxr / GHSA-mh99 | ReDoS, via eslint toolchain (dev) |
  | `esbuild` → ^0.28.1 | (pre-existing) | retained |
  | `nanoid@<3.3.18` → >=3.3.18 (added 2026-08-31) | GHSA-2v37-7h3g-55p8 | infinite-loop edge case, via next's bundled postcss |
  | `deepmerge-ts@<8.0.0` → >=8.0.0 (added 2026-08-31) | GHSA-ggr8-5vv4-36mx | stack exhaustion, via `@prisma/config` (prisma CLI, dev-time; CLI verified working on v8) |

  Remove an override once its parent ships a patched resolution. Validated
  with: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm build`,
  `pnpm prod:preflight`, and all three `pnpm audit` variants.

## 3. Deploy database migrations

From the admin environment against the production database:

```bash
pnpm db:deploy        # prisma migrate deploy — applies committed migrations only
```

Never use `pnpm db:migrate` here — `prisma migrate dev` is strictly a
local development command (do not run it against production).

## 4. Import source data

From the admin environment (public APIs cannot trigger imports):

```bash
pnpm data:download            # fetch source CSVs (Fjelstul World Cup Database)
pnpm data:inspect             # optional sanity pass over CSV headers
pnpm data:import -- --reset   # full normalized import
pnpm data:verify              # integrity checks must pass
```

If this is a **re-import** on a live database, snapshot/backup first
(rollback path in §9).

## 5. Build the search index

From the admin environment, using the production `DATABASE_URL` (search
is Postgres-backed — no other credentials involved):

```bash
pnpm search:index
pnpm search:verify
```

This atomically rebuilds the `SearchDocument` table in the production
database. Re-run it after every data import.

## 6. Build and deploy the app

```bash
pnpm prod:validate    # full local gate: verify suites + typecheck + lint + build + e2e
```

Then deploy via the hosting platform (Vercel flow in
[VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)). Do not wire migrations,
imports, or indexing into the deploy pipeline — they remain manual
admin steps.

## 7. Smoke test

All of these must respond correctly on the production URL:

- `/`
- `/tournaments` and `/tournaments/1986`
- `/matches` and `/matches/m-1986-52-argentina-vs-west-germany`
- `/countries` and `/countries/argentina`
- `/players` and `/players/diego-maradona`
- `/records`
- `/explorer`
- `/sources` (CC-BY-SA attribution visible)
- `/about`
- `/privacy`
- `/sitemap.xml` and `/robots.txt`
- `/api/health` → `{ ok: true, database: "connected" }`
- `/api/search?q=maradona` → ranked results (`{ query, count, results }`)
- `/api/export/explorer?format=csv&eventType=Goal` → CSV attachment
  named `worldcup-nexus-explorer.csv`
- `/api/dev/data-summary` → **404** (proves `NODE_ENV=production`)
- A nonsense URL → 404 page

## 8. Header checks

`curl -I https://your-production-domain.com/` must show:

- `Content-Security-Policy-Report-Only` (the baseline CSP)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  — only expected once production HTTPS is confirmed (it is emitted when
  `NODE_ENV=production`)

Also confirm an API error path leaks nothing: querying search while the
database is unreachable must return a 503 with a generic message — no
hostnames, no stack traces.

## 9. Rollback

- **Bad deploy:** promote/redeploy the previous build on the platform
  (Vercel keeps prior deployments — instant rollback).
- **Bad import:** restore the pre-import database backup/snapshot, then
  rebuild the search index (`pnpm search:index`) so search matches the
  restored data, then `pnpm data:verify && pnpm search:verify`.
- **Bad index:** the index is always rebuildable from the database —
  re-run `pnpm search:index`. Where the setup allows, keep the previous
  index until the new one passes `pnpm search:verify`.
- **Bad migration:** Prisma migrations are forward-only; restore the DB
  backup and redeploy the previous app build that matches the old
  schema.

## 10. Post-launch monitoring

Watch for the first days after launch:

- **Error logs** (platform log drain): any recurring 5xx.
- **API 429 rate**: sustained 429s mean either abuse (good — the limiter
  works) or limits set too low for legitimate traffic.
- **Export usage** (`/api/export/explorer` volume): the most expensive
  route; sustained heavy use justifies platform-level rate limits.
- **DB connection count**: serverless platforms can multiply
  connections — see pooling notes in DATABASE_PRODUCTION.md.
- **Search errors**: 503s from `/api/search` mean the database is
  unreachable from the search path; pages keep working but search UX
  degrades. An empty results set for common queries usually means
  `pnpm search:index` was not re-run after an import.
- **CSP Report-Only violations** (browser consoles / reporting endpoint
  if configured later): after 1–2 clean weeks, plan the switch to an
  enforced CSP (hardening plan P2.1).

## 11. 2026 archive data steward (Phase 1 — local only)

The 2026 data steward pipeline (`docs/2026_DATA_STEWARD_AGENT.md`) is **not**
part of any deployment. It runs locally, needs no service credentials, and
never writes to the production database:

```bash
pnpm data:2026:collect      # fetch approved source snapshots (internet)
pnpm data:2026:candidates   # extract per-source candidates
pnpm data:2026:manual-pack  # inspect the human-authenticated reference pack (offline)
pnpm data:2026:full-check   # normalize + validate (offline, CI-safe)
pnpm data:2026:mominul:inspect  # read-only summary of the Mominul candidate provider
pnpm data:2026:bustami:inspect  # read-only summary of the Bustami EFI candidate provider
```

The manual reference pack (`data/2026/reference/manual-verified-v1/`) is
committed, human-curated data: it is read during normalize/validate, hashed
into the reports, and never fetched by the collector. Its
`manifest.importAllowed` must remain `false`; importing anything still
requires the human-written `data/2026/approved/approval.json` gate.

Operational notes:

- Do NOT wire the collect step into CI — collection depends on external
  endpoints and is allowed to partially fail (failures are recorded in the
  snapshot sidecars and the coverage report).
- `data/2026/raw/` and `data/2026/candidates/` are git-ignored working data;
  the normalized/validation/report outputs are small, curated, committable
  (except `data/2026/normalized/mominul/` and `data/2026/normalized/bustami/`
  — large, regenerable enrichment output, also git-ignored).
- Two **candidate enrichment providers** are registered
  (`mominul_2026_dataset`, `bustami_fifa_efi_2026`). Their output is
  candidate/normalized/report files only: nothing is imported, nothing is
  rendered publicly, and the manual verified reference pack remains
  authoritative. The Bustami EFI data additionally carries a standing
  legal/usage block (`RESEARCH_ONLY_UNTIL_LICENSE_REVIEW`) — do not use it
  outside internal research/analytics until a license review clears it.
- Importing 2026 archive data into production is a **future phase** and is
  gated on a human-written `data/2026/approved/approval.json` — see
  `data/2026/approved/README.md`. A report saying "NOT READY FOR IMPORT"
  blocks import.
