# AGENTS.md

## Project

WORLDCUP Nexus is an independent historical archive of the FIFA World Cup.

It contains data for tournaments, countries, players, matches, goals, cards, substitutions, penalties, squads, records, and historical exploration.

The product should feel like a premium digital football museum, not a betting site and not an official FIFA product.

## Source of truth

- Read `docs/TECH_STACK.md` before making architecture decisions.
- Read `docs/UI_STYLE_GUIDE.md` before building UI.
- Read `docs/DATA_MODEL.md` before changing database models once it exists.
- Read `docs/DATA_SOURCES.md` before changing import or attribution logic once it exists.
- Do not invent historical stats.

## Tech stack

- Next.js App Router
- TypeScript
- MUI
- MUI X Data Grid
- Prisma
- PostgreSQL
- PostgreSQL full-text search + pg_trgm (no external search service)
- pnpm

## UI rules

- Use MUI only.
- Do not add Tailwind CSS.
- Use `src/theme/theme.ts` for the base theme and `src/theme/visualTokens.ts`
  for the premium "Neon Atlas" surface language.
- Use `sx`, `styled`, and MUI theme overrides.
- Keep the visual style a deep-blue stadium-at-night canvas with trophy-gold and
  electric-cyan glow accents. Premium surfaces (homepage and similar) use rounded
  glow cards, gradient fills, and gold/cyan neon highlights; interior archive
  pages keep a calmer dark layout but share the same palette. See
  `docs/UI_STYLE_GUIDE.md`.
- Do not use official FIFA logos or imply official FIFA affiliation.

## Next.js rules

- Use the App Router.
- Prefer server components by default.
- Use client components only for interactivity.
- Do not call internal API routes from server components when direct server-side queries are available.
- Use route handlers for search, explorer filters, exports, and public API-style endpoints.

## Data rules

- No hardcoded real historical totals in production UI.
- Keep source-backed data.
- Add verification scripts for important facts.
- Document source conflicts in `docs/DATA_ISSUES.md`.

## Commands

- Install: `pnpm install`
- Dev server: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Format: `pnpm format`

## Validation

Before marking work complete:

- TypeScript passes
- ESLint passes
- Build passes for route/layout/config changes
- Data verification passes for import/stat changes
- No official FIFA branding was introduced