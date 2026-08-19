---
name: League-private coaching data
description: League and club ownership rules for private coaching evidence in multi-club accounts.
---

Match Prep reports, journal cycles/entries (reflections), GPS sessions and athletic tests each carry `league_id NOT NULL` (backfilled to ACT NPLW by an idempotent startup migration).

**Rules for any new or changed feature touching these tables:**
- List endpoints REQUIRE a `leagueId` query param (400 without it); central middleware in entryAuth enforces access; superadmin bypasses.
- Id-addressed routes (PATCH/DELETE/GET by id) must load the row's league and check via `mayTouchLeagueRow(req, leagueId, module)`.
- Create bodies require `leagueId`; journal cycle entries inherit their cycle's league.
- Frontend passes `activeLeagueId` from `useActiveLeague()` into params AND the generated queryKey; gate queries with `enabled: activeLeagueId != null`. DataEntry uploads use its own selected season's `leagueId`.
- Any snapshot/sync inserter into these tables (e.g. journal snapshot sync in startup migrations) must stamp `league_id` too, or fresh DBs fail NOT NULL at boot.

Reflections (cycles and standalone entries), saved Match Prep reports and saved Football Match Reports also carry club ownership. The server resolves and stamps the club from the authenticated league grant (or validated superadmin override); clients never choose it.

**Club-ownership rules:**
- Lists filter by exact league + club, and id-addressed reads/writes check both. A cross-club id should look absent (404), not reveal that another club owns it.
- Cycle entries inherit their cycle's club. Legacy rows are backfilled to the league's recorded focus club, never inferred from a report title, opponent or free text.
- Every AI generation route (persistent Assistant, Week Ahead, pre-match talk/brief, and future helpers) may include private rows only for the exact server-resolved club and enabled source module. Private-data helpers should require club identity themselves, not rely only on caller gates. Veo/legacy selected-match evidence remains focus-club-only until it has durable club ownership.

**Why:** a single league can now contain accounts for several clubs. League-only checks would expose one club's coach-authored reflections, plans and reports to another club in that league.

League separation still matters too: switching the Hub to Reserves or a future league must never surface another league's prep, reflection, GPS or testing data.

**Pricing tiers (coach-decided Jul 2026, BUILT):** basic subscription = season stats, match prep, reflections (+ data entry). Paid add-ons are module tick boxes: `session-planner` (Session Planner + Session Library) and `assistant` (Coach Assistant). These two use ANYWHERE semantics — visible if ticked in any of the user's leagues (tools aren't league-scoped); nav/Home use hasModuleAnywhere, server checks module-anywhere for unscoped requests. Existing users were granted both once via a one-shot marker migration (addon-modules-grant-v1) so later unticks stick.

**Coach-confirmed convention (Jul 2026):** within a club's program, GPS and Testing data always live under the FIRSTS league; the reserves league view shows them empty. Reserves coaches who should see GPS/testing get viewer access to the firsts league instead of moving data. Same model applies to future clubs — everything isolated per league-team, firsts holds the physical-performance data.

Known gap (accepted for now): AI brief/deck context helpers (opponent profile, match lookups) still pick seasonId from broad season lists, not strictly the active league — fine while only NPLW has analytics data.
