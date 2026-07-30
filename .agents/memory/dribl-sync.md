---
name: Dribl sync
description: Importing NPLM results/goals from the Dribl (Capital Football) public API
---
# Dribl sync

- Real API: `https://mc-api.dribl.com/api`. Cloudflare 403s Node fetch/https (TLS fingerprint) even with browser headers, but **curl passes** — the api-server route shells out to curl (`execFile`, argv array, no shell). If prod (Railway) ever 403s, it's the egress IP, not the code.
- Required headers: Chrome UA + `Accept: application/json` + `Origin`/`Referer: https://capital.dribl.com`.
- Key endpoints: `/tenants?slug=capital` (id at `data.id`, NOT hash_id; `?tenant=capital` returns the wrong tenant), `/list/seasons?tenant=`, `/results?tenant&season&date_range=all` (cursor-paginated, 30/page; has FT score but HT fields are null there), `/matchcentre/{match_hash_id}?tenant=` (HT score in `home/away_score_ht` + `match_events` with goal scorer name, minute, own_goal, penalty_kick, team_id = scorer's team hash).
- Own goals: event `team_id` is the *scorer's* team; credit the opposite club, scorer saved as "Own Goal". Penalties → goalType `SP-P`.
- Route `/entry/dribl-preview` maps Dribl team names → local clubs by substring match, only fetches matchcentre for new matches OR existing matches whose logged goal count < scoreline (top-up mode dedupes on scorerTeam+minute). Frontend imports via the existing /entry/match + /entry/goal endpoints, so all dual-write/auth logic is reused.
- Dribl league feed name is derived from our league name (NPLM → "NPLM 1st Grade") in `driblLeagueNameFor` — extend there for NPLW etc.

**Why:** Dribl runs all AU federated leagues, so this pattern generalises to any club/league later.
