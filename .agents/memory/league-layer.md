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

**Campaign presentation (user-approved):** competition and season are separate choices, not a new league for every year. The coach approved explicit context such as ACT NPLM | 2027 season, with retained access to 2026. November 2026 preseason sessions may belong to the 2027 campaign while retaining their actual dates.

**Why:** new preseason GPS evidence arrives before March fixtures, and the coach must not confuse it with the previous season.

**How to apply:** do not infer the campaign solely from a session's calendar year. Keep chosen campaign context consistent across navigation, uploads, reports and roster views; absence of new-season measurements must not silently fall back to the prior year's data.

Year drives the selection, not the team: show a year-first selector covering every accessible campaign year, then only competitions created for that year. Switching competitions must retain that year.

**Why:** the coach found the full historical competition list confusing when viewing 2027, then clarified that the year must drive selections so they do not have to scroll teams to reach another year.

**How to apply:** use actual accessible season records, not fixture availability or the active-season flag. Keep the full authorised competition list separate from this navigation filter. Preserve the competition if it exists in the chosen year; otherwise select one available in that year, resolving competition and season together.

For the men's 2027 setup, first-grade and U23 GPS stay together under ACT NPLM. ACT NPLM U23 remains a separate competition for match data; do not automatically feed or link its GPS. U23 coaches should receive access to the ACT NPLM GPS area for their players.

**Why:** the coach explicitly confirmed this arrangement rather than linking U23 GPS.

**How to apply:** preserve separate match campaigns and use explicit access grants for coaches; do not duplicate training sessions into U23.

**Gotcha**: seed deletes clubs+seasons before leagues (FK order); re-seeds still change all IDs (never hardcode league/season/team IDs). Also: the Edit/WriteFile tooling collapsed `$` in a SQL DO-block once — prefer `CREATE UNIQUE INDEX IF NOT EXISTS` style idempotent statements in startupMigrations over DO blocks.
