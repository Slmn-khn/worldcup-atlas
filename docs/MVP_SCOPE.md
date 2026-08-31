# WORLDCUP Nexus — MVP Scope

## Product definition

WORLDCUP Nexus is an independent historical archive of the FIFA World Cup.

## MVP pages

### Core browsing

- `/` — Home: hero, summary stats, featured tournament, recent additions
- `/tournaments` — All tournaments list (1930–present)
- `/tournaments/[year]` — Tournament detail: overview, group stage, knockout bracket, top scorers, squad list
- `/tournaments/[year]/matches/[matchId]` — Match detail: lineups, goals, cards, substitutions
- `/countries` — All nations list
- `/countries/[slug]` — Country detail: history, appearances, wins, players, matches
- `/players` — Players list with filter/search
- `/players/[slug]` — Player detail: biography, stats, tournaments, goals, cards
- `/search` — Global search (Postgres full-text + pg_trgm)

### Data explorer

- `/explorer` — Filterable data grid across entities (tournaments, matches, goals, cards)

### Legal and meta

- `/about` — Project description, data attribution, legal disclaimer
- `/data` — Data sources, methodology, known issues

## Non-MVP features

The following are out of scope for MVP and must not be built prematurely:

- User accounts, authentication, or favourites
- API key management or public API docs
- Real-time scores or live data
- Social sharing or embeds
- Mobile app
- Multi-language / i18n
- Comments or community features
- Advertising or sponsorship placements
- Predictions or simulations
- Comparison tool
- Export to PDF

## First vertical slice (Checkpoint 5)

The first full end-to-end slice to validate the data pipeline and UI system:

| Entity           | Page                                   |
| ---------------- | -------------------------------------- |
| Home             | `/`                                    |
| All tournaments  | `/tournaments`                         |
| 1986 tournament  | `/tournaments/1986`                    |
| 1986 final match | `/tournaments/1986/matches/[final-id]` |
| Brazil           | `/countries/brazil`                    |
| Diego Maradona   | `/players/diego-maradona`              |

This slice was chosen because 1986 is data-rich (Maradona, "Hand of God", golden boot) and validates: tournament structure, knockout matches, player cross-referencing, and country pages.

## Success criteria

### Data

- All tournaments from 1930 to present are represented
- Goals, cards, substitutions, and squads are importable from source data
- No invented historical data anywhere in production UI

### UI

- Home, tournament, match, country, and player pages render without errors
- TypeScript and ESLint pass with no suppressions
- Build passes (no runtime errors at build time)
- All pages are mobile-responsive via MUI breakpoints

### Search

- Global search returns relevant results for tournaments, countries, and players
- Search index is populated from the database after import

### Quality

- No official FIFA logos or affiliation claims
- All data attributed to sources per `docs/DATA_SOURCES.md`
- Known data conflicts logged in `docs/DATA_ISSUES.md`
