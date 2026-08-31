# WORLDCUP Nexus Tech Stack

## App

- Framework: Next.js App Router
- Language: TypeScript
- UI system: MUI
- Styling: MUI theme, sx prop, styled API
- Tables: MUI X Data Grid Community
- Icons: MUI Icons
- Package manager: pnpm

## Backend

- Backend layer: Next.js Route Handlers and server-side services
- ORM: Prisma
- Database: PostgreSQL
- Search: PostgreSQL full-text search + pg_trgm (SearchDocument table — no external search service)
- Validation: Zod
- Exports: custom CSV/JSON API routes

## Local Infrastructure

- Docker Compose
- PostgreSQL container
- (search runs inside PostgreSQL — no separate search container)

## Testing

- TypeScript
- ESLint
- Prettier
- Vitest
- Playwright

## Product Rule

WORLDCUP Nexus is an independent historical archive. Do not use official FIFA logos or present the product as officially affiliated with FIFA.UI_STYLE_GUIDE.md
