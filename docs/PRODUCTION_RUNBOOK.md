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
- [ ] Create the Meilisearch service (Meilisearch Cloud or self-hosted
      private instance; see
      [MEILISEARCH_PRODUCTION.md](MEILISEARCH_PRODUCTION.md)).
- [ ] Create a Meilisearch **admin/indexing key** (kept only in the
      admin environment).
- [ ] Create a Meilisearch **runtime search key** (scoped, search-only —
      this is what the app gets).
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
| `MEILISEARCH_HOST` | `https://…` production search endpoint |
| `MEILISEARCH_API_KEY` | the **runtime search key** (not the admin key) |
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

In the **admin environment**, export the same variables per command run,
except `MEILISEARCH_API_KEY` = the **admin/indexing key** when indexing.
Never write production values into a committed file.

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

From the admin environment, with `MEILISEARCH_API_KEY` set to the
**admin/indexing key**:

```bash
pnpm search:index
pnpm search:verify
```

The app itself keeps the scoped runtime search key — the admin key never
enters platform env vars or client code.

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
- `/api/search?q=maradona` → grouped results
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

Also confirm an API error path leaks nothing: temporarily querying
search while Meilisearch is unreachable must return a 503 with a generic
message — no hostnames, no stack traces.

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
- **Meilisearch errors**: 503s from `/api/search` mean the instance is
  unreachable; pages keep working but search UX degrades.
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
