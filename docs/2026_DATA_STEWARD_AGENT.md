# 2026 Data Steward Agent — Phase 1

## Purpose

A deterministic, database-free pipeline that prepares **finalized 2026 World
Cup archive data** for a future, human-approved import: it collects snapshots
from approved sources, extracts per-source candidates, normalizes and merges
them with confidence metadata, validates the result, and writes human-readable
reports.

This is a *steward*, not an importer. Phase 1 never touches PostgreSQL, never
publishes data, never calls AI services, and never fetches from unapproved
sources. It is safe to run locally at any time.

The 2026 **live schedule** feature (`Fixture` table, `pnpm fixtures:sync`) is a
separate pipeline and is untouched by this agent — see
`docs/FEATURE_2026_SCHEDULE.md`.

## Phase 1 scope

- Collect raw snapshots from the approved source registry.
- Build per-source candidate records (JSON / CSV / Football.TXT parsing).
- Resolve entities across sources (team aliases via the existing
  country/flag helpers) and merge duplicates.
- Assign confidence + verification metadata to every record.
- Derive group standings from match results and cross-check provider tables.
- Validate deterministically and produce reports.

Explicitly **out of scope** in Phase 1: importing to the database, publishing,
fact generation, AI-assisted content, admin UI.

## Approved sources

Defined in `src/server/agents/worldcup2026/sourceRegistry.ts` (mirrored to
`data/2026/source-registry.json`; the collector rewrites the mirror each run so
it cannot drift). Only sources in the registry may ever be fetched.

| Source id | Reliability | Priority | License | Role |
| --- | --- | --- | --- | --- |
| `manual_verified_2026_pack_v1` | MANUAL_REFERENCE | 1 | internal reference pack with source attribution | Human-authenticated reference pack (see below). Highest-priority reference; never fetched, never imported directly. |
| `openfootball_worldcup_2026` | OPEN_DATA | 2 | CC0-1.0 | Stable open public-domain baseline: groups, full schedule, results, bracket (Football.TXT + JSON). |
| `worldcup2026_repo` | COMMUNITY_API | 3 | ISC | Structured 2026-specific community provider (rezarahiminia/worldcup2026): teams, groups, stadiums, matches, group tables via CSV and the worldcup26.ir API. Never the sole source of truth. |
| `mominul_2026_dataset` | OPEN_DATA_CANDIDATE | 3 | CC0-1.0 | Relational open dataset (mominullptr/FIFA-World-Cup-2026-Dataset): teams, venues, stages, referees, matches, squads, match events, lineups, player stats, team match stats. Candidate provider — see "Candidate enrichment providers" below. |
| `bustami_fifa_efi_2026` | RESEARCH_ANALYTICS_CANDIDATE | 5 | Needs review; README says analytical/research purposes only | Player-level FIFA EFI metrics (Bustami/efi-fifa-data-wc-2026): FIFA match/player IDs + advanced performance metrics. Research/analytics candidate only — import blocked (`RESEARCH_ONLY_UNTIL_LICENSE_REVIEW`). |

**No FIFA scraping** — official pages remain manual verification references
only; their findings enter the pipeline through the manual reference pack.

## Candidate enrichment providers

Two sources are registered as *candidate providers*: they enrich the archive
with candidate data but are **never authoritative** and **never auto-approved**.
Their output stays in candidate/normalized/report files only — no database
writes, no public rendering, and the `data/2026/approved/approval.json` gate
is untouched. The manual verified reference pack remains authoritative for
the tournament outcome (Spain champion, Argentina runner-up, England third,
France fourth), the final, awards, and known conflicts.

### Mominul FIFA World Cup 2026 Dataset (`mominul_2026_dataset`)

- Reliability `OPEN_DATA_CANDIDATE`, priority 3, CC0-1.0.
- Adapter: `src/server/agents/worldcup2026/providers/mominulDataset.ts`; 12
  files (11 CSVs + `real_match_details.json`) parsed tolerantly (extra
  columns allowed, empty string → null, safe numeric coercion, row-level
  errors kept as WARN/ERROR records — never silently dropped).
