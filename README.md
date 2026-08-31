# WORLDCUP Nexus

**Every World Cup. Every Era. Every Legend.**

WORLDCUP Nexus is an independent historical archive of the FIFA World Cup:
every imported tournament, nation, player, match, goal, card, substitution,
and penalty — browsable, searchable, and exportable.

> WORLDCUP Nexus is an independent project and is **not affiliated with
> FIFA**.

## Tech stack

- Next.js (App Router) + TypeScript
- MUI (+ MUI X Data Grid Community)
- Prisma 7 + PostgreSQL
- PostgreSQL full-text search + pg_trgm (global search — no external search service)
- Docker Compose (local infrastructure)
- pnpm, Vitest, Playwright, ESLint, Prettier

## Quickstart

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm prisma migrate dev
pnpm data:download
pnpm data:import -- --reset
pnpm search:index
pnpm dev
```

Open http://localhost:3000.

## Key commands

| Command                    | Purpose                               |
| -------------------------- | ------------------------------------- |
| `pnpm dev` / `build`       | Run / build the app                   |
| `pnpm assets:icons`        | Generate favicon/PWA icon variants    |
| `pnpm data:download`       | Cache source CSVs                     |
| `pnpm data:import`         | Normalize source data into PostgreSQL |
| `pnpm search:index`        | Build the Postgres search index       |
| `pnpm data:verify`         | Data integrity checks                 |
| `pnpm data:verify:queries` | Page query layer checks               |
| `pnpm search:verify`       | Search checks                         |
| `pnpm export:verify`       | Export (CSV/JSON) checks              |
| `pnpm public:verify`       | Public route / SEO file checks        |
| `pnpm security:verify`     | Security hardening checks             |
| `pnpm prod:preflight`      | Static deployment-readiness checks    |
| `pnpm prod:validate`       | Full pre-deploy validation gate       |
| `pnpm db:deploy`           | Apply migrations (production/staging) |

## Recommended local validation

```bash
pnpm prod:preflight
pnpm prod:validate    # all verify suites + typecheck + lint + build + e2e
```

## Deployment

The app deploys as a read-only public web app; migrations, data import,
and search indexing run separately from a trusted admin environment —
never through public APIs. Run `pnpm prod:preflight` and
`pnpm prod:validate` before any deploy.

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — architecture, env vars, workflows
- [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) — step-by-step launch
- [docs/VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md) — Vercel notes
- [docs/DATABASE_PRODUCTION.md](docs/DATABASE_PRODUCTION.md) — PostgreSQL notes
- [docs/SEARCH_PRODUCTION.md](docs/SEARCH_PRODUCTION.md) — Postgres-backed search notes

Never commit secrets (`.env*` is git-ignored; templates are
`.env.example` and `.env.production.example`). The `/sources`
attribution (CC-BY-SA 4.0 license requirement), `/privacy` page, and the
independence disclaimer must remain in any deployment.

## Status

Checkpoints 1–8C complete: app shell, data pipeline (download → import →
verify), query layer, DB-backed pages (home, tournaments, matches,
countries, players, records, explorer), Postgres-backed global search, explorer
filters + CSV/JSON export, SEO/attribution polish, Vault editorial visual
system, security audit + hardening, and deployment preparation. Remaining
roadmap: the production deployment itself, standings/bracket views, source
reconciliation.

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the full
checkpoint log.

## Brand assets

Brand artwork lives in [public/brand](public/brand). Two source files are
committed:

- `public/brand/worldcup-nexus-icon.png` — source app/brand icon
- `public/brand/worldcup-nexus-banner.png` — wide hero / social banner

The favicon and PWA/Apple icon variants are **generated** from the source
icon with `pnpm assets:icons` (uses `sharp`). Run it before building if the
variants are missing; it writes `public/favicon.ico`, `public/icon.png`,
`public/apple-icon.png`, and the `worldcup-nexus-icon-{32,192,512}.png`
variants under `public/brand`. The banner is used for the homepage hero and
for Open Graph / Twitter social previews (see `src/app/layout.tsx`).

No official FIFA logos or branding are used — the marks are WORLDCUP Nexus's
own, and the site never implies FIFA affiliation.

## Data source and attribution

All historical data comes from the
[Fjelstul World Cup Database](https://www.github.com/jfjelstul/worldcup) by
Joshua C. Fjelstul, Ph.D. — © 2023 Joshua C. Fjelstul, Ph.D., published
under the
[CC-BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/legalcode).
WORLDCUP Nexus normalizes the original CSVs into a relational database and
derives display fields and aggregates; modifications are documented in
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and
[docs/DATA_ISSUES.md](docs/DATA_ISSUES.md). Attribution details are also on
the in-app [Sources page](http://localhost:3000/sources).