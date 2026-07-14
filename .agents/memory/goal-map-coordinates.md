---
name: Goal-map coordinate contract & scoring zones
description: What goalX/goalY mean, how they map to real pitch markings, and the six-yard/penalty-area/outside zone split used by "Scoring Zones by Player".
---

# Goal-map coordinates (goals.goal_x / goal_y)

**Contract (goal-at-top, attacking third):**
- `goalX`: 0–100 across the full pitch **width**; goal centre = 50.
- `goalY`: **yards from the goal line** (0 = on the line). So goalY=18 sits on the 18-yard-box line.
- **NOT** the old sideways layout. An early version drew the goal on the right/side; the corrected
  Goal Location Map (SeasonStats `GoalLocationMap`) is the authoritative orientation — goal at TOP,
  y = distance out. The standalone Goal Map tool is being changed to match this too.

Observed dev-data ranges: goalX 10–79, goalY ~1–29 (yards).

**Pitch markings in map units** (GoalLocationMap uses fx = goalX*0.8 → yards, fy = goalY):
- Goal mouth: gx 45–55 (8 yd wide, centre 50). Penalty spot: gy=12, gx=50.
- Penalty area (18-yd box): gy ≤ 18 and gx 22.5–77.5.
- Six-yard box: gy ≤ 6 and gx 37.5–62.5.

# Scoring Zones by Player (SeasonStats, Team Insights)

Client-side only — reuses `goalBreakdownFull/L3` `.goals` (ScoredGoalRecord already carries scorer +
goalX/goalY as **number|null**, converted upstream — do NOT compare them to `""`). Buckets each goal via
`goalZone(gx,gy)`: six-yard first, then penalty area, else outside (order matters so six isn't double-
counted). Excludes own goals (`scorer.toUpperCase() === "OG"`) and unmapped coords (shown as a count).
Stacked horizontal bar per scorer + Last-3 toggle. Dev sanity split: 23 six-yard / 61 box / 12 outside.
