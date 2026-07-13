---
name: Goal breakdown as scored-goal list
description: /analytics/goal-breakdown returns raw scored-goal records; frontend buckets them into stacked-by-club charts
---

## What it returns
`/analytics/goal-breakdown` (teamId+seasonId) returns `{ opponents: string[], goals: ScoredGoalRecord[] }`, NOT pre-bucketed counts. Each record carries goalType/assistType/buildupLane/finishType/howPenetrated + scorer/assist + opponent + matchDate. Opponent comes from `matchesTable.opponent` (matches clubs.name, so club colours resolve); goals attributed to us via player_stats roster (scorer in FOCUS_CLUB roster set).

**Why:** one flexible endpoint feeds three Team Insights charts (interval / goal-type / goal-detail-by-dimension), all stacked by opponent club, plus a hover tooltip that lists individual goals for context. Client-side bucketing avoids N endpoints and enables per-goal detail.

## Goal-type x-axis order
Custom order via suffix match (`typeRank`/`TYPE_ORDER = FT-DT, FT-AT, MT-DT, MT-AT, BT-DT, BT-AT, SP-T, SP-F, SP-P, SP-C`); `endsWith` so the "R-" open-play prefix and SP set-piece codes both sort. Unknown codes fall to the end.

## Conceded array + lastN (GS pies + Last-3 toggle)
`/analytics/goal-breakdown` also returns `conceded: ScoredGoalRecord[]` (goals whose scorer is NOT in the FOCUS_CLUB roster, mirroring opponent-goal-breakdown) and accepts an optional `lastN` param (windows to the most-recent N matches by date; applied to matchIds so goals filter too). The GS pie section splits both scored and conceded by goalType: `SP*` = set pieces, else open-play regains (strip `R-` prefix for display).

**Conceded attribution caveat:** roster-name-based conceded overcounts vs the official goals-against (e.g. 10 vs 7) because a few genuinely-scored goals have scorer names not matching the roster set. Kept for consistency with opponent-goal-breakdown; surfaced with a visible UI caveat rather than switching to scorerTeam. **Why:** memory warns scorerTeam strings are unreliable; changing only conceded to scorerTeam would make scored/conceded use different attribution.

Pie tooltip (user says hovers are "ultra important"): shows count, percent of GRAND total (all goals incl. untyped, = records.length), and the group's share of grand total. On-arc labels also show percent-of-grand-total (not within-donut share), matching the reference dashboard.

## Extra record fields (unlock client-side charts)
`ScoredGoalRecord` also carries `matchId`, `passString`, `goalX`, `goalY`, `firstTimeFinish` (coords `Number()`-coerced from numeric DB cols; drizzle goalsTable props are camelCase: firstTimeFinish/passString/goalX/goalY). `matchId` lets the client merge scored+conceded into per-match timelines. Pass-string is empty/null for set pieces → bucket as "Set play / n.a.".

Also carries match-level metadata mirrored onto every record: `matchCode` (= `matchesTable.matchId` text, e.g. "R1-WAN-BEL" = round + home-away 3-letter club codes; BEL = Belconnen) and `matchResult` ("W"/"D"/"L"). **Why:** the First Goal Value Index chart needs the round code for its hover match-list, and W/D/L MUST come from the recorded final score (`goalsScored`/`goalsConceded`), NOT from goal-count attribution (roster/OG heuristics can misattribute and flip results). First-goal *side* (SF/CF) still uses event order from timelines (only signal available; minute-granularity ties resolve to "for" via insertion order — a known ambiguity).

## Isolated per-chart Last-3 toggles
There are TWO goal-breakdown queries: `goalBreakdownFull` (no lastN) and `goalBreakdownL3` (lastN:3). Each Team Insights chart owns its own boolean (`l3ScInt`/`l3ScType`/... `l3CcDet`) and picks its source via `pick(l3) = l3 ? L3 : Full`. **Why:** user requires each chart's "Last 3 rounds" button to affect ONLY that chart. Do NOT reintroduce a single shared `teamLastN`. Conceded charts stack by `oppsOf(conceded)` (the team that scored) with a separate `hiddenConcededClubs` set + `concededDim`.

## Goal Location Map coordinate contract
Vertical attacking-third pitch, goal at TOP. `goalX` is 0–100 across the full pitch WIDTH; `goalY` is in YARDS from the goal line (0 = on the line). A point at y=18 must sit exactly on the 18-yard-box (penalty area) edge; y=6 = six-yard line; y=12 = penalty spot. Component draws in yards: width mapped 100→80yd (`fx = gx*0.8`, 0.8 yd/unit) so the pitch keeps true proportions; `fy = gy`. Scored = blue dot (#3b82f6), conceded = red ✕. Has own club + goal-type dropdown filters and a rich hover card (Vs/Scorer/Goal Type/Finish/Minute/First-time). **Why:** the Goal Map data-entry tool records these exact units; DB confirms goal_x 10–78.8, goal_y 0.9–29.2.

## Blank goalType is intentional (conceded-by-type)
In /analytics/opponent-profile, conceded goals with blank/empty `goalType` are SKIPPED (not bucketed as "Unknown"). Scored side still falls back to "Unknown". **Why:** a blank goal type is a deliberate data-entry choice, not missing data, so it shouldn't create a spurious "Unknown" column on the Goals Conceded by Type chart. Trim before testing truthiness (`g.goalType?.trim()`).

## Philosophy Alignment quadrant (Team Insights)
Scatter, one point per match, from the existing GET /matches (useListMatches) — NO analytics endpoint needed; the matches table already stores possession/shots/passes/oppShots/oppPasses/quadrantPoints. x = possession % (axis fixed 20–80, midline 50; 0–20/80–100 are unheard-of in soccer so off-chart on purpose). y = "Quadrant Points" composite computed CLIENT-SIDE from raw columns: `4*goalsScored + shots + passes/10 - 4*goalsConceded - oppShots - oppPasses/10`. The DB `quadrant_points` text col is just this rounded to a whole number — recompute from raw cols to keep decimals (authoritative). **Must** require ALL six inputs non-null before plotting (not just possession) or missing stats impute to 0 and shift a point into the wrong quadrant. Quadrant labels (user-approved): TR "Our Way, Rewarded", TL "Backs to the Wall", BR "Ball, No Bite", BL "Outplayed". Colour dots by opponent club (one <Scatter> per club for a club legend). **Why:** source is an Excel "team-based" tab; formula verified against Croatia 3-3 → -1.9≈-2.

## Empty-state gotcha
Interval builder maps a fixed 6 buckets, so it ALWAYS has rows — `OpponentStackChart`'s `data.length===0` empty path never fires. Must early-return `[]` when there are no scored goals / no opponents, or the chart renders blank instead of "No goals recorded".