- Classification against the manual verified pack
  (`providers/enrichment.ts`): agrees with a verified field →
  `SUPPORTING_EVIDENCE`; disagrees → `CONFLICT` (reported; manual pack value
  stays preferred); cleanly resolved match the pack has no verified result
  for → `GAP_FILL_CANDIDATE`; everything else → `ENRICHMENT_CANDIDATE` /
  `UNRESOLVED`.
- Player/event/lineup/stat rows remain enrichment candidates only.
- Import recommendation: **CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION**
  (still gated on the future approval workflow).

### Bustami FIFA EFI Data WC 2026 (`bustami_fifa_efi_2026`)

- Reliability `RESEARCH_ANALYTICS_CANDIDATE`, priority 5. **License/usage
  caution:** the upstream README scopes the data to analytical/research
  purposes only, and the metrics originate from the official FIFA platform.
- Adapter: `src/server/agents/worldcup2026/providers/bustamiEfiDataset.ts`;
  3 CSVs (EFI player-match metrics, FIFA match IDs, FIFA player IDs).
- Every derived record carries
  `importBlockedReason: RESEARCH_ONLY_UNTIL_LICENSE_REVIEW`; records are
  `ADVANCED_ANALYTICS_CANDIDATE`s, EFI metrics are never merged into the
  core public archive in this phase, and conflicts with verified manual
  facts are reported (manual pack preferred).
- Import recommendation: **RESEARCH_ONLY_UNTIL_LICENSE_REVIEW**.

### Identity resolution

`matchIdentity.ts` resolves provider match rows onto reference matches
(manual pack + normalized archive) with explicit confidence:
`EXACT_MATCH_ID` → `EXACT_FIFA_ID` → `EXACT_TEAM_DATE_STAGE` → `PROBABLE` →
`UNRESOLVED`. `playerIdentity.ts` resolves players by provider id, then
name + team; ambiguous names resolve to `UNRESOLVED` and are **never
merged**. Ambiguity never guesses — duplicate keys poison the lookup.

### Provider outputs

| Path | Content | Git |
| --- | --- | --- |
| `data/2026/candidates/mominul/*.candidates.json`, `data/2026/candidates/bustami/*.candidates.json` | Per-file provider candidate rows (`raw`/`parsed`/`parseStatus`/`warnings`, source file + row number preserved) | ignored |
| `data/2026/normalized/mominul/enriched-*.json`, `data/2026/normalized/bustami/enriched-*.json` | Classified enrichment records (`importReady: false` on every record) | ignored (large, regenerable) |
| `data/2026/reports/mominul-provider-report.md`, `bustami-efi-provider-report.md` | Human-facing provider reports | committable |
| `data/2026/reports/enrichment-coverage-report.json`, `enrichment-conflict-report.json` | Machine-readable coverage + conflicts vs the manual pack | committable |

Inspect with `pnpm data:2026:mominul:inspect` / `pnpm data:2026:bustami:inspect`
(read-only).

## Manual verified reference pack

`data/2026/reference/manual-verified-v1/` holds a **human-authenticated
reference pack**: `manifest.json` plus tournament/teams/groups/matches/
standings/bracket/venues/awards/sources/conflicts JSON files. It is loaded by
`src/server/agents/worldcup2026/manualReferencePack.ts`, which validates the
structure with Zod, hashes every file (sha256) and computes a pack hash so
reports pin the exact revision.

Interpretation of per-record `verification`:

- `verified` — high-priority reference. These records vote merged values and,
  at priority 1, win them. A verified value that **corroborates** other
  sources upgrades the record (e.g. the M104 final becomes
  MULTI_SOURCE_VERIFIED/READY); one that **disagrees** produces a reported
  conflict — never a silent override of evidence.
- `reported` / `partial` — supporting evidence: recorded and attributed, but
  a value only they know stays SINGLE_SOURCE / review-required.
- `unverified` — identity/context only. Null scores and unconfirmed slots
  abstain from every field vote, so they can never become final values.

Specifics of how the pack affects the pipeline:

