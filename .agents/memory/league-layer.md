---
name: League layer
description: Multi-league (competition) support — schema shape, invariants, and pending prod migration
---

# League layer

**Model**: `leagues` (id, name unique, region) → `seasons.league_id` NOT NULL → all match/goal/player data hangs off seasonId. `clubs.league_id` NOT NULL too. A season means "one league's one year" (e.g. ACT NPLW 2026). Adding NSW NPL = insert a league + its season + its clubs; nothing else changes.

**Why**: user will track NSW NPL, VIC NPL etc. over time (multi-league SaaS vision in replit.md). Season was already the universal scope key, so the league hangs above it instead of adding leagueId to every data table.

**How to apply**: new features must scope by seasonId (which implies the league); club dropdowns/colour maps should filter clubs by the selected season's leagueId once a second league exists. GET /leagues and Season.leagueId/leagueName are in the API.

**Prod migration is automatic**: api-server runs idempotent startup migrations (`startupMigrations.ts`) before listening — creates `leagues`, backfills league_id on seasons/clubs. Safe to re-run every boot; add future schema upgrades there so Railway deploys self-migrate. Server exits if migrations fail.

**League Setup tab**: Data Entry has a "4 · League Setup" tab — create league → season → clubs (POST /leagues, /seasons, /clubs; admin-only writes). Invariants enforced in DB: unique(league_id, name) on clubs; partial unique index = at most one active season per league (POST /seasons transactionally deactivates that league's others). GET /seasons orders leagueId asc, year desc so "first active" defaults resolve to the original league. Match-entry club dropdown filters clubs by the selected season's league. PG error codes mapped via pgError helper (23505→409, 23503→400).

**Naming rule (user-confirmed)**: clubs/teams are called by their in-league name — the league provides the context. Focus team is named "Belconnen" (not "BUFC NPLW 1sts"); when ACT NPLW Reserves is added, the reserves team also becomes just "Belconnen" in that league. Club names are unique per (league_id, name), NOT globally — same name may exist in several leagues.

**Gotcha**: seed deletes clubs+seasons before leagues (FK order); re-seeds still change all IDs (never hardcode league/season/team IDs). Also: the Edit/WriteFile tooling collapsed `$` in a SQL DO-block once — prefer `CREATE UNIQUE INDEX IF NOT EXISTS` style idempotent statements in startupMigrations over DO blocks.
