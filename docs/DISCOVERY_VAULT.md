# Discovery Vault

## Purpose

The Discovery Vault is a curated archive of World Cup facts, records, and
stories, surfaced as a rotating "Fact of the Hour" on the homepage plus a
searchable `/facts` archive. Facts can carry an optional mini quiz block and
progress is tracked with lightweight, account-free gamification (below). It
is a premium editorial layer on top of the existing football data — not a
betting site, and not affiliated with FIFA.

## Fact statuses

| Status | Meaning | Public? |
| --- | --- | --- |
| `DRAFT` | Being written; not reviewed. | No |
| `NEEDS_REVIEW` | Written but not yet confirmed against a source. | No |
| `PUBLISHED` | Reviewed and confirmed — safe to show publicly. | **Yes** |
| `ARCHIVED` | Previously published, intentionally retired. | No |
| `REJECTED` | Failed review (inaccurate, unverifiable, out of scope). | No |

Every public query in `src/server/facts/queries.ts` filters to
`status: PUBLISHED`. No other code path is allowed to expose a fact publicly.

## Verification rules

A fact also carries a `verificationStatus`:

- `UNVERIFIED` / `NEEDS_REVIEW` — not yet confirmed.
- `DB_VERIFIED` — confirmed directly against the WORLDCUP Nexus database
  (e.g. counting title years from the `Tournament` model).
- `SOURCE_VERIFIED` — confirmed against an external published source
  (Wikipedia, FIFA, the Fjelstul dataset, etc.).
- `MANUALLY_VERIFIED` — confirmed by a human researcher without a single
  citable source (used sparingly).

**A fact cannot be seeded or saved as `PUBLISHED` unless its
`verificationStatus` is `DB_VERIFIED`, `SOURCE_VERIFIED`, or
`MANUALLY_VERIFIED`.** This is enforced in the seed schema
(`src/server/facts/seedSchema.ts`) — see
`data/facts/starter-facts.json`'s `maracana-1950-attendance-disputed` entry
for an example of a fact held at `NEEDS_REVIEW` because its central number is
genuinely disputed.

Every fact also requires at least one `FactSource` row with a `url` and/or
`notes` — a fact with no source note is refused by the seed schema outright.

## Hourly rotation

`getHourlyFact` (`src/server/facts/rotation.ts`) is the single entry point
the homepage calls for the "Fact of the Hour." It tries two strategies, in
order:

1. **Scheduled (`FactRotation`)** — if a `FactRotation` row's
   `[slotStartAt, slotEndAt)` window contains `now` and its fact is still
   `PUBLISHED`, that fact is used. This is the Phase 2 path: slots are
   generated ahead of time by the cron job below, so the "current fact" is a
   cheap indexed lookup, not a computation.