- Unknown group letters ("GX-…" ids, `group: null`) are resolved
  deterministically by matching the 4-team set against the other sources'
  groups; no unique match → the record stays out of merged groups and is
  counted as unresolved.
- Disputed identifiers (e.g. knockout match numbers that disagree between the
  pack and OpenFootball) are **withheld**, not guessed — the disagreement is
  recorded in conflicts.json and the merged record carries no number.
- The pack's own `conflicts.json` (known manual conflicts, C-00x) is merged
  into the steward conflict registry as UNRESOLVED entries and preserved
  verbatim; only an explicit manual resolution in a future phase may resolve
  them.
- Awards are reference-only output (`data/2026/normalized/awards.json`,
  confidence MANUAL_OVERRIDE when verified) — there is no award import model
  in this phase.

Updating the pack: replace/add files in the folder, keep `manifest.json`
accurate (`importAllowed` MUST stay `false` — the loader hard-fails
otherwise), then run `pnpm data:2026:manual-pack` to check structure and
`pnpm data:2026:full-check` to re-normalize and re-validate. Partial coverage
(e.g. 67 of 104 matches) is a WARN, never a FAIL — the pack records gaps
honestly, and that is exactly why it is **reference evidence, not a direct
import**: the `data/2026/approved/approval.json` gate still applies to any
future import.

## Source reliability model

`SourceReliability`: `OFFICIAL` > `OPEN_DATA` > `COMMUNITY_API` >
`MANUAL_REFERENCE` describes what a source *is*; the numeric `priority`
(lower wins) decides which value is carried forward when merged sources
disagree — the disagreement itself is always reported as a conflict.

Two additional candidate tiers describe the enrichment providers:

- `OPEN_DATA_CANDIDATE` — open-licensed enrichment/gap-fill evidence
  (Mominul). Candidate only: may corroborate, conflict, or gap-fill, never
  authoritative, never auto-approved for import.
- `RESEARCH_ANALYTICS_CANDIDATE` — research/analytics data with unresolved
  license/usage terms (Bustami EFI). Blocked from import and public
  rendering until an explicit license review clears it.

Confidence levels on every normalized record:

- `OFFICIAL_VERIFIED` — matches an official reference snapshot (Phase 2+).
- `MULTI_SOURCE_VERIFIED` — two or more independent sources agree.
- `SINGLE_SOURCE` — only one source knows the value.
- `DERIVED` — computed from other normalized values (e.g. standings).
- `MANUAL_OVERRIDE` — reserved for future human corrections.
- `UNVERIFIED` — placeholder/unresolvable data preserved from a source.
- `CONFLICTED` — sources disagree on a major field.

Verification status: `READY`, `NEEDS_REVIEW`, `CONFLICTED`, `INCOMPLETE`.

## Folder layout

| Path | Content | Git |
| --- | --- | --- |
| `data/2026/reference/manual-verified-v1/` | Human-authenticated reference pack (manifest + 10 JSON files) | committable (curated human data) |
| `data/2026/raw/<sourceId>/` | Untouched response bodies + `.meta.json` sidecars (URL, sha256, HTTP status, fetch time) | ignored |
| `data/2026/candidates/` | Per-source candidate records with source refs and parse-error arrays | ignored |
| `data/2026/normalized/` | Merged, Zod-validated records (`tournament/teams/groups/venues/matches/standings/bracket/sources/conflicts.json`) | committable (small, curated) |
| `data/2026/validation/` | `validation-report.json`, `conflict-report.json`, `source-coverage-report.json` | committable |
| `data/2026/reports/` | `2026-data-steward-report.md` (human-facing) | committable (`tmp/` ignored) |
| `data/2026/approved/` | Approval gate — README only in Phase 1 | committable |
| `data/2026/source-registry.json` | Generated mirror of the TS registry | committable |

Raw snapshots are kept strictly separate from normalized data; every
normalized record carries `sourceIds`, `confidence`, `verificationStatus`,
and (for matches) `rawSourceRefs` pointing back into the raw snapshots.

## Commands

