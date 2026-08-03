# Bustami FIFA EFI Data WC 2026 — Provider Report

Generated: 2026-07-27T14:00:21.281Z

**Status: candidate data only.** This provider was NOT imported. No database writes occurred, nothing is rendered publicly, and the `data/2026/approved/approval.json` gate is untouched. The manual verified reference pack remains authoritative for the tournament outcome, the final, awards, and known conflicts.

Reliability: `RESEARCH_ANALYTICS_CANDIDATE` (priority 5). License: **needs review** — the upstream README scopes the data to analytical/research purposes only.

## Files

Fetched: 3 ok, 0 failed. Parsed: 3 candidate files.

| File | Rows | Columns detected |
| --- | ---: | ---: |
| wc2026_efi.csv | 5359 | 124 |
| wc2026_matches.csv | 104 | 10 |
| wc2026_players.csv | 1248 | 7 |

Row-level parse quality across all files: 0 WARN rows, 0 ERROR rows (kept with their raw payloads — never silently dropped).

## Row counts

- wc2026_matches rows: 104
- wc2026_players rows: 1248
- wc2026_efi rows: 5359

Columns detected:

- `wc2026_efi.csv`: player_id, match_id, assists, attempt_at_goal, attempt_at_goal_against, attempt_at_goal_against_on_target, attempt_at_goal_blocked, attempt_at_goal_from_ball_progression, attempt_at_goal_from_corner, attempt_at_goal_from_cross, attempt_at_goal_from_free_kicks, attempt_at_goal_from_other, attempt_at_goal_from_pass, attempt_at_goal_from_penalty, attempt_at_goal_from_rebound, attempt_at_goal_inside_the_penalty_area, attempt_at_goal_inside_the_penalty_area_on_target, attempt_at_goal_off_target, attempt_at_goal_on_target, attempt_at_goal_outside_the_penalty_area, attempt_at_goal_outside_the_penalty_area_on_target, attempted_ball_progressions, attempted_switches_of_play, avg_speed, clean_sheets, completed_ball_progressions, completed_switches_of_play, corners, crosses, crosses_completed, defensive_pressures_applied, direct_defensive_pressures_applied, direct_free_kicks, direct_red_cards, distance_high_speed_running, distance_high_speed_sprinting, distance_jogging, distance_low_speed_sprinting, distance_walking, distributions_completed_under_pressure, distributions_under_pressure, forced_turnovers, fouls_against, fouls_for, free_kicks, goalkeeper_defensive_actions_inside_penalty_area, goalkeeper_defensive_actions_outside_penalty_area, goalkeeper_save_percentage, goalkeeper_saves, goalkeeper_saves_on_target, goal_kicks, goals, goals_conceded, goals_conceded_from_attempt_at_goal_against, goals_from_direct_free_kicks, goals_inside_the_penalty_area, goals_outside_the_penalty_area, headed_attempt_at_goal, indirect_free_kicks, indirect_red_cards, linebreaks_attempted, linebreaks_attempted_all_lines, linebreaks_attempted_attacking_and_midfield_line, linebreaks_attempted_attacking_line, linebreaks_attempted_attacking_line_completed, linebreaks_attempted_attacking_line_completed_only, linebreaks_attempted_attacking_line_only, linebreaks_attempted_completed, linebreaks_attempted_defensive_line, linebreaks_attempted_defensive_line_completed, linebreaks_attempted_defensive_line_completed_only, linebreaks_attempted_defensive_line_only, linebreaks_attempted_midfield_and_defensive_line, linebreaks_attempted_midfield_line, linebreaks_attempted_midfield_line_completed, linebreaks_attempted_midfield_line_completed_only, linebreaks_attempted_midfield_line_only, linebreaks_attempted_under_pressure, linebreaks_completed_all_lines, linebreaks_completed_attacking_and_midfield_line, linebreaks_completed_midfield_and_defensive_line, linebreaks_completed_under_pressure, matches_played, number_of_involvements, number_of_possession_sequences, number_of_shot_ending_sequences, offers_to_receive_in_behind, offers_to_receive_in_between, offers_to_receive_in_front, offers_to_receive_inside, offers_to_receive_outside, offers_to_receive_total, offsides, own_goals, passes, passes_completed, penalties, penalties_scored, received_offers_to_receive, receptions_between_midfield_and_defensive_line, receptions_in_behind, receptions_under_direct_pressure, receptions_under_indirect_pressure, receptions_under_no_pressure, receptions_under_pressure, red_cards, speed_runs, sprints, substitutions_in, substitutions_out, take_ons_completed, threat, throw_ins, time_played, top_speed, total_distance, xg, yellow_cards, team_id, team_name, player_name, player_number, position, birthday
- `wc2026_matches.csv`: match_id, result_id, group_id, match_status, date, home_team, home_team_id, away_team, away_team_id, stage
- `wc2026_players.csv`: team_id, team_name, player_id, player_name, player_number, position, birthday

## Mapping coverage

- FIFA match ID mapping: 3302/5463 rows resolved (60%) — EXACT_FIFA_ID: 3239, EXACT_TEAM_DATE_STAGE: 41, PROBABLE: 22, UNRESOLVED: 2161.
- FIFA player ID mapping: 6607/6607 rows resolved (100%) — EXACT_PROVIDER_ID: 6607.
- Conflicts with verified manual facts (manual pack preferred): 0.

## License / usage warning

⚠️ **The upstream README states this data is for analytical/research purposes only.** Every record derived from this provider carries `importBlockedReason: RESEARCH_ONLY_UNTIL_LICENSE_REVIEW`. EFI metrics are NOT merged into the core public archive, are NOT import-ready, and must not be displayed publicly until a license/usage review explicitly clears them.

## Import recommendation

**RESEARCH_ONLY_UNTIL_LICENSE_REVIEW**

Not imported. Research/analytics use only until the license review completes.