2. **Deterministic fallback (Phase 1)** — if no slot has been scheduled for
   this hour yet (cron hasn't run, or the DB is empty of rotations), or the
   scheduled fact is no longer published, `getHourlyFact` falls back to
   `selectHourlyFact`: a pure function of the current UTC hour and the
   published-fact pool, computed on the fly with no DB writes.
   - `getUtcHourBucket(now)` — whole hours elapsed since the Unix epoch, UTC.
   - `hourBucket % CATEGORY_ORDER.length` selects this hour's category from a
     fixed rotation (`HISTORY → RECORD → ICONIC_MOMENT → PLAYER_COMPARISON →
     COUNTRY_COMPARISON → FINAL → PENALTY → FORMAT → HOST → SCHEDULE_2026 →
     FUN_FACT`).
   - Facts in that category are sorted by `qualityScore` desc, then `slug`
     asc; `Math.floor(hourBucket / CATEGORY_ORDER.length) % pool.length`
     picks which fact in that category is shown, cycling over time.
   - If the hour's category currently has no published facts, the whole
     published pool is used instead.
3. If there are **no published facts at all**, `getHourlyFact` returns `null`
   and the homepage renders the "Discovery Vault facts are being prepared."
   empty state instead of crashing.

`selectHourlyFact` and `planFactRotationSlots` (below) are both exported as
pure functions (no top-level DB import) specifically so this logic is unit
tested without a database — see `tests/unit/facts/rotation.test.ts` and
`tests/unit/facts/rotationSchedule.test.ts`. The DB-touching functions in
`rotation.ts` and `rotationSchedule.ts` import Prisma/the query layer via a
dynamic `import()` inside their function bodies, so importing either module
never touches the database unless one of those functions is actually called.

## Scheduled rotation (`FactRotation`)

`GET|POST /api/cron/generate-fact-rotations`, protected by `CRON_SECRET`
(shared auth helper: `src/server/security/cron.ts` — `Authorization: Bearer
<secret>` or `?secret=`, fail-closed with no secret configured), generates
the next 72 hourly slots (3 days) starting at the current UTC hour and
upserts them into `FactRotation`, keyed by the unique `slotStartAt`. Deployed
on Vercel Cron daily at 03:00 UTC (`vercel.json`) — three days of lead time
comfortably survives a missed or delayed run.

Selection (`planFactRotationSlots` in `src/server/facts/rotationSchedule.ts`)
is a soft-constraint waterfall evaluated per slot, in order:

1. Not featured in a `FactRotation` slot in the last 30 days, **and** a
   different category than the immediately preceding slot.
2. Not featured in the last 30 days (category repeat allowed) — small pools
   run out of category variety before they run out of fresh facts.
3. Featured recently, but at least a different category than the previous
   slot.
4. Any published fact (last resort — e.g. a single-category or single-fact
   pool).

Within whichever tier has candidates, `isFeatured` facts are preferred first,
then higher `qualityScore`, then `slug` ascending for a deterministic
tie-break. Tiers 1–2 are recorded as `rotationType: SCHEDULED`; tiers 3–4 as
`FALLBACK`, so the generated schedule is honest about where it had to relax a
constraint (visible via `FactRotation.rotationType`). `MANUAL` is reserved
for a future admin override and is never set by the cron job itself.

The "last 30 days" exclusion looks at real, already-elapsed `FactRotation`
rows (`slotStartAt` in `[now − 30d, windowStart)`) — never the slots the
current run is about to (re)write — so re-running the cron never
self-excludes the batch it's generating. Category continuity also looks one
slot further back than the batch itself: the generator seeds
`initialPreviousCategory` from the last `FactRotation` row before the new
window, so the daily job doesn't reset variety at the boundary between
yesterday's schedule and today's.

Re-running the cron is safe: each slot is upserted by its unique
`slotStartAt`, so it simply re-plans the same rolling window rather than
accumulating duplicate rows.

## Starter seed flow

1. Conservative, hand-written facts live in `data/facts/starter-facts.json`.
2. `pnpm facts:seed` (`scripts/facts/seed-starter-facts.ts`) validates every
   record with Zod (`src/server/facts/seedSchema.ts`), upserts by `slug`, and
   replaces that fact's `FactSource`/`FactRelation` rows in place.
3. Invalid records are skipped (with the exact validation issues logged), not
   partially imported.
4. `FactRelation.entityId` is resolved from `entitySlug` against the real
   Player/Country/Tournament/Match tables where possible; an unresolved
   relation is still stored with its slug/label (used for display and for
   "related facts" matching) but a null `entityId`.

Re-running `pnpm facts:seed` is safe — it's a full upsert, not an append.

## Gamification (localStorage only — no accounts, no personal data)

`src/lib/discoveryProgress.ts` is the single client-side store behind every
gamification surface. It reads/writes one `localStorage` key
(`worldcup-nexus:discovery-progress`) and never makes a network call — no
account, no server-side tracking, no personal data leaves the browser.

State shape:

```ts
{
  discovered: { slug, category, tags, discoveredAt }[], // unique by slug
  streak: { current, longest, lastVisitDate },           // local calendar days
  quiz: { attempts, correct },
}
```

- **Discovered facts** — recorded by `MarkFactDiscovered` on fact detail page
  mount (`recordFactDiscovered`). Each entry keeps the fact's `category` and
  `tags` at discovery time so badge progress (below) never needs a follow-up
  fetch of the full catalog.
- **Viewed categories** — derived, not separately stored: `getViewedCategories`
  returns the distinct `category` values across `discovered`.
- **Streak** — `current`/`longest` consecutive local calendar days with at
  least one discovery. Revisiting an already-discovered fact still counts as
  "engaged today" (it just never adds a duplicate `discovered` entry). A
  missed day resets `current` to 1 but never forgets `longest`.
- **Quiz score** — `attempts`/`correct`, incremented once per answered
  `QuizBlock` via `recordQuizAttempt`.

`getProgress`/`getServerProgressSnapshot`/`subscribeToProgress` are built for
`useSyncExternalStore`: the server snapshot is always the empty state (so SSR
never mismatches hydration), and `subscribeToProgress` listens for both
cross-tab `storage` events and a same-tab custom event (`recordFactDiscovered`
and `recordQuizAttempt` dispatch it after every write) so a just-answered
quiz or just-unlocked badge shows up immediately without a page reload.

### Badges

Five badges (`src/lib/discoveryBadges.ts`), computed entirely from the
`discovered` list — category and/or tag matchers, no new DB schema:

| Badge | Criteria | Threshold |
| --- | --- | --- |
| Finals Expert | `category === "FINAL"` | 1 |
| Penalty Historian | `category === "PENALTY"` | 1 |
| Golden Boot Hunter | tags include `goals`/`golden-boot`/`top-scorer`/`scorer` | 1 |
| Brazil Archive Explorer | tags include `brazil` | 3 |
| 2026 Scout | `category === "SCHEDULE_2026"` or tags include `2026` | 2 |

`DiscoveryBadges` renders all five (earned ones glow gold; unearned ones show
as dim locked chips with a native tooltip showing progress, e.g. "2/3") on
the homepage card, the `/facts` archive header, and a fact's detail page.

### Mini quiz block

A `quiz` content block (`{ type: "quiz", question, options, correctIndex,
explanation? }` — see `src/server/facts/types.ts`) renders as an interactive
`QuizBlock` alongside a fact's other content blocks: pick an option, get
instant right/wrong feedback and an optional explanation, scored via
`recordQuizAttempt` — no network call.
`parseContentBlocks` additionally checks that `correctIndex` references a
real option (a check a discriminated union can't express on its own); a quiz
block that fails this is dropped like any other malformed block. See the
`argentina-france-2022-final`, `miroslav-klose-alltime-top-scorer`, and
`world-cup-2026-first-48-team-tournament` starter facts for examples.

## Data-template fact generator

`pnpm facts:generate` (`scripts/facts/generate-fact-candidates.ts`) mechanically
derives Fact candidates from database queries — no AI, no randomness. Given
the same database state, it always produces the same candidates. Seven
templates (`src/server/facts/generator/`):

| Template | Query | Candidates |
| --- | --- | --- |
| Top scorers | `Goal.groupBy` by player, own goals excluded | top 3 |
| Squad selections | `SquadPlayer.groupBy` by player | top 3 |
| Biggest wins | goal-margin ranked across all matches | top 3 |
| Highest-scoring matches | total-goals ranked across all matches | top 3 |
| Host winners | `Tournament.hostName` matches the winning team's name | every match (currently 6) |
| Penalty shootouts | `Match.decidedByPenalties = true`, ranked by stage importance then recency | up to 10 |
| Final score facts | `Match.stage = "final"` | one per tournament |

**"Most appearances" is deliberately generated as "most squad selections."**
This archive only imports World Cup squad selections, never match-level
lineups/appearances (see `docs/DATA_MODEL.md`), so a literal "most
appearances" claim would be unsupported by our own data — the generated
title/summary always say "squad selections," never "appearances" (the
content body may still explain the distinction to the reader).

**Every template scopes to men's World Cup tournaments only.** The archive
also imports the women's World Cup (30 tournaments total, mixed together in
`Tournament`), and a leaderboard combining both without saying so would
silently misrepresent the numbers — the same rule
`src/server/queries/records.ts` and the hand-written starter facts already
follow. The filter excludes `name contains "Women's"` rather than matching
`contains "Men's"` — "Women's" contains "men's" as a literal substring
("Wo-**men's**"), so a positive match would incorrectly include every
women's tournament too. This was caught by actually running the generator
during development (three real women's players and a women's final leaked
into the first run) before the exclusion-based fix.

Every candidate:

- Gets slug `auto-<template>-<id>` — the `auto-` prefix guarantees it can
  never collide with a hand-curated starter fact's slug.
- Is written with `status: NEEDS_REVIEW` and `verificationStatus: DB_VERIFIED`
  — the numbers are trustworthy (computed straight from our own database),
  but the generated prose still needs a human editorial pass before it can
  go public, exactly like a hand-written `NEEDS_REVIEW` draft. **A generated
  candidate is never written as `PUBLISHED`.**
- Carries a `FactSource` row (`sourceType: WORLDCUP_NEXUS_DB`) describing
  exactly which query produced it (e.g. "`Match.stage = \"final\"` for
  tournament year 2022. Scoped to men's World Cup tournaments only…") — full
  audit trail for the reviewer.
- Is re-runnable: the script never touches a Fact whose status is not
  `NEEDS_REVIEW` — once a human publishes, archives, rejects, or starts
  hand-editing (`DRAFT`) a candidate, re-running the generator leaves that
  row untouched forever. A still-`NEEDS_REVIEW` candidate is refreshed in
  place (its sources/relations are replaced, not accumulated) so pending
  drafts stay current with the latest data until someone reviews them.

## AI-assisted fact candidate writer

`pnpm facts:draft-ai` (`scripts/facts/draft-ai-fact-candidates.ts`) is a second
way to produce the same seven templates' candidates — using Claude
(`claude-opus-4-8`, via `@anthropic-ai/sdk`) to write more natural title,
summary, and paragraph text instead of the fixed sentence templates in
`src/server/facts/generator/format.ts`. It is an alternative/upgrade path for
the *prose*, not a new source of facts: it reuses the exact same query layer
as the deterministic generator (`fetchTopScorerInputs`,
`fetchSquadSelectionInputs`, `fetchHostWinnerInputs`, `getAllMensMatches` in
`src/server/facts/generator/queries.ts`) and produces candidates on the exact
same slugs, so an AI-drafted candidate lands on the same Fact row a
deterministic one would — one candidate per record in the review queue, never
two competing drafts.

**The AI never chooses what to say — only how to say it.** The pipeline
(`src/server/facts/aiDrafter/` — see below) is:

1. **Fetch structured, DB-verified input.** The same raw query results the
   deterministic generator uses are reshaped (`aiDrafter/adapt.ts`, pure) into
   a flat list of `{ label, value }` facts plus one sentence of narrative
   context — e.g. for a top scorer: player name, goal count, archive rank,
   and career era. Nothing here is AI-authored.
2. **Draft text from only those facts.** `aiDrafter/prompt.ts` builds a system
   prompt that explicitly forbids calculating, rounding, estimating, or
   introducing any number not in the given fact list, and forbids adding any
   claim the facts don't support. `aiDrafter/client.ts` — the only file in the
   module that touches the Anthropic SDK — sends this via Claude's structured
   outputs (`output_config.format` + a Zod schema), so the response is always
   exactly `{ title, summary, paragraph }`, never free-form prose to parse.
3. **Extract every number the AI actually wrote and check it against the
   input.** `aiDrafter/validate.ts` regex-extracts every digit sequence from
   the drafted title/summary/paragraph and confirms each one traces back to a
   number present in step 1's fact list (a string fact like `"2002–2014"`
   contributes both 2002 and 2014 to the allowed set). Any number in the
   AI's text that isn't in that allow-list — a rounded figure, an invented
   comparison, a hallucinated year — fails validation.
4. **Fail closed.** A candidate that fails numeric validation, or whose
   Anthropic API call errors (missing key, refusal, malformed response), is
   **never written to the database**. The CLI logs exactly which numbers were
   rejected and moves on to the next candidate — there is no "save it anyway
   as extra-cautious NEEDS_REVIEW" fallback; an unverified numeric claim is
   treated the same as a failed generation, not a lesser-trust save.
5. **Save through the same safe upsert as the deterministic generator.** A
   candidate that passes validation is written via
   `scripts/facts/utils/upsertGeneratedFactCandidate.ts` (shared by both
   scripts) — `status: NEEDS_REVIEW`, `verificationStatus: DB_VERIFIED` (the
   *numbers* are DB-verified either way; NEEDS_REVIEW gates the *prose*,
   AI-written or not), and never overwrites a Fact a human has already
   published, archived, rejected, or started hand-editing. The stat_grid
   content block is still rendered directly from the DB-verified figures
   (`aiDrafter/build.ts`), never from the AI's text — the only thing the model
   writes is the title, summary, and paragraph.

Every AI-drafted candidate's `FactSource` note names the model and states
that its numeric claims were validated, so a reviewer always knows a fact was
AI-drafted and what was checked before it was saved.

**No admin/review workflow exists yet.** Reviewing NEEDS_REVIEW candidates —
AI-drafted or deterministic — currently means running `pnpm db:studio` and
editing rows directly. A dedicated review UI (with side-by-side diffing,
approve/reject actions, etc.) is a deferred follow-up, not part of this
writer.

## Why AI is not used at runtime

- No user-facing request path calls an LLM. The homepage, `/facts`, and the
  fact detail page only ever read from PostgreSQL.
- The AI-assisted writer above only ever runs from an offline CLI script
  (`pnpm facts:draft-ai`) invoked by a human or a future cron job — never from
  a route handler, a page, or anything that serves public traffic. Its output
  always lands as `NEEDS_REVIEW`, exactly like every other generation path.
- Facts are hand-authored/curated/generated ahead of time and seeded/saved to
  the database; nothing is generated on the fly in response to a visitor's
  request.
- This keeps the archive's core promise intact: every public fact has a
  traceable source and a human-reviewed status before it can appear.

## Future phases

- **Share cards** — generate an OG-image-style card per fact for social
  sharing.
- **Badge unlock moments** — a toast/animation the instant a badge is earned,
  instead of only reflecting state on the next render.
- **Longer quizzes** — a dedicated multi-question quiz mode built from a
  batch of facts, beyond the current one-question-per-fact mini quiz.
- **More data templates** — e.g. per-nation records, tournament-format
  milestones, or a "team X's biggest win" template scoped by country.
- **Admin/review workflow** — a dedicated UI for triaging `NEEDS_REVIEW`
  candidates (deterministic or AI-drafted): side-by-side view, approve/edit/
  reject actions, filtering by template or source. Until this exists, review
  happens via `pnpm db:studio` — see "AI-assisted fact candidate writer"
  above. **Only verified `PUBLISHED` facts can ever appear publicly** — this
  rule does not change in any future phase.