```bash
pnpm data:2026:collect      # fetch approved endpoints → data/2026/raw (needs internet)
pnpm data:2026:candidates   # raw → per-source candidates
pnpm data:2026:normalize    # candidates (+ manual reference pack) → normalized + conflicts
pnpm data:2026:validate     # normalized → reports (exit 1 on FAIL; --allow-failures to override)
pnpm data:2026:manual-pack  # inspect the manual reference pack: hashes, coverage, warnings
pnpm data:2026:full-check   # normalize + validate (no network — CI-safe once snapshots exist)
pnpm data:2026:collect-and-check  # full pipeline including collection
pnpm data:2026:mominul:inspect    # read-only summary of the Mominul provider files
pnpm data:2026:bustami:inspect    # read-only summary of the Bustami EFI provider files
pnpm data:2026:display-schedule   # build the /schedule/2026 display artifact (no DB writes)
```

Command flow for the candidate providers: `collect` downloads both providers'
files into `data/2026/raw/<sourceId>/` (with `.meta.json` sidecars; a failed
file never crashes the run), `candidates` writes the per-file provider
candidate rows, `normalize` additionally runs the provider enrichment
(classification against the manual pack + normalized archive) and writes the
enriched files and all four enrichment reports, and `validate` folds the
enrichment coverage into the steward Markdown report.

`collect` is intentionally **not** part of `full-check`: collection needs the
internet and may be flaky in CI. Collection failures are per-endpoint and
non-fatal — the failed endpoint is recorded in its `.meta.json` sidecar and in
the coverage report, and the pipeline continues with what it has.

## How conflicts are handled

Conflicts are **reported, never silently resolved**:

- Every merged field records which sources voted and whether they agreed.
- **Major fields** (stage, group membership, scores, match numbers, team
  identity) in disagreement mark the whole record `CONFLICTED`.
- **Minor fields** (status, kickoff labels, venue/city) in disagreement keep
  the highest-priority source's value, flag the record `NEEDS_REVIEW`, and
  still write a conflict entry.
- Derived standings are compared against provider group tables; mismatches
  produce one conflict entry per group.
- Qualification placeholders a stale source carries ("UEFA Path A Winner")
  are preserved as `UNVERIFIED` records, matched to their real fixture only
  when the mapping is unambiguous, and excluded from real-team counts.

Everything lands in `data/2026/normalized/conflicts.json` and
`data/2026/validation/conflict-report.json`. If conflicts or major gaps
exist, the Markdown report states **NOT READY FOR IMPORT**. Major conflicts
require manual review — see also the conflict-handling policy in
`docs/DATA_SOURCES.md` and `docs/DATA_ISSUES.md`.

## Archive display schedule (`/schedule/2026`)

With the tournament complete, `/schedule/2026` renders from this pipeline's
**file-backed archive data — not** from the live `Fixture` table and never
from a provider fetch. The source module is
`src/server/worldcup2026/archiveSchedule.ts`, with this preference order:

1. `data/2026/approved/finalized/matches.json` (pack match format), if valid
2. `data/2026/approved/finalized/display-schedule.json` (generated artifact)
3. the manual verified reference pack, plus gap-fills from
   `data/2026/review/review-decisions.json` **only** when a decision sets
   `approved: true` — and even then the row's verification is capped at
   `REPORTED` (only the pack itself can mark a row `VERIFIED`)

Rules: missing scores/teams are shown as **RESULT UNDER REVIEW** (never
fabricated, never "SCHEDULED" — the tournament is over), group letters are
only shown where sources confirmed them, and unresolved knockout rows keep
their honest gaps (e.g. M88).

Regenerate the display artifact after pack/decision changes:

```bash
pnpm data:2026:display-schedule
```

The generator is file-in/file-out: **no database writes**, no network. The
artifact lives under `data/2026/approved/finalized/` but is a *display* file —
it is not `approval.json` and does not open the DB import gate.

## Approved Mominul import (Phase 2 — implemented)

The user manually verified the **Mominul FIFA World Cup 2026 Dataset**
(github.com/mominullptr/FIFA-World-Cup-2026-Dataset) and approved importing it
as the ONLY 2026 archive source. The import is quarantined in dedicated
`WorldCup2026*` Prisma tables (see `prisma/schema.prisma`) — the canonical
historical archive (`Tournament`/`Match`/`Player`/…) is untouched, and the
`approval.json` gate for canonical imports (below) remains closed.

