# Security Audit — WORLDCUP Nexus

Checkpoint 8A. Code/configuration audit performed 2026-06-12 against the
local repository. No code was modified as part of this audit.

> **Update (2026-08-31):** Meilisearch has since been removed — search is
> now Postgres-backed (`SearchDocument` table, full-text + `pg_trgm`; see
> `docs/SEARCH_PRODUCTION.md`). Meilisearch-specific findings and notes
> below are retained as a historical record but no longer apply: there is
> no search service, no `MEILISEARCH_HOST`/`MEILISEARCH_API_KEY`, and
> `/api/search` queries PostgreSQL through parameterized Prisma
> `$queryRaw` (no string-built SQL).

> **Update (Checkpoint 8B, 2026-06-12):** the hardening items derived from
> this audit have been implemented — findings 1 (headers + Report-Only
> CSP), 2 (rate limiting), 3 (production-safe error responses), 4 (CSV
> formula neutralization), 5 (sitemap revalidation), 6 (dependency
> overrides; `pnpm audit` clean), 7 (200-char query cap), 12 (export
> filename rename), and 14 (privacy page) are resolved in code. P0.4
> (production environment guarantees) remains deployment-time. See the
> implementation-status table in `docs/SECURITY_HARDENING_PLAN.md`.

## Scope

Audited surfaces:

- All API routes: `/api/health`, `/api/search`, `/api/explorer`,
  `/api/export/explorer`, `/api/dev/data-summary`
- Server layer: `src/server/queries/**`, `src/server/search/**`,
  `src/server/exports/**`, `src/server/db/prisma.ts`
- Input parsing: `src/lib/search-params.ts`,
  `src/server/queries/parseExplorerParams.ts`, page `searchParams` usage
- Rendering: React components (XSS surfaces), search result rendering,
  explorer DataGrid, CSV generation
- Configuration: `next.config.ts`, `tsconfig.json`, ESLint, `package.json`,
  `pnpm-lock.yaml`, `prisma.config.ts`, `prisma/schema.prisma`,
  `docker-compose.yml`, `.env` / `.env.example`, `.gitignore`
- Scripts: `scripts/import/**`, `scripts/search/**`, `scripts/verify/**`
- Docs: `docs/DEPLOYMENT.md`, `README.md`
- Dependency tree (`pnpm audit`)

Out of scope: runtime penetration testing, hosted-infrastructure review
(no production environment exists yet), Docker image CVE scanning.

## Executive Summary

WORLDCUP Nexus is a public, read-only historical archive with a small,
well-contained attack surface. The codebase is notably clean: all database
access goes through the Prisma query builder (a single constant
`SELECT 1` is the only raw query), every user input path is parsed through
centralized sanitizing helpers with allowlists and caps, no dangerous
browser APIs are used anywhere, secrets are server-only and git-ignored,
the one dev endpoint is production-disabled, and RawSourceRecord data is
verifiably never exposed (enforced by automated checks).

The gaps are launch-hardening gaps, not exploitable vulnerabilities: there
are **no HTTP security headers configured**, **no rate limiting on any API
route**, API error responses **echo internal error messages**, and the CSV
export does not neutralize **spreadsheet formula injection**. All are
straightforward to fix and are sequenced in
`docs/SECURITY_HARDENING_PLAN.md`.

## Overall Risk Rating

**Medium** (pre-hardening) — trending **Low** once Priority 0/1 items in
the hardening plan are complete.

Rationale: the application holds no user data, no credentials, no write
endpoints, and no session state, which caps the impact of most attack
classes. The remaining risk is dominated by (a) missing browser/transport
hardening headers, (b) unthrottled public APIs that can be abused for
load, and (c) information leakage through error details. None allows data
modification or secret disclosure under normal failure modes.

## Critical Findings

None found.

## High Findings

1. **No HTTP security headers are configured.** `next.config.ts` sets no
   `headers()` and there is no `middleware.ts`. The app currently ships
   without Content-Security-Policy, Strict-Transport-Security,
   X-Content-Type-Options, frame-ancestors/X-Frame-Options,
   Referrer-Policy, or Permissions-Policy. For a public production site
   this leaves defense-in-depth entirely to browser defaults.
   *Files:* `next.config.ts` (only `reactCompiler: true`).
