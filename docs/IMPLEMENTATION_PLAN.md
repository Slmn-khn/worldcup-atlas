# WORLDCUP Nexus — Implementation Plan

## Rule: one checkpoint at a time

Do not start the next checkpoint until the current one's acceptance criteria are fully met. Each checkpoint must be independently deployable or at minimum independently verifiable.

---

## Checkpoint 1 — Next.js + MUI app running

**Status: complete**

**Summary:** Next.js + MUI frontend app runs.

### Acceptance criteria

- `pnpm dev` starts without errors
- App renders at `localhost:3000`
- MUI theme provider is wired up (`src/theme/theme.ts`)
- Dark navy/gold palette is applied
- TypeScript compiles clean (`pnpm typecheck`)
- ESLint passes (`pnpm lint`)

---

## Checkpoint 2 — Local data backbone

**Status: complete**

**Summary:** Docker Compose, PostgreSQL, Meilisearch, Prisma 7 config, initial schema, Prisma client helper, placeholder scripts, and `/api/health` are set up.

### Deliverables

- `docker-compose.yml` with PostgreSQL and Meilisearch services
- `.env.example` with all required env vars documented
- Prisma initial schema (`prisma/schema.prisma`)
- Prisma client singleton helper (`src/lib/prisma.ts`)
- `/api/health` route handler returning DB and search service status

### Acceptance criteria

- `docker compose up` starts PostgreSQL and Meilisearch without errors
- `pnpm prisma migrate dev` applies schema to local DB without errors
- `GET /api/health` returns `200` with `{ db: "ok", search: "ok" }`
- `.env.example` documents every variable used in the app
- No hardcoded credentials in source

---

## Checkpoint 3 — Static app shell

**Status: complete**

**Summary:** Static WORLDCUP Nexus app shell is built with `AppShell`, `Navbar`, `Footer`, `PageContainer`, `SectionHeading`, `StatCard`, `GlobalSearch` placeholder, entity cards (tournament, match, country, player, record), a clearly labeled mock-data file, and the homepage shell.

### Deliverables

Component library under `src/components/`:

- `AppShell` — wraps all pages with Navbar + Footer + main content area
- `Navbar` — site-wide navigation with logo and links
- `Footer` — data attribution, legal disclaimer, links
- `PageContainer` — max-width constrained content wrapper
- `SectionHeading` — consistent section title with optional subtitle
- `StatCard` — key stat display (e.g. "22 tournaments", "2,548 goals")
- `TournamentCard` — clickable card with year, host, winner
- `MatchCard` — score display with teams, date, round
- `CountryCard` — flag placeholder, country name, appearances count
- `PlayerCard` — name, nationality, position, key stat
- `GlobalSearch` — search input placeholder (not wired to data yet)

### Acceptance criteria

- All components render in a Storybook story or a `/dev/components` page (mock data allowed, must be clearly labeled)
- No real historical data hardcoded in component defaults
- TypeScript passes
- ESLint passes
- All components use MUI only (no Tailwind, no raw CSS files)
- Visual style matches `docs/UI_STYLE_GUIDE.md`

---

## Checkpoint 4A — Data source audit and downloader

**Status: complete**

**Summary:** Source manifest (`src/server/import/source-manifest.ts`), downloader (`pnpm data:download`), header inspection (`pnpm data:inspect`), local cache under `data/sources/fjelstul/`, and attribution notes in `docs/DATA_SOURCES.md`.

### Deliverables

- Inspection notes on the Fjelstul World Cup Database structure (files, entities, relationships)
- Source manifest documenting each selected source file: origin URL, entity, license
- Data download/cache folder for source files (kept out of version control as appropriate)
- Downloader that fetches the selected source CSV files into the cache folder
- Header inspection of each downloaded CSV, documented
- Attribution and source notes recorded per `docs/DATA_SOURCES.md`

### Constraints

- Do not normalize or import into the database yet
- Do not invent data

### Acceptance criteria

- Selected Fjelstul CSV files are downloaded into the local cache folder
- Source manifest lists every downloaded file with origin and license (CC-BY-SA 4.0)
- CSV headers are inspected and documented
- No database writes occur
- Attribution and source notes are documented

---

## Checkpoint 4 — First database seed and import

