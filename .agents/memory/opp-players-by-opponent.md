---
name: Opponent Insights player charts (stacked by opponent)
description: How the Opponent Insights tab's per-player Goals/Assists/Contributions charts get their data and render.
---

# Opponent Insights player charts

The Opponent Insights tab's three per-player charts (Goals, Assists, Contributions
for the currently-selected club) are stacked-by-opponent-club bars with a clickable
legend, a "Last 3 rounds" toggle, and a Total / Mins-per toggle — mirroring the
Player Insights charts.

**Data source:** one endpoint `GET /analytics/opponent-players-by-opponent`
(params: teamId, seasonId, club, optional lastN) feeds these charts. It returns
`{ opponents[], players[] }` where each player has `totalMins`, `totalGoals`,
`totalAssists`, `totalStarts`, `totalApps`, and `byOpponent[opp] = { goals, assists, minsPlayed }`.
Built from the whole-league tables (`league_goals` / `league_player_stats` / `league_matches`),
NOT the Belconnen-only tables — so it works for any club.

**Serves the FULL roster, not just scorers.** `players[]` is the union of contributors
(≥1 goal/assist) AND everyone who featured in the club's team sheets. This is deliberate:
the same endpoint also powers the squad charts **18 (Starts & Appearances)** and
**19 (Total Minutes)**, which must include non-scorers (defenders/keepers). The stacked
goal/assist charts 15–17 are unaffected because `OppPlayerStackChart` filters rows to
`filteredValue > 0` client-side, dropping non-scorers automatically. `totalStarts`/`totalApps`
are counted once per windowed player-stat row, so they respect the same lastN window as minutes.
Squad charts 18/19 (plain `PlayerBarCard`s) get a per-chart Last-3 toggle by simply switching
between the already-fetched full and lastN:3 sources — no per-opponent breakdown needed
(they read player-level totals via `oppStartsAppsData`/`oppMinutesData`).

- `club = "__ALL__"` sentinel = league-wide (bypasses the club filter); frontend caps
  bars to top ~20 in that mode.
- **Opponent = the other side of the match**: resolve via a match_id→{home,away,date}
  map; the opponent is whichever of home/away isn't the owning/scoring club.
- **lastN window is date-based**: sort the club's matches desc by match_date, take last N
  match_ids (for `__ALL__`, last N distinct dates league-wide).
- Frontend fetches BOTH full and `lastN:3` once; each chart picks its source via its own
  toggle. Reuses `MpgEntry`/`ContribEntry`/`AssistEntry` row shapes and the existing
  `MinsPerGoalTooltip`/`AssistStackedTooltip`/`ContribTooltip`.

**Why one component:** `OppPlayerStackChart` (in SeasonStats.tsx) takes a `metric`
prop ("goals"|"assists"|"contrib") and derives everything client-side, so the 3 charts
share code without touching the proven Player Insights charts (limits blast radius).

**Data gotcha:** a scorer who appears in `league_goals` but has no `league_player_stats`
rows shows `totalMins: 0` → Mins/Goal renders "0 mins". This is a real seed data gap
(name mismatch between goal scorer and player-stats name), not a code bug — same
behavior as the existing Player Insights charts. See seed-matchid-join.md.
