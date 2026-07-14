---
name: League layer
description: Multi-league (competition) support — schema shape, invariants, and pending prod migration
---

# League layer

**Model**: `leagues` (id, name unique, region) → `seasons.league_id` NOT NULL → all match/goal/player data hangs off seasonId. `clubs.league_id` NOT NULL too. A season means "one league's one year" (e.g. ACT NPLW 2026). Adding NSW NPL = insert a league + its season + its clubs; nothing else changes.

**Why**: user will track NSW NPL, VIC NPL etc. over time (multi-league SaaS vision in replit.md). Season was already the universal scope key, so the league hangs above it instead of adding leagueId to every data table.

**How to apply**: new features must scope by seasonId (which implies the league); club dropdowns/colour maps should filter clubs by the selected season's leagueId once a second league exists. GET /leagues and Season.leagueId/leagueName are in the API.

**Pending — prod migration**: Railway prod DB does NOT have this yet (work unpushed). On next deploy run the equivalent SQL: create `leagues`, insert 'ACT NPLW', add `league_id` to seasons+clubs, backfill, SET NOT NULL. Seed.ts handles fresh databases.

**Gotcha**: seed deletes clubs+seasons before leagues (FK order); re-seeds still change all IDs (never hardcode league/season/team IDs).
