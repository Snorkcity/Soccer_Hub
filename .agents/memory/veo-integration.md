---
name: Veo stats integration
description: Reverse-engineered Veo (app.veo.co) internal API — auth flow, endpoints, per-match data shapes — for syncing match stats into BUFC Hub.
---

# Veo stats integration (internal API — no official export)

Coach records matches on Veo; no CSV/API export for club accounts. Credentials in secrets
`VEO_EMAIL` / `VEO_PASSWORD` (never echo). Rides internal endpoints — if Veo changes, rebuild.
Design generalisable: future clubs supply their own Veo login → same flow, per-team/per-login.

**Why:** materially raises product value; coach wants ALL available stats + deeper per-event data.

## Auth — OIDC authorization-code + PKCE against https://auth.veo.co
- Client ID `IzRQtXQ07V7n8uBtpTHzi` (from settings-*.js `REACT_APP_AUTH_SERVICE_CLIENT_ID`).
- GET `/oidc/auth` (client_id, redirect_uri `https://app.veo.co/signin-redirect/`, response_type=code,
  scope `openid email phone address profile`, S256 PKCE, state, nonce) → follows to
  `login.html?uid=...`. Keep a cookie jar across all steps (interaction cookies are httpOnly).
- POST creds to `/interaction/{uid}/login` (note **`/login` suffix**), form fields `username`,`password`,
  WITHOUT `-L`; response Location → GET that `/oidc/auth/{uid}` resume URL → Location has `code=`.
- POST `https://auth.veo.co/oidc/token` (grant_type=authorization_code, code, redirect_uri, client_id,
  code_verifier) → Bearer access_token, expires 3600s. Cache token; re-login on expiry.
- Node TLS is NOT blocked for Veo (curl works; puppeteer login works). Prefer server fetch/curl.

## API base `https://app.veo.co/api/app/`  (all need `Authorization: Bearer <token>`)
- **Club/team slugs** live in `leagues.veo_club_slug` / `leagues.veo_team_slug` (seeded by startup migration) — read them from the DB, never hardcode. Veo keeps legacy year prefixes in slugs (e.g. a 2026 team can still be `2024-...`).
- **Teams list:** `GET /clubs/{club}/teams/` (add `?fields=slug&fields=match_count`).
- **Match list per team (THE gap, now solved):** `GET /clubs/{club}/recordings/?filter=own&team={team-slug}`.
  NOT the global `/api/app/matches/` firehose (ignores all team filters, returns other clubs worldwide).
  Recording objects carry identifier, title, team, start, thumbnail, processing_status, etc.
  `processing_status` is object-valued in current responses (often `{}` when done), despite older
  response typing describing a string; preserve it verbatim as JSON.
- **Match detail:** `GET /matches/{id}/` → has_analytics_enabled, has_events_enabled, has_tracking_data,
  has_momentum_data, opponent_team_name, title, identifier(=id, a uuid).

## Per-match data (verified on a real Firsts vs Majura match, id ca427389-76a6-47ce-85bd-72c47d9b6dc6)
- **`/matches/{id}/events/` — THE core source of truth.** `{events:[...]}`, ~280 rows. Each:
  `event_type` (FootballGoal/Shot/CornerKick/ThrowIn/Foul/FreeKick/PenaltyKick/GoalKick/KickOff/OutOfPlay),
  `team` ("Own"|"Opp"), `video_time_ms` (recording time), `period_id`, `period_time_ms` (**true match time
  within period**), `player_jersey`, `player_id`, `outcome`, `x`, `z` (pitch coords 0–1; null on some goals),
  `attributes`. Compute ALL aggregates + momentum/field-tilt + shot maps from this yourself — more robust
  than the stats endpoint.
- **`/matches/{id}/stats/`** → `{ordering:[...], stats:{Slug:{own,opp,byPeriod,stat}}}`. Slugs: FootballGoal,
  PossessionPercent, FootballShot, TotalAttempts, FootballCornerKick, FootballFoul, FootballFreeKick,
  PassesCompleted, FootballPenaltyKick, PossessionMinutes, PossessionWon, FootballThrowIn. NOTE: on the test
  match own/opp came back 0 (may need a periods query param, or is analytics-tier dependent) — trust events.
- **own_side semantic**: `own_side` is the end OUR GOAL defends — we attack the OPPOSITE end. It's easy to invert (that once plotted every shot at the wrong end); sanity-check any pitch-oriented chart against raw per-period x values before trusting it.
- **`/matches/{id}/periods/`** → `[{public_identifier, timeframe:[startSec,endSec], own_side:"left"|"right",
  duration, is_confirmed}]`. Needed to map period_time → overall match minute and to know which goal end is ours.
- **`/matches/{id}/roster/`** → `{items:[{player:{user_id,name,initials,avatar}, jersey_number, field_position,
  position_name, is_captain}]}`. jersey_number was null on test match — player_id/name mapping may be sparse.
