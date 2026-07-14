---
name: GPS player identity merging
description: How duplicate GPS names (U17-/U18- eras, nicknames) pool into one canonical player and link to season-stats names
---

# GPS player identity merging

**Rule:** never rewrite raw `gps_sessions.player_name`. Duplicate identities are merged at **read time**: `gps_player_aliases` (alias → canonical) is LEFT JOINed in GET /gps-sessions (COALESCE serves + filters by canonical) and applied as a map in /analytics/gps-load-summary. `player_identity_links` (canonical → season_stats_name) records the cross-app link where names differ (Danijela↔Dani, Sam↔Sammy, Emily.H↔Emily).

**Why:** future GPS imports arrive with raw/old names; read-time canonicalisation keeps pooling correct without touching the import path. Coach confirmed the who-is-who mapping (July 2026).

**How to apply:**
- New duplicate identity → INSERT into `gps_player_aliases` (seeded idempotently in startupMigrations with ON CONFLICT DO NOTHING, so manual DB edits survive deploys; no UI yet — coach asks in chat).
- `gps_player_positions` is keyed by **canonical** name; migration re-keys alias rows (min(position) tie-break).
- Frontend needs no awareness — it only ever sees canonical names.
- Unresolved as of July 2026: Mackenzie vs U18-Mack, Maddie vs Maddy, and remaining U17-/U18- prefixed juniors left unmapped on purpose.
- Verified: no same-game dual-name collisions exist in the data (checked year+round+split per canonical).
