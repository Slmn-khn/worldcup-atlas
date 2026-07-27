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
pnpm data:2026:review-pack        # Phase 2A: generate the human review pack
pnpm data:2026:review-validate    # Phase 2A: validate review-decisions.json
pnpm data:2026:approval-candidate # Phase 2A: generate approval.candidate.json (gated)
pnpm data:2026:human-review       # review-pack + review-validate
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

## No production writes in Phase 1

- No module under `src/server/agents/worldcup2026/` imports Prisma or any
  database utility.
- No existing `Fixture`, `Match`, `Tournament`, `Team`, `Country`, or
  `Stadium` records are read or written.
- There is no import script. A future one must demand
  `data/2026/approved/approval.json` (see `data/2026/approved/README.md`).

## Phase 2A — Human review pack + approval workflow

Phase 2A converts the pipeline's conflicts and gap-fill/enrichment
candidates into **reviewable files** and validates a human's explicit
decisions. It is still review-only: **no database writes, no import, no
auto-approval**, and the manual verified reference pack remains
authoritative.

### Generate the review pack

```bash
pnpm data:2026:review-pack             # never clobbers review-decisions.json
pnpm data:2026:review-pack -- --force  # also regenerate review-decisions.json
```

Reads the validation/enrichment reports (and the Mominul enriched matches
for per-gap detail) and writes to `data/2026/review/`:

- `output/review-items.json` — deterministic review items with deduplicated
  evidence. Severity: **CRITICAL** for tournament winner/final/top-four
  conflicts, **HIGH** for match result conflicts, **MEDIUM** for gap-fill
  candidates and team/group/venue conflicts (and the EFI license review),
  **LOW** for enrichment-only candidates and label-drift classes. Every item
  starts `decision: null`, `status: "PENDING"`.
- `output/review-items.csv` — the same items for Excel / Google Sheets.
- `output/review-summary.md` — human-facing summary.
- `templates/review-decisions.example.json` — annotated example.
- `review-decisions.json` — the reviewer's working file (created only when
  missing; existing reviewer work is preserved unless `--force`).

### Record and validate decisions

A human fills `data/2026/review/review-decisions.json` with entries
`{reviewItemId, decision, reviewerNote, approvedValue, approvedSourceId}`.
Decisions: `APPROVE_MANUAL`, `APPROVE_MOMINUL`, `APPROVE_OPENFOOTBALL`,
`APPROVE_DERIVED`, `APPROVE_AS_ENRICHMENT_ONLY`, `REJECT_PROVIDER`,
`NEEDS_SOURCE`, `IGNORE_NON_BLOCKING`, `BLOCK_IMPORT`.

```bash
pnpm data:2026:review-validate
```

Checks schema, known item ids, evidence-backed `approvedSourceId`, required
`approvedValue` on value conflicts, and **required reviewer notes** for
`REJECT_PROVIDER`, `BLOCK_IMPORT`, `APPROVE_AS_ENRICHMENT_ONLY`, and any
`APPROVE_MOMINUL` that overrides a manual verified pack value. Writes
`output/review-validation-report.json`/`.md`. Exit 0 while items are merely
pending (with a loud warning that import cannot proceed); exit 1 only for a
malformed decisions file.

### Generate the approval candidate

```bash
pnpm data:2026:approval-candidate
```

Only when every CRITICAL/HIGH item is decided, nothing is `BLOCK_IMPORT`,
and no CRITICAL/HIGH item is stuck at `NEEDS_SOURCE`, this writes
`data/2026/approved/approval.candidate.json` with pinned hashes
(validation report, review pack, review decisions, normalized data pack).

**`approval.candidate.json` is not `approval.json`.** The candidate always
has `approvedForImport: false` and empty `approvedBy`/`approvedAt`. A human
must fill those in, set `approvedForImport: true`, and rename the file to
`approval.json` — the generator never does any of that. The future Phase 2B
importer refuses to run without that human-completed `approval.json`.

### Recommended full review flow

```bash
pnpm data:2026:validate
pnpm data:2026:review-pack
# … human edits data/2026/review/review-decisions.json …
pnpm data:2026:review-validate
pnpm data:2026:approval-candidate
# re-run pnpm data:2026:validate to refresh the report's Human Review Status
```

The steward report (`data/2026/reports/2026-data-steward-report.md`) carries
a **Human Review Status** section (REVIEW_NOT_STARTED → REVIEW_IN_PROGRESS →
REVIEW_BLOCKED / READY_FOR_APPROVAL_CANDIDATE →
APPROVAL_CANDIDATE_GENERATED) with counts and the next required human
actions; it reflects the review state at the last `data:2026:validate` run.

`data:2026:approval-candidate` requires reviewer decisions — do not add it
to CI. `data:2026:human-review` (pack + validate) is safe to run any time.

## Future phases

1. **Approved import (Phase 2B)** — import script gated on the
   human-completed approval file (`approvedBy`, `approvedAt`,
   `dataPackVersion`, `validationReportHash`, `approvedForImport: true`),
   never overwriting existing archive records. Phase 2A only produces the
   `approval.candidate.json` precursor.
2. **Fact generation** — derive verified facts/records from the imported
   archive with the existing verification-script pattern.
3. **AI-assisted narrative candidates** — generated *candidates only*, always
   flagged for human review, never auto-published.
4. **Admin review UI** — surface conflicts/NEEDS_REVIEW records for human
   resolution.
