---
name: Full league data tables
description: Where whole-league (all clubs) data lives vs Belconnen-only data, for BUFC hub analytics.
---

# league_matches / league_goals hold the full league

The original `matches`/`goals` tables only ever imported Belconnen's own 14 fixtures. To support club-centric scouting (any club's record + goals across ALL their games) and a full ladder, two separate tables were added: `league_matches` and `league_goals`, seeded from the league-wide CSV.

- Final counts: **40 league_matches, 189 league_goals, 6 clubs**, all seasonId **4** (Women's 1sts 2026 NPL).
- Placeholder 0-0 fixtures carry an empty goal row (no scorer/minute) in the source CSV — these are NOT goals. Filter them in seed (require non-empty `Scorer Team`) and they must stay out of the DB, or they inflate conceded/scored counts.
- `/analytics/league-ladder` and `/analytics/opponent-profile` compute from these league tables. The Belconnen-only `matches`/`goals` tables and the Player Insights charts were intentionally left untouched.

**Goal attribution in opponent-profile:** for a selected club, `scored` = goals where `scorerTeam === club`; `conceded` = the other side's goals in that club's fixtures. Charts bucket by 15-min interval and by goal type, each stacked by which opponent.

**Why:** keeping league data in new tables avoided disturbing the working Belconnen-perspective features while enabling whole-league analysis.