**Status: split into 4B (complete) and 4C (complete)**

### Scope split

**Checkpoint 4B — core normalized import (complete):** imports the core
foundation data from cached Fjelstul CSVs: raw source records, tournaments,
countries, teams, players, stadiums, referees, matches, and squads
(`pnpm data:import`, verified by `pnpm data:verify`).

**Checkpoint 4C — event and awards import (complete):** imports event-level
data from cached Fjelstul CSVs: goals, bookings (cards), substitutions,
penalty kicks (shootouts), and awards. Also resolves source-backed
`Tournament.goalsCount` and `runnerUpTeamId` (losing finalist of the decided
final). Raw source records now cover all 13 selected datasets. Source quirks
are logged in `docs/DATA_ISSUES.md` (ISSUE-006…008).

**Checkpoint 4D — query layer and stats foundation (complete):** typed
server-side query layer under `src/server/queries/` (home, tournaments,
matches, countries, players, records) returning frontend-friendly DTOs
(`types.ts`) — no raw Prisma models or `RawSourceRecord` payloads reach
pages. Includes a records/leaderboard foundation computed strictly from
imported data, a dev-only `/api/dev/data-summary` route, and a page-query
verification script (`pnpm data:verify:queries`).

**Next:** Checkpoint 5 builds DB-backed pages on top of these query
functions (`getHomePageData`, `getTournamentByYear`, `getMatchByIdOrSlug`,
`getCountryProfile`, `getPlayerProfile`, `getRecordsOverview`).

### Deliverables

- Import scripts under `scripts/import/`
- Source data downloaded or documented for download from Fjelstul World Cup Database
- Prisma seed script (`prisma/seed.ts`) that runs the import pipeline
- Basic data verification scripts under `scripts/verify/`

### Acceptance criteria

- `pnpm prisma db seed` completes without errors
- All tournaments (1930–present) have records in the database
- At least one tournament (1986) has full match, goal, card, and squad data
- Verification scripts report no critical data errors
- No invented data — all values traceable to a source
- Any source conflicts logged in `docs/DATA_ISSUES.md`

---

## Checkpoint 5 — First real vertical slice

**Status: in progress — 5A complete**

### Checkpoint 5A — DB-backed home and tournaments list (complete)

- `/` now renders from `getHomePageData()`: real archive stats, latest
  tournaments, recent finals, top nations, top scorers, and record
  leaderboard previews. Empty sections render an honest `EmptyState`
  instead of fake data.
- `/tournaments` renders from `getTournamentCards()` with loading and error
  states.
- `src/lib/mock-data.ts` deleted — no mock or hardcoded historical values
  remain in production pages.

### Checkpoint 5B — Tournament detail page (complete)

- `/tournaments/[year]` renders from `getTournamentByYear(year)`: hero
  (name, host, dates, champions/runners-up/final chips, breadcrumb), stat
  grid (teams, matches, goals, cards, substitutions, shootouts, shootout
  kicks, awards), anchor section nav, teams grid, stage-grouped match list
  (linking to future `/matches/[slug]` routes), top scorers, awards, and
  penalty shootout section.
- Invalid or missing years render a `not-found` state; route has skeleton
  loading and a client error boundary.
- Group standings / knockout bracket views are deliberately deferred until
  standings/bracket queries exist (honest placeholder text, no invented
  standings).

### Checkpoint 5C — Match detail page (complete)

- `/matches/[idOrSlug]` renders from `getMatchByIdOrSlug` (accepts database
  id, slug, or source id): hero with scoreline, penalty score, winner/draw
  chips and breadcrumb; match info grid (date, stage, stadium, location,
  match number — referee/attendance render only when imported data exists);
  chronological event timeline (goals, own goals, penalty goals, cards,
  one-sided substitution records); per-category event breakdown; penalty
  shootout view grouped by team (✓/✕ per kick, honest note when shootout
  rows are missing); related links to the tournament and both nations.
- Lineups/formations deliberately deferred (honest placeholder note — no
  invented lineups). Route has skeleton loading, client error boundary, and
  a not-found state.

### Checkpoint 5D — Countries index and country profile (complete)

- `/countries` renders from `getCountryCards()`: nation grid with
  tournaments/matches/goals/titles counts.
