---
name: GPS Insights feature
description: GPS page (Player GPS + Team Overview tabs), metric definitions from the coach's old Dash app, round-code squad parsing, data gaps
---

## Metric definitions (from the coach's reference app in attached_assets/gps_app)
- "High Speed Metres (>18 km/h)" = `sprint_distance_m` column — NOT a zone column.
- "Very High Speed Metres (>25 km/h)" = `distance_zone5_km × 1000`.
- Top speed stored as m/s (`top_speed_ms`); display in km/h (×3.6).
- **Data gap:** accel/decel *zone counts* (>3 m/s²) from the old app were never imported — only `max_acceleration_mss`/`max_deceleration_mss` exist. The accel/decel chart shows maxes as a disclosed substitute. If the coach re-imports GPS CSVs, adding the count columns would restore the original chart.

## Round codes & squads
- `round` encodes the squad: 2024 uses bare codes (`R2`, `GF`, `FCQ`) for 1sts and `-r` for reserves; 2025+ uses `-1sts`/`-res`/`-18s` (also `-17s`, `R1-V2-17s`). `squadOf()` regex: `-(res|r)$` → Reserves, `-1[78]s$` → 17s/18s, else 1sts. team_id is always 1 — squad selection MUST come from round suffix, not teams table.
- `player_id` is null in gps_sessions; everything keys off `player_name` (first names). GET /gps-sessions supports `playerName` and `split` query params for this.

## Split rows
- Each game has rows per split: `game` (whole match), `1st.half`, `2nd.half`; occasional thirds/Extra-time ignored. Filter `tags === 'game'`.
- Chart convention: stack halves only when BOTH halves exist; otherwise render the game-row total as a single bar (a lone half stacked would show a false-zero half). `bundleTotal` = game row first, halves sum/max as fallback.
- Dates are `DD/MM/YYYY` text; parse manually, treat unparseable as unknown and sort last.

**Why:** these conventions came out of matching the coach's old app exactly (he asked for like-for-like charts) plus an architect-review fix for the lone-half false-zero bug.
