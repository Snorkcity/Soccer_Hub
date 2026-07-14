---
name: Combo Threat chart (assist→scorer partnerships)
description: How the combo-threat feature is wired across backend + frontend, and the buildCombos exclusion rules
---

# Combo Threat chart

Ranked horizontal bar chart of assist→scorer partnerships ("who combines for goals"), shared by both the Team Insights (Belconnen) and Opponent Insights (selected club) tabs of SeasonStats.

**Backend** (`artifacts/api-server/src/routes/analytics.ts`):
- `/analytics/goal-combos` — team-scoped; goals/matches/player_stats tables; roster attribution via `isFocusGoal` (only OUR goals).
- `/analytics/opponent-goal-combos` — club-scoped; league_goals/league_matches; supports `__ALL__` sentinel + lastN (see lastn-rounds-windowing.md for the date-bucketing rule).
- Both call a shared `buildCombos()` helper.

**`buildCombos` exclusions:** own goals ("OG"), unassisted goals, and self-assists are all excluded from the partnership tally but unassisted/OG still count toward `totalGoals`. Returns `{ combos (desc by count), totalGoals, assistedGoals }` so the chart can show "X of Y goals came from a partnership".

**Frontend** (`SeasonStats.tsx`): one shared `ComboThreatChart` component. Bar fill = the club's brand colour via `colorMap[label]` (label="Belconnen" for team, selectedClub for opponent, "" → falls back to primary for league-wide). Short names via the `sn` map (built from Belconnen leaderboard, so opponent player names fall back to full name — fine).

**Why the shared component:** the user's roadmap explicitly wanted combo/relationship analysis usable for BOTH our team and scouted opponents, from the same UI.
