---
name: BUFC Hub architecture
description: Database seeding state — which teams/seasons have data, team IDs, seed script location
---

## Seeded data state

All historical CSV data (matches, goals, player stats, GPS sessions, athletic tests) is seeded only for:
- teamId=1 (Belconnen United FC Women's 1sts)
- seasonId=1 (2026 NPL Season), seasonId=2 (2025), seasonId=3 (2024)

GPS data spans 2024/2025/2026 (5,200 rows total). Athletic tests cover 2025/2026 (54 rows).

**Why:** Only one team's CSVs were provided. When adding other teams, re-run `lib/db/src/seed.ts` after adding their CSV data.

## Seed script

`lib/db/src/seed.ts` — uses csv-parse, run with `pnpm dlx tsx lib/db/src/seed.ts`. Deletes all rows before re-seeding (safe for development, destructive in production).

## Team / season IDs are VOLATILE — never hardcode

The seed script deletes and re-inserts everything, so the autoincrement `id` of the
focus team and its seasons **changes on every re-seed** (e.g. it has been 1, 16, and 31
for the Women's 1sts across re-seeds; season likewise 1/4/7). Do not hardcode these
anywhere.

**Why:** Nothing in the app hardcodes team/season IDs — the Home page and Season Stats
auto-select the first analytics-enabled female team + latest season via effects. Tests
and curl checks must first read the *current* IDs, not reuse a remembered number.

**How to apply:** To get the current IDs for a manual curl/db check, query the DB
(e.g. `SELECT id, name FROM teams WHERE analytics_enabled = true`) or read them from the
selected values in the UI — never paste a previously-seen ID.

## Analytics route caveats

- League ladder is inferred from focus-team match results only (not true full-league data)
- Scorer team classification uses scorerTeam field from goal events (not hard-coded names)
- goals-by-interval uses desc ordering for recent-N-matches filter (fixed bug)
