---
name: Goal-map coordinate contract & scoring cone
description: What goalX/goalY mean, how they map to real pitch markings, and the scoring-cone inside/outside model used by "Scoring Cone by Player" and the DNA Cone % spoke.
---

# Goal-map coordinates (goals.goal_x / goal_y)

**Contract (goal-at-top, attacking third):**
- `goalX`: 0–100 across the full pitch **width**; goal centre = 50, posts at 45 & 55 (goal 8 yd wide).
- `goalY`: **yards from the goal line** (0 = on the line). So goalY=18 sits on the 18-yard-box line.
- 1 yd of width = **1.25 goalX units** (80-yd pitch width mapped to 0–100).
- **NOT** the old sideways layout. The corrected Goal Location Map (SeasonStats `GoalLocationMap`)
  is authoritative — goal at TOP, y = distance out. The standalone Goal Map tool will be changed to match.

Observed dev-data ranges: goalX 10–79, goalY ~1–29 (yards).

**Pitch markings in gx/gy units:** penalty area gy ≤ 18, gx 22.5–77.5; six-yard box gy ≤ 6, gx 37.5–62.5;
penalty spot gy=12, gx=50.

# Scoring cone (user's preferred close/far model — replaced the box-zone scheme)

The user explicitly rejected six-yard/penalty-area/outside buckets in favour of the **scoring cone**:
lines from each goalpost flaring at 45° so they pass through the penalty-area corners at 18 yds.

**Inside-cone test:** `gx >= 45 - 1.25*gy && gx <= 55 + 1.25*gy` (no depth cap).

Used in two places (keep them in sync):
- Backend `/analytics/player-dna`: per-player `coneYes/coneTotal` over mapped goals → `conePct` metric
  (+ squadMax/squadAvg; avg over players with coneTotal>0, same population style as firstTouchPct).
- Frontend "Scoring Cone by Player" chart (Team Insights, after Goal Location Map): client-side 2-segment
  stacked bars from `goalBreakdownFull/L3` `.goals` (goalX/goalY are **number|null** there — converted
  upstream, don't compare to ""). Excludes own goals (`toUpperCase() === "OG"`) and unmapped coords.

**ConeDiagram** mini SVG (SeasonStats) gives visual context — shown in the chart header and in the DNA
tooltip for the Cone % spoke. The user wants the cone picture visible wherever the cone is referenced.

Dev sanity: DC 19/19 inside (100%), squad avg 94.1% — most goals in this data are central.
