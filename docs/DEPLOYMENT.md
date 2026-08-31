# WORLDCUP Nexus — Deployment

Production deployment guide (Checkpoint 8C). Companion documents:

- [docs/PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) — step-by-step launch runbook
- [docs/VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) — Vercel-specific notes
- [docs/DATABASE_PRODUCTION.md](DATABASE_PRODUCTION.md) — PostgreSQL production notes
- [docs/SEARCH_PRODUCTION.md](SEARCH_PRODUCTION.md) — Postgres-backed search notes
- [docs/SECURITY_AUDIT.md](SECURITY_AUDIT.md) / [docs/SECURITY_HARDENING_PLAN.md](SECURITY_HARDENING_PLAN.md)

## 1. Overview

WORLDCUP Nexus deploys as a **read-only public web app**: the runtime
serves pages and search/export APIs only. All write operations —
migrations, data import, search indexing — run **out of band from a
trusted admin environment** (a maintainer machine or a CI job), never
through public APIs. There is no admin dashboard and there are no user
accounts in v1.

**Recommended v1 architecture** (recommended path, not a hard vendor
lock — any equivalent works):

| Concern | Recommended | Acceptable alternatives |
| --- | --- | --- |
| App hosting | Vercel | Any Node 20+ host that runs `next start` |
| Database | Supabase PostgreSQL | Neon, RDS, any hosted PostgreSQL 16+ |
| Search | Postgres full-text + `pg_trgm` (same database — free) | A dedicated engine (Meilisearch/Typesense) only if future scale demands |
| Import/indexing | Trusted local/admin machine | Private CI job with scoped secrets |

Internal identifiers kept from early development (allowed, cosmetic):
the package name `worldcup-atlas`, the local database name
`worldcup_atlas`, and local Docker container names. None of these are
user-facing.

## 2. Required services

1. **Hosted PostgreSQL** (16+ recommended, matching local Docker). This
   also serves search — the `SearchDocument` table lives in the same
   database (no separate search service).
2. **App hosting** with Node 20+, environment variable support, and
   HTTPS (Vercel recommended).
3. Optional: platform WAF / rate limiting in front of `/api/*`
   (reinforces the built-in per-instance limiter).

## 3. Required environment variables

Templates: `.env.example` (local), `.env.production.example`
(production placeholders — never commit real values).

| Variable | Required | Used by | Local example | Production guidance | Secret? |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Yes | App runtime, `db:deploy`, import/verify scripts | `postgresql://worldcup:worldcup@localhost:5432/worldcup_atlas` | Hosted PostgreSQL connection string; use the **pooled** endpoint if the provider offers one | **Secret, server-only** |
| `DIRECT_URL` | Optional | Reserved for pooled setups (migrations/import direct connection) | same as `DATABASE_URL` | Direct (non-pooled) endpoint; same as `DATABASE_URL` if no pooler. Note: current code reads only `DATABASE_URL` — see DATABASE_PRODUCTION.md | **Secret, server-only** |
| `NEXT_PUBLIC_SITE_URL` | Yes | Metadata, Open Graph, sitemap, robots | `http://localhost:3000` | The canonical production URL (`https://…`); set **before building** | Public (inlined into the client bundle by design) |
| `NODE_ENV` | Yes (platform-set) | Error detail gating, HSTS, dev endpoint gate, Prisma logging | `development` | Must be `production` (Vercel sets it automatically) | Public |

Rules:

- `DATABASE_URL` is **server-only** — it is read exclusively in server
  modules and must never appear in `NEXT_PUBLIC_*` variables or client
  code.
- Search is Postgres-backed: no `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY`
  (or any search-service variables) are required anymore.
- Never commit real values; set them in the platform's env settings.

## 4. Production database setup

See [DATABASE_PRODUCTION.md](DATABASE_PRODUCTION.md). Summary: create a
hosted PostgreSQL database with strong unique credentials, restrict
network access to the app platform and the admin environment, enable
automated backups, and (recommended) split roles: a write-capable
migration/import role and a read-only runtime role.

## 5. Production search setup

See [SEARCH_PRODUCTION.md](SEARCH_PRODUCTION.md). Summary: search runs
on the production PostgreSQL database (full-text `tsvector` + `pg_trgm`
fuzzy matching over the `SearchDocument` table). Deploy migrations with
`pnpm db:deploy`, then build the index with `pnpm search:index` from the
admin environment. No extra service, keys, or env vars.

## 6. Production migration workflow

From the admin environment, with production `DATABASE_URL` exported for
the command only:

```bash
pnpm db:deploy        # prisma migrate deploy
```

- `prisma migrate deploy` applies committed migrations exactly — it never
  generates new ones, never resets, and is the **only** migration command
  for production/staging.
- `pnpm db:migrate` (`prisma migrate dev`) is **local development only**;
  never run it against a production database.
- Migrations are deliberate, manual steps — nothing applies them
  automatically on boot or deploy.

## 7. Production data import workflow

From the admin environment (never via public API — no API route can
trigger imports, verified by `pnpm prod:preflight`):

```bash
pnpm data:download            # fetch + cache source CSVs (Fjelstul World Cup Database)
pnpm data:inspect             # optional: verify CSV headers/shape
pnpm data:import -- --reset   # normalize into PostgreSQL (full reseed)
pnpm data:verify              # integrity checks against the imported data
```

`--reset` clears and reimports — on production this is the supported
path (the dataset is historical and changes only when re-imported).
Take a DB backup/snapshot before a production re-import.

## 8. Search indexing workflow

From the admin environment, using the production `DATABASE_URL` (search
is Postgres-backed — no other credentials involved):

