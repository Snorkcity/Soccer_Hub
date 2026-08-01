---
name: Football Match Report
description: Season Stats "Match Report" tab — /analytics/match-report endpoint, score orientation gotcha, insight conventions
---

# Football Match Report (Season Stats tab)

- Server-computed: GET /analytics/match-report (teamId, seasonId, matchRowId = matches row id) in `artifacts/api-server/src/routes/analytics.ts`; UI is `artifacts/bufc-hub/src/components/MatchReportTab.tsx`, 4th tab in SeasonStats.
- **half_score / full_score are stored HOME–AWAY, not us–them.** Derive orientation by matching full_score against goalsScored/goalsConceded, flip the half score the same way; skip HT insights when ambiguous. Getting this wrong produced "came from 1–6 down to win" on an 8–1 away win.
- **Why:** match_id encodes home/away (R17-TUG-BEL = away), the scores follow the fixture, but goalsScored/Conceded are already us-centric.
- Season-to-date context deliberately uses matchDate <= this match's date for league tally/ladder ("after this round" — same-day fixtures across the league included). Our own team ordering tie-breaks by row id.
- Conceded goal rows show opponent scorer if recorded, else scorerTeam club name; own goals in our favour keep scorer "OG" with no note.
- Insight/notes conventions Scott saw and liked: brace/hat-trick, "N for the season", league scorer rank (from league_goals, OG excluded), clean-sheet streak with named started back line (position ∈ GK/CB/LB/RB/LWB/RWB/DM), HT swing, win/unbeaten streaks, ladder line.
- GPS block: match GPS by team_id + season YEAR (text) + round IN [R#, R#-1sts], split_name='game'. Do NOT filter by gps_sessions.league_id — historical uploads carry league stamp 1 while newer seasons use their own league ids. gps_player_positions IS keyed by canonical names (aliases resolve raw→canonical first).
- Previous meetings + passes-per-shot insight live in the same endpoint; meeting summary must count draws separately (w/d/l), not just wins/losses.
- Save/download/email mirrors the GPS report trio: saved rows in `match_reports` (league-private, writes module-scoped to data-entry; reads open to league members), dark PPTX in `matchReportPptx.ts` (same palette as teamGpsMatchReport). Coach emails share the `gps_coach_emails` table under squad bucket "Football" but via football-own endpoints `/match-report-coach-emails` + `/match-report-email` (data-entry gated, admin-only) so clubs without the GPS module can still email — don't route football emails through the gps-prefixed endpoints.
- Dribl-era matches (R16+ in season 4) have no possession/shots/passes — tiles with null values are filtered out server-side; don't "fix" that by zero-filling.