- `/countries/[slug]` renders from `getCountryProfile(slug)`: hero (titles,
  finals, W/D/L chips), all-time record stat grid (tournaments, titles,
  finals, matches, W/D/L, goals for/against, goal difference), tournament
  timeline (Champions/Runners-up from tournament fields only — no invented
  finishes), finals list (won/lost from the match winner), top scorers, and
  a recent-matches list with W/D/L chips linking to match pages.
- Derivations: titles via `Tournament.winnerTeamId` (counts 1950 correctly,
  which had no final); W/D/L via match winner (shootout wins count as wins);
  per-tournament finish beyond champions/runners-up is NOT derived (the
  source `performance` column is not normalized). Squad data is never
  labeled "appearances".
- Country links from match pages and the homepage now resolve.

### Checkpoint 5E — Players index and player profile (complete)

- `/players` renders from `getPlayerCards()` + `getPlayerCount()`: first 60
  players alphabetically with squads/goals/awards counts and an honest
  "showing N of total" note (search/filters arrive with global search).
- `/players/[slug]` renders from `getPlayerProfile(slug)`: hero (country
  link, position, date of birth, squads/goals/cards/penalties/awards
  chips), World Cup Record stat grid, **World Cup Squads** (squad
  selections — explicitly NOT appearances), goals, cards, penalty kicks,
  substitutions (in/out), and awards — every event row links to its match.
- Data honesty: no appearances, caps, minutes, assists, or lineups are
  derived (not in source). Opponent is omitted for own goals (ambiguous).
- Player links from tournament/country/match pages now resolve.

### Checkpoint 5F — Records page (complete)

