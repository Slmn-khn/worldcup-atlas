# Mominul FIFA World Cup 2026 Dataset — Provider Report

Generated: 2026-07-27T14:00:21.281Z

**Status: candidate data only.** This provider was NOT imported. No database writes occurred, nothing is rendered publicly, and the `data/2026/approved/approval.json` gate is untouched. The manual verified reference pack remains authoritative for the tournament outcome, the final, awards, and known conflicts.

Reliability: `OPEN_DATA_CANDIDATE` (priority 3), license CC0-1.0. Core matches may become gap-fill candidates when they resolve cleanly; player/event/lineup/stat rows remain enrichment candidates only.

## Files

Fetched: 12 ok, 0 failed. Parsed: 12 candidate files.

| File | Rows | Columns detected |
| --- | ---: | ---: |
| match_events.csv | 834 | 6 |
| match_lineups.csv | 5408 | 7 |
| match_team_stats.csv | 208 | 12 |
| matches.csv | 104 | 17 |
| matches_detailed.csv | 104 | 23 |
| player_stats.csv | 1248 | 21 |
| real_match_details.json | 104 | 9 |
| referees.csv | 28 | 4 |
| squads_and_players.csv | 1248 | 10 |
| teams.csv | 48 | 8 |
| tournament_stages.csv | 7 | 3 |
| venues.csv | 16 | 8 |

Row-level parse quality across all files: 0 WARN rows, 0 ERROR rows (kept with their raw payloads — never silently dropped).

## Row counts by area

- Teams: 48
- Venues: 16
- Matches: 104 (+ 104 detailed, 104 real-detail entries)
- Referees: 28
- Squad/player rows: 1248
- Match events: 834
- Lineup rows: 5408
- Player stat rows: 1248
- Team match stat rows: 208

## Comparison against the manual verified pack

- Supporting evidence (agrees with verified manual fields): 203
- Conflicts with the manual pack (manual pack preferred): 2
- Gap-fill candidates (cleanly resolved manual gaps): 78
- Enrichment candidates: 9044; unresolved rows: 23.
- Match identity resolution: 289/312 rows resolved (93%) — EXACT_MATCH_ID: 62, EXACT_TEAM_DATE_STAGE: 103, PROBABLE: 124, UNRESOLVED: 23.
- Player identity resolution: 7904/7904 rows resolved (100%) — EXACT_PROVIDER_ID: 7904.

## Import recommendation

**CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION**

Not imported. Cleanly-resolved records are candidates for a future, human-approved import only after validation review; conflicting records are never applied over the manual verified pack.

