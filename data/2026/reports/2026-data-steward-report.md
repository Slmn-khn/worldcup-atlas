# 2026 Data Steward Report

Generated: 2026-07-27T14:10:55.218Z

## Verdict: NOT READY FOR IMPORT

Validation status: **WARN** — 0 errors, 3 warnings, 236 conflicts.

## Data integrity guarantees

- **No database writes occurred.** The Phase 1 pipeline reads and writes only files under `data/2026/` — it never touches PostgreSQL or any `Fixture`/`Match`/`Tournament`/`Team`/`Country`/`Stadium` record.
- There is no import script in Phase 1.
- **Approval gate:** any future import must be gated on a human-written `data/2026/approved/approval.json` whose `validationReportHash` matches the sha256 of the current `data/2026/validation/validation-report.json` (see `data/2026/approved/README.md`).

## Source coverage

| Source | Endpoints | Collected | Failed |
| --- | ---: | ---: | ---: |
| manual_verified_2026_pack_v1 | 0 | 0 | 0 |
| openfootball_worldcup_2026 | 2 | 2 | 0 |
| worldcup2026_repo | 8 | 8 | 0 |
| mominul_2026_dataset | 12 | 12 | 0 |
| bustami_fifa_efi_2026 | 3 | 3 | 0 |

## Candidates found per source

| Source | teams | groups | venues | matches | standings |
| --- | ---: | ---: | ---: | ---: | ---: |
| openfootball_worldcup_2026 | 96 | 24 | 0 | 176 | 0 |
| worldcup2026_repo | 96 | 12 | 32 | 176 | 48 |

## Normalized counts

- teams: 54
- realTeams: 48
- placeholderTeams: 6
- groups: 12
- venues: 16
- matchRecords: 107
- resolvedMatches: 104
- finishedMatches: 104
- standings: 48
- conflicts: 236
- errors: 0
- warnings: 3

## Tournament record

- World Cup 2026 (2026), hosts: Canada, Mexico, USA
- 2026-06-11 → 2026-07-19; winner: Spain, runner-up: Argentina, third: England, fourth: France
- confidence: MULTI_SOURCE_VERIFIED, verification: NEEDS_REVIEW

## Observations (derived from this run)

- `manual_verified_2026_pack_v1` contributes to 66 of 104 finished match records.
- `openfootball_worldcup_2026` contributes to 104 of 104 finished match records.
- `worldcup2026_repo` contributes to 104 of 104 finished match records.
- The final is recorded as finished: Spain 1–0 Argentina (winner: Spain).
- 69 matches are FINISHED per one source but still SCHEDULED per `worldcup2026_repo` — that snapshot appears to be stale pre-tournament data (placeholder scores, late-qualifier placeholders).
- Provider group tables disagree with match-derived standings in 12 groups (see conflict notes for per-team diffs).
- 6 qualification placeholder "teams" were preserved as UNVERIFIED (e.g. "IC Path 1 Winner", "IC Path 2 Winner") and excluded from real-team counts.

## Manual Verified Reference Pack

- Pack ID: `manual-verified-2026-v1`
- Pack hash: `sha256:8086c4d001bdef7034ff21a19113b66bd6c9103aad9d8a6033422f22ff766cff`
- Files loaded: 10 — awards (`8882c3a01b79…`), bracket (`1ed6cdb013af…`), conflicts (`ed19ab091790…`), groups (`df11878b3c4c…`), matches (`af82b1a1a774…`), sources (`2a3fd09e5a6a…`), standings (`e7b83d512bb8…`), teams (`990f0a5df9ec…`), tournament (`deb14963a90b…`), venues (`2697be372415…`)

Coverage:

| Area | Records | Notes |
| --- | ---: | --- |
| tournament | 1 | verified (champion/runner-up/third/fourth) |
| teams | 48 | 42 verified, 6 reported/partial/unverified |
| groups | 12 | group letters resolved against other sources by team-set matching |
| matches | 67 | 60 verified, 7 unverified; official total 104 |
| standings | 4 tables + final top four | verified final standings |
| bracket | 6 rounds | knockout progression M73–M104 |
| venues | 16 | includes FIFA-name vs stadium-name aliases |
| awards | 4 | reference only — no award import model in this phase |
| conflicts | 7 | known manual conflicts, preserved as UNRESOLVED |

Match coverage: **67 of 104** official matches captured (60 verified, 7 unverified).

**Import recommendation:** the manual reference pack is suitable as high-priority supporting evidence for verified records, but not sufficient for full automatic import because it captures 67 of 104 matches and explicitly records known data gaps. Partial/unverified records are supporting context only and never become final values.

## Candidate enrichment providers

Candidate providers contribute enrichment/analytics **candidates only**: nothing below was imported, nothing is rendered publicly, and the manual verified reference pack remains authoritative — provider disagreements are reported as conflicts, never applied. Details: `mominul-provider-report.md`, `bustami-efi-provider-report.md`, `enrichment-coverage-report.json`, `enrichment-conflict-report.json`.

| Provider | Files ok/failed | Rows | Conflicts vs manual pack | Gap-fill candidates | Import recommendation |
| --- | --- | ---: | ---: | ---: | --- |
| mominul_2026_dataset | 12/0 | 9357 | 2 | 78 | CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION |
| bustami_fifa_efi_2026 | 3/0 | 6711 | 0 | 0 | RESEARCH_ONLY_UNTIL_LICENSE_REVIEW |

⚠️ `bustami_fifa_efi_2026` carries a standing usage restriction — importBlockedReason: **RESEARCH_ONLY_UNTIL_LICENSE_REVIEW** (research/analytics only until a license/usage review clears it; never merged into the core public archive in this phase).

## Conflicts

| Conflict | Count |
| --- | ---: |
| groups.teams | 6 |
| matches.cityName | 62 |
| matches.final.shots | 1 |
| matches.homeScore | 1 |
| matches.kickoffDateLabel | 4 |
| matches.kickoffTimeLabel | 29 |
| matches.matchNumber | 6 |
| matches.matches (group stage) | 1 |
| matches.matches.GB-6 | 1 |
| matches.matches.M88 | 1 |
| matches.matches.round_of_16 | 1 |
| matches.status | 69 |
| matches.venueName | 1 |
| standings.table | 12 |
| teams.teams | 1 |
| venues.capacity | 13 |
| venues.cityName | 15 |
| venues.countryName | 11 |
| venues.venues.nynj | 1 |

Full details in `data/2026/validation/conflict-report.json` and `data/2026/normalized/conflicts.json`. Conflicts are reported, never silently resolved; the normalizer keeps the highest-priority source's value and flags the record.

## Missing / flagged data

- WARN `MANUAL_PACK_PARTIAL_COVERAGE`: Manual reference pack captures 67 of 104 official matches — usable as high-priority supporting evidence, insufficient for a full import.
- WARN `MANUAL_PACK_UNVERIFIED_MATCHES`: 7 manual pack matches are not fully verified (missing scores/participants) — supporting evidence only, never final values.
- WARN `MANUAL_PACK_UNVERIFIED_TEAMS`: 6 manual pack team records are not fully verified (including unconfirmed participant placeholders) — not import-ready.

## Next recommended action

- Review conflicts.json: every entry is a real cross-source (or intra-source) disagreement that was reported, not silently resolved.
- Do NOT import in Phase 1. A future import phase must require data/2026/approved/approval.json (see data/2026/approved/README.md).

## Safe to import?

**NOT READY FOR IMPORT.** Conflicts and/or validation issues above must be reviewed and resolved (or explicitly approved) first.
