---
name: Replit runtime-managed DATABASE_URL vs external (Railway) Postgres
description: Why DATABASE_URL can't be overridden on Replit and how the app points its dev environment at an external Railway Postgres.
---

# Replit reserves DATABASE_URL; use DEV_DATABASE_URL to point dev at Railway

Every Replit project ships with a built-in PostgreSQL DB, and Replit marks `DATABASE_URL` (plus `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`) as **runtime-managed**. `requestSecrets`/`setEnvVars` **reject** those keys, and the built-in DB cannot be deleted. So you cannot repoint `DATABASE_URL` at an external DB on Replit.

**Pattern chosen for hosting dev on Railway:** the DB library reads a custom `DEV_DATABASE_URL` (a normal, settable secret) and prefers it over `DATABASE_URL`, **gated to non-production** so prod never reads it:
`NODE_ENV === "production" ? DATABASE_URL : (DEV_DATABASE_URL || DATABASE_URL)`.
Applied consistently in both the runtime pool and the drizzle-kit config so `push`/migrations and the app agree.

**Environment wiring:**
- Replit dev: set `DEV_DATABASE_URL` = Railway Postgres-Dev **public** URL (`DATABASE_PUBLIC_URL`), since Replit is outside Railway's network. Dev workflow sets `NODE_ENV=development`, so the override is active.
- Railway prod app service: reads only `DATABASE_URL`, set to the **private/internal** reference of the prod DB (e.g. `${{Postgres-Prod.DATABASE_URL}}`). Do NOT set `DEV_DATABASE_URL` there.

**Why:** user wanted both dev and prod databases hosted in Railway. Moving dev off Replit's built-in DB means re-seeding the (empty) Railway dev DB: `pnpm --filter @workspace/db run push` then `pnpm dlx tsx lib/db/src/seed.ts` (both honor the DEV_DATABASE_URL override from the shell env).

**How to apply:** if `DATABASE_URL` shows up in `viewEnvVars` `runtimeManaged`, do not try to set it — use the `DEV_DATABASE_URL` override path instead.
