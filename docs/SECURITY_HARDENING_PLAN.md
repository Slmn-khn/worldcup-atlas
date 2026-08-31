# Security Hardening Plan — WORLDCUP Nexus

Companion to `docs/SECURITY_AUDIT.md` (Checkpoint 8A). Items are sequenced
by deployment priority.

> **Update (2026-08-31):** Meilisearch was removed; search is now
> Postgres-backed (see `docs/SEARCH_PRODUCTION.md`). Meilisearch-specific
> wording below is historical — the error-masking, rate-limiting, and
> query-cap protections all still apply to the Postgres search path.

## Implementation status (Checkpoint 8B, 2026-06-12)

| Item | Status |
| --- | --- |
| P0.1 — Production-safe API errors | ✅ Implemented (`src/server/security/api-errors.ts`) |
| P0.2 — Security headers + Report-Only CSP | ✅ Implemented (`next.config.ts`; HSTS production-only) |
| P0.3 — CSV formula-injection neutralization | ✅ Implemented (`src/server/exports/csv.ts`) |
| P0.4 — Production environment guarantees | ⏳ Deployment-time (see checklist below) |
| P1.1 — API rate limiting | ✅ Implemented (in-memory baseline, `src/server/security/rate-limit.ts`) |
| P1.2 — Search query length cap | ✅ Implemented (200 chars, `src/server/search/search.ts`) |
| P1.3 — Sitemap caching | ✅ Implemented (`revalidate = 86400`) |
| P1.4 — Dependency advisories | ✅ Resolved (`pnpm.overrides`; `pnpm audit` clean) |
| P1.5 — Privacy page | ✅ Implemented (`/privacy` + footer link) |
| P2.x | ⏳ Post-launch (CSP enforcement, CI, observability, Docker hygiene) |

Known limitations of the implemented baseline:

- **Rate limiting is in-memory and per-process/instance.** Counters reset
  on restart/redeploy and are not shared across instances. Adequate at
  launch scale; serious traffic should add platform/WAF or shared-store
  (e.g. Redis) rate limiting on top.
- **CSP is Report-Only.** Enforcement is a later checkpoint (P2.1) after
  observing violations in the wild. MUI/Emotion and the Next App Router
  require `'unsafe-inline'` until a nonce-based CSP is intentionally
  designed.
- **HSTS is emitted only when `NODE_ENV=production`** and presumes the
  deployed site is HTTPS-only — confirm at deploy time before announcing.
- **Sitemap now revalidates daily** (ISR) — it is generated at build time,
  so the build environment needs database connectivity.

---

## Priority 0 — Must fix before deployment

### P0.1 — Stop echoing internal error details from API routes

- **Risk:** `/api/search`, `/api/explorer`, and `/api/export/explorer`
  return `detail: error.message` on failure. Infrastructure errors can
  include the Meilisearch host URL or database host/port — information
  disclosure (audit finding 3, OWASP A05).
- **Files:** `src/app/api/search/route.ts`,
  `src/app/api/explorer/route.ts`,
  `src/app/api/export/explorer/route.ts`.
- **Plan:** keep the friendly `error` string; emit `detail` only when
  `process.env.NODE_ENV === "development"`. Log the full error server-side
  (`console.error`) so platform logs retain diagnostics.
- **Validation:** `pnpm test:e2e` (routes still respond); manual check
  with Meilisearch stopped → 503 body contains no host/connection info in
  a production build (`pnpm build && pnpm start`).
- **Acceptance:** production error responses contain only static
  user-facing strings; dev behavior unchanged.

### P0.2 — Baseline security headers

- **Risk:** no CSP/HSTS/nosniff/frame-ancestors/Referrer-Policy/
  Permissions-Policy at all (audit finding 1, OWASP A05).
- **Files:** `next.config.ts` (add `headers()`); no middleware required
  for the baseline set.
- **Plan:** add the non-breaking set immediately:
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, and the **Report-Only CSP
  draft from the audit** (`Content-Security-Policy-Report-Only`). HSTS is
  enabled at/after first production deploy once HTTPS-only is confirmed
  (platforms like Vercel serve HTTPS by default).
- **Validation:** `pnpm build && pnpm start`, then inspect response
  headers on `/`, `/explorer`, `/api/health`; click through every route
  watching the console for CSP report violations; `pnpm test:e2e`.
- **Acceptance:** headers present on all responses; zero functional
  regressions; CSP violations triaged to an empty list.

