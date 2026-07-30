---
name: Dev DB refresh from prod
description: How to sync dev database data from the live prod database on demand
---

Run `bash scripts/refresh-dev-from-prod.sh` to copy all DATA tables prod → dev (read-only on prod).

**Key facts:**
- Excludes account tables: `users`, `password_reset_tokens`; `user_league_access` is snapshotted before TRUNCATE (CASCADE from `leagues` wipes it) and restored afterwards.
- The `sessions` table is coaching session plans (data), NOT login sessions — auth is cookie-based with no session table — so it IS copied.
- Script aborts if prod/dev URLs point at the same server, or if any table's columns differ (run dev migrations first on drift).
- Sequences reset to max(id) after copy; tables without an `id` column (e.g. gps_player_aliases, curriculum_chunks) are skipped.
- After a refresh, dev team/season IDs become prod's IDs — expected; frontend auto-selects.

**Why:** prod is the source of truth (weekly GPS uploads); dev snapshots go stale and games look "missing" during development.
