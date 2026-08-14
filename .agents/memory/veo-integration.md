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
- **`/matches/{id}/periods/`** → `[{public_identifier, timeframe:[startSec,endSec], own_side:"left"|"right",
  duration, is_confirmed}]`. Needed to map period_time → overall match minute and to know which goal end is ours.
- **`/matches/{id}/roster/`** → `{items:[{player:{user_id,name,initials,avatar}, jersey_number, field_position,
  position_name, is_captain}]}`. jersey_number was null on test match — player_id/name mapping may be sparse.
- Also present: `/videos/`, `/highlights/`, `/lineup/players/` (empty on test), `/feature-processing-status/`,
  `/bookmarks/`, `/roster/`.

## Not yet found / TODO at build
- Pass-heatmap-by-third + passes/possession locations + momentum-data + shotmap: analysisSlice thunks
  (fetchPassesAndPossession → `match-details` [404'd here], fetchIntervalHeatmap, fetchShotmap,
  fetchMatchMomentumData) — likely only on higher tracking tier (test match had has_tracking_data=false,
  has_momentum_data=false). Capture live via headless-browser network sniff on a tracking-enabled match.
- Discovery technique that worked: puppeteer-core (`lib/puppeteer/puppeteer-core.js`, NOT lib/esm/...) +
  nix chromium at /nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.../bin/chromium; login form has
  `input[name=username]`/`input[name=password]`; watch requests matching `svc.veo.co|/api/(app|v1)/`.

## Build plan (agreed with coach)
Sync button in Data Entry mirroring Dribl: default Firsts, dropdown arrow → Reserves → "Sync to Veo".
League-scoped tables (carry league_id per league-private-data rule); store matches + raw events jsonb.
Wire into momentum/field-tilt chart (up=us/down=them, 2–5min bins), shot maps, and Match Report badges;
maybe a dedicated "Veo Insights" tab. Map league→Veo team slug (store on leagues row, allow override).
Prod reserves league id = 81; dev firsts league 1/season 1, reserves league 9/season 4 (don't confuse
with Veo team match_count of 81). Dribl pattern reference: artifacts/api-server/src/routes/dribl.ts.


## Veo ↔ Hub match linking (match reports)
- `veo_matches.match_id` → `matches.id`; one recording per Hub match (manual link steals from any other row holding it).
- Auto-link: kickoff ±1.5 days; single candidate wins on date alone, multiple candidates need an opponent-name match (normalised containment, min 4 chars) or the row is left for manual fixing. Veo opponents are often abbreviations (TUFC, WCW, COFC) that never fuzzy-match Hub names — the manual Select on the Veo Insights "Match links" card is the real workhorse for those.
- `/veo/report-stats?leagueId&matchRowId` serves shots + 5-min momentum bins for a linked Hub match; maths deliberately mirrors the client-side VeoInsights MatchView (same weights/bins) — change them in both places.
## Sync stays MANUAL (coach decision)
Veo recordings upload from hardware weekly and finish processing anywhere Sunday night–Tuesday
morning; a scheduled sync would mis-time it. Coach explicitly wants the manual "Sync from Veo"
button as the only trigger — do not add auto-sync (related follow-up task was cancelled).

## No possession or pass data on this tier (probed Aug 2026)
/matches/{id}/stats/ lists PossessionPercent/PossessionMinutes/PossessionWon/PassesCompleted in
"ordering" but returns null for all of them, and its counting stats are all zeros — the Hub
computes counts from the events feed itself. No pass events exist in /events/. Pass strings and
possession charts are NOT buildable from Veo for this account; don't re-probe unless the coach's
Veo plan changes. Exploratory raw GETs: use exported veoApiGet() in api-server lib/veo.ts.

## Shot-map orientation (own_side)
Rotate a period's pitch 180° when `own_side !== "left"` so Belconnen attacks right — i.e. flip on "right"/default, NOT on "left".
**Why:** the earlier per-match map flipped on "left" and was silently backwards; season-aggregate shot clustering (shots pile up at the attacked goal) proved the correct direction.
**How to apply:** any new chart using Veo x/z coords must reuse this convention (season-shots endpoint + VeoInsights match view both do). Sanity-check orientation against aggregate clustering, never a single match.