### P0.3 — CSV formula-injection neutralization

- **Risk:** exported cells beginning with `=`, `+`, `-`, `@`, tab, or CR
  can execute as formulas in Excel/Sheets (audit finding 4, OWASP A03).
  Data is source-controlled today, but the dataset is an external input.
- **Files:** `src/server/exports/csv.ts`,
  `scripts/verify/verify-export.ts` (new assertion).
- **Plan:** in `toCsvValue`, prefix any value matching `/^[=+\-@\t\r]/`
  with a single quote (`'`) before the existing quote/comma escaping;
  extend `export:verify` with a unit-style check that hostile values are
  neutralized. Note: scores like `3–2` use en-dash (not ASCII `-`) and
  are unaffected; negative-looking values do not exist in this dataset.
- **Validation:** `pnpm export:verify` (with the new check);
  `pnpm test:e2e`.
- **Acceptance:** a synthetic `=cmd()` value round-trips as `'=cmd()`;
  existing export checks still pass.

### P0.4 — Production environment guarantees

- **Risk:** dev-only behaviors must actually be gated in production:
  `/api/dev/data-summary` (already `NODE_ENV`-gated), Prisma dev query
  logging, Meilisearch master-key usage (audit findings 8, 16).
- **Files:** none (deployment configuration), `docs/DEPLOYMENT.md`.
- **Plan:** deployment-time checklist (no code): confirm
  `NODE_ENV=production` on the platform; create a **scoped search-only
  Meilisearch key** for the app and keep the master key vaulted;
  provision a least-privilege Postgres role for runtime (SELECT on app
  tables) separate from the migration/import role; document both in
  DEPLOYMENT.md.
- **Validation:** `curl /api/dev/data-summary` on the deployed site →
  404; search works with the scoped key (`pnpm search:verify` against
  production env).
- **Acceptance:** dev endpoint 404s in production; app holds no master
  key; runtime DB role cannot write.

---

## Priority 1 — Strongly recommended before deployment

### P1.1 — Rate limiting on API routes

- **Risk:** unauthenticated, unthrottled APIs — export materializes up to
  5,000 rows per call (audit finding 2, OWASP A04).
- **Files:** new `middleware.ts` (or platform-level rules — Vercel WAF /
  hosting rate rules are acceptable and simpler).
- **Plan:** prefer platform-level limits if deploying to a platform that
  offers them (zero code). Otherwise add a small fixed-window in-memory
  limiter in `middleware.ts` keyed by IP for `/api/*`: e.g. 60 req/min
  for `/api/search` and `/api/explorer`, **6 req/min for
  `/api/export/explorer`**, generous for `/api/health`. Return 429 with
  `Retry-After`. (In-memory is per-instance — adequate at this scale;
  upgrade to a shared store only if horizontal scaling demands it.)
- **Validation:** scripted loop exceeds the limit → 429; e2e suite stays
  green (limits far above test rates).
- **Acceptance:** sustained abuse of export/search is throttled; normal
  browsing never sees 429.

### P1.2 — Cap search query length at the API boundary

- **Risk:** unbounded `q` accepted by `/api/search` (audit finding 7).
- **Files:** `src/app/api/search/route.ts` or
  `src/server/search/search.ts`.
- **Plan:** `query.slice(0, 200)` (trim first) in the service so every
  caller is covered.
- **Validation:** `pnpm search:verify`; manual long-string request
  returns normally.
- **Acceptance:** 10k-char query is truncated server-side, no error.

### P1.3 — Sitemap and page caching

- **Risk:** `force-dynamic` sitemap runs 4 unbounded queries per request
  (~11,800 URLs); all data pages re-query per request (audit finding 5).
- **Files:** `src/app/sitemap.ts` (switch to `revalidate = 86400`),
  optionally per-page `revalidate` for historical pages post-launch.
- **Plan:** sitemap first (content changes only on data import). Page
  caching is safe for this dataset (historical, changes only on import)
  but interacts with the filter system — start with CDN/ISR on the
  sitemap and detail pages, leave filtered index pages dynamic.
- **Validation:** `pnpm public:verify` (sitemap checks);
  `curl /sitemap.xml` twice — second response served from cache.
- **Acceptance:** repeated sitemap fetches don't hit the database.

### P1.4 — Clear the two moderate dependency advisories

- **Risk:** postcss <8.5.10 and @hono/node-server <1.19.13, both
  transitive (audit finding 6, OWASP A06).
