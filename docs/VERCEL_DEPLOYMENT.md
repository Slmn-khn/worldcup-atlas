# WORLDCUP Nexus — Vercel Deployment Notes

Vercel is the recommended v1 host (any Node 20+ platform that runs
`next start` also works — see [DEPLOYMENT.md](DEPLOYMENT.md) §1).
Nothing here deploys automatically; these are manual setup notes.

## Project setup

1. Create a Vercel project and connect the Git repository.
2. Framework preset: **Next.js** (auto-detected; set manually if not).
3. **Install command:** `pnpm install --frozen-lockfile`
   (the repo pins `packageManager: pnpm@8.15.1`, which Vercel/corepack
   picks up).
4. **Build command:** `pnpm db:generate && pnpm build`
   — the generated Prisma client lives in git-ignored `src/generated/`,
   so it must be generated before every build.
5. Output/start: handled by Vercel for Next.js — no custom output or
   start command needed.
6. Node version: 20+ (Vercel default is fine).

## Environment variables

Set in Project → Settings → Environment Variables (Production scope):

- `DATABASE_URL` — production PostgreSQL (pooled endpoint if available;
  serverless functions multiply connections — see
  [DATABASE_PRODUCTION.md](DATABASE_PRODUCTION.md))
- `DIRECT_URL` — direct endpoint (or same value)
- `NEXT_PUBLIC_SITE_URL` — the production URL; it is inlined at build
  time, so set it **before** the first production build

Rules:

- **Never put secrets in `NEXT_PUBLIC_*` variables** — they are shipped
  to every browser.
- `NODE_ENV=production` is set by Vercel automatically; do not override.
- Do not add env vars that trigger migrations/imports — database
  migration, data import, and search indexing are run **separately from
  an admin environment** ([PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
  §3–5), never from the public runtime or the build pipeline.

## Build-time database access

The sitemap is generated at build time (revalidates daily), so the
**build needs `DATABASE_URL` connectivity** with the schema migrated
(an imported dataset makes the sitemap complete; an empty schema builds
but lists only static routes). Run migrations and import **before** the
first production build.

## After each deploy

- Verify headers (`curl -I https://<domain>/`):
  `Content-Security-Policy-Report-Only`, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and
  `Strict-Transport-Security` (HTTPS is default on Vercel).
- Verify `NODE_ENV=production` took effect:
  `/api/dev/data-summary` must return **404**, and API error bodies must
  not contain a `detail` field.
- Run the smoke tests in [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
  §7.

## Platform extras worth enabling

- **Vercel WAF / rate limiting** on `/api/*` (the app's built-in limiter
  is per-instance memory — on serverless it resets per function instance,
  so platform-level limits are the real control at scale).
- Log drain → alerting on 5xx / 429 rates.
- Rollback = "Promote previous deployment" (instant).
