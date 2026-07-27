---
name: On-field impact minute-window model
description: How team GD is attributed to players in the Opponent Insights On-Field Impact chart
---
The opponent on-field impact endpoint attributes goals by minute windows, NOT the binary whole-match model used by the Belconnen Player-tab leaderboard.

Rule: starter who played M mins is on for [0, M]; a sub is on for [L−M, L] where L = max(90, max goal minute, max minsPlayed in that match). Only goals inside the window count toward that player's GF/GA. Per-opponent entries let the client exclude opponents ("take out easy games") and recompute GD/per-90/min-mins client-side.

**Why:** coach explicitly asked for this refinement — goal minutes exist for every league goal and started+minsPlayed for every appearance, so binary credit was needlessly coarse.

**How to apply:** if the Player-tab (Belconnen) impact chart is ever revisited, coach may want the same model there. Known approximation (told to coach): a sub who is later subbed off again is assumed to play to full time. Data quirk: 2 league matches have goal-row counts ≠ scoreline (seed gaps); goal rows are treated as truth here.
