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
- Dribl league feed name is derived from our league name in `driblLeagueFor`: NPLM → "NPLM 1st Grade", NPLW → "NPLW 1st Grade", NPLW Reserves → "NPLW Reserve Grade". Extend there for new leagues; check `/NPLW.*Reserve/` style specifics before the broader match.
- **Multi-tenant (Aug 2026):** driblLeagueFor also returns a tenant slug (capital = Capital Football, fv = Football Victoria); Origin/Referer headers, tenant/season/competition caches all keyed per tenant; dribl-config sends driblTenantSlug so the browser fallback uses the right federation. "VIC NPLW" → fv / "NPL VIC Women" / competition "Senol NPL Victoria Women" (sponsor name in competition title — don't match on a generic "NPL Women"). Same data shape as ACT incl. matchcentre goal events and lineups.

**NSW (Aug 2026):** Football NSW tenant slug is **"fdprod"** (name FNSW; Match Centre lives at competitions.footballnsw.com.au — findable via `/tenants?mc_link=competitions.footballnsw.com.au` too, but the normal `?slug=fdprod` + `https://fdprod.dribl.com` Origin works). "NSW NPLW" → First Grade, "NSW NPLW U23" → U23, competition "NPL Women's NSW". Cloudflare gotcha: a bare `Mozilla/5.0` UA gets blocked — always use the full Chrome UA string.

**Why:** Dribl runs all AU federated leagues, so this pattern generalises to any club/league later.

**Match-ID club codes (Aug 2026):** first-3-letters codes collide (Sydney University/Olympic → SYD, Western City/Western Sydney → WES) and can merge two fixtures under one ID. Shared `clubCodesFor` in @workspace/api-zod builds per-league unique codes (non-colliding clubs keep first-3 so old IDs stay stable; colliders get word-aware codes like SYU/SYO/WEC/WES); used by both the Dribl sync matchId build and the Data Entry auto-ID. NSW prod rows were renamed accordingly (league_matches/league_goals/league_player_stats).

**Matching existing games:** never match on the rebuilt match-ID string — hand-entered IDs use their own club codes (e.g. BELR vs BEL). Match on round+home+away (fallback date+home+away) and reuse the existing match ID so top-ups hit the right row.

**Lineups endpoint (cracked from SPA JS):** `GET /matchcentre-match-members/match/{match_hash_id}/team/{home|away_team_hash_id}?tenant=...` → per player: first/last name, jersey, starting, playing, is_captain, is_goalkeeper, role_slug (staff too). Use fixture's `match_hash_id`, not hash_id. Sub minutes aren't here — check match_events for substitution events.

**Line-up import (built):** preview computes per-club player rows (minutes from lineup+sub events; jersey-first, name-fallback matching; unused bench = 0 mins/no appearance). Only offered for match+club with no league_player_stats rows; save uses `ifMissing` so a sync never overwrites hand-entered sheets. Browser fallback is three-pass: fixtures → matchCentres (now with subs/durations/away hash) → lineups.

**No-lineup markers:** re-syncs skip games a previous sync confirmed sheet-less. Rules that must hold: "confirmed empty" ([]) is distinct from "fetch failed/not fetched yet" (null) — only the former may be remembered; never persist markers while the browser-fallback assembly is mid-pass; games get a grace window before marking (sheets appear days late); an on-demand re-check must exist and must clear markers when a sheet appears. Gotcha: orval's `zod.coerce.boolean()` turns the query string "false" into true — parse boolean query params from the raw string yourself.

**Same-initial teammates:** save endpoint rejects duplicate names in a sheet, so brothers like two "J.Smith" blocked EVERY sheet containing both (whole-team 400). Fix: nameVariants/resolveName extend first-name prefix (Jo.Smith/Ju.Smith) and prefer club's already-saved spellings so goals + stats stay joined.

**Name map must exist in BOTH DBs:** dribl_name_map is claimed during preview against whichever DB the sync runs on — prod sat empty while dev learned pins, risking divergent short-name assignments. Prod was seeded from dev (Jul 2026, verified against prod's saved goal/stat spellings first). Any dev/prod copy of Dribl data must include dribl_name_map or splits like A.Rakic/An.Rakic can re-shuffle.

**Stable name map:** prefix-only variants can't tell Anthony/Andrija apart once A. and An. both exist (names escalated every game). Fix: dribl_name_map table pins full name → display name per club/season permanently; first player (chronological) keeps the short name, later arrival gets next free prefix; unique index on display name too; claims persisted during preview with onConflictDoNothing.