```bash
pnpm search:index             # atomically rebuild the SearchDocument table
pnpm search:verify            # common-query checks through the app's service
```

Re-run after **every** data import — the index is a snapshot of the
database. Index documents are built only from normalized tables;
RawSourceRecord is never indexed.

## 9. Vercel deployment workflow

See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). Summary: connect the
repo, framework Next.js, install `pnpm install --frozen-lockfile`, build
`pnpm build` (run `pnpm db:generate` first — the Prisma client in
`src/generated/` is git-ignored), set the env vars from section 3, and
note the build needs database connectivity (the sitemap is generated at
build time with daily revalidation).

### 9b. Brand assets

Brand artwork lives in `public/brand`. The two source files
(`worldcup-nexus-icon.png`, `worldcup-nexus-banner.png`) are committed. The
favicon / PWA / Apple icon variants are **generated** and must exist before
build:

```bash
pnpm assets:icons   # writes favicon.ico, icon.png, apple-icon.png + 32/192/512
```

`pnpm public:verify` fails if any required brand asset is missing, so the
predeploy gate catches a forgotten generation step. The banner powers the
homepage hero and the Open Graph / Twitter social previews. No official FIFA
branding is used.

## 10. Security checklist

Code-level hardening shipped in Checkpoint 8B (headers + Report-Only
CSP, production-safe API errors, rate limiting, CSV formula
neutralization, query caps — details in SECURITY_HARDENING_PLAN.md).
Deployment-time items:

- [ ] `NODE_ENV=production` confirmed (gates `/api/dev/data-summary`,
      enables HSTS, hides error detail).
- [ ] HTTPS enforced; HSTS header verified after deploy
      (`max-age=63072000; includeSubDomains; preload` — only enable when
      HTTPS-only is certain).
- [ ] Least-privilege Postgres runtime role (SELECT-only) — if deferred,
      track as launch follow-up (see DATABASE_PRODUCTION.md).
- [ ] All env vars set in the platform; nothing committed.
- [ ] Automated DB backups enabled; restore tested once.
- [ ] Logs/alerts: monitor 5xx rate, 429 rate, `/api/export` volume.
- [ ] Optional platform WAF/rate limits on `/api/*` (the built-in
      limiter is per-instance only).
- [ ] `pnpm audit` clean at deploy time.

## 11. Rollback plan

- **App:** redeploy the previous build (on Vercel: promote the previous
  deployment — instant).
- **Database:** migrations are forward-only; if a bad import corrupted
  data, restore the pre-import backup/snapshot, then re-run
  `pnpm search:index` so the index matches the restored data.
- **Search:** the index can always be rebuilt from the database
  (`pnpm search:index`); if possible keep the previous index until the
  new one passes `pnpm search:verify`.
- Order matters: restore DB first, then reindex, then verify
  (`pnpm data:verify && pnpm search:verify`).

## 12. Post-deploy smoke tests

Run through the list in [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
§7–8: all public pages (`/`, `/tournaments`, `/matches`, `/countries`,
`/players`, `/records`, `/explorer`, `/sources`, `/about`, `/privacy`),
`/api/health`, a search query, a CSV export, `/sitemap.xml`,
`/robots.txt`, the security headers, and confirm
`/api/dev/data-summary` returns 404.

## 13. Known limitations

- **Detail-route not-found pages return HTTP 200.** Dynamic detail routes
  (`/tournaments/[year]`, `/matches/[idOrSlug]`, `/countries/[slug]`,
  `/players/[slug]`) stream through a `loading.tsx` boundary, so when an
  entity is missing the not-found UI renders correctly but the HTTP
  status is 200. Mitigated with `robots: noindex` fallback metadata; the
  global catch-all returns a true 404.
- **Rate limiting is per-instance and in-memory** — resets on redeploy,
  not shared across instances/regions. Reinforce with platform/WAF
  limits for serious traffic.
- **CSP is Report-Only** — enforcement is a post-launch checkpoint after
  observing violations (hardening plan P2.1).
- **Build needs database connectivity** — the sitemap (revalidate 24h)
  is generated at build time; all other data pages are fully dynamic and
  need DB connectivity at runtime.
- **CI runs static checks only** (typecheck, lint, security checks, and
  a build against an empty migrated database). Data-dependent suites
  (`data:verify`, `search:verify`, `test:e2e`, `public:verify`,
  `export:verify`) need imported data and run locally/admin-side via
  `pnpm prod:validate` — see `.github/workflows/ci.yml`.
- In-app search degrades gracefully: if the database is unreachable the
  search API returns 503 and pages keep working.

## Local development

```bash
docker compose up -d          # PostgreSQL
pnpm install
pnpm db:generate              # generate the Prisma client (src/generated/)
pnpm db:migrate               # prisma migrate dev — LOCAL ONLY
pnpm data:download            # cache source CSVs (Fjelstul World Cup Database)
pnpm data:import -- --reset   # normalize into PostgreSQL
pnpm search:index             # build the Postgres search index (SearchDocument)
pnpm dev                      # http://localhost:3000
```

Full local validation before any deploy:

```bash
pnpm prod:preflight           # static deployment-readiness checks
pnpm prod:validate            # all verify suites + typecheck + lint + build + e2e
pnpm audit
```

## Non-negotiables

- No secrets committed to the repository.
- Source attribution must remain visible: the footer links to `/sources`,
  which carries the CC-BY-SA 4.0 attribution required by the Fjelstul World
  Cup Database license. Removing it would violate the data license.
- The independent-project disclaimer ("not affiliated with FIFA") must
  remain visible in the footer and on `/sources` and `/about`.
- The `/privacy` page and `SECURITY.md` remain part of the public surface.
