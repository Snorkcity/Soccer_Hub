---
name: User accounts & league access
description: Real logins replaced the shared club password; per-league admin/viewer access model
---

- users + user_league_access tables; scrypt hashes (lib/passwords); session cookie now carries userId (old role tokens invalid → re-login).
- Access model: is_superadmin = god access (coach only); others get per-league rows role admin|viewer. AuthStatus.role stays "admin"/"viewer" for legacy UI checks (admin = can write somewhere).
- League scoping enforced CENTRALLY in requireSession: any seasonId/leagueId in query OR parsed JSON body is resolved to a league and checked (see/write). **Gotcha:** a new write endpoint that carries scope some other way (path param, nested field) must check access itself.
- POST /leagues is superadmin-only (enforced in middleware). /auth/users CRUD superadmin-only.
- Bootstrap: startup migration creates scott@gameinsights.com.au superadmin from ADMIN_PASSWORD only when users table is empty — prod bootstraps itself on first deploy; coach creates other accounts via the Users page (nav item gated to superadmin).
- Leagues in dev: ACT NPLW (1), ACT NPLW Reserve, ACT NPL Men — IDs volatile per re-seed; never hardcode. Mens league is coach-only; Luke (analyst)/Darren/Illya to get NPLW + Reserve admin.
- **Why:** coach wanted "super properly" — god access for him, least privilege for others, mens league private for scouting.

## Module tick-boxes (2026-07)
- `user_league_access.modules` (jsonb string[]) is the real permission: season-stats, gps, testing, match-prep, reflections, data-entry. Tick = read+write for that module in that league. `role` is legacy, derived (data-entry ⇒ admin) — kept for old UI checks.
- Middleware maps route prefixes → modules (MODULE_ROUTES / WRITE_MODULE_ROUTES in entryAuth). **Gotchas:** GPS routes are `/gps-sessions`+`/gps-player-positions` (no `/gps` prefix); reflections routes live under `/journal`; but `/journal/prematch-brief` + `/journal/week-ahead-brief` belong to match-prep. Setup writes (/seasons,/teams,/clubs,/players,/matches,/goals,/player-stats) are data-entry on WRITE only (their GETs feed everyone's dropdowns).
- Unmapped non-shared writes fall back to "must have data-entry somewhere". Shared writes (/sessions,/library,/assistant,/auth): any signed-in user.
- ID-param deletes (e.g. /entry/goal/:id) carry no seasonId, so handlers self-check the row's league (canEnterDataForSeason) — any NEW id-param write route must do the same or it's a cross-league IDOR.
- Frontend: useLeagueModules() hook; Shell nav via hasModuleAnywhere; pages filter season dropdowns by hasModule(season.leagueId, module); GPS/Testing whole-page gated (they pick team/year not league).
- Startup migration ORDER matters: modules ALTER/backfill must run AFTER runUserAccountsMigration creates the table.
