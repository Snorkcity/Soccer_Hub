---
name: Data Entry feature
description: How the password-gated data-entry flow works — auth scheme, dual-write rules, screenshot reader contract
---

# Data Entry (BUFC hub)

**Auth**: stateless HMAC cookie `bufc_entry` signed with SESSION_SECRET (middleware `entryAuth.ts`); ALL mutating `/api` requests require it (reads stay public). Password checked against `ADMIN_PASSWORD` env — when unset, entry is locked everywhere (no dev fallback). Railway prod needs `ADMIN_PASSWORD` set manually.

**Dual-write rules** (all wrapped in db.transaction — never write these tables separately):
- `/entry/match` → `league_matches` always + Belconnen `matches` row (Veo fields, cleanSheet computed) when Belconnen plays.
- `/entry/goal` → `league_goals` always + legacy `goals` (keyed by `matches.id`, not matchId text) for Belconnen fixtures.
- `/entry/player-stats` → replace semantics (delete+insert per match+club) into `league_player_stats`, mirrored into legacy `player_stats` (creates `players` rows on first sight, lookup by name+club). `player_stats` holds BOTH teams' rows for Belconnen games.

**Why**: legacy Belconnen tables still drive team-tab charts; league tables drive ladder/opponent charts. Entering once must feed both.

**Screenshot reader**: `/entry/extract-players` — base64 image in JSON (express.json 25mb limit scoped to this route only), OpenAI vision via plain fetch to `AI_INTEGRATIONS_OPENAI_BASE_URL` (falls back to `OPENAI_API_KEY` + api.openai.com for Railway). Review-before-save: returns rows + warnings, saves nothing. Prompt enforces "J.Bloggs" (first-initial.surname) naming — user requirement to avoid duplicate-player issues from surname-only data.

**Gotchas**:
- Orval zod const names come from operationId, not schema name — a components schema named identically to `{OperationId}Body` (e.g. `LoginBody` for operationId `login`) breaks codegen with TS2308 export collision. Rename the schema (→ `AdminLoginBody`).
- matchDate stored as "YYYY/MM/DD" strings; date input values must be converted.
- Match ID convention auto-built as `R{round}-{HOME3}-{AWAY3}` client-side, editable.
- Testing subagent [DB] steps query Replit's DATABASE_URL, NOT the Railway DEV_DATABASE_URL this app uses — its DB assertions are false negatives; verify via psql "$DEV_DATABASE_URL" yourself.
