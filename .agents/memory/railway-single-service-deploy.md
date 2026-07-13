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
- Seeding prod from Replit is a one-off using its **public** URL (`DATABASE_PUBLIC_URL`), passed inline as `DEV_DATABASE_URL=<prod-public-url>` to `drizzle-kit push` + the seed script (shell is non-production, so the lib picks up `DEV_DATABASE_URL`). Rotate the prod password afterward.