- `/records` renders from the restructured `getRecordsOverview()`: hero with
  a data-driven scope note ("All imported tournaments" — counts of men's and
  women's editions computed from actual tournament names), four highlight
  record cards, and six categories: Team (titles, goals, wins, matches by
  nation), Player (top scorers, most awards), Match (highest-scoring,
  biggest wins, most goals by one team), Tournament (goals/matches/teams),
  Penalty (longest shootouts, most converted, most missed-or-saved), and
  Discipline (cards by player/nation/match).
- Every record item links to its real player/country/match/tournament page
  via an explicit `href` (null when no slug exists). Not implemented because
  the data is absent: appearances/caps, minutes, assists, clean sheets.
- Homepage records preview adapted to the new categorized shape.

### Checkpoint 5F.1 — Matches index page (complete)

- `/matches` (previously an unrouted navbar link) renders from the new
  `getMatchCards()` query: newest tournaments first, 60 most recent match
  cards with an honest "showing N of total" note, loading/error states.
  Query supports page/pageSize/tournamentYear for later use; advanced
  filters arrive with the data explorer.

### Checkpoint 5G — Data Explorer shell (complete)

- `/explorer` renders from the new `getExplorerData()` query: matches,
  goals, bookings, substitutions, penalty kicks, and awards normalized into
  one `ExplorerRowDto` shape, browsable in an MUI X Data Grid (Community)
  with server-side pagination. Event-type and tournament-year filters and
  page size are URL query params (shareable links); rows link to match,
  player, and tournament pages.
- Combined-view pagination merges identically-sorted windows from each
  event table (year desc, date desc, minute asc — matches sort before their
  own events). Raw source rows are not exposed (stated on the page and
  checked by the verify script).
- Deferred: full-text search (Meilisearch checkpoint), country/player
  filters, CSV/JSON export.

### Checkpoint 6A — Meilisearch indexing + global search (complete)

> **Superseded (2026-08-31):** search was migrated off Meilisearch to
> Postgres full-text + `pg_trgm` (`SearchDocument` table,
> `src/server/search/postgresSearch.ts`, `pnpm search:index` →
> `scripts/search/build-postgres-index.ts`) to eliminate search-service
> cost. The document builders and `/api/search` route survive; the notes
> below describe the original Meilisearch implementation.

- Single index `worldcup_atlas_search` (typed documents grouped client-side):
  tournaments, countries, players, matches, record leaderboards, and a
  curated event set (goals, shootout penalty kicks, awards — bookings and
  substitutions stay in the explorer to keep the index focused). Documents
  are built from normalized tables/the query layer only — RawSourceRecord
  is never indexed.
- `pnpm search:index` (re)builds settings + documents and waits for tasks;
  `pnpm search:verify` checks common queries. Both are ESM `.mts` scripts
  (meilisearch v0.58 is ESM-only).
- `/api/search?q=…` returns grouped JSON (503 with a clear message when
  Meilisearch is down — pages never depend on search availability).
- `GlobalSearch` is now live: debounced (300ms, min 2 chars) grouped
  dropdown with loading/empty/error states; Enter opens the first result,
  Escape closes.

### Checkpoint 6B — Data Explorer enhancements + exports (complete)

- `/explorer` filters extended to: event type, tournament year, country,
  player (capped option list — players with recorded events, max 200),
  stage, and a text query — all URL-driven and bookmarkable. Filtering is
  DB-side per event type (shared where-builders for fetch + count), keeping
  the windowed merge-pagination correct. Structural rules: playerSlug
  excludes Match rows; stage excludes Award rows.
- `/api/explorer` returns the same filtered JSON. `/api/export/explorer`
  exports CSV (default, with proper escaping and attachment headers) or
  JSON, respecting filters, capped at 5,000 rows with an
  `X-Export-Truncated` header when clipped.
- Export buttons on the explorer summary carry the current filters.
  Verified by `pnpm export:verify` plus 7 new explorer checks in
  `pnpm data:verify:queries`. RawSourceRecord is never exposed.

### Checkpoint 7A — SEO, attribution, and production polish (complete)

- Central site config (`src/lib/site.ts`); root metadata with title
  template, metadataBase, Open Graph/Twitter defaults; standardized
  human-readable titles on every index and detail page.
- `/sources` (full CC-BY-SA 4.0 attribution per the source license: author,
  © 2023 notice, license link, repository link, modification notice, plus
  transformations and known limitations) and `/about` pages; footer now
  carries all nav links, the independence disclaimer, and an attribution
  pointer.
- **License correction**: the Fjelstul World Cup Database is CC-BY-SA 4.0
  (verified against the source repository) — docs, manifest constant, and
  script headers previously said CC BY 4.0 and were corrected.
- `sitemap.xml` (static + all tournament/match/country/player detail URLs
  from the database), `robots.txt` (API routes disallowed), web app
  manifest, app-level not-found and error pages.
- `docs/DEPLOYMENT.md`, rewritten `README.md`, and `pnpm public:verify`
  (route files, site config, robots policy, sitemap sanity).

### Checkpoint 7B — UI polish, accessibility, and smoke tests (complete)

- Accessibility: theme-level visible keyboard focus (gold outline) for all
  links/buttons/card actions; navbar uses the shared site config (adds the
  previously missing About link), `aria-current` on the active link, and a
  labeled brand link; search dropdown announced via `aria-live`. Card-type
  meaning was already text-labeled (not color-only) — verified.
- Streaming not-found caveat investigated: detail routes still return 200
  with correct not-found UI (loading boundary streams the shell first).
  Mitigated with `robots: noindex` on the fallback metadata of all four
  dynamic detail routes; documented in `docs/DEPLOYMENT.md`. The global
  catch-all returns a true 404.
- Playwright smoke suite (`pnpm test:e2e`): all 9 static routes (heading +
  footer disclaimer), `/api/health`, four representative detail pages
  (1986, the 1986 final, Argentina, Maradona), explorer URL filters, global
  404 status, sitemap/robots content. `webServer` reuses a running dev
  server locally.
- `pnpm public:verify` extended: every nav/footer link target must have a
  route file; 26 loading/error/not-found state files audited.

### Checkpoint 7C — Professional visual redesign system (complete)

- **Typography**: Playfair serif replaced with Space Grotesk
  (`--font-display`) for headings, scorelines, and stats; Inter body at
  15–17px; eyebrow label system (small caps, 0.14em); tabular numerals on
  all data numbers; raw stage strings now display through `formatStage()`.
- **Theme/tokens** (`src/theme/tokens.ts` rewritten): restrained palette —
  base `#050A12`, surfaces `#0D1828/#122238/#172A44`, slate hairline
  borders, gold `#F4C95D` + soft `#D6A84F`, single cyan data accent
  `#38BDF8`, semantic green `#22C55E`; purple and neon green removed.
  De-MUI'd component defaults: cards (gradient panel, 12px radius, soft
  shadow), buttons, chips (22px small, 7px radius), breadcrumbs, selects,
  focused inputs (cyan ring), table cells.