2. **No rate limiting or abuse controls on any API route.**
   `/api/search` fans out to six Meilisearch sub-queries per call;
   `/api/export/explorer` materializes up to 5,000 database rows per call;
   `/api/explorer` runs multi-table queries. All are unauthenticated and
   unthrottled, making them cheap DoS/cost amplification levers. Result
   caps exist (good), request-frequency caps do not.

## Medium Findings

3. **API error responses leak internal error messages.** `/api/search`,
   `/api/explorer`, and `/api/export/explorer` all return
   `detail: error.message` on failure. Infrastructure failures can echo
   internals — Meilisearch connection errors include the configured host
   URL, and Prisma connectivity errors can include host/port and database
   name. No stack traces are returned (good), but the `detail` field
   should not reach clients in production.
   *Files:* `src/app/api/search/route.ts:43`,
   `src/app/api/explorer/route.ts:22`,
   `src/app/api/export/explorer/route.ts:93`.
4. **CSV export does not mitigate spreadsheet formula injection.**
   `toCsvValue()` escapes quotes/commas/newlines but does not neutralize
   cells beginning with `=`, `+`, `-`, `@`, tab, or CR, which Excel/Sheets
   may evaluate as formulas. Exported values come from the imported
   Fjelstul dataset (not arbitrary user input), so current exploitability
   is low — but the dataset is an external supply-chain input and future
   re-imports could introduce hostile strings.
   *File:* `src/server/exports/csv.ts:4-8`.
5. **Sitemap is computed from the database on every request.**
   `src/app/sitemap.ts` is `force-dynamic` and runs four unbounded
   `findMany` queries (~11,800 URLs) per fetch. Repeated sitemap fetches
   are a free database-load amplifier. The same `force-dynamic`
   no-caching posture applies to all data pages; acceptable at launch
   traffic but a standing abuse/cost exposure without CDN or revalidation
   caching.
6. **Two moderate dependency advisories (transitive).**
   `pnpm audit`: `postcss <8.5.10` (XSS via unescaped `</style>`;
   build-time path via `next@16.2.6`) and `@hono/node-server <1.19.13`
   (middleware bypass; transitive dev/tooling path). Neither is directly
   reachable in production runtime as used, but both should be cleared via
   upstream updates before launch.

## Low Findings

7. **Search query length is not capped.** `/api/search` passes `q`
   through unmodified (the page-side helpers cap at 100–120 chars, but
   the API route does not). Meilisearch tolerates long strings; this is a
   minor abuse-bandwidth issue. `limit` *is* capped (max 50) and `type`
   *is* allowlisted in the service layer.
8. **Local Docker services bind to all interfaces with weak fixed
   credentials.** `docker-compose.yml` publishes Postgres `5432` and
   Meilisearch `7700` with `worldcup/worldcup` and a literal master key.
   This is explicitly a local-development setup (documented as such), but
   on a laptop in an untrusted LAN these ports are reachable. Recommended
   (post-checkpoint): bind to `127.0.0.1:` and set
   `MEILI_ENV: development` only locally — never reuse this compose file
   in production.
9. **`/api/health` is public and reveals database connectivity.** The
   response is minimal (`ok`, `app`, `database: connected|disconnected`)
   with no versions, hosts, or stack traces — well designed. A public
   binary "DB up/down" signal is broadly acceptable; if undesired,
   restrict by header token at the platform level.
10. **Detail-route not-found pages return HTTP 200** (documented caveat in
    `docs/DEPLOYMENT.md`). Mitigated with `robots: noindex` fallback
    metadata; residual risk is cache/SEO noise only.

## Informational Findings

11. `zod@4` is installed but unused — input validation is hand-rolled (and
    sound). Either adopt it for API routes or remove the dependency.
12. The export filename is still `worldcup-atlas-explorer.csv` (internal
    branding leftover; cosmetic).
13. No CI pipeline exists — all verification gates are manual.
14. No privacy page exists. The app sets no cookies, has no accounts, no
    analytics, and no tracking; only public historical sports data is
    served. A short privacy statement is still recommended pre-launch.
