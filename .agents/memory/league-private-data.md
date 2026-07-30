---
name: League-private coaching data
description: Match Prep, Reflections, GPS and Testing rows are stamped with league_id; every list/create must carry leagueId.
---

Match Prep reports, journal cycles/entries (reflections), GPS sessions and athletic tests each carry `league_id NOT NULL` (backfilled to ACT NPLW by an idempotent startup migration).

**Rules for any new or changed feature touching these tables:**
- List endpoints REQUIRE a `leagueId` query param (400 without it); central middleware in entryAuth enforces access; superadmin bypasses.
- Id-addressed routes (PATCH/DELETE/GET by id) must load the row's league and check via `mayTouchLeagueRow(req, leagueId, module)`.
- Create bodies require `leagueId`; journal cycle entries inherit their cycle's league.
- Frontend passes `activeLeagueId` from `useActiveLeague()` into params AND the generated queryKey; gate queries with `enabled: activeLeagueId != null`. DataEntry uploads use its own selected season's `leagueId`.
- Any snapshot/sync inserter into these tables (e.g. journal snapshot sync in startup migrations) must stamp `league_id` too, or fresh DBs fail NOT NULL at boot.

**Why:** switching the Hub to Reserves (or a future club) must never show another league's prep files/reflections/GPS/testing.

**Coach-confirmed convention (Jul 2026):** within a club's program, GPS and Testing data always live under the FIRSTS league; the reserves league view shows them empty. Reserves coaches who should see GPS/testing get viewer access to the firsts league instead of moving data. Same model applies to future clubs — everything isolated per league-team, firsts holds the physical-performance data.

Known gap (accepted for now): AI brief/deck context helpers (opponent profile, match lookups) still pick seasonId from broad season lists, not strictly the active league — fine while only NPLW has analytics data.
