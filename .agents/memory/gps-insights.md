---
name: GPS Insights feature
description: GPS page (Player GPS + Team Overview tabs), metric definitions from the coach's old Dash app, round-code squad parsing, data gaps
---

## Metric definitions (from the coach's reference app in attached_assets/gps_app)
- "High Speed Metres (>18 km/h)" = `sprint_distance_m` column — NOT a zone column.
- "Very High Speed Metres (>25 km/h)" = `distance_zone5_km × 1000`.
- Top speed stored as m/s (`top_speed_ms`); display in km/h (×3.6).
- Accel/decel counts >3 m/s² = sum of the "3 - 4" and "> 4" zone-count bands. Columns `accel_count_3_4`, `accel_count_over_4`, `decel_count_3_4`, `decel_count_over_4` were added later and backfilled from the source CSVs (`lib/db/src/backfillAccelCounts.ts`, run via esbuild bundle since tsx isn't installed); seed + startup migration cover future re-seeds/prod. Both count charts AND max-accel/decel charts exist (how often vs how hard).
- **Squad & position averages:** report comparisons computed client-side in the report dialog from a full-year sessions fetch (reuses buildBundles/bundleTotal so averages match the charts exactly — don't duplicate server-side). Positions live in `gps_player_positions` (player_name PK = exact GPS name; GK/Defender/Midfielder/Forward), edited in Data Entry tab 6; PUT with null position deletes. Averages are per player-game means (weighted by games, not per-player). Position comparisons are **per squad** (e.g. "1sts Midfielders average", key `pos:<squad>`) — coach explicitly does NOT want a club-wide position average; each grade needs its own so a player sees the next level's benchmark. Default report ticks = own squad + squads above on SQUAD_LADDER, for both squad and position groups. Player's position also shown on the report cover line. Coach wants minutes + a normalised number in every chart hover, and normalisation in the report: tooltips show per-90 for additive metrics; report has a dedicated "Per 90 minutes" table slide after "How you compare" (only summable metrics + accel/decel; speed/max metrics deliberately excluded — they don't scale with minutes). ReportComparison carries avg mins/game to enable group per-90.
- **Player PPTX report:** client-side via pptxgenjs (lazy dynamic import) in `src/lib/playerGpsReport.ts`; input is plain mapped data (no app imports → no cycles). pptxgenjs combo charts use runtime `(typesArray, options)` signature — TS typings only know `(type, data, opts)`, so cast. Pass `null` (not 0) for missing games so charts show gaps, not fake zero bars; nulls verified fine in generated XML.
- **Backfill gotcha:** ~280 training rows have blank player/date/round keys — a blank-key CSV tuple matches ALL of them and sprays its values; the backfill script filters those out. Prod DB still needs the backfill run at next deploy.

## GPS match upload (Data Entry tab 6)
- Catapult CSV parsed client-side; header map verified against the real 109-column export (29 columns used, rest ignored). Two file modes: coach's weekly sheet has her own Round/Opponent/Date/Session Title/Mins columns and holds BOTH squads in one file — upload auto-groups by Round column and saves one request per round with form disabled. Raw exports without a Round column fall back to the form (date/round-code/squad/opponent, `round` = `${code}-${squad}`, 2025+ suffix convention). Her I–M columns (Score/Formations/Conditions/Venue) are ignored by design.
- Mins played pre-filled from Duration secs ÷ 60 (matches her sheet values exactly), editable per row before save.
- Paste option: textarea accepts one game's rows (TSV from Excel copy or CSV text) parsed via XLSX string mode; same form fields/flow as file upload. Raw Catapult calls the whole-match split "all" — parser maps it to `game`.
- splitName MUST be canonicalised before save (`game`/`1st.half`/`2nd.half`/`extra-time`). Catapult's real combined ET label is `Extra-time`; readers must classify case-insensitively because seeded history preserves source casing. Unknown periods are warned and skipped, never silently dropped. tags always save as "game".
- Replace-semantics per (year, round, teamId); POST /entry/gps-sessions.

## Round codes & squads
- `round` encodes the squad: 2024 uses bare codes (`R2`, `GF`, `FCQ`) for 1sts and `-r` for reserves; 2025+ uses `-1sts`/`-res`/`-18s` (also `-17s`, `R1-V2-17s`). `squadOf()` regex: `-(res|r)$` → Reserves, `-1[78]s$` → 17s/18s, else 1sts. team_id is always 1 — squad selection MUST come from round suffix, not teams table.
- `player_id` is null in gps_sessions; everything keys off `player_name` (first names). GET /gps-sessions supports `playerName` and `split` query params for this.

## Split rows
- Each game has rows per split: `game` (whole match), `1st.half`, `2nd.half`, and for knockout matches a combined `Extra-time`. Filter `tags === 'game'`.
- Chart/report convention: whole-game values are authoritative. Regulation halves and ET remain visible as period detail; period sums/max are fallback totals only when the game value is absent. Never let a split stack visually replace a present game value.
- Dates are `DD/MM/YYYY` text; parse manually, treat unparseable as unknown and sort last.

**Why:** these conventions came out of matching the coach's old app exactly (he asked for like-for-like charts) plus an architect-review fix for the lone-half false-zero bug.

## Bulk report emailing (2026-08)
- `gps_player_emails(player_name PK, email)` — global table keyed by CANONICAL GPS name; mostly minors' addresses so ALL routes (reads too) are admin-only in-route, on top of session auth.
- Send flow: client builds PPTX via `generatePlayerGpsReport(input, "base64")` and POSTs to `/gps-report-email` per player (sequential loop = per-player progress). Server validates from-address ends `@gameinsights.com.au` (whole domain Resend-verified) and attaches base64.
- `/api/gps-report-email` has its own 25mb json parser mounted AFTER requireSession in app.ts.
- Name-matching gotchas when seeding emails: alias 'Alyssa'→canonical 'DC'; Emily Hay = Emily.H (emilyvhay3@), Emily Evans = Emily.E (evans.emilyh@ — confusingly named).

## Fixture-derived opponents
GPS rounds usually lack an opponent; GET /gps-sessions fills it server-side by matching the round number (R#) to football fixtures: matchId prefix = round code, 1sts = the GPS league's own seasons, Reserves = sibling league named "<league name> Reserves". A Catapult-carried opponent on the row always wins over the fixture lookup.

## GPS development direction for 2027
The coach will be running GPS for the men's U23 and first-grade teams in 2027. They want to explore field-position targets and baselines, and feedback across games that supports one-to-one conversations with players.

**Why:** The user stated this upcoming scope and intends to share literature prepared with ChatGPT to explain the direction.

**How to apply:** Review the supplied literature before defining targets or implementing changes. Treat this as a direction to discuss, not approval to build a particular model.

### Background from the user's ChatGPT work

This project started with the user working with ChatGPT for 24 months, coding, tinkering and building more basic versions. The user says ChatGPT knows their thinking and rationale.

**Why:** the user explicitly asked for this project background to be remembered when sharing their GPS document.

**How to apply:** read the supplied GPS material as a continuation of that work, paying attention to the user's thinking and rationale.

### Confirmed metric and position requirements
Use high-speed metres (HSP) and very-high-speed metres (VHSP), matching the app's existing metric definitions rather than adopting a different threshold from the supplied context.

Keep each player's broad position and add a second, more specific role:
- Defender → CB or FB.
- Midfielder → DM / 6, AM / 10, or B2B / 8.
- Forward → 9 or winger.

**Why:** The coach explicitly confirmed that the metrics should be like the app and that the specific role should be one step after the existing position description.

**How to apply:** Preserve the broad position when adding specific roles; treat the named role and its shirt-number shorthand as the same role, not separate categories. The coach subsequently approved a separate Player Development tab; preserve the legacy GPS comparisons while adding development evidence.

## Future coach methodology presentation

Once the GPS methodology is incorporated into the project, the user definitely wants a PPTX to present to coaches so they understand what is "in the brains" of this part of the project.

**Why:** the user explicitly requested a future coach-facing explanation of the methodology.

**How to apply:** distinguish this methodology presentation from individual player GPS reports. Explain the implemented calculations, reference choices, interpretation limits and coaching use; do not create the deck ahead of the requested incorporation.

## Confirmed men's GPS methodology decisions

- The user says the 10 role has similar physical needs to the 6 role, although their football needs differ. Keep the roles distinct while using similar physical emphasis.
- Keep HSP at 18 km/h because that comes from the Catapult site and the user will use Catapult again. Do not adopt the document's 19 km/h definition.
- Consider older seasons rather than discarding them: in 2028, retain 2027 evidence and show or record whether players' outputs have improved or declined across seasons.
- The user delegates the remaining methodology judgement calls to the agent, recognising that policy or ideal practice cannot always be implemented.

**Why:** the user explicitly settled these points when discussing the methodology for the men's teams.

**How to apply:** preserve historical evidence and make season comparisons distinguishable from changing current averages. Make practical recommendations for unresolved details; this delegation does not itself request immediate implementation.
