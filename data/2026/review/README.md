# 2026 Human Review Pack (Phase 2A)

This folder holds the **human review workflow** between the Phase 1 data
steward pipeline and any future approved import. Everything here is files —
**no database import happens from review files alone**, and no production
import is possible in this phase.

## What lives here

| Path | Content | Who writes it |
| --- | --- | --- |
| `output/review-items.json` | Generated review items (conflicts, gap-fill candidates, enrichment candidates) | `pnpm data:2026:review-pack` |
| `output/review-items.csv` | The same items as a spreadsheet (Excel / Google Sheets friendly) | `pnpm data:2026:review-pack` |
| `output/review-summary.md` | Human-facing summary of what needs review | `pnpm data:2026:review-pack` |
| `output/review-validation-report.json` / `.md` | Validation of the reviewer's decisions | `pnpm data:2026:review-validate` |
| `templates/review-decisions.example.json` | Annotated example of a decisions file | `pnpm data:2026:review-pack` |
| `review-decisions.json` | **The reviewer's decisions** — human-edited | a human reviewer |

## Rules

- Review files are **generated from** the validation/enrichment reports
  (`data/2026/validation/`, `data/2026/reports/`) and the manual verified
  reference pack. Generation never mutates those sources.
- Reviewer decisions must be **explicit**: every blocking item needs a
  decision recorded in `review-decisions.json`; nothing is auto-approved.
- The manual verified reference pack remains **authoritative** — approving a
  provider value over a verified manual record requires an explicit decision
  with a reviewer note.
- Review files feed the future `approval.json` generation: a complete,
  validated review can produce `data/2026/approved/approval.candidate.json`,
  which a human must still fill in, set `approvedForImport: true`, and
  rename to `approval.json`.
- **Human review is required before import.** Phase 2A has no importer; the
  future Phase 2B importer refuses to run without a human-written
  `approval.json`.

## Workflow

```bash
pnpm data:2026:validate            # refresh validation + steward report
pnpm data:2026:review-pack         # generate review items + templates
# … a human edits data/2026/review/review-decisions.json …
pnpm data:2026:review-validate     # check the decisions file
pnpm data:2026:approval-candidate  # generate approval.candidate.json when eligible
```

`review-decisions.json` is never overwritten by the generator unless you pass
`--force`.
