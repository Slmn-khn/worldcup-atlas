# GitHub Copilot Instructions for WORLDCUP Nexus

Follow `AGENTS.md`.

WORLDCUP Nexus is a Next.js App Router + TypeScript + MUI application for a historical World Cup archive.

Rules:

- Use MUI, not Tailwind.
- Use Prisma and PostgreSQL for persisted data.
- Use Postgres-backed search (SearchDocument table, full-text + pg_trgm) for global search.
- Do not hardcode historical statistics.
- Do not invent data.
- Prefer server components unless client-side interactivity is required.
- Build reusable components.
- Keep styling consistent with the dark navy, charcoal, and gold museum/archive direction.
- Do not use official FIFA logos or imply official FIFA affiliation.
- Add or update verification scripts when changing data logic.