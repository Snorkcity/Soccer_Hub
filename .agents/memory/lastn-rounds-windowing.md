---
name: "Last N rounds" windowing semantics
description: How lastN must be applied differently for single-club vs league-wide (__ALL__) analytics endpoints
---

# "Last N rounds" windowing

The `lastN` query param on analytics endpoints means **last N rounds**, not last N matches.

**Rule:**
- **Single club / team-scoped** view: N most-recent matches == N rounds (each club plays once per round), so take the top-N matches sorted by date desc.
- **League-wide (`club === "__ALL__"`)** view: a round contains *multiple* fixtures, so you must window by the **N most-recent distinct match dates**, then include *all* matches on those dates — NOT the N most-recent matches.

**Why:** taking N raw matches league-wide silently drops most fixtures in a round and undercounts every aggregate (goals, combos, player tallies). The UI toggle literally says "Last 3 rounds", so the data must match that meaning.

**How to apply:** any new league-wide endpoint built on `league_matches`/`league_goals` must mirror the distinct-date bucketing already used in `opponent-players-by-opponent` and `opponent-goal-combos` in `artifacts/api-server/src/routes/analytics.ts`. Grep those for the `isAll` + `matchDate` Set pattern before writing a new one.