15. `prisma.$queryRaw\`SELECT 1\`` in `/api/health` is the only raw SQL in
    the application — a constant tagged template with no interpolation
    (safe).
16. `/api/dev/data-summary` correctly returns 404 outside
    `NODE_ENV=development` and never exposes RawSourceRecord.
17. No `console.log` of data or secrets in server/API code; Prisma query
    logging is development-only.

## OWASP Top 10 Mapping

| Category | Status |
| --- | --- |
| A01 Broken Access Control | Low exposure — read-only app, no auth surface, no mutation endpoints, dev route production-gated (finding 16). |
| A02 Cryptographic Failures | No secrets in repo; TLS/HSTS to be enforced at deployment (finding 1). |
| A03 Injection | No SQL injection paths found (Prisma builder everywhere; finding 15). Meilisearch filter is allowlisted. CSV formula injection unmitigated (finding 4). No XSS sinks (no `dangerouslySetInnerHTML`/`innerHTML`; all values text-rendered through React/MUI). |
| A04 Insecure Design | Caps and allowlists are designed in (pageSize ≤100, export ≤5000, sort/event-type allowlists). Rate limiting missing (finding 2). |
| A05 Security Misconfiguration | Missing security headers (finding 1); error detail exposure (finding 3); local Docker binding (finding 8). |
| A06 Vulnerable and Outdated Components | Two moderate transitive advisories (finding 6); stack otherwise current (Next 16, React 19, Prisma 7, MUI 9). |
| A07 Identification & Authentication Failures | N/A — no authentication exists by design. |
| A08 Software & Data Integrity Failures | Lockfile committed; no install-time scripts of concern; no CI (finding 13); data pipeline fetches from a pinned public source documented in the source manifest. |
| A09 Logging & Monitoring Failures | No production logging/monitoring plan yet (finding in hardening plan). |
| A10 SSRF | No user-controlled URL fetching anywhere in the app runtime. Import scripts fetch fixed manifest URLs offline, not from request input. |

## Route-by-Route API Review

### GET /api/health
- **Purpose:** liveness/readiness signal. **Public.** No inputs.
- **Validation:** n/a. **Response:** `{ ok, app, database }` — minimal; no
  versions, hosts, env values, or stack traces.
- **Data exposure:** none beyond a connectivity boolean.
- **Abuse risk:** negligible (single `SELECT 1`).
- **Recommendation:** acceptable as-is publicly; optionally restrict via
  platform header check. Exclude from robots (already disallowed —
  `/api/` is disallowed in robots.txt).

### GET /api/search
- **Inputs:** `q` (string), `limit` (int), `type` (csv of allowlisted
  document types).
- **Validation:** empty `q` short-circuits; `limit` clamped to 1–50 in the
  service; `type` allowlisted against `SEARCH_DOCUMENT_TYPES`; Meilisearch
  `filter` built only from allowlisted values (no injection). **Gap:** no
  `q` length cap (finding 7).
- **Response:** grouped DTOs (`id/type/title/subtitle/description/href`)
  with internal hrefs only; no index/task internals.
- **Errors:** 503 with a helpful message **plus `detail`** (finding 3).
- **Abuse risk:** 6 Meilisearch sub-queries per request, unthrottled
  (finding 2).
- **Recommendation:** cap `q` (≤200 chars), drop `detail` in production,
  add per-IP rate limit. Public unauthenticated access is appropriate.

### GET /api/explorer
- **Inputs:** `eventType`, `tournamentYear`, `countrySlug`, `playerSlug`,
  `stage`, `q`, `page`, `pageSize`.
- **Validation:** all strings trimmed and capped at 100 chars; ints must
  be positive integers; `pageSize` clamped to ≤100 and `eventType`
  effectively allowlisted in the query layer; invalid values ignored.
- **Response:** normalized `ExplorerRowDto`s — verified by automated check
  ("explorer rows do not expose RawSourceRecord data").
- **Errors:** 500 with `detail` (finding 3).
- **Abuse risk:** moderate query cost, unthrottled (finding 2).
- **Recommendation:** drop `detail`, rate limit; otherwise sound.

### GET /api/export/explorer
- **Inputs:** explorer filters plus `format` (`csv` default; only `json`
  accepted as alternative — effectively allowlisted).
