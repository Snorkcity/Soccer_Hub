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

## Product vision

Long-term goal: sell this platform to other football clubs as a SaaS product.
The Season Stats and GPS chart concepts are reportedly unique — not seen by A-league analysts.
Every feature should be built to a standard that can be white-labelled or licensed to other clubs.

## Modules / Apps

Existing (to migrate from Python/Dash):
- Season Stats App — 1 page, 3 tabs, ~12,000 lines Python, analytics-enabled teams only
- GPS App — Catapult pod data, analytics-enabled teams only
- Athletic Testing App — 5 charts, analytics-enabled teams only
- Goal Map Input Tool — visual pitch/goal UI; coach clicks location of a goal on the pitch to generate an x/y coordinate; value entered into database to power the goal map chart in Season Stats

New (to build from scratch):
- RPE App — players input perceived exertion (1–10) per session/match on phone; coaches see dashboard with trends, fatigue flags
- Wellness App (General) — all teams; players log how they're feeling per session/week; coaches see overview
- Women's Health App — female teams only; tracks cycle, energy, mood, soreness, sleep; shown as separate tile, hidden for male teams
- Team Management — all teams; schedule, attendance, availability, communication, squad roster
- AI Coach Assistant — custom GPT with club curriculum, embedded in platform; can help coaches find relevant session plans from library
- Session Plans (Team) — coaches upload plans for their own team; visible to their coaching staff only
- Coaches Library (Club-wide) — any coach can upload/share session plans; all coaches across the club can browse, search, download; plans can be tagged by age group, theme, drill type etc
- Drill Library — 500 PPTX slides imported as searchable drill cards (diagram image + coaching notes + tags: phase, theme, age group, player numbers, skill focus); foundation for session planning
- Session Plan Builder — coach selects drills from library into a warmup→intro→main→final template; customises timings/notes; exports to PDF or Word in standard template format; AI can suggest drills based on a natural language request (e.g. "60min possession session for u14, 16 players"); built on top of the 250 existing plans and 500 diagrams as the content library
- AI Video Analysis App (future) — coach submits YouTube/stream URL + game style template; AI analyses match and returns a presentation-style report/review
- Export engine — all relevant modules support export to PDF, PPTX, and/or XLS (match reports, season summaries, player reports, wellness summaries etc)
- Mid-season Player Reports — coach completes a structured form per player (ratings + comments); criteria defined by curriculum/learning phase for that age group; outputs individual player report or full team report as PDF/PPTX
- Adhoc module builds — platform is designed to accept new modules as ideas emerge; each new idea can be scoped and built without disrupting existing features

## Data sources (Season Stats App)
- Goal analysis data → feeds Season Stats
- Match sheets data → feeds Season Stats
- Both entered via in-app forms → PostgreSQL
- Hub / Home — tiles linking to all enabled modules per team

## Club structure

Female teams: u11, u12, u13, u14, u16, Seniors (Reserves + Firsts operate as one squad)
Male teams: u11, u12, u13, u14, u15, u16, u18, u23, Firsts
Analytics-enabled teams: Female Seniors (Reserves + Firsts) + Male Firsts only
Female Seniors has two squads — Reserves and Firsts — both tracking identical analytics data (same sheet structure, same charts, filtered by team)
All other teams: Team Management features only (schedule, attendance, communication, roster)
Analytics flag per team: enabled/disabled — simple toggle so any team can be upgraded later
Typical non-elite team: ~2 coaches, 1 manager, 15 players, ~30 parents (~48 users)

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

- **Player-name join (goals ↔ minutes):** goal/assist attribution links to a player's
  minutes by exact name match between the league-based sheet (`Scorer`/`Assist`) and the
  player-based sheet (`Player Name`). Names must be byte-identical across both. Known
  cross-sheet typos are reconciled in `NAME_FIXUPS` in `lib/db/src/seed.ts` (add new
  entries there rather than editing raw CSVs, so fixes survive a re-upload).
- **Transferred players (mid-season):** a player keeps her goals under the club she
  scored for (league-based `Scorer Team`), but her minutes follow her to the new club in
  the player-based sheet. Result: she can appear in her former club's Opponent Insights
  with "0 mins" (e.g. EJ, Croatia→Belconnen, 2026). This is intentional/by-design, not a
  bug. Match-side resolution means her relabeled minutes only ever count in matches her
  new club actually played, so the new club's stats stay correct.
- **Naming convention — siblings / same surnames:** 2026 data uses bare surnames
  (`Bloggs`), which is ambiguous when families share one (already present this season:
  Babic, Nikias, Singers, Cerne, DeMarco each have a bare entry AND initialed siblings
  like `A.Babic`/`L.Babic`). From 2027 the plan is `Initial.Surname` (`J.Bloggs` = Joe
  Bloggs) in BOTH sheets so siblings disambiguate naturally by their distinct initials —
  no special app logic required as long as both sheets use the same spelling.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
