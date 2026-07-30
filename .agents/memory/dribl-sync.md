---
name: Dribl sync
description: Importing NPLM results/goals from the Dribl (Capital Football) public API
---
# Dribl sync

- Real API: `https://mc-api.dribl.com/api`. Cloudflare 403s Node fetch/https (TLS fingerprint) even with browser headers, but **curl passes** — the api-server route shells out to curl (`execFile`, argv array, no shell). If prod (Railway) ever 403s, it's the egress IP, not the code.
- Required headers: Chrome UA + `Accept: application/json` + `Origin`/`Referer: https://capital.dribl.com`.
- **`/results` silently drops early-season rounds** (only ~recent months) — use `/fixtures` with a `competition=<hash>` filter (`/list/competitions?tenant=` gives hashes, e.g. "National Premier League Men's"); fixtures rows also carry HT scores (`home/away_score_half`) and use full ISO dates (results uses "YYYY-MM-DD HH:MM:SS"). Unfiltered /fixtures spans every ACT grade (250+ pages); the competition filter cuts it to <10.
- Key endpoints: `/tenants?slug=capital` (id at `data.id`, NOT hash_id; `?tenant=capital` returns the wrong tenant), `/list/seasons?tenant=`, `/results?tenant&season&date_range=all` (cursor-paginated, 30/page; has FT score but HT fields are null there), `/matchcentre/{match_hash_id}?tenant=` (HT score in `home/away_score_ht` + `match_events` with goal scorer name, minute, own_goal, penalty_kick, team_id = scorer's team hash).
- Own goals: event `team_id` is the *scorer's* team; credit the opposite club, scorer saved as "Own Goal". Penalties → goalType `SP-P`.
- Prod (Railway) IPs ARE blocked by Cloudflare even via curl — the frontend falls back to fetching Dribl from the coach's browser (mc-api sends `Access-Control-Allow-Origin: *`) and POSTs trimmed fixtures/match-centres to `/entry/dribl-preview` (two-phase: server replies `needDetail` hashes, browser fetches those and re-posts). Assembly always happens server-side.
- Route `/entry/dribl-preview` maps Dribl team names → local clubs by substring match, only fetches matchcentre for new matches OR existing matches whose logged goal count < scoreline (top-up mode dedupes on scorerTeam+minute). Frontend imports via the existing /entry/match + /entry/goal endpoints, so all dual-write/auth logic is reused.
- Dribl league feed name is derived from our league name in `driblLeagueNameFor`: NPLM → "NPLM 1st Grade", NPLW → "NPLW 1st Grade", NPLW Reserves → "NPLW Reserve Grade". Extend there for new leagues; check `/NPLW.*Reserve/` style specifics before the broader match.

**Why:** Dribl runs all AU federated leagues, so this pattern generalises to any club/league later.

**Matching existing games:** never match on the rebuilt match-ID string — hand-entered IDs use their own club codes (e.g. BELR vs BEL). Match on round+home+away (fallback date+home+away) and reuse the existing match ID so top-ups hit the right row.

**Lineups endpoint (cracked from SPA JS):** `GET /matchcentre-match-members/match/{match_hash_id}/team/{home|away_team_hash_id}?tenant=...` → per player: first/last name, jersey, starting, playing, is_captain, is_goalkeeper, role_slug (staff too). Use fixture's `match_hash_id`, not hash_id. Sub minutes aren't here — check match_events for substitution events.

**Line-up import (built):** preview computes per-club player rows (minutes from lineup+sub events; jersey-first, name-fallback matching; unused bench = 0 mins/no appearance). Only offered for match+club with no league_player_stats rows; save uses `ifMissing` so a sync never overwrites hand-entered sheets. Browser fallback is three-pass: fixtures → matchCentres (now with subs/durations/away hash) → lineups.
