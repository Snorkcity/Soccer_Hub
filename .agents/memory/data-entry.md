---
name: Data Entry feature
description: How the password-gated data-entry flow works — auth scheme, dual-write rules, screenshot reader contract
---

# Data Entry (BUFC hub)

**Auth**: whole app is behind login. Stateless HMAC cookie `bufc_session`, token `exp.role.hmac` signed with SESSION_SECRET (middleware `entryAuth.ts`). Roles: `admin` (view + write; the single ADMIN_PASSWORD grants it today) and `viewer` (view-only, reserved for future club coach logins — user plans 3-4 logins per club, plus a 2nd admin later). Middleware gates ALL `/api` routes except `/auth/*`: any role reads, only admin writes. Frontend `AuthGate` wraps the router (no data loads pre-login); Data Entry page additionally requires role==="admin". When ADMIN_PASSWORD unset, everything is locked (no dev fallback). Railway prod needs `ADMIN_PASSWORD` set manually. **Why roles-in-token now:** user explicitly wants future multi-login growth without rework — add credentials at login, keep the single gate.

**Dual-write rules** (all wrapped in db.transaction — never write these tables separately):
- `/entry/match` → `league_matches` always + Belconnen `matches` row (Veo fields, cleanSheet computed) when Belconnen plays.
- `/entry/goal` → `league_goals` always + legacy `goals` (keyed by `matches.id`, not matchId text) for Belconnen fixtures.
- `/entry/player-stats` → replace semantics (delete+insert per match+club) into `league_player_stats`, mirrored into legacy `player_stats` (creates `players` rows on first sight, lookup by name+club). `player_stats` holds BOTH teams' rows for Belconnen games.

**Why**: legacy Belconnen tables still drive team-tab charts; league tables drive ladder/opponent charts. Entering once must feed both.

**Screenshot reader**: `/entry/extract-players` — base64 image in JSON (express.json 25mb limit scoped to this route only), OpenAI vision via plain fetch to `AI_INTEGRATIONS_OPENAI_BASE_URL` (falls back to `OPENAI_API_KEY` + api.openai.com for Railway). Review-before-save: returns rows + warnings, saves nothing. Prompt enforces SURNAME-ONLY naming (2026-07 change: user's 2026 season data uses surnames only, so extraction matches it directly); initials kept only when two players share a surname (e.g. "J.Bloggs"/"K.Bloggs" + warning). Prompt also encodes Dribl sub-icon minute rules (user-specified 2026-07): red arrow = came off at that minute, green = came on (90 − minute), green+red = red − green, minutes over 90 cap to 90 first, bench+green always counts as an appearance even at 0 mins, ball icon ignored. Verified against a real Dribl screenshot incl. 92' edge cases.

**Future multi-club direction (user-confirmed)**: when clubs get viewer logins, the session will also carry *which club* — Team/Player tabs show the logged-in club's data, Opponent tab shows the rest of the league from their POV. So prefer building charts off the league-wide tables (works for any club) over the legacy Belconnen tables; Belconnen-only extras (Veo possession/shots, GPS, testing) won't exist for other clubs until they enter their own.

**Gotchas**:
- Orval zod const names come from operationId, not schema name — a components schema named identically to `{OperationId}Body` (e.g. `LoginBody` for operationId `login`) breaks codegen with TS2308 export collision. Rename the schema (→ `AdminLoginBody`).
- matchDate stored as "YYYY/MM/DD" strings; date input values must be converted.
- Match ID convention auto-built as `R{round}-{HOME3}-{AWAY3}` client-side, editable.
- Testing subagent [DB] steps query Replit's DATABASE_URL, NOT the Railway DEV_DATABASE_URL this app uses — its DB assertions are false negatives; verify via psql "$DEV_DATABASE_URL" yourself.
