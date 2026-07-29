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

## Per-user club (2026-07)
- Access hierarchy is league → club → modules: `user_league_access.club` (nullable) is the person's OWN club in that league; Team/Player insights centre on it. NULL falls back to `leagues.focus_club`.
- Server resolution: `focusClubForRequest(req, seasonId)` in api-server lib/focusClub — user grant club wins, else cached league default. ALL analytics + data-entry focus-club call sites use it; any NEW endpoint needing "our club" must too (never call focusClubForSeason directly from a route).
- Club is validated against clubs table for that league on user create/update (400 otherwise). Only superadmin can set it (users CRUD is superadmin-only).
- **Why:** multi-club future — two clubs sharing one league's data, each coach seeing their own club's insights.

## Self-service & password reset (2026-07)
- My Account page (`/account`, shared nav): self name/email (PATCH /auth/profile) + change password + logout. Profile route must clear the per-request `_sessionUser` cache before re-reading, or the response shows stale data.
- Forgot-password: POST /auth/forgot-password (always {ok:true}, never reveals account existence) emails a one-hour single-use link; POST /auth/reset-password {token,newPassword}. Tokens stored sha256-hashed in password_reset_tokens (idempotent startup migration). Both routes are in the unauthenticated allow-list in entryAuth.
- Reset links use `?reset_token=` on the app root (no dedicated route — AuthGate intercepts before auth), so they work under any base path. Base URL: prod pinned to app.gameinsights.com.au, dev derived from Referer.
- Email sending: Resend REST API with RESEND_API_KEY, from noreply@gameinsights.com.au. Key must ALSO be set on Railway (Replit connectors don't work off-platform — that's why plain API key over the Resend connector). Sending fails 403 until the domain is verified at resend.com/domains.

## League/club selection UI (2026-07)
- Season Stats header: League dropdown → seasons of that league → club. Non-superadmins never pick a club (server resolves grant club / league default via focusClubForRequest).
- Superadmin club switcher sends `X-Focus-Club` header on every request (setDefaultHeaders in api-client-react custom-fetch). Server honours it ONLY for superadmins and only if the club exists in the season's league.
- **Why:** query keys don't include the header, so a club switch must removeQueries on /analytics/* + invalidate, or stale club data flashes.
- **How to apply:** any new page that shows focus-club-scoped data should reuse this pattern rather than adding club params to every endpoint.

## App-wide active league (2026-07)
- League is picked ONCE on the Hub (LeagueContext, localStorage-persisted); it drives sidebar nav, Hub cards, Season Stats. Users with one league see no dropdown. Data Entry keeps its own League·Season select (cross-league on purpose).
- **Why:** which league is active determines which modules/badges a user sees; Scott wanted a single choice point up front.
- **How to apply:** new module pages must gate with hasModule(activeLeagueId, module) (route-level, not just nav) and scope their season lists to the active league.
