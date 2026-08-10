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

**Player-row delete**: same pattern as goal delete — DELETE /entry/player-stat/:id removes the league row and finds the legacy `player_stats` mirror by exact null-safe match on ALL mirrored fields across the fixture's matches partitions, deleting one candidate only (broad name+club matching risks hitting the wrong/multiple rows). Saved-row list + trash UI sits under the tally badges in the Players form. Deleting rows never prunes `players` — legacy player orphans are accepted for now.

**Goal delete/edit**: no stored link between `league_goals` and legacy `goals` copies — DELETE /entry/goal/:id removes the league row and finds the legacy mirror by exact null-safe match on ALL mirrored fields (isNull vs eq per field) across every matches partition for that fixture; exact duplicates are interchangeable so deleting one is safe, partial-field matching is NOT (can hit the wrong goal). Goal list + delete UI lives under the tally badges in the Goals form; goal query invalidation uses prefix keys (no params) so in-flight saves can't strand another fixture's cache.

**Screenshot reader**: `/entry/extract-players` — base64 image in JSON (express.json 25mb limit scoped to this route only), OpenAI vision via plain fetch to `AI_INTEGRATIONS_OPENAI_BASE_URL` (falls back to `OPENAI_API_KEY` + api.openai.com for Railway). Review-before-save: returns rows + warnings, saves nothing. Prompt enforces SURNAME-ONLY naming (2026-07 change: user's 2026 season data uses surnames only, so extraction matches it directly); initials kept only when two players share a surname (e.g. "J.Bloggs"/"K.Bloggs" + warning). Prompt also encodes Dribl sub-icon minute rules (user-specified 2026-07): red arrow = came off at that minute, green = came on (90 − minute), green+red = red − green, minutes over 90 cap to 90 first, bench+green always counts as an appearance even at 0 mins, ball icon ignored. Verified against a real Dribl screenshot incl. 92' edge cases.

**Future multi-club direction (user-confirmed)**: when clubs get viewer logins, the session will also carry *which club* — Team/Player tabs show the logged-in club's data, Opponent tab shows the rest of the league from their POV. So prefer building charts off the league-wide tables (works for any club) over the legacy Belconnen tables; Belconnen-only extras (Veo possession/shots, GPS, testing) won't exist for other clubs until they enter their own.

**Gotchas**:
- Orval zod const names come from operationId, not schema name — a components schema named identically to `{OperationId}Body` (e.g. `LoginBody` for operationId `login`) breaks codegen with TS2308 export collision. Rename the schema (→ `AdminLoginBody`).
- matchDate stored as "YYYY/MM/DD" strings; date input values must be converted.
- Match ID convention auto-built as `R{round}-{HOME3}-{AWAY3}` client-side, editable.
- Testing subagent [DB] steps query Replit's DATABASE_URL, NOT the Railway DEV_DATABASE_URL this app uses — its DB assertions are false negatives; verify via psql "$DEV_DATABASE_URL" yourself.

**Per-league name format (2026-07):** `leagues.name_format` — coach standard is "S.Smith" ('initial-surname'), the DEFAULT for every league incl. new ones; only ACT NPLW + Reserves are explicitly 'surname' to match their already-entered surname-only history. Extract endpoint takes optional leagueId and swaps the prompt naming rule; frontend passes season.leagueId.
- Saved player rows can be edited in place (name/mins/status): the PATCH route mirrors the delete route pattern — locate the legacy Belconnen copy by exact-match on the row's OLD field values inside the same transaction, never by id. Any new per-row mutation of dual-written data must follow this pattern.

## Shirt numbers (2026-08)
- `league_player_stats.shirt_number` (text) — captured from Dribl jerseys, screenshot extraction, and manual entry. Legacy `player_stats` mirror deliberately has NO column; PATCH strips it from the legacy patch.
- Goals tab # boxes are a **lookup aid only** — goals always store the resolved name, never the number. Auto-filled names are tracked so an unmatched number clears them (no stale attribution). Boxes appear only when the team's saved sheet has numbers.
- Coach-confirmed workflow: Dribl pre-fills scorers; analyst uses the # box mainly for assists.

## Locked goal-coding vocab (2026-08)
- Goal type / Assist type / How penetrated / Buildup lane / Finish are LOCKED shadcn Selects in the Goals tab (constants in DataEntry.tsx, from the coach's spreadsheet) — not free text with datalist any more. Legacy values on old goals are prepended so editing never wipes them.
- Prod typos normalised at the same time ("Through Ball"→"Through ball", "Right Foot9"→"Right Foot"). Hip/Knee finishes left as genuine legacy values.

## Dribl name map — surname-duplicate prevention (Aug 2026)
- Dribl imports name by surname; coach's hand-entered sheets use first names → syncs re-created duplicate roster rows. Fix: on import, `claimName` first prefers a spelling already in saved `league_player_stats` (exact variant OR an unambiguous bare-first-name hit) before minting a new one. Roster is loaded per club per season alongside dribl_name_map.
- Genuinely-new display names are surfaced as `newNames` on preview playerStats blocks AND, for goal-only imports with no lineup, as `newGoalNames` on the match → amber warning in the sync list + a "Player name map" editor card (per club) on the Dribl tab.
- Editing a mapping (`PUT /entry/dribl-name-map/:id`) renames the display AND every already-saved row this season in lockstep: league_player_stats, league_goals (scorer+assist), and the legacy focus-club mirror (player_stats + players + goals). This is how you MERGE a stray variant into the preferred name. Unique index `dribl_name_map_display_unique` → 409 on collision.
- Id-addressed routes self-check league via `mayTouchLeagueRow(req, leagueId, "data-entry")` since central middleware can't see scope.

## Goal Source field (Aug 2026)
- `source` column on goals + league_goals: how the attack started — Buildup / Counter / Press (vocab field `sources`, editable in League Setup like the others).
- Buildup = 6+ passes by the coach's definition; the Goals form auto-picks Buildup when passString >= 6 (sourceAutoRef guards manual choices — only ever overwrite/clear our own auto-pick).
- Assist types Buildup/Counter were REMOVED from vocab and refiled into source by an idempotent startup migration (guarded `source IS NULL` so restarts never clobber manual values).
- Inswinger/Outswinger assist types are dead-ball crosses: only offered when goal type is SP-C or SP-F; cleared only on a coach-initiated goal-type change, never on edit hydration (legacy data survives edits).
