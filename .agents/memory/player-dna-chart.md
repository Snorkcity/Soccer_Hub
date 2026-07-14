---
name: Player Scoring DNA radar chart
description: /analytics/player-dna endpoint + PlayerDnaChart radar; data mapping, per-90 squad-max floor, OG exclusion, Team-tab-only scope.
---

# Player Scoring DNA (radar) — Team Insights tab

A player-focused radar with a dropdown (populated from the leaderboard, default = top scorer) and a
Last-3-rounds toggle. 8 numeric spokes, each normalized to `value / squadMax * 100` (clamped 0–100):
Goals, Goals/90, Assists, Assists/90, First-touch %, Right foot, Left foot, Header.

Categorical facts can't be radar spokes (they're names) → shown as **text callouts** beside the web:
favourite opponent, top assist partner, minutes-per-goal, game time.

**Scope:** Belconnen (FOCUS_CLUB) players only, Team Insights tab. NOT shared with the Opponent tab
(unlike the Combo-Threat chart). Reuses `FOCUS_CLUB` / `isFocusGoal` / roster patterns.

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
