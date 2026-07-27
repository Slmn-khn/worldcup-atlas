# 2026 Human Review Pack — Summary

Generated: 2026-07-27T15:14:12.024Z
Review pack hash: `sha256:26247e14dad94d4ce11327c841fd16e0e5946e3032567fb3bee79f61fd8c2581`

**Phase 2A is review-only.** Nothing here has been imported, no database was written, and nothing is auto-approved. The manual verified reference pack remains authoritative; approving a provider value over it requires an explicit decision with a reviewer note.

## Counts

| Severity | Items |
| --- | ---: |
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 91 |
| LOW | 16 |

| Type | Items |
| --- | ---: |
| EFI_ANALYTICS_CANDIDATE | 4 |
| LINEUP_CANDIDATE | 1 |
| MATCH_GAP_FILL | 36 |
| MATCH_RESULT_CONFLICT | 13 |
| OTHER | 4 |
| PLAYER_EVENT_CANDIDATE | 2 |
| SOURCE_CONFLICT | 18 |
| TEAM_CONFLICT | 7 |
| VENUE_CONFLICT | 25 |

## Items requiring review before an approval candidate

- **review-match-GB-5-score** (HIGH MATCH_RESULT_CONFLICT) — Manual verified pack remains preferred; provider value reported, never applied.
- **review-match-GROUP-Group-B-flag-ca-flag-ch-homeScore** (HIGH MATCH_RESULT_CONFLICT) — Sources disagree on matches.homeScore for GROUP|Group B|flag:ca~flag:ch.
- **review-pack-C-001** (HIGH MATCH_RESULT_CONFLICT) — [manual pack C-001, source_disagreement] Total shots in the final: NBC reported Spain led 20-2; CBS reported 20-3.

## Medium-severity items (91)

- `review-efi-license` — RESEARCH_ONLY_UNTIL_LICENSE_REVIEW: The Bustami EFI dataset's upstream README scopes the data to analytical/research purposes only, and the metrics derive from the official FIF
- `review-gap-GB-6` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match GB-6, for which the manual verified pack records no verified result (a documented gap). Approving fills
- `review-gap-M10` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M10, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M11` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M11, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M12` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M12, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M13` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M13, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M14` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M14, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M15` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M15, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M16` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M16, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M22` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M22, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M24` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M24, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M29` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M29, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M30` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M30, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M31` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M31, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- `review-gap-M33` — CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION: Provider data cleanly resolves match M33, for which the manual verified pack records no verified result (a documented gap). Approving fills 
- …and 76 more (see review-items.json/csv).

## How to review

1. Open `review-items.csv` (or `review-items.json`).
2. Record decisions in `data/2026/review/review-decisions.json` (template: `templates/review-decisions.example.json`).
3. Run `pnpm data:2026:review-validate`.
4. When all CRITICAL/HIGH items are decided (and nothing is BLOCK_IMPORT), run `pnpm data:2026:approval-candidate`.
5. A human fills in `approval.candidate.json`, sets `approvedForImport: true`, and renames it to `approval.json` — only then can a future Phase 2B importer run.