**Source lock:** `data/2026/approved/mominul-import-policy.json`, validated
semantically by `src/server/agents/worldcup2026/mominulImportPolicy.ts`. The
importer refuses to run unless the policy names `mominul_2026_dataset`,
status `APPROVED_BY_USER`, and explicitly excludes
`match_prediction_features`, `bustami_efi`, `openfootball`,
`worldcup26_live`, and `manual_pack_values`.

**Pipeline:**

```bash
pnpm data:2026:collect                  # snapshot the source files (network)
pnpm data:2026:mominul:approved-pack    # raw CSVs → approved pack (validated)
pnpm data:2026:mominul:import           # DRY-RUN (default; zero DB access)
CONFIRM_2026_MOMINUL_IMPORT=true pnpm data:2026:mominul:import:write
# NODE_ENV=production additionally requires: -- --confirm-production
```

- The approved pack (`data/2026/approved/mominul/finalized/`) is validated
  hard: 48 teams, 16 venues, 104 matches, 1,248 players, no duplicate source
  ids, full referential integrity, all matches Completed, and the final must
  be Spain 1–0 Argentina AET. Validation failure blocks the import.
- The importer (`mominulImporter.ts`) is **idempotent** — every entity
  upserts on its integer source id (or `matchId+teamCode` for team stats),
  so re-running converges; a re-run after a bad partial import is the
  rollback story (no destructive reset exists or is needed). Each write run
  is recorded as a `WorldCup2026ImportBatch` row with per-entity
  created/updated/skipped counts.
- Reports: `data/2026/reports/mominul-approved-import-{preview,result}.{json,md}`.
- Excluded on principle: `match_prediction_features.csv` (ML-only), all
  Bustami EFI data, OpenFootball/worldcup26 rows, and manual-pack values
  (the manual pack stays a comparison/reference artifact only).

**Website integration:** `/schedule/2026` and `/tournaments/2026` read the
imported tables first (`src/server/worldcup2026/{queries,scheduleSource}.ts`)
and fall back to the file-backed approved pack when the DB is empty;
`/matches/2026/<id>` and `/tournaments/2026/players/<id>` render match
reports and player profiles. 2026 players are deliberately NOT merged into
the historical `Player` model. Live OpenFootball/worldcup26 fixture sync
remains disabled (feature flags) and the legacy `Fixture` rows are never
used for 2026 display.

Beyond the 2026-specific pages, the whole app now treats the archive as
**1930–2026**: `canonicalBridge.ts` maps the imported archive onto the
canonical card/finals/stats read models (homepage, timeline, featured,
/tournaments, sitemap, search), and every bridge point drops its synthetic
2026 contribution automatically if canonical `Tournament` year 2026 appears
(post-promotion) — the double-counting guard is
`mergeWc2026TournamentCard` plus the canonical-2026 check in
`src/server/archive/stats.ts`.

## No production writes in Phase 1

- No module under `src/server/agents/worldcup2026/` imports Prisma or any
  database utility, except the Phase 2 `mominulImporter.ts`, which receives
  its client as a parameter, only ever writes the quarantined
  `WorldCup2026*` tables, and is gated as described above.
- No existing `Fixture`, `Match`, `Tournament`, `Team`, `Country`, or
  `Stadium` records are read or written.
- There is still no CANONICAL-archive import script. A future one must
  demand `data/2026/approved/approval.json` (see
  `data/2026/approved/README.md`).

## Future phases

1. **Approved import** — import script gated on the approval file
   (`approvedBy`, `approvedAt`, `dataPackVersion`, `validationReportHash`,
   `approvedForImport`), never overwriting existing archive records.
2. **Fact generation** — derive verified facts/records from the imported
   archive with the existing verification-script pattern.
3. **AI-assisted narrative candidates** — generated *candidates only*, always
   flagged for human review, never auto-published.
4. **Admin review UI** — surface conflicts/NEEDS_REVIEW records for human
   resolution.