- **Validation:** same as explorer; export capped at
  `EXPLORER_EXPORT_CAP = 5000` rows with `X-Export-Truncated`/
  `X-Export-Cap` headers when clipped.
- **Response:** CSV with correct `Content-Type: text/csv; charset=utf-8`
  and `Content-Disposition: attachment`, or JSON envelope. No raw
  payloads, no secrets (verified by `pnpm export:verify`).
- **Gaps:** CSV formula injection (finding 4); `detail` on error
  (finding 3); unthrottled despite being the most expensive route
  (finding 2).
- **Recommendation:** highest-priority route for rate limiting; add
  formula-prefix escaping; drop `detail`.

### GET /api/dev/data-summary
- **Dev-only.** Returns 404 when `NODE_ENV !== "development"`. Exposes
  aggregate stats/leaderboards (no RawSourceRecord) in dev. Acceptable;
  verify platform sets `NODE_ENV=production` (Vercel/Next do by default).

## Security Headers Review

**Current status: none configured.** No `headers()` in `next.config.ts`,
no middleware, no proxy config.

Recommended set (via `next.config.ts` `headers()`):

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  (production HTTPS only)
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

**CSP draft** (stage 1, `Content-Security-Policy-Report-Only`):

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

Constraints to respect:
- **MUI/Emotion injects runtime `<style>` tags** → `style-src` requires
  `'unsafe-inline'` (or an Emotion nonce wired through the App Router
  cache provider — possible but invasive).
- **Next.js App Router emits inline bootstrap scripts** → `script-src`
  needs `'unsafe-inline'` unless a nonce-based CSP is generated in
  middleware per-request. Recommended path: ship Report-Only with
  `'unsafe-inline'`, observe, then evaluate nonce-based enforcement.
- Fonts are self-hosted via `next/font` (no Google Fonts origin needed);
  there are no external images, no third-party scripts, no analytics —
  the CSP can be unusually tight.
- Stage 2: switch to enforced CSP after Report-Only shows no violations
  across all routes (including the DataGrid on /explorer).

## Environment and Secrets Review

- **Safe:** `.gitignore` ignores `.env`/`.env.*` (keeps `.env.example`);
  `.env.example` contains only local-development defaults that match
  `docker-compose.yml` and are labeled as local-only; no real secrets
  exist anywhere in the repo; `DATABASE_URL` and `MEILISEARCH_API_KEY`
  are read exclusively in server-only modules (`src/server/db/prisma.ts`,
  `src/server/search/client.ts`, `prisma.config.ts`); the only
  `NEXT_PUBLIC_*` variable is `NEXT_PUBLIC_SITE_URL` (safe public value);
  zero `process.env` usage in client components (verified by scan).
- **Risk:** none found in code. Operational risk: the local Meilisearch
  master key is used as the API key — production must use a scoped
  search-only key (DEPLOYMENT.md already says so).
- **Remediation:** covered in hardening plan (scoped keys, rotation note).

## Database and Prisma Review

- All application queries use the Prisma query builder; user input reaches
  queries only through typed, sanitized option objects (`contains` /
  `equals` parameters — parameterized by Prisma).
- Exactly one raw query exists: `prisma.$queryRaw\`SELECT 1\`` in
  `/api/health` — constant tagged template, no interpolation, **safe**.
  No `$queryRawUnsafe` / `$executeRawUnsafe` / string-built SQL anywhere
  (verified by scan).
- Sorts, event types, record categories, and export formats are
  allowlisted; pageSize/export caps enforced in the query layer (≤100 /
  ≤5000); bad params are normalized, never thrown (verified by the
  `data:verify:queries` bad-param check).
- DB errors do not reach page UIs (error boundaries render generic
  states); the API `detail` field is the one leak path (finding 3).
- Dev-only query logging; production logs errors only.
- Recommendation: provision a least-privilege production DB role
  (SELECT-only for the app runtime; migrations/import run with a separate
  role) — tracked in the hardening plan.

## Meilisearch Review

- The browser never talks to Meilisearch — all search flows through
  `/api/search`; the client helper is server-only and documented as such.