- Also present: `/videos/`, `/highlights/`, `/lineup/players/` (empty on test), `/feature-processing-status/`,
  `/bookmarks/`, `/roster/`.

## Browser discovery
- `scripts/capture-veo-network.mjs` logs in through the real app and records the match page's requests.
  Attach response/request capture only AFTER login — otherwise the auth form POST can put credentials in
  diagnostic output. Keep captures temporary and delete them after extracting endpoint shapes.
- Login form uses `input[name=username]` / `input[name=password]`; analytics drawer button has
  `aria-label="bar chart 2"`. Analytics 2 chat has `aria-label="Chat with your match data"`.

## Build plan (agreed with coach)
Sync button in Data Entry mirroring Dribl: default Firsts, dropdown arrow → Reserves → "Sync to Veo".
League-scoped tables (carry league_id per league-private-data rule); store matches + raw events jsonb.
Wire into momentum/field-tilt chart (up=us/down=them, 2–5min bins), shot maps, and Match Report badges;
maybe a dedicated "Veo Insights" tab. Map league→Veo team slug (store on leagues row, allow override).
Prod reserves league id = 81; dev firsts league 1/season 1, reserves league 9/season 4 (don't confuse
with Veo team match_count of 81). Dribl pattern reference: artifacts/api-server/src/routes/dribl.ts.


## Veo ↔ Hub match linking (match reports)
- `veo_matches.match_id` → `matches.id`; one ACTIVE recording per Hub match. Removed archive rows retain their old link for reference but do not block an active replacement.
- Auto-link is league/team-scoped and compares exact `Australia/Sydney` calendar dates. A sole same-date fixture wins; opponent then title may break only a genuine same-day tie. Missing/ambiguous cases remain manual. Never use a UTC-duration window or title-first identity.
- `/veo/report-stats?leagueId&matchRowId` serves shots + 5-min momentum bins for a linked Hub match; maths deliberately mirrors the client-side VeoInsights MatchView (same weights/bins) — change them in both places.
## Sync stays MANUAL (coach decision)
Veo recordings upload from hardware weekly and finish processing anywhere Sunday night–Tuesday
morning; a scheduled sync would mis-time it. Coach explicitly wants the manual "Sync from Veo"
button as the only trigger — do not add auto-sync (related follow-up task was cancelled).

## Possession & pass-strings: the RAS service (FOUND Aug 2026)
Pass strings / possession location / pass location panels are NOT on app.veo.co/api — they come
from the **RAS service**: base URL in `window.VEO_SERVICE_URLS.RAS_URL` embedded in the app.veo.co
page HTML (currently `https://dt3kfuz4eo879.cloudfront.net` — a CloudFront host that could rotate,
so re-scrape the page HTML if it 403s). Same Bearer token as `/api/app` works. Endpoints:
- `GET {RAS}/recordings/{matchId}/analytics` → pipeline status map, e.g.
  `{"match-details":"completed","shot-details":"completed",...}` — gate on `match-details==="completed"`.
- `GET {RAS}/recordings/{matchId}/match-details?filters=start,end&filters=start2,end2` where each
  filter pair is a period's video-time `timeframe` from `/matches/{id}/periods/`. Returns one item
  per period: `{start, end, stats:{PossessionSeconds:{L,R}, PassesCompleted:{L,R}, PossessionWon:{L,R}},
  passStrings:{L:[[len,count],...],R}, passLocations:{L:[{x,y},...],R},
  possessionLocations:{L:{defensive,middle,attacking},R}, possessionLocationsGrid:{L:{type:"18_zone_system",values:[18]},R}}`.
