---
name: Goal attribution pattern
description: How to correctly attribute goals to Belconnen players in analytics endpoints
---

# Goal Attribution Pattern

## The Rule
Never filter `goals` table rows by `scorerTeam` using hardcoded strings like `["Belconnen", "BelReserves"]`. Instead, load **all** goals for teamId/seasonId and then use the Belconnen player roster (built from `player_stats WHERE club = "Belconnen"`) as the natural filter.

## Why
The `scorerTeam` column in the `goals` table uses inconsistent values in the source data — the same team may appear as `"Belconnen"`, `"BelReserves"`, or the full `"Belconnen United FC Women's 1sts"`. Filtering by a hardcoded list misses some values and silently undercounts goals.

## How to Apply
1. Load all goals: `SELECT scorer, matchId FROM goals WHERE teamId=? AND seasonId=?`
2. Build Belconnen roster: `const belconnenRoster = new Set(Object.keys(minsByPlayerOpp))`
3. Skip goals where `!belconnenRoster.has(g.scorer)` — this naturally excludes opponent scorers and any unrecognised names.

The existing `player-leaderboard` endpoint uses the same approach via `nameToId` lookup.

## Unified scored/conceded rule — `isFocusGoal(scorer, scorerTeam, roster)`
Scored-vs-conceded is decided by ONE shared helper `isFocusGoal` (defined near `FOCUS_CLUB` in analytics.ts): a goal is **ours** if `roster.has(scorer)` **OR** `scorerTeam === FOCUS_CLUB`. Applied consistently in `/analytics/goal-breakdown`, `/analytics/opponent-goal-breakdown`, and `/analytics/goals-by-interval` (the interval endpoint builds the roster from `player_stats` over the windowed matches).

The `scorerTeam === FOCUS_CLUB` arm handles two cases the roster alone misses:
1. **Own goals in our favour** — stored with `scorer = "OG"` (a literal, never a player name) and `scorer_team = FOCUS_CLUB` (the beneficiary club). It subsumes the older explicit `scorer === "OG"` carve-out.
2. **Mis-stored goals** — scorer name mistyped/unrecognised but the team label is correct.

A Belconnen player's own goal (into our own net) has `scorer = "OG"` + `scorer_team = opponent`, so both arms are false → correctly stays conceded.

**Why:** user explicitly chose (July 2026) to trust the team label in addition to the roster, to catch OGs (4 were showing as conceded, inflating conceded/deflating scored) AND mis-stored goals. Accepted tradeoff: `scorerTeam` is spelled inconsistently this season, so the team-label arm only exact-matches `"Belconnen"` — `"BelReserves"`/full-name goals still rely on the roster arm. User noted future seasons will have clean club-name-only `scorer_team` and separate First/Reserve grade apps.

**Do NOT** apply this rule to per-player attribution (top scorer, goals-by-opponent per-player breakdown, assists): those attribute goals to a *named player*, so an "OG" or unknown scorer can't map to a known player — keep them roster/name-based.