- **Files:** `package.json` / `pnpm-lock.yaml`.
- **Plan:** bump `next` to the latest 16.x patch when it pins
  postcss ≥8.5.10; otherwise add a pnpm `overrides` entry for
  `postcss@>=8.5.10` and the hono server patch; re-run the full suite.
  Do **not** auto-upgrade majors.
- **Validation:** `pnpm audit` → 0 known vulnerabilities;
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e`.
- **Acceptance:** clean audit with green suite.

### P1.5 — Privacy statement page

- **Risk:** none technical — trust/compliance gap (audit finding 14). No
  cookies, no accounts, no analytics, no tracking exist; player data is
  public historical sports data under CC-BY-SA attribution.
- **Files:** new `src/app/privacy/page.tsx` + footer link; `public:verify`
  picks it up via the nav/footer link check.
- **Plan:** short editorial page: what is (not) collected, no cookies, no
  analytics, data licensing pointer to /sources, contact route. No cookie
  banner needed (nothing to consent to). If analytics are ever added,
  prefer a cookieless/privacy-focused option and update the page.
- **Validation:** `pnpm public:verify`, `pnpm test:e2e`.
- **Acceptance:** /privacy renders in the Vault style and is linked in
  the footer.

---

## Priority 2 — Post-launch improvements

### P2.1 — Enforced CSP (from Report-Only)

- **Risk:** Report-Only doesn't block; enforcement is the real control.
- **Files:** `next.config.ts` (header swap), possibly `middleware.ts` +
  Emotion cache provider if pursuing nonces.
- **Plan:** after ≥1–2 weeks of clean Report-Only telemetry, switch to
  enforced CSP with `'unsafe-inline'` for styles (Emotion requirement);
  evaluate nonce-based `script-src` as a follow-up.
- **Validation:** every route in e2e + manual explorer/DataGrid pass with
  zero console CSP errors.
- **Acceptance:** enforced CSP live with no functional loss.

### P2.2 — CI pipeline with security gates

- **Risk:** all verification is manual today (audit finding 13).
- **Files:** new `.github/workflows/ci.yml`.
- **Plan:** on PR/push: `pnpm install --frozen-lockfile`, `pnpm audit`
  (fail on high+), `pnpm typecheck`, `pnpm lint`, `pnpm db:generate`,
  `pnpm build`; optional services job for `data:verify`/`search:verify`/
  `test:e2e` with Postgres+Meilisearch containers. No secrets in the
  workflow; use repo secrets only if the services job is added.
- **Validation:** green pipeline on a no-op PR; red on an injected lint
  error.
- **Acceptance:** merges blocked on the gates above.

### P2.3 — Observability

- **Risk:** no monitoring/logging plan (OWASP A09).
- **Plan:** platform log drain; alert on 5xx rate, 429 rate, and
  `/api/export` volume; uptime check on `/api/health`; document the
  runbook in DEPLOYMENT.md.
- **Validation:** test alert fires on a forced 5xx.
- **Acceptance:** on-call can see and react to abuse within minutes.

### P2.4 — Local Docker hygiene

- **Risk:** dev compose binds 5432/7700 on all interfaces with fixed
  credentials (audit finding 8) — local-only, but laptops travel.
- **Files:** `docker-compose.yml` (deferred — Docker untouched in 8A).
- **Plan:** bind `127.0.0.1:5432:5432` and `127.0.0.1:7700:7700`; keep
  the "local development only" warnings.
- **Validation:** `docker compose up -d` + full local suite still green.
- **Acceptance:** services unreachable from the LAN.

### P2.5 — Housekeeping

- Remove or adopt the unused `zod` dependency (decide one way).
- ~~Rename the export file `worldcup-atlas-explorer.csv` →
  `worldcup-nexus-explorer.csv`~~ — **done in Checkpoint 8B**.
- ~~Add a `SECURITY.md` with a vulnerability-report contact~~ — **done in
  Checkpoint 8B** (private GitHub security advisory / maintainer contact).
- Schedule quarterly `pnpm audit` + dependency review.
- Validation for all: full command suite green.

---

## Suggested execution order

1. **Checkpoint 8B — Security Hardening (P0.1–P0.3 + P1.1–P1.4):** one
   code checkpoint, fully testable locally.
2. **P0.4 + deployment checklist:** executed during the deployment
   checkpoint itself.
3. **P1.5 (privacy page):** small standalone page task, before launch.
4. **P2.x:** scheduled post-launch.
