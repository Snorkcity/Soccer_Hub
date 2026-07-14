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

## Two non-obvious decisions
- **Per-90 squad-max floor:** rate maxima (goals/90, assists/90) only include players with
  ≥ `MIN_MINS_FOR_RATE_MAX` minutes, so a low-minute cameo can't blow out the scale. Then bump the
  max by the *selected* player's own rate so their spoke is never unreachable.
- **Own-goal exclusion:** assist attribution must skip rows where `scorer === "OG"` (as well as
  `assist === "OG"` and self-assist), mirroring ComboThreat. An assist on an own goal is nonsense and
  would inflate assists / assists-per-90 / topAssistPartner. **Why:** a own goal that counts *for*
  Belconnen enters `ourGoals` via `scorerTeam`, so scorer can legitimately be "OG" in the focus set.