- `&interactiveStrings=true` adds per-string detail `[len,count,[{start,end,endLocation},...]]`.
- `GET {RAS}/recordings/{matchId}/shot-details?filters=...` also exists.
- **L/R are PITCH SIDES, not teams** — map via each period's `own_side`: own = "L" when
  `own_side==="left"` (mirrors Veo's client; possession-location thirds keys are used as-is, no flip).
Implementation: `getPassDetails()` in api-server lib/veo.ts (status-gated, stores `{available:false}`
when analytics absent so sync never re-loops); stored in `veo_matches.pass_details` jsonb; served by
`/veo/season-passing`; charts in VeoInsights (season "Possession & passing" section + match panels).
Probe scripts: scripts/probe-veo-ras.ts, CLI sync: scripts/veo-sync-cli.ts (same code path as the
route via exported syncVeoLeagueOnce/autoLinkVeoLeague).

## Shot-map orientation (own_side)
Rotate a period's pitch 180° when `own_side !== "left"` so Belconnen attacks right — i.e. flip on "right"/default, NOT on "left".
**Why:** the earlier per-match map flipped on "left" and was silently backwards; season-aggregate shot clustering (shots pile up at the attacked goal) proved the correct direction.
**How to apply:** any new chart using Veo x/z coords must reuse this convention (season-shots endpoint + VeoInsights match view both do). Sanity-check orientation against aggregate clustering, never a single match.

## Analytics 2 player data (FOUND Aug 2026)
Analytics 2 is enabled in the account. Do not assume its public launch-date cutoff reflects API
availability: read-only probes found physical rows on every recent recording checked, including matches
from June 2026. Always probe the endpoint; do not discard old matches by date.

- **Physical metrics:** `GET /api/mes/v2/{matchId}/physical-metrics`. Rows are split by `drill`
  (period/segment) and carry `teamId`, `jerseyNumber`, `distance` (metres), `secondsPlayed`,
  `maxSpeed`, `averageSpeed`, `maxAccel`, `maxDecel`, `sprints`, and `hsr` (high-intensity runs).
- **Tracking:** `GET /api/mes/v2/{matchId}/player-tracking?start={seconds}` returns timestamp-keyed
  compact arrays of tracked players; `.../player-tracking/jersey-numbers?periods=start,end...`
  returns detected shirt numbers by left/right pitch side and period.
- **Expanded events:** `GET /api/mes/v2/{matchId}/match-events` carries `eventType`, team, time,
  coordinates, outcome and (when detected) `playerJersey`. Analytics 2 adds tackles, dribbles,
  interceptions, loose-ball recoveries and saves to the earlier goal/shot/set-piece events.
- **Preferred player-summary endpoint:** `POST /api/app/analysis/stats/` with
  `{type:"cross_match", team_id, match_ids:[...], group_by:"player"}`. It returns one
  `cross_match_player` per player/detected jersey with roster identity fields plus all event and physical
  metrics already aggregated: goals, assists, involvements, shots/attempts/conversion, set pieces,
  tackles, dribbles, interceptions, loose recoveries, saves, total/successful/unsuccessful passes,
  pass success rate, distance, sprints, top/average speed, HIRs and seconds played.
- **Identity caveat:** if the match lineup is incomplete, Veo deliberately returns `Jersey #X` rows
  rather than dropping data. Map via Veo lineup/roster when present; otherwise preserve the jersey row
  and let the coach resolve it. Never guess a player name from shirt number alone.

**Why:** the existing sync predates Analytics 2 and does not collect these endpoints. The cross-match
response is the safest first integration surface because it matches Veo's Player Stats Overview and
avoids re-implementing period aggregation.

**How to apply:** extend the manual Veo sync (never an automatic job) to persist raw Analytics 2 player
summaries with their match and league scope. Keep raw detected jersey identity separate from Hub player
identity so lineup corrections can remap without rewriting source data.

## Interim Veo player-profile UX

**Rule:** keep Match → Players simple while Veo's event metrics mature: use a single-player dropdown to filter the table, with own and opponent players first and unresolved/unassigned jersey rows last. Preserve those rows rather than guessing identities.

**Why:** current Veo coverage varies by recording and does not yet provide a reliable, well-defined duel metric. A radar/profile chart would overstate precision until the underlying event set and samples are stronger.

**How to apply:** improve the dropdown and table incrementally, but defer cross-metric radar/vector scoring until Veo coverage, definitions, minute thresholds, and comparison baselines are agreed.

## Analytics 2 team ownership safety
Attribute every player-source contribution to own, opponent, or unassigned before combining metrics.
Veo team IDs and MES Own/Opponent labels are strongest; an absent/zero physical team ID may fall back
only when its canonical shirt belongs to exactly one official club squad in that linked fixture. A shirt
found on both squads stays unassigned. Never use names, fuzzy matching, GPS identities, or aliases.

**Why:** physical rows are often missing a usable team ID, both clubs commonly reuse shirt numbers, and
the all-zero UUID is a missing-value sentinel. Combining by shirt first silently mixes opposing players.

**How to apply:** include side/team scope in every match and season key. Own rows may use durable Hub
identity; opponent rows may aggregate across matches only with both a stable Veo player ID and a real
source team ID. Name-only opponent rows and every unassigned row must remain match-scoped.

## Coach Assist (Veo reference, not an API dependency)
The match page exposes a Coach Assist chat with the prompt “Ask about this match, team or the club…” and
starters for match summary, trends, training drills, scoring efficiency and game-plan analysis. It is
beta and supports personalised voice/coach level.

**Why:** this validates a strong Hub feature, but Veo's private chatbot transport is not a stable data
contract and should not become a Hub dependency.

**How to apply:** build match-aware Q&A through the Hub's existing Coach Assistant/OpenAI path, grounding
it in synced Veo events, team stats, player summaries and Hub match context. Reuse Veo only as a raw-data
source; do not proxy or imitate its private chat endpoint.
