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

## User-authorised transfers from test to live

Treat an accidental test-site entry as a narrowly scoped data transfer, not a reason to reverse the full database refresh. Match canonical player identities within the requested club in both environments, preserve the original live assignments, and apply only the requested fields in one transaction. Abort if the live snapshot has changed; verify the committed values against the saved test snapshot.

**Why:** production contains newer unrelated data, and GPS position assignments share a global player-name namespace. A broad reverse refresh could overwrite live uploads or another club's records.

**How to apply:** when explicitly asked to move saved positions from test to live, transfer broad position and specific role together without changing GPS measurements, accounts, fixtures, aliases, or other tables.
