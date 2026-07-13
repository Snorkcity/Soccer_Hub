---
name: Opponent Insights tab chart roadmap
description: Agreed order/spec of charts for the BUFC Hub Opponent Insights tab; built incrementally over time.
---

# Opponent Insights tab — chart roadmap

Charts show the details of the **club selected/clicked at the top of the page**. Many mirror the Team Insights tab charts but scoped to the chosen opponent (for = goals we scored vs them, against = goals they scored vs us), so reuse the Team Insights components where possible (OpponentStackChart, GoalTypePie, tooltips, colour maps).

Agreed order (code incrementally, one/few at a time):
1. Opponent match list
2. Coach behaviour
3. Goals scored by interval
4. Goals scored by type
5. Goals scored — open play & set piece pie charts
6. Goals detail by type
7. Goals conceded by interval
8. Goals conceded by type
9. Goals conceded — open play & set piece pie charts
10. Goal detail by type — conceded
11. 5-minute response after goals
12. 5-minute response — teams involved in swings
13. Goal map opponent (for and against)
14. First goal value index
15. Opponent goal per min
16. Opponent assists per min
17. Opponent goal contributions per minute
18. Opponent — starts and appearances
19. Opponent total minutes

**Note:** the Team Insights GS–Pie section (regain/set-piece × scored/conceded, shared opponent filter, group-by-third tooltip) is the template for items 5 & 9 here.

## Selector options: ALL + Belconnen + opponents
The opponent selector offers three kinds of target, all served by the same `/analytics/opponent-profile` endpoint (club param is a free string, no enum, no codegen needed):
- **A real opponent club** — league-wide profile of that club (from league_matches/league_goals).
- **Belconnen** — same endpoint works for our own club (we're in the league data); use it to cross-check Team Insights numbers.
- **`__ALL__` sentinel = league-wide.** Backend has a dedicated early-return branch: aggregates every league goal, `scored*` stacked by the scoring club and `conceded*` stacked by the conceding club (conceding = the home/away team that isn't scorerTeam). Both interval and type populate for scored AND conceded (genuinely different views). `matches:[]` and a placeholder record (goalsFor==goalsAgainst==total goals) because match-history/record are club-relative.
- Frontend `isAll = selectedClub === "__ALL__"`: hides the record summary + match-history (club-relative), relabels the 4 stack charts ("by scoring/conceding club") and top-scorers ("League Top Scorers").
- Default-select effect must treat `__ALL__` and `Belconnen` as valid selections so it doesn't reset them.

**Under ALL, what populates:** the 4 stack charts (scored/conceded × interval/type) + top scorers. **What is hidden (club-relative):** record summary, match history. Still to work through as more roadmap charts (5–19) get built — decide their ALL behaviour case by case.
