---
name: Goal-map coordinate contract & poacher zone
description: What goalX/goalY mean, how they map to real pitch markings, and the poacher-zone model behind the DNA "Poacher %" spoke.
---

# Goal-map coordinates (goals.goal_x / goal_y)

**Contract (goal-at-top, attacking third):**
- `goalX`: 0–100 across the full pitch **width**; goal centre = 50, posts at 45 & 55 (goal 8 yd wide).
- `goalY`: **yards from the goal line** (0 = on the line). So goalY=18 sits on the 18-yard-box line.
- 1 yd of width = **1.25 goalX units** (80-yd pitch width mapped to 0–100).
- **NOT** the old sideways layout. The corrected Goal Location Map (SeasonStats `GoalLocationMap`)
  is authoritative — goal at TOP, y = distance out.

Observed dev-data ranges: goalX 10–79, goalY ~1–29 (yards).

**Pitch markings in gx/gy units:** penalty area gy ≤ 18, gx 22.5–77.5; six-yard box gy ≤ 6, gx 37.5–62.5;
penalty spot gy=12, gx=50.

# Poacher zone (current close/far model — replaced BOTH the box-zone scheme and the scoring cone)

Model evolution (all user-driven): six-yard/box/outside zones → 45° scoring cone → **poacher zone**.
The user's intent: distinguish **poachers from long-rangers**. Final definition: the strip directly in
front of goal, **post-to-post wide and out to 10 yds** from the goal line.

**Inside test:** `gx >= 45 && gx <= 55 && gy <= 10`.

The standalone per-player chart ("Scoring Cone by Player") was **removed as not important enough** —
the metric lives ONLY as the DNA radar spoke. Don't resurrect a standalone chart for it.

- Backend `/analytics/player-dna`: per-player `poacherYes/poacherTotal` over mapped goals → `poacherPct`
  metric (+ squadMax/squadAvg; avg over players with poacherTotal>0, same population as firstTouchPct).
- Frontend: `Poacher %` spoke in DNA_AXES; tooltip context "X of Y mapped goals from the poacher zone
  (post-to-post, within 10 yds)" + **PoacherZoneDiagram** mini SVG (user wants the zone picture visible
  wherever the metric is referenced).

Dev sanity: DC 8/19 (42.1%), squad avg 35.3%; league-wide 37/96 mapped goals in zone — good discrimination
(the old cone was ~94-100% for everyone, too loose).
