---
name: Player Scoring DNA radar chart
description: /analytics/player-dna + /analytics/opponent-player-dna + PlayerDnaChart radar; data mapping, per-90 squad-max floor, OG exclusion, shared computeDnaResponse helper.
---

# Player Scoring DNA (radar) — Player Insights + Opponent Insights tabs

A player-focused radar with a dropdown (populated from the leaderboard, default = top scorer) and a
Last-3-rounds toggle. 9 numeric spokes, each normalized to `value / squadMax * 100` (clamped 0–100):
Goals, Goals/90, Assists, Assists/90, First-touch %, Poacher %, Right foot, Left foot, Header.

Categorical facts can't be radar spokes (they're names) → shown as **text callouts** beside the web:
favourite opponent, top assist partner, minutes-per-goal, game time.

**Scope:** TWO instances of the same `PlayerDnaChart` component:
- **Player Insights tab** — Belconnen players (endpoint `/analytics/player-dna`, matches/goals/player_stats
  tables, `FOCUS_CLUB` / `isFocusGoal` roster attribution). DNA sits under Goal Contributions, with
  Combo Threat below it (both moved here from Team Insights July 2026).
- **Opponent Insights tab** — the selected club's players (endpoint `/analytics/opponent-player-dna`,
  whole-league tables), between the contributions chart and Combo Threat. Gets ALL 9 spokes incl per-90
  because `league_player_stats` carries minutes for EVERY club, not just Belconnen. Dropdown ranked by
  totalGoals+totalAssists from opponent-players-by-opponent; `__ALL__` and lastN (distinct-date rounds)
  supported, mirroring opponent-goal-combos conventions.

**Shared backend:** both routes call `computeDnaResponse({player, roster, minsMap, appsMap, goals})`
in analytics.ts; goals rows carry a pre-resolved `opponentLabel` (team route: matchOppMap; opponent
route: other side of the fixture). Both reuse the same `PlayerDnaResponse` OpenAPI schema.

## Data mapping (goals table)
- Foot/head: `goals.finish_type` = "Right Foot" / "Left Foot" / "Head" (compare lowercased/trimmed).
- First-touch: `goals.first_time_finish` (boolean; only counts goals where it's non-null).
- Per-90 minutes: sum of `player_stats.mins_played` for the roster player.
- Opponent per goal: `matches.opponent` via `matchId`.

## Tooltip context (squadAvg + first-touch)
The radar tooltip shows **This player / Squad avg / Squad best** plus a context subline
("8 of 19 goals (42%)" for foot/header, "11 of 18 goals finished first-time", "1.50 per 90 mins").
Response carries `squadAvg` (schema `PlayerDnaAverages` — same axes but all fractional, NOT the
integer `PlayerDnaMetrics`), plus `firstTouchYes` / `firstTouchTotal` for the selected player.

**squadAvg population is deliberate, not strict per-axis contributors:**
- goals / foot / header → averaged over ALL scorers (goals>0). **Why:** averaging headers only over
  header-scorers inflates the baseline and makes a genuine aerial threat look ordinary; "avg per
  scorer" is the useful comparison. A code reviewer will flag this as inconsistent — it's intentional.
- assists → over assisters; per-90 → contributors that clear MIN_MINS floor; first-touch % → players
  with first-touch-eligible goals. Non-contributors (zeros) always excluded so they don't drag it down.

## Two non-obvious decisions
- **Per-90 squad-max floor:** rate maxima (goals/90, assists/90) only include players with
  ≥ `MIN_MINS_FOR_RATE_MAX` minutes, so a low-minute cameo can't blow out the scale. Then bump the
  max by the *selected* player's own rate so their spoke is never unreachable.
- **Own-goal exclusion:** assist attribution must skip rows where `scorer === "OG"` (as well as
  `assist === "OG"` and self-assist), mirroring ComboThreat. An assist on an own goal is nonsense and
  would inflate assists / assists-per-90 / topAssistPartner. **Why:** a own goal that counts *for*
  Belconnen enters `ourGoals` via `scorerTeam`, so scorer can legitimately be "OG" in the focus set.
