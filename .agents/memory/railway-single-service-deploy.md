---
name: Railway single-service deployment
description: How this Replit-architected app is deployed to Railway as one combined Node service, and the non-obvious gotchas.
---

# Railway deployment topology

This app is normally hosted on Replit, where the platform router serves the Vite SPA at `/` and the Express api-server at `/api` on one origin. Railway has no such router, so the app is deployed as a **single combined service**:

- The **api-server also serves the built frontend** (`artifacts/bufc-hub/dist/public`) with an SPA fallback — but **only when `NODE_ENV=production`** and a built bundle exists. On Replit (dev + Deployments) this block is inert because the platform serves the frontend separately.
- SPA fallback must serve `index.html` only for navigation routes; requests with a file extension fall through to a real 404 (missing hashed bundles must not be masked by `index.html`).
- `railway.json` holds build + start + healthcheck (`/api/healthz`).

**Why (gotchas that cost time):**
- **`NODE_ENV=production` is set ONLY in the Railway start command, never as a service variable.** If it were a shared service var, the build/install phase would skip devDependencies (esbuild lives in api-server devDeps, etc.) and the build would fail. The build command also runs `pnpm install --frozen-lockfile --prod=false` defensively.
- The frontend build (`vite build`) requires `BASE_PATH` and `PORT` set at config-eval time even for a build — set inline in the build command (`BASE_PATH=/ PORT=... vite build`).
- Static-serve path resolves from `process.cwd()` (Railway runs the start command from repo root), overridable via `CLIENT_DIST_DIR`.

**DB wiring:**
- Live app → Postgres-Prod via **internal** ref `${{Postgres-Prod.DATABASE_URL}}` (private, free egress). App also needs `PORT` set (it hard-throws without it; Railway magic-port detection alone is unreliable).
- Dev & prod are **separate** Railway Postgres instances; each must be seeded independently — data never flows between them.
- For approved private imports, explicitly select the external target: `DEV_DATABASE_URL` for development and `PROD_DATABASE_URL` for production. Do not disguise the production target as development or print connection strings.

## Deploy gotchas learned Jul 2026 push
- Railway health check hits /api/healthz UNAUTHENTICATED — the requireSession gate must whitelist it (a 401 fails the deploy with "service unavailable" retries even though the server is up).
- Server only listens AFTER startup migrations: any slow data sync before listen eats into the healthcheck window (now 300s). Batch inserts (jsonb_to_recordset) — row-at-a-time over the network blew the 120s window.
- Practice-library data reaches prod via committed snapshot lib/db/src/data/library-sync.json + one-shot startup sync gated by seed_markers key (bump SYNC_VERSION after regenerating snapshot from dev). No prod DB URL needed anymore.
- Railway credentials are managed separately from Replit secrets. Changing SESSION_SECRET invalidates signed sessions; do not assume dev and live credentials are interchangeable.

## Private data and public release source

The GitHub source repository is public. Do not commit uploaded GPS CSVs, parsed player measurements, database exports or private coaching records as deployment seed files. Keep private data in the database and use an approved private import after the schema is deployed. Generic import code and synthetic regression fixtures can be public.

**Why:** the public repository boundary is separate from the signed-in application's club privacy; embedding data in a startup snapshot would bypass that privacy.

**How to apply:** inspect staged paths before release and preserve the ignored uploaded/generated-output directories. Resolve the target competition, campaign, club and roster identities in the destination database; never transplant development IDs. Private one-off imports must be additive and refuse to overwrite existing sessions. Historical committed snapshots are not permission to publish newly supplied private measurements.
