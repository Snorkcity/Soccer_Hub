---
name: Player timeline drill-down
description: Click-a-player drill-down on Starts & Appearances charts → game-by-game Start/Bench/Out line chart
---

Both Starts & Appearances charts (Player tab + Opponent Insights) support clicking a player's bar to swap the chart area for `/analytics/player-timeline` (seasonId, club, player) — every club fixture in chronological order with status start/bench/out + minutes, so missed games show as gaps.

**Key decisions**
- Frontend reverses the array: most recent match on the LEFT (coach asked to read the season right-to-left — "are they playing lately?").
- Endpoint is club-scoped over league tables, so it works for Belconnen (Player tab, club="Belconnen") and any opponent club alike.
- Click extraction must use `activePayload[0].payload` (fullName on Player tab where display names are shortened via `sn`; `name` on opponent chart where it's already the raw playerName) — never the shortened axis label on the Player tab.
- Drill-down state resets on club AND season/team change; card controls (Last-3 toggle / sort pills) are hidden while drilled in because they don't apply to the timeline view.

**How to apply:** reuse `PlayerTimelineChart` in SeasonStats for any future per-player drill-down; pass `timeline={{ seasonId, club }}` to `PlayerBarCard` to enable clicking.
