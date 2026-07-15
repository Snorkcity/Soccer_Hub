---
name: GPS Insights feature
description: GPS page (Player GPS + Team Overview tabs), metric definitions from the coach's old Dash app, round-code squad parsing, data gaps
---

## Metric definitions (from the coach's reference app in attached_assets/gps_app)
- "High Speed Metres (>18 km/h)" = `sprint_distance_m` column — NOT a zone column.
- "Very High Speed Metres (>25 km/h)" = `distance_zone5_km × 1000`.
- Top speed stored as m/s (`top_speed_ms`); display in km/h (×3.6).
- Accel/decel counts >3 m/s² = sum of the "3 - 4" and "> 4" zone-count bands. Columns `accel_count_3_4`, `accel_count_over_4`, `decel_count_3_4`, `decel_count_over_4` were added later and backfilled from the source CSVs (`lib/db/src/backfillAccelCounts.ts`, run via esbuild bundle since tsx isn't installed); seed + startup migration cover future re-seeds/prod. Both count charts AND max-accel/decel charts exist (how often vs how hard).
- **Squad & position averages:** report comparisons computed client-side in the report dialog from a full-year sessions fetch (reuses buildBundles/bundleTotal so averages match the charts exactly — don't duplicate server-side). Positions live in `gps_player_positions` (player_name PK = exact GPS name; GK/Defender/Midfielder/Forward), edited in Data Entry tab 6; PUT with null position deletes. Averages are per player-game means (weighted by games, not per-player). Position comparisons are **per squad** (e.g. "1sts Midfielders average", key `pos:<squad>`) — coach explicitly does NOT want a club-wide position average; each grade needs its own so a player sees the next level's benchmark. Default report ticks = own squad + squads above on SQUAD_LADDER, for both squad and position groups. Player's position also shown on the report cover line.
- **Player PPTX report:** client-side via pptxgenjs (lazy dynamic import) in `src/lib/playerGpsReport.ts`; input is plain mapped data (no app imports → no cycles). pptxgenjs combo charts use runtime `(typesArray, options)` signature — TS typings only know `(type, data, opts)`, so cast. Pass `null` (not 0) for missing games so charts show gaps, not fake zero bars; nulls verified fine in generated XML.
- **Backfill gotcha:** ~280 training rows have blank player/date/round keys — a blank-key CSV tuple matches ALL of them and sprays its values; the backfill script filters those out. Prod DB still needs the backfill run at next deploy.

## Round codes & squads
- `round` encodes the squad: 2024 uses bare codes (`R2`, `GF`, `FCQ`) for 1sts and `-r` for reserves; 2025+ uses `-1sts`/`-res`/`-18s` (also `-17s`, `R1-V2-17s`). `squadOf()` regex: `-(res|r)$` → Reserves, `-1[78]s$` → 17s/18s, else 1sts. team_id is always 1 — squad selection MUST come from round suffix, not teams table.
- `player_id` is null in gps_sessions; everything keys off `player_name` (first names). GET /gps-sessions supports `playerName` and `split` query params for this.

## Split rows
- Each game has rows per split: `game` (whole match), `1st.half`, `2nd.half`; occasional thirds/Extra-time ignored. Filter `tags === 'game'`.
- Chart convention: stack halves only when BOTH halves exist; otherwise render the game-row total as a single bar (a lone half stacked would show a false-zero half). `bundleTotal` = game row first, halves sum/max as fallback.
- Dates are `DD/MM/YYYY` text; parse manually, treat unparseable as unknown and sort last.

**Why:** these conventions came out of matching the coach's old app exactly (he asked for like-for-like charts) plus an architect-review fix for the lone-half false-zero bug.
