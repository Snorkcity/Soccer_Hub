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
