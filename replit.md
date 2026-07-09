# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Responsive design is a core requirement: players use phone (team management), coaches use desktop (data input + charts)
- Data input via app forms → PostgreSQL database (not Google Sheets). Sheets used for historical data import only.
- User prefers to work from their computer, not phone — file sharing and code uploads will happen from desktop.
- Build as a PWA (Progressive Web App) — installable from browser, no App Store needed.

## Architecture decisions

- Player is the central entity — persistent across seasons, teams, and modules (Season Stats, GPS, Athletic Testing all share the same player record, no duplication)
- Many-to-many: players ↔ squads (a player can be in multiple squads across years)
- Many-to-many: players ↔ modules (same player appears in Season Stats, GPS, Athletic Testing)
- Squad/Season is its own entity: has a year, a team name, and a roster
- Season lifecycle: Create Squad → Enrol Players → Active Season → Archive → New Season
- Archived seasons are read-only but always accessible historically
- Parents linked to players (not squads) so they follow their child across seasons automatically
- Role-based access: Player / Parent / Coach / Club Admin
- Build for 1 team first, architecture must support expansion to 15+ teams and 750 users (500 players, 200 parents, 50 coaches/managers) without rework

## Club structure

Female teams: u11, u12, u13, u14, u16, Seniors (Reserves + Firsts operate as one squad)
Male teams: u11, u12, u13, u14, u15, u16, u18, u23, Firsts
Analytics-enabled teams: Female Seniors + Male Firsts only
All other teams: Team Management features only (schedule, attendance, communication, roster)
Analytics flag per team: enabled/disabled — simple toggle so any team can be upgraded later
Typical non-elite team: ~2 coaches, 1 manager, 15 players, ~30 parents (~48 users)

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