- Keys are server-env only; nothing Meilisearch-related is `NEXT_PUBLIC`.
- Indexed documents are built exclusively from normalized Prisma entities
  (`src/server/search/documents.ts` explicitly excludes RawSourceRecord)
  and contain titles/subtitles/keywords plus **internal hrefs only**.
- Search responses are mapped to DTOs; no task IDs, index settings, or
  engine metadata are returned.
- Search unavailability degrades gracefully (503 from the API; pages never
  depend on search) — verified behavior.
- Index name `worldcup_atlas_search` appearing in errors/infra is an
  internal identifier with no security value — leak is immaterial.
- Production recommendation: private network or provider-hosted instance,
  scoped search-only API key, port 7700 never publicly reachable,
  `MEILI_ENV=production` (disables the dev dashboard).

## Export/CSV Safety Review

- Caps, truncation headers, content-type, and attachment disposition are
  all correct; JSON variant mirrors the same cap.
- Quote/comma/newline escaping is correct (RFC 4180 style).
- **Gap:** no formula-injection neutralization (finding 4). Plan: prefix
  cells matching `/^[=+\-@\t\r]/` with `'` (or a leading space) in
  `toCsvValue`, with the export-verify script extended to assert it.
- No secrets, env values, or raw payloads in export output (verified by
  `pnpm export:verify`).

## Deployment Security Checklist

Production go-live checklist (expanded from `docs/DEPLOYMENT.md`):

- [ ] Hosted PostgreSQL with strong unique credentials; network-restricted
      to the app platform; least-privilege runtime role; automated backups
      with tested restore.
- [ ] Search: no separate service (Postgres-backed) — nothing extra to
      secure beyond the database itself.
- [ ] All env vars set in the platform (never committed):
      `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL` (production URL).
- [ ] HTTPS enforced; HSTS header enabled after confirming HTTPS-only.
- [ ] Security headers + Report-Only CSP deployed (hardening plan P0/P1).
- [ ] Rate limiting active on `/api/*` (strictest on export).
- [ ] Migrations via `pnpm prisma migrate deploy` — deliberate, not
      automatic on boot.
- [ ] Data import + `pnpm search:index` run deliberately post-migration;
      re-index after every import (stale-index risk documented).
- [ ] `NODE_ENV=production` confirmed (gates the dev endpoint).
- [ ] Logs/alerts wired (platform log drain at minimum); 5xx and 429
      monitored.
- [ ] Secrets rotation owner and cadence agreed.
- [ ] Sitemap caching/revalidation in place before announcing the site.

## Evidence

Commands run during this audit (2026-06-12):

- `pnpm audit` / `pnpm audit --prod` → **2 moderate** (postcss <8.5.10
  transitive via next@16.2.6; @hono/node-server <1.19.13 transitive);
  0 high/critical.
- Pattern scans over `src/` + `scripts/` (excluding generated):
  `eval(`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML`,
  `localStorage`, `sessionStorage`, `$queryRawUnsafe`,
  `$executeRawUnsafe`, `$executeRaw`, `Access-Control-Allow`,
  `TODO|FIXME|HACK` → **0 hits each**; `$queryRaw` → 1 hit (safe constant,
  health route).
- Client-env scan: `process.env` in `"use client"` files → **0**;
  `NEXT_PUBLIC` usage → 1 (`NEXT_PUBLIC_SITE_URL` in `src/lib/site.ts`).
- Server logging scan: `console.*` in `src/server` + `src/app/api` → **0**.
- Script supply-chain scan: `curl|wget|execSync|child_process|spawn` in
  `scripts/` → **0**.
- Full verification suite (run earlier the same session, all passing):
  `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm public:verify`,
  `pnpm data:verify`, `pnpm data:verify:queries` (includes
  RawSourceRecord-exposure and bad-param checks), `pnpm export:verify`,
  `pnpm search:verify`, `pnpm test:e2e` (17/17).

## Limitations

This is a static code/configuration audit of the local repository plus
safe local commands. It is **not** a penetration test, a runtime DAST
scan, a Docker image CVE scan, or a review of any hosted environment
(none exists yet). Findings about production behavior (headers, TLS,
rate limiting) describe what the code will and will not provide when
deployed; the hosting platform adds its own layer that must be reviewed
at deployment time.