- **Layout system**: shared `HeroSurface` + `PageHeader` (used by all four
  index pages, explorer, sources, about); navbar rebuilt (brand tile, gold
  underline active state, mobile overflow fade); editorial three-column
  footer (disclaimer + attribution intact); `SectionHeading` with eyebrow;
  `EmptyState` with icon panel instead of dashed placeholder.
- **Cards**: shared anatomy (eyebrow → title → key stat → metadata → CTA);
  number-first StatCard/RecordStatCard (record value is now the hero; fixed
  mid-score line-break bug with word joiners); PlayerCard letter avatar
  replaced by flag + position tile; CountryCard flags + trophy mark;
  homepage now passes flags through.
- **Match center**: scoreboard rebuilt as a composed panel — eyebrow
  (tournament · stage · date), 3.2–4.5rem tabular score, winner/penalties
  chips; match info grid stage-formatted.
- **Tables**: leaderboards became ranked panels with proportional bars
  (scaled to #1) and gold top-3; explorer chips moved to a tint tier system
  (penalty kick de-alarmed to cyan tint, substitution to green tint, Award
  ghost); DataGrid header/footer chrome, uppercase tracked headers, cyan
  row hover; timeline sub chips tinted (literal card colors kept).
- **Search**: cyan focus ring + icon accent on the new surfaces; grouped
  dropdown panel restyled; loading shimmer retained (static under reduced
  motion).
- Motion additions intentionally deferred — see Checkpoint 7D.

### Checkpoint 7D — Motion + football constellation (complete)

- `motion` package with app-wide `MotionConfig reducedMotion="user"`
  (`MotionProvider` in the provider tree); primitives extended to the 7D
  spec: `FadeIn` (delay/y/once/duration), `StaggerContainer`
  (staggerChildren + delayChildren), `MotionCard`, `ParallaxLayer`
  (yRange/xRange/opacityRange with legacy drift alias), `PageTransition`.
- `FootballConstellation` refined and mounted: content-safe layouts (nodes
  live in the right half/top/bottom strips/corners — never over
  headlines; match clusters sit at the far edges since the scoreboard
  panel owns the center), gold+cyan-only palette per the style guide,
  line opacity ≤0.11, deterministic seeded jitter (match slug /
  tournament year), 5–8 mobile nodes via a CSS-hidden desktop group.
- Applied: homepage hero (`hero` + ball node), records hero (`records`),
  match detail hero (`match`, low intensity), explorer header
  (`explorer` via the new PageHeader `decoration` slot), tournament
  detail hero (`subtle`, low intensity).
- Parallax hero orbs retained on the homepage; card hover motion via the
  shared interactive sx (lift + gold border + shadow, reduced-motion
  safe); search dropdown enter/exit, staggered group reveal, and loading
  shimmer retained from 7C.
- Section/timeline reveals deepened: match info grid, penalty shootout,
  event breakdown, related links, all player profile lists, country
  finals/top scorers/match list, and tournament teams/matches/scorers/
  awards now FadeIn at container level (rows never animate
  individually).
- Reduced-motion: static constellation at lower opacity, no drift/pulse,
  no parallax, opacity-only reveals; decorative layers aria-hidden +
  pointer-events none.

### Checkpoint 7C (superseded) — Cinematic motion system + visual upgrade (complete)

- `motion` package with app-wide `MotionConfig reducedMotion="user"`;
  reusable primitives (`FadeIn`, `StaggerContainer`, `ParallaxLayer`,
  `MotionCard`, `PageTransition`) and visual atmosphere components
  (`AtlasBackground`, `HeroOrb`, `PitchLines`).
- Homepage hero rebuilt as a cinematic client component: layered gradient
  atmosphere, pitch lines, parallax floating glow orbs, staggered headline/
  CTA/search entrance. Route content gets a light keyed entrance via
  `PageTransition` in the app shell.
- Section reveals everywhere via `SectionHeading` (one wrap covers the whole
  app); card grids and stat grids stagger in on home, index, records, and
  detail pages; timelines reveal at container level (rows stay stable).
- Card hover system upgraded: gold border, lift, glow shadow, and
  `focus-within` parity across all clickable cards; search dropdown animates
  in/out with `AnimatePresence`; buttons get a gold glow hover.
- Performance/a11y guardrails: transform/opacity only, parallax limited to
  the hero, no per-row table animation, reduced-motion honored at three
  levels (MotionConfig, `useReducedMotion` guards, CSS fallback).
- **Visual upgrade pass — "Cinematic Football Intelligence"**: design token
  system in `src/theme/tokens.ts` (base `#050B14`, border `#263B56`,
  electric cyan `#22D3EE` for interaction/search/data, pitch neon green
  `#A3E635` for positive stats, rare purple `#8B5CF6` glow depth; gold
  stays the brand color). Theme-level premium card panels (gradient
  background, gold border, glow shadows), shared `interactiveCardSx`/
  `glowPanelSx` replacing per-card hover duplication, cyan input focus
  rings, `AtlasBackground`/`HeroOrb`/`PitchLines` reworked with
  cyan/green/purple glow layers (cyan + purple orb variants added).
  GlobalSearch upgraded to a command input: cyan focus glow, animated
  cyan/gold loading shimmer (static strip under reduced motion), staggered
  group reveal, cyan row hover light. Records hero gets full atmosphere;
  leaderboards became premium panels with elevated header strips and
  top-3 gold ranks. Explorer filters framed as a "Query Console" command
  panel; cyan active-filter chips, cyan export buttons, DataGrid depth +
  row hover tint (CSS only). Detail heroes re-lit with gold/cyan/purple
  gradients on the deeper base; match scoreboard gold glow; sub-on /
  converted-penalty markers moved to pitch neon green with dark text
  (labels preserved — meaning never color-only).

- Remaining: standings/bracket views, source reconciliation, deployment
  itself.

### Checkpoint 8F — Responsive Footer + Mobile Navigation Polish (complete)

Mobile/responsive polish — no redesign, no data or schema changes.

- `src/components/layout/Footer.tsx`: replaced the single-column mobile
  stack (which left the footer too tall, loose, and full of blank black)
  with a 2-column link grid on `xs`/`sm` (brand spans full width) and the
  4-up grid on `md+`. Tightened mobile padding/gaps (`pt` 40px, `rowGap`
  32px, attribution `mt` 32px) and gave link rows a ~40px touch target.
  Attribution + independence disclaimer stay visible at every breakpoint.
- `src/components/layout/Navbar.tsx`: the mobile horizontal-scroll nav
  (which cut "Explorer" off behind a fade mask) is replaced by a hamburger
  button + right-anchored black `Drawer` below `md`: stripe accent, brand,
  close button, hairline link rows, ~52px tap targets, left gold active
  stripe (not a pill), closes on navigation. Desktop inline nav unchanged.
- Accessibility: menu/close buttons have `aria-label`; hamburger exposes
  `aria-haspopup`/`aria-expanded`; active route uses `aria-current` plus a
  non-color marker; focus-visible from the global theme still applies.
- Tests: `tests/e2e/responsive-layout.spec.ts` (375×812 + 1280×900) —
  footer brand/disclaimer/attribution visible, footer links reachable,
  hamburger opens and Explorer is navigable, no horizontal overflow on
  key routes, desktop nav inline with no hamburger. Functional checks
  only, no screenshots.
- MUI only; no Tailwind; all routes intact.

### Checkpoint 8E — Brand Assets, Favicon, and Social Banner (complete)

Deployment polish: wired the WORLDCUP Nexus brand artwork through the app.

- Source assets committed under `public/brand`: `worldcup-nexus-icon.png`
  (app/brand icon) and `worldcup-nexus-banner.png` (hero / social banner).
- `scripts/assets/generate-icons.ts` (`pnpm assets:icons`, `sharp` dev
  dependency) generates the variant set from the source icon —
  `public/favicon.ico` (PNG-in-ICO), `public/icon.png` (512),
  `public/apple-icon.png` (180), and `worldcup-nexus-icon-{32,192,512}.png`.
  The source icon is never overwritten; no throwaway sizes are emitted. The
  legacy `src/app/favicon.ico` was removed to avoid the `/favicon.ico` route
  conflict with the generated public asset.
- `src/app/layout.tsx` metadata: `icons` (icon / shortcut / apple) plus
  Open Graph and Twitter (`summary_large_image`) images pointing at the
  banner; `src/lib/site.ts` holds the asset paths. `src/app/manifest.ts`
  now ships the 192/512 PWA icons.
- Homepage hero (`src/app/page.tsx`) uses the banner as a right-weighted
  `next/image` backdrop (`priority`, meaningful `alt`) behind an
  `aria-hidden` dark gradient — the semantic `<h1>`/subtitle and the
  black-canvas Vault layout are unchanged. Banner is not added to every page.
- `scripts/verify/verify-public-routes.ts` checks the required brand assets
  exist and that the manifest references on-disk icons.
- No data logic, Prisma schema, Docker, or import scripts touched. No
  official FIFA branding introduced.

### Checkpoint 8A — Security audit (complete)

- Static code/configuration audit of the full public surface: API
  routes, server layer, input parsing, rendering, configuration,
  scripts, dependency tree. No code changes — findings and remediation
  sequencing only.
- Deliverables: `docs/SECURITY_AUDIT.md` (no critical findings; overall
  risk Medium pre-hardening) and `docs/SECURITY_HARDENING_PLAN.md`
  (P0/P1/P2 sequenced plan).

### Checkpoint 8B — Security hardening implementation (complete)

- P0.1 production-safe API errors (`src/server/security/api-errors.ts`;
  `detail` is development-only, full errors logged server-side).
- P0.2 baseline security headers + Report-Only CSP in `next.config.ts`
  (HSTS emitted only in production).
- P0.3 CSV formula-injection neutralization in
  `src/server/exports/csv.ts`.
- P1.1 in-memory fixed-window API rate limiting
  (`src/server/security/rate-limit.ts`: search/explorer 60/min, export
  6/min, health 120/min; 429 + Retry-After).
- P1.2 search query cap (200 chars, service-level); P1.3 sitemap
  `revalidate = 86400`; P1.4 dependency advisories cleared via
  `pnpm.overrides` (audit clean); P1.5 `/privacy` page + footer link.
- Housekeeping: `SECURITY.md`, export renamed to
  `worldcup-nexus-explorer.csv`, `pnpm security:verify` suite, e2e
  coverage for headers/privacy/export filename (20 tests).

### Checkpoint 8C — Deployment preparation (complete)

- `docs/DEPLOYMENT.md` rewritten as the production guide (recommended
  Vercel + hosted PostgreSQL + private Meilisearch architecture, env
  var table, migration/import/index workflows, security checklist,
  rollback, smoke tests, known limitations).
- New docs: `docs/PRODUCTION_RUNBOOK.md` (step-by-step launch),
  `docs/VERCEL_DEPLOYMENT.md`, `docs/DATABASE_PRODUCTION.md`,
  `docs/MEILISEARCH_PRODUCTION.md`.
- `.env.production.example` (placeholders only) + annotated
  `.env.example`; `.gitignore` keeps both templates tracked.
- Scripts: `db:deploy` (prisma migrate deploy), `prod:preflight`
  (`scripts/verify/verify-production-readiness.ts` — static
  deployment-readiness checks, no live services), `prod:validate`
  (full verification gate).
- `.github/workflows/ci.yml`: static CI (typecheck, lint,
  security:verify, preflight, audit, build against an empty migrated
  Postgres service). Data-dependent suites stay local by design.
- Deployment itself is deliberately NOT performed in this checkpoint.

### Checkpoint 7C Revised — World Cup Vault Editorial Redesign (complete)

The UI follows the uploaded World Cup Vault references and the design.md
black-canvas editorial system: true-black canvas, Saira Condensed
uppercase display over Inter 300 body, 1px hairlines, zero radius
everywhere, restrained gold accents, the green/gold/red identity stripe
(brand mark only), Vault primitives in `src/components/vault/`, the
PDF-structured homepage (derived archive span, tournament timeline,
finals rows), dossier detail pages, and the structured black footer with
CC-BY-SA attribution. Motion/constellation effects remain parked until
the visual foundation is stable.

### Checkpoint 7D — Vault Archive Controls + Page Filters (complete)

URL-driven, bookmarkable filtering across the archive in the Vault
editorial style (no rounded SaaS pills, no sidebar chrome):

- **Reusable filter system** (`src/components/filters/`): VaultFilterBar
  (hairline panel, uppercase label, result count), VaultSearchInput
  (48px zero-radius, commits on Enter/blur, clear button), VaultSelect
  (URL-bound, always an "All" option, options from the query layer),
  VaultActiveFilters (rectangular labels + clear all), VaultPager
  (server-rendered PREV/NEXT preserving params), useUrlFilters (client
  hook: preserves unrelated params, resets page on filter change).
  Mobile = stacked controls; no drawer needed.
- **Safe param parsing** (`src/lib/search-params.ts`): string/number/
  boolean/enum/pagination helpers that ignore or normalize bad input —
  pages never throw on malformed URLs.
- **Query layer**: `getTournamentIndex` (q/yearFrom/yearTo/host/winner +
  5 sorts, in-memory over the cards, options from actual rows);
  `getMatchCards` extended (q over teams/stage/stadium/year,
  countrySlug via team→country, stage, decidedByPenalties, 4 sorts —
  score-derived sorts rank filtered ids in memory then fetch the page) +
  `getMatchFilterMeta` (years/countries/distinct stages);
  `getCountryIndex` (q/hasTitles/minTournaments + 5 sorts — titles from
  source-resolved winnerTeamId, safe to filter); `getPlayerIndex`
  (q/countrySlug/position/hasGoals/hasAwards/hasCards, paged, 5 sorts —
  "most goals" via own-goal-excluding groupBy, labeled on the page).
- **Pages**: /tournaments, /matches, /countries, /players each carry an
  ARCHIVE CONTROLS bar with filtered counts and honest empty states;
  /records gets uppercase category tabs (hairline underline) + record
  search that narrows whole leaderboards (entries are never trimmed);
  /explorer's Query Console now composes the same Vault filter
  components (API/export untouched).
- **Detail page local filters**: tournament match list (q/stage/
  teamSlug), country match list (q/tournamentYear/stage/result W-D-L
  from the source-backed result field), player event sections
  (q/tournamentYear/eventType — squads history never trimmed). Match
  detail event filter deliberately deferred as future polish.
- **Verification**: `pnpm data:verify:queries` gains 7D checks — year/
  country/penalty filter correctness, sort order assertions, q lookups
  (soft where naming-dependent), and bad-param tolerance.

### Deliverables

Pages wired to live database:

- `/` — Home with real stats and featured tournament
- `/tournaments` — All tournaments list from DB
- `/tournaments/1986` — 1986 tournament detail
- `/tournaments/1986/matches/[matchId]` — 1986 final match detail
- `/countries/brazil` — Brazil country page
- `/players/diego-maradona` — Diego Maradona player page

### Acceptance criteria

- All six pages render without errors using real DB data
- No mock data labels visible in production paths
- Meilisearch index populated; search returns results for "Maradona" and "Brazil"
- TypeScript passes
- ESLint passes
- Build passes (`pnpm build`)
- No official FIFA branding or affiliation claims

---

## Checkpoint 6 — Search and data explorer

**Status: not started**

### Deliverables

- `/search` — Full global search page with Meilisearch integration
- `/explorer` — Data explorer with MUI X Data Grid, filters, and pagination
- Search index covers: tournaments, matches, countries, players
- Explorer covers: matches, goals, cards

### Acceptance criteria

- Search returns relevant results across all indexed entities
- Explorer renders large datasets without performance degradation
- Filters work correctly with URL state (shareable URLs)
- TypeScript passes
- ESLint passes
- Build passes

---

## Checkpoint 7 — Full MVP polish and deployment

**Status: not started**

### Deliverables

- All MVP pages from `docs/MVP_SCOPE.md` complete
- `/about` and `/data` pages with attribution and legal copy
- Performance audit (Core Web Vitals acceptable)
- `README.md` updated with setup instructions
- Deployment configuration (Vercel or equivalent)
- Environment variable documentation complete

### Acceptance criteria

- All MVP pages listed in `docs/MVP_SCOPE.md` render without errors
- Lighthouse performance score ≥ 80 on key pages
- No TypeScript errors
- No ESLint errors
- Build passes
- Deployment succeeds
- Data attribution is visible and accurate
- No official FIFA branding introduced
