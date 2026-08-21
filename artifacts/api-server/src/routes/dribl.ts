// ── Dribl sync (Capital Football) ─────────────────────────────────────────────
// Reads public fixture/result data from the Dribl match-centre API that powers
// capital.dribl.com and turns it into an import preview for Data Entry.
//
// Two paths produce the same preview:
//   GET  /entry/dribl-preview — the server fetches from Dribl itself (works in
//        dev; Cloudflare may block hosting-provider IPs in production).
//   POST /entry/dribl-preview — the browser fetches the raw Dribl JSON (home
//        connections pass Cloudflare; mc-api sends Access-Control-Allow-Origin *)
//        and posts trimmed payloads here for assembly against the database.
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, leagueMatchesTable, leagueGoalsTable, leaguePlayerStatsTable, seasonsTable, leaguesTable, clubsTable, driblNameMapTable, driblNoLineupTable, playerStatsTable, playersTable, goalsTable } from "@workspace/db";
import {
  GetDriblPreviewQueryParams,
  GetDriblPreviewResponse,
  GetDriblConfigQueryParams,
  GetDriblConfigResponse,
  AssembleDriblPreviewBody,
  ListDriblNameMapQueryParams,
  ListDriblNameMapResponse,
  UpdateDriblNameMapBody,
  UpdateDriblNameMapResponse,
  DeleteDriblNameMapResponse,
  clubCodesFor,
} from "@workspace/api-zod";
import { leagueIdForSeason, mayTouchLeagueRow } from "../middlewares/entryAuth";
import { pgErrorCode } from "../lib/pgError";
import { logger } from "../lib/logger";
import { NPLB_2026_LEAGUES } from "../lib/nplb2026";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const router: IRouter = Router();

const DRIBL_API = "https://mc-api.dribl.com/api";
function driblHeaders(tenantSlug: string) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "application/json",
    Origin: `https://${tenantSlug}.dribl.com`,
    Referer: `https://${tenantSlug}.dribl.com/`,
  };
}

// Which Dribl tenant (federation) + league + competition a local league maps
// to. The competition hash filters the fixtures feed down from thousands of
// rows (every grade in the federation) to just the NPL games. Extend as
// leagues are added. Tenant slugs: capital = Capital Football (ACT),
// fv = Football Victoria, fdprod = Football NSW (their Match Centre lives at
// competitions.footballnsw.com.au but the Dribl tenant slug is "fdprod").
export function driblLeagueFor(leagueName: string): { tenant: string; league: string; competition: string } | null {
  const boysGrade = NPLB_2026_LEAGUES.find(
    (spec) => spec.localName.localeCompare(leagueName, "en", { sensitivity: "base" }) === 0,
  );
  if (boysGrade) {
    return {
      tenant: "capital",
      league: boysGrade.driblLeague,
      competition: "National Premier League Boys",
    };
  }
  if (/VIC.*NPLW|NPLW.*VIC/i.test(leagueName))
    return { tenant: "fv", league: "NPL VIC Women", competition: "Senol NPL Victoria Women" };
  if (/NSW.*NPLW.*U.?23|NPLW.*U.?23.*NSW/i.test(leagueName))
    return { tenant: "fdprod", league: "U23", competition: "NPL Women's NSW" };
  if (/NSW.*NPLW|NPLW.*NSW/i.test(leagueName))
    return { tenant: "fdprod", league: "First Grade", competition: "NPL Women's NSW" };
  if (/NPLM.*U.?23/i.test(leagueName)) return { tenant: "capital", league: "NPLM U23", competition: "National Premier League Men's" };
  if (/NPLM/i.test(leagueName)) return { tenant: "capital", league: "NPLM 1st Grade", competition: "National Premier League Men's" };
  if (/NPLW.*Reserve/i.test(leagueName)) return { tenant: "capital", league: "NPLW Reserve Grade", competition: "National Premier League Women's" };
  if (/NPLW/i.test(leagueName)) return { tenant: "capital", league: "NPLW 1st Grade", competition: "National Premier League Women's" };
  return null;
}

// Cloudflare fingerprints Node's TLS stack and returns 403 for fetch/https
// requests even with browser headers, but curl's fingerprint passes. So all
// server-side Dribl calls shell out to curl.
async function driblGet(path: string, params: Record<string, string>, tenantSlug = "capital"): Promise<any> {
  const url = new URL(`${DRIBL_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const args = ["-sS", "-m", "30", "-w", "\n%{http_code}"];
  for (const [k, v] of Object.entries(driblHeaders(tenantSlug))) args.push("-H", `${k}: ${v}`);
  args.push(url.toString());
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 20 * 1024 * 1024 });
  const cut = stdout.lastIndexOf("\n");
  const status = stdout.slice(cut + 1).trim();
  if (status !== "200") throw new Error(`Dribl ${path} responded ${status}`);
  return JSON.parse(stdout.slice(0, cut));
}

// Tenant + season hashes never change once issued — cache for the process.
const tenantCache = new Map<string, string>();
async function driblTenant(tenantSlug: string): Promise<string> {
  const cached = tenantCache.get(tenantSlug);
  if (cached) return cached;
  const data = await driblGet("/tenants", { slug: tenantSlug }, tenantSlug);
  const id: string | undefined = data?.data?.id ?? data?.data?.hash_id ?? data?.data?.[0]?.id;
  if (!id) throw new Error(`Could not resolve Dribl tenant for ${tenantSlug}.dribl.com`);
  tenantCache.set(tenantSlug, id);
  return id;
}

const competitionHashCache = new Map<string, string>();
async function driblCompetitionHash(tenant: string, name: string, tenantSlug: string): Promise<string> {
  const key = `${tenant}:${name}`;
  const cached = competitionHashCache.get(key);
  if (cached) return cached;
  const data = await driblGet("/list/competitions", { tenant }, tenantSlug);
  const rows: Array<{ id: string; name?: string; title?: string }> = data?.data ?? [];
  const pick = rows.find(c => (c.name ?? c.title) === name);
  if (!pick) throw new Error(`Dribl has no "${name}" competition for tenant ${tenantSlug}`);
  competitionHashCache.set(key, pick.id);
  return pick.id;
}

const seasonHashCache = new Map<string, string>();
async function driblSeasonHash(tenant: string, year: string, tenantSlug: string): Promise<{ hash: string; title: string }> {
  const key = `${tenant}:${year}`;
  const cached = seasonHashCache.get(key);
  if (cached) return { hash: cached, title: year };
  const data = await driblGet("/list/seasons", { tenant }, tenantSlug);
  const rows: Array<{ id: string; title: string; year: number; is_current: boolean }> = data?.data ?? [];
  const matches = rows.filter(s => String(s.year) === year);
  const pick = matches.find(s => s.is_current) ?? matches[matches.length - 1];
  if (!pick) throw new Error(`Dribl has no ${year} season for tenant ${tenantSlug}`);
  seasonHashCache.set(key, pick.id);
  return { hash: pick.id, title: pick.title };
}

// Definitive club list for a league straight from the Dribl fixtures feed —
// the ground truth the AI club-setup flow uses instead of guessing from the
// league name (which can drift to an older season's line-up). Returns null
// when the league has no Dribl mapping or the feed can't be reached.
export async function driblFixtureFeedFor(
  leagueName: string,
  year: string,
): Promise<{ fixtureCount: number; clubNames: string[] }> {
  const dribl = driblLeagueFor(leagueName);
  if (!dribl) throw new Error(`Dribl sync isn't set up for ${leagueName} yet`);
  const tenant = await driblTenant(dribl.tenant);
  const { hash: seasonHash } = await driblSeasonHash(tenant, year, dribl.tenant);
  const competition = await driblCompetitionHash(tenant, dribl.competition, dribl.tenant);
  const names = new Set<string>();
  let fixtureCount = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 60; page++) {
    const params: Record<string, string> = { tenant, season: seasonHash, competition, date_range: "all" };
    if (cursor) params.cursor = cursor;
    const data = await driblGet("/fixtures", params, dribl.tenant);
    const rows = data?.data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const a = row.attributes ?? {};
      if (a.league_name === dribl.league && !a.bye_flag) {
        fixtureCount++;
        if (a.home_team_name) names.add(String(a.home_team_name));
        if (a.away_team_name) names.add(String(a.away_team_name));
      }
    }
    cursor = data?.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  return { fixtureCount, clubNames: Array.from(names).sort() };
}

export async function driblClubNamesFor(leagueName: string, year: string): Promise<string[] | null> {
  try {
    const feed = await driblFixtureFeedFor(leagueName, year);
    return feed.clubNames.length > 0 ? feed.clubNames : null;
  } catch {
    return null; // fall back to the AI's own knowledge
  }
}


/** Lowercase, drop filler tokens like "FC", collapse punctuation/whitespace —
 * so "Bulls Academy" still matches Dribl's "Bulls FC Academy First Grade Female". */
function clubMatchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(w => w && w !== "fc")
    .join(" ");
}

/** Map a Dribl team name ("Canberra Croatia FC All Age Men 1st Grade Male") to a local club name. */
function matchClub(driblTeamName: string, clubs: string[]): string | null {
  const hay = driblTeamName.toLowerCase();
  // Longest club name first so e.g. "White Eagles" wins over any shorter accidental hit
  const sorted = [...clubs].sort((a, b) => b.length - a.length);
  for (const club of sorted) {
    if (hay.includes(club.toLowerCase())) return club;
  }
  // Fallback: compare with "FC" and punctuation stripped from both sides
  const hayKey = clubMatchKey(driblTeamName);
  for (const club of sorted) {
    const key = clubMatchKey(club);
    if (key && hayKey.includes(key)) return club;
  }
  return null;
}

/** Suggest a local club name from a Dribl team name, for first-sync club
 * creation on a league with no clubs yet. Cuts the name at the first
 * grade/gender qualifier ("First Grade", "U23", "Under 18's", "NPL Women's",
 * …) and drops a trailing bare "FC"/"SFC"/"SC" token, e.g. "Sydney University SFC NPL Women's
 * First Grade" → "Sydney University". */
export function suggestClubName(driblTeamName: string): string {
  let n = driblTeamName.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const cut = n.search(/\b(first grade|1st grade|under ?\d{2}(?:'s)?|u ?\d{2}|npl[wm]?|reserves|women'?s?|female|male|men'?s?|senior|all age|premier league)\b/i);
  if (cut > 0) n = n.slice(0, cut);
  n = n.replace(/\b(sfc|fc|sc)\s*$/i, "").trim().replace(/[-–—,·]+$/, "").trim();
  if (/^Belconnen United$/i.test(n)) return "Belconnen";
  return n || driblTeamName.trim();
}

/** Dribl timestamps are UTC; matches are played in ACT. */
function toLocalDbDate(utc: string): string {
  // /results uses "YYYY-MM-DD HH:MM:SS", /fixtures uses full ISO ("…T…Z")
  const d = new Date(utc.includes("T") ? utc : `${utc.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d).replaceAll("-", "/");
}

/** "Sam Van Dooren" → "S.Van Dooren" (initial-surname) or "Van Dooren" (surname). */
function formatPlayerName(full: string, nameFormat: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.trim();
  const surname = parts.slice(1).join(" ");
  if (nameFormat === "surname") return surname;
  return `${parts[0][0]}.${surname}`;
}

// ── Shared assembly ───────────────────────────────────────────────────────────

type SeasonRow = { year: string; leagueId: number; leagueName: string; nameFormat: string | null };

type NormFixture = {
  fullRound: string; date: string; status: string;
  homeTeamName: string; awayTeamName: string;
  homeScore: number | null; awayScore: number | null;
  homeScoreHt?: number | null; awayScoreHt?: number | null;
  matchHashId: string;
};

type NormEvent = { teamId: string; minute: number | null; ownGoal: boolean; penalty: boolean; name: string };
type NormSub = { teamId: string; minute: number | null; outName: string; inName: string; outJersey: string; inJersey: string };
type NormDetail = {
  homeScoreHt: number | null; awayScoreHt: number | null;
  homeTeamHashId: string; awayTeamHashId?: string;
  ftFirstHalf?: number | null; ftSecondHalf?: number | null;
  events: NormEvent[]; subs?: NormSub[];
};
type NormLineupPlayer = {
  firstName: string; lastName: string; jersey: string;
  starting: boolean; playing: boolean; isGoalkeeper: boolean; roleSlug: string;
};

/**
 * All display-name variants for a full name, shortest first: the league's
 * normal format, then progressively longer first-name prefixes to split
 * same-initial teammates ("Ja.Smith" vs "Jo.Smith"), and finally the full name.
 */
function nameVariants(full: string, nameFormat: string): string[] {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return [full.trim()];
  const surname = parts.slice(1).join(" ");
  const first = parts[0];
  const out: string[] = [];
  if (nameFormat === "surname") out.push(surname);
  for (let i = 1; i <= first.length; i++) out.push(`${first.slice(0, i)}.${surname}`);
  out.push(full.trim());
  return [...new Set(out)];
}

/**
 * Per-club name book: a permanent full-name → display-name mapping (backed by
 * the dribl_name_map table) so display names stay stable across syncs. The
 * first player to claim "A.Rakic" keeps it forever; a later same-initial
 * arrival is pinned to the next free variant ("An.Rakic"). Matches are
 * processed in date order, so "first" means first to appear in the season.
 */
type NameBook = {
  byFull: Map<string, string>; // lower-cased full name -> display name
  taken: Set<string>;          // display names already claimed
  fresh: Array<{ fullName: string; displayName: string }>; // new claims to persist
  /** lower-cased name → exact spelling of names already in saved stat rows for this club. */
  roster: Map<string, string>;
  /** lower-cased first name → exact roster spelling, only when that roster name
   * is a bare first name AND unique — so "amber" → "Amber" but never a guess. */
  rosterFirst: Map<string, string>;
};

function claimName(book: NameBook, full: string, nameFormat: string): string {
  const key = full.trim().toLowerCase();
  const existing = book.byFull.get(key);
  if (existing) return existing;
  const variants = nameVariants(full, nameFormat);
  let pick: string | null = null;
  // Prefer a spelling the coach already uses in saved sheets: an exact variant
  // hit ("S.Wells" / "Wells") or an unambiguous bare-first-name hit ("Amber"
  // for "Amber Toseland"). This is what stops a Dribl sync re-creating surname
  // duplicates of hand-entered players.
  for (const v of variants) {
    const hit = book.roster.get(v.toLowerCase());
    if (hit && !book.taken.has(hit)) { pick = hit; break; }
  }
  if (!pick) {
    const firstName = full.trim().split(/\s+/)[0];
    const hit = firstName ? book.rosterFirst.get(firstName.toLowerCase()) : undefined;
    if (hit && !book.taken.has(hit)) pick = hit;
  }
  if (!pick) {
    pick = variants[variants.length - 1];
    for (const v of variants) {
      if (!book.taken.has(v)) { pick = v; break; }
    }
  }
  book.byFull.set(key, pick);
  book.taken.add(pick);
  book.fresh.push({ fullName: key, displayName: pick });
  return pick;
}

/**
 * Turn one team's Dribl line-up + the match's sub events into per-player stat
 * rows (minutes, started, appearance). Subs are matched by jersey first, name
 * as fallback. Unused bench players get a row with 0 minutes / no appearance.
 * Same-initial teammates get longer first-name prefixes so names stay unique.
 */
function computeStatsRows(
  players: NormLineupPlayer[],
  subs: NormSub[],
  teamHashId: string,
  detail: NormDetail | null,
  nameFormat: string,
  book: NameBook,
): Array<{ playerName: string; shirtNumber: string | null; minsPlayed: number; started: boolean; appearance: boolean; position: string | null }> {
  const first = detail?.ftFirstHalf || 45;
  const second = detail?.ftSecondHalf || 45;
  const duration = Math.min(first + second, 130);
  const teamSubs = subs
    .filter(s => s.teamId === teamHashId && s.minute != null)
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));

  const rows: Array<{ playerName: string; shirtNumber: string | null; minsPlayed: number; started: boolean; appearance: boolean; position: string | null }> = [];
  for (const p of players) {
    if (p.roleSlug && p.roleSlug !== "player") continue; // coaching staff etc.
    const full = `${p.firstName} ${p.lastName}`.trim();
    // Dribl occasionally publishes placeholder member rows with no name.
    // They are not importable players and must not invalidate the whole sheet.
    if (!full) continue;
    const matchesPlayer = (jersey: string, name: string): boolean =>
      (jersey !== "" && p.jersey !== "" && jersey === p.jersey) ||
      name.trim().toLowerCase() === full.toLowerCase();
    let on: number | null = p.starting ? 0 : null;
    let off: number | null = null;
    for (const s of teamSubs) {
      if (on == null && matchesPlayer(s.inJersey, s.inName)) on = s.minute;
      else if (on != null && off == null && matchesPlayer(s.outJersey, s.outName)) off = s.minute;
    }
    const appeared = on != null;
    const mins = appeared ? Math.max(0, Math.min((off ?? duration) - (on ?? 0), duration)) : 0;
    rows.push({
      playerName: claimName(book, full, nameFormat),
      shirtNumber: p.jersey.trim() || null,
      minsPlayed: mins,
      started: p.starting,
      appearance: appeared,
      position: p.isGoalkeeper ? "GK" : null,
    });
  }
  return rows;
}

async function loadSeasonRow(seasonId: number): Promise<SeasonRow | undefined> {
  const [row] = await db
    .select({
      year: seasonsTable.year,
      leagueId: seasonsTable.leagueId,
      leagueName: leaguesTable.name,
      nameFormat: leaguesTable.nameFormat,
    })
    .from(seasonsTable)
    .innerJoin(leaguesTable, eq(seasonsTable.leagueId, leaguesTable.id))
    .where(eq(seasonsTable.id, seasonId));
  return row;
}

/**
 * Turn a list of Dribl fixtures into the import preview. `getDetail` supplies
 * match-centre detail (HT score + goal events) for a fixture hash, or null when
 * unavailable — in which case the hash is added to `needDetail` so the caller
 * can fetch it and re-assemble.
 */
async function buildPreview(
  seasonId: number,
  seasonRow: SeasonRow,
  fixtures: NormFixture[],
  getDetail: (hash: string) => Promise<NormDetail | null>,
  getLineup?: (matchHash: string, teamHash: string) => Promise<NormLineupPlayer[] | null>,
  recheckNoLineups = false,
): Promise<{ matches: Array<Record<string, unknown>>; needDetail: string[]; needLineups: Array<{ match: string; team: string }>; skippedNoLineups: number; suggestedClubs?: string[] }> {
  const clubs = (await db.select({ name: clubsTable.name }).from(clubsTable)
    .where(eq(clubsTable.leagueId, seasonRow.leagueId))).map(c => c.name);
  if (clubs.length === 0) {
    // Brand-new league with no clubs yet: instead of matching nothing, offer
    // the distinct team names from the fixture list (cleaned of grade/gender
    // qualifiers) so the coach can create the clubs right from the sync.
    const names = new Set<string>();
    for (const f of fixtures) {
      names.add(suggestClubName(f.homeTeamName));
      names.add(suggestClubName(f.awayTeamName));
    }
    return {
      matches: [], needDetail: [], needLineups: [], skippedNoLineups: 0,
      suggestedClubs: [...names].filter(Boolean).sort(),
    };
  }
  // Per-league unique 3-letter codes for new match IDs (Sydney Uni/Olympic etc.
  // would otherwise both be SYD and risk two fixtures sharing one ID).
  const clubCodes = clubCodesFor(clubs);
  // Existing matches are matched on round + home + away (with match-date as a
  // backup), NOT on the match-ID string — hand-entered games use their own club
  // codes (e.g. BELR vs BEL) so rebuilding the ID from club names won't line up.
  const existingRows = await db.select({
    matchId: leagueMatchesTable.matchId,
    matchDate: leagueMatchesTable.matchDate,
    homeTeam: leagueMatchesTable.homeTeam,
    awayTeam: leagueMatchesTable.awayTeam,
  }).from(leagueMatchesTable).where(eq(leagueMatchesTable.seasonId, seasonId));
  const existingByKey = new Map<string, string>(); // lookup key -> existing matchId
  for (const r of existingRows) {
    const roundFromId = /^R(\d+)-/.exec(r.matchId)?.[1];
    if (roundFromId) existingByKey.set(`r${roundFromId}|${r.homeTeam}|${r.awayTeam}`, r.matchId);
    if (r.matchDate) existingByKey.set(`d${r.matchDate}|${r.homeTeam}|${r.awayTeam}`, r.matchId);
  }
  // Goals already logged per match — so a re-sync can top up missing goals
  // (e.g. after a partial import) without ever duplicating rows.
  const goalRows = await db
    .select({ matchId: leagueGoalsTable.matchId, scorerTeam: leagueGoalsTable.scorerTeam, minuteScored: leagueGoalsTable.minuteScored })
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));
  const goalsByMatch = new Map<string, Array<{ scorerTeam: string | null; minuteScored: number | null }>>();
  for (const g of goalRows) {
    const list = goalsByMatch.get(g.matchId) ?? [];
    list.push(g);
    goalsByMatch.set(g.matchId, list);
  }

  // Player stats already saved per match+club — line-ups are only offered for
  // clubs with no rows yet, so hand-entered team sheets are never clobbered.
  const statsRows = await db
    .selectDistinct({ matchId: leaguePlayerStatsTable.matchId, club: leaguePlayerStatsTable.club })
    .from(leaguePlayerStatsTable)
    .where(eq(leaguePlayerStatsTable.seasonId, seasonId));
  const statsByMatch = new Map<string, Set<string>>();
  for (const s of statsRows) {
    if (!s.club) continue;
    const set = statsByMatch.get(s.matchId) ?? new Set<string>();
    set.add(s.club);
    statsByMatch.set(s.matchId, set);
  }
  // Games where a previous sync confirmed Dribl has no published team sheet —
  // skip those club sheets entirely (that's the re-sync speedup), unless the
  // caller asked to re-check them. Cleared when a sheet later appears.
  const noLineupRows = await db
    .select({ matchId: driblNoLineupTable.matchId, club: driblNoLineupTable.club })
    .from(driblNoLineupTable)
    .where(eq(driblNoLineupTable.seasonId, seasonId));
  const noLineupSet = new Set(noLineupRows.map(r => `${r.matchId}|${r.club}`));
  const freshNoLineups: Array<{ matchId: string; club: string }> = [];
  const clearedNoLineups: Array<{ matchId: string; club: string }> = [];
  let skippedNoLineups = 0;

  // Permanent full-name → display-name book per club (dribl_name_map table),
  // seeded so display names stay stable across syncs. Names not yet in the map
  // (e.g. hand-entered sheets) are claimed by the first Dribl full name that
  // matches — matches run in date order, so the season's first player wins.
  const mapRows = await db
    .select({ club: driblNameMapTable.club, fullName: driblNameMapTable.fullName, displayName: driblNameMapTable.displayName })
    .from(driblNameMapTable)
    .where(eq(driblNameMapTable.seasonId, seasonId));
  // Names already in saved stat rows per club (hand-entered sheets included) —
  // fresh claims prefer these spellings so a Dribl surname never duplicates a
  // player the coach already entered under a first name.
  const rosterRows = await db
    .selectDistinct({ club: leaguePlayerStatsTable.club, playerName: leaguePlayerStatsTable.playerName })
    .from(leaguePlayerStatsTable)
    .where(eq(leaguePlayerStatsTable.seasonId, seasonId));
  const rosterByClub = new Map<string, string[]>();
  for (const r of rosterRows) {
    if (!r.club) continue;
    const list = rosterByClub.get(r.club) ?? [];
    list.push(r.playerName);
    rosterByClub.set(r.club, list);
  }
  const booksByClub = new Map<string, NameBook>();
  const bookFor = (club: string): NameBook => {
    let book = booksByClub.get(club);
    if (!book) {
      const roster = new Map<string, string>();
      const firstCounts = new Map<string, string[]>();
      for (const name of rosterByClub.get(club) ?? []) {
        roster.set(name.toLowerCase(), name);
        // Bare first names only (single token, no dot) qualify for first-name matching.
        if (/^[^\s.]+$/.test(name)) {
          const list = firstCounts.get(name.toLowerCase()) ?? [];
          list.push(name);
          firstCounts.set(name.toLowerCase(), list);
        }
      }
      const rosterFirst = new Map<string, string>();
      for (const [k, list] of firstCounts) if (list.length === 1) rosterFirst.set(k, list[0]);
      book = { byFull: new Map(), taken: new Set(), fresh: [], roster, rosterFirst };
      booksByClub.set(club, book);
    }
    return book;
  };
  for (const r of mapRows) {
    const book = bookFor(r.club);
    book.byFull.set(r.fullName, r.displayName);
    book.taken.add(r.displayName);
  }

  const matches: Array<Record<string, unknown>> = [];
  const needDetail: string[] = [];
  const needLineups: Array<{ match: string; team: string }> = [];
  // Process in date order so name claims ("first player keeps the short name")
  // follow the season chronologically, whatever order the fixtures feed uses.
  const orderedFixtures = [...fixtures].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // Big federations (e.g. VIC NPLW) carry 150+ completed games in one season —
  // far too many for one sync. Cap each sync at the 50 most recent NEW games;
  // already-recorded games always flow through (they're deduped/topped up), so
  // repeat syncs keep walking back through older rounds 50 at a time.
  const completedAll = orderedFixtures
    .filter((f): f is typeof f & { homeScore: number; awayScore: number } =>
      f.status === "complete" && f.homeScore != null && f.awayScore != null);
  const recordedCache = new Map<(typeof completedAll)[number], boolean>();
  const isRecorded = (f: (typeof completedAll)[number]): boolean => {
    let v = recordedCache.get(f);
    if (v == null) {
      const home = matchClub(f.homeTeamName, clubs);
      const away = matchClub(f.awayTeamName, clubs);
      const round = parseInt(f.fullRound.replace(/\D/g, ""), 10) || 0;
      const localDate = toLocalDbDate(f.date);
      v = home != null && away != null &&
        (existingByKey.get(`r${round}|${home}|${away}`) ??
          (localDate ? existingByKey.get(`d${localDate}|${home}|${away}`) : undefined)) != null;
      recordedCache.set(f, v);
    }
    return v;
  };
  const allowedNew = new Set(completedAll.filter(f => !isRecorded(f)).slice(-50));
  const completedFixtures = completedAll.filter(f => isRecorded(f) || allowedNew.has(f));
  for (const f of completedFixtures) {
    const home = matchClub(f.homeTeamName, clubs);
    const away = matchClub(f.awayTeamName, clubs);
    const unmatched: string[] = [];
    if (!home) unmatched.push(f.homeTeamName);
    if (!away) unmatched.push(f.awayTeamName);
    const round = parseInt(f.fullRound.replace(/\D/g, ""), 10) || 0;
    const localDate = toLocalDbDate(f.date);
    const existingId = home && away
      ? existingByKey.get(`r${round}|${home}|${away}`) ?? (localDate ? existingByKey.get(`d${localDate}|${home}|${away}`) : undefined)
      : undefined;
    // Reuse the hand-entered match ID when the game is already recorded, so
    // goal top-ups land on the right row instead of creating a duplicate.
    const matchId = existingId ?? (home && away ? `R${round}-${clubCodes[home] ?? "?"}-${clubCodes[away] ?? "?"}` : `R${round}-?`);
    const exists = existingId != null;
    // For matches already recorded, only re-fetch detail when the logged goal
    // count falls short of the scoreline (a partial import worth topping up).
    const loggedGoals = goalsByMatch.get(matchId) ?? [];
    const goalsShort = exists && loggedGoals.length < f.homeScore + f.awayScore;

    // The fixtures feed carries HT scores directly — use them even when the
    // match-centre detail is unavailable.
    let halfScore: string | null =
      f.homeScoreHt != null && f.awayScoreHt != null ? `${f.homeScoreHt}-${f.awayScoreHt}` : null;
    const goals: Array<{ scorerTeam: string; scorer: string; minute: number | null; ownGoal: boolean; penalty: boolean }> = [];
    // Which clubs still need player rows (line-ups) for this game?
    const savedStatsClubs = statsByMatch.get(matchId) ?? new Set<string>();
    const statsWanted: Array<{ club: string; side: "home" | "away" }> = [];
    const wantStats = (club: string, side: "home" | "away") => {
      if (savedStatsClubs.has(club)) return;
      // A previous sync confirmed Dribl has no sheet for this club — skip
      // unless the caller asked to re-check those.
      if (!recheckNoLineups && noLineupSet.has(`${matchId}|${club}`)) { skippedNoLineups++; return; }
      statsWanted.push({ club, side });
    };
    if (getLineup && home) wantStats(home, "home");
    if (getLineup && away) wantStats(away, "away");
    const playerStats: Array<{ club: string; exists: boolean; rows: unknown[] }> = [];
    if (home && away && (!exists || goalsShort || statsWanted.length > 0)) {
      try {
        const detail = await getDetail(f.matchHashId);
        if (!detail) {
          needDetail.push(f.matchHashId);
        } else {
          // Line-ups: one fetch per team that still needs player rows.
          for (const w of statsWanted) {
            const teamHash = w.side === "home" ? detail.homeTeamHashId : detail.awayTeamHashId;
            if (!teamHash) continue;
            const players = await getLineup!(f.matchHashId, teamHash);
            if (players == null) {
              needLineups.push({ match: f.matchHashId, team: teamHash });
            } else if (players.some(p => !p.roleSlug || p.roleSlug === "player")) {
              const rows = computeStatsRows(players, detail.subs ?? [], teamHash, detail, seasonRow.nameFormat ?? "initial-surname", bookFor(w.club));
              if (rows.length > 0) playerStats.push({ club: w.club, exists: false, rows });
              // A sheet exists after all — forget any earlier no-lineup marker.
              if (noLineupSet.has(`${matchId}|${w.club}`)) clearedNoLineups.push({ matchId, club: w.club });
            } else {
              // Dribl answered but published no players. Only remember that for
              // games old enough that a sheet is clearly never coming — recent
              // games often get their sheet a day or two after full time.
              const playedAt = new Date(f.date.includes("T") ? f.date : `${f.date.replace(" ", "T")}Z`).getTime();
              const oldEnough = Number.isFinite(playedAt) && Date.now() - playedAt > 7 * 24 * 60 * 60 * 1000;
              if (oldEnough && !noLineupSet.has(`${matchId}|${w.club}`)) {
                freshNoLineups.push({ matchId, club: w.club });
              }
            }
          }
          if (halfScore == null && detail.homeScoreHt != null && detail.awayScoreHt != null) {
            halfScore = `${detail.homeScoreHt}-${detail.awayScoreHt}`;
          }
          for (const ev of (!exists || goalsShort) ? detail.events : []) {
            const scorersClub = ev.teamId === detail.homeTeamHashId ? home : away;
            const creditedClub = ev.ownGoal ? (scorersClub === home ? away : home) : scorersClub;
            goals.push({
              scorerTeam: creditedClub,
              scorer: ev.ownGoal ? "Own Goal" : claimName(bookFor(scorersClub), ev.name, seasonRow.nameFormat ?? "initial-surname"),
              minute: typeof ev.minute === "number" ? Math.min(ev.minute, 130) : null,
              ownGoal: ev.ownGoal,
              penalty: ev.penalty,
            });
          }
        }
      } catch (e) {
        logger.warn({ match: f.matchHashId, err: String(e) }, "Dribl match-centre fetch failed — importing scoreline only");
      }
    }

    // Top-up mode: keep only Dribl goals not already logged (matched on
    // credited team + minute).
    let finalGoals = goals;
    if (exists) {
      const taken = new Set(loggedGoals.map(g => `${g.scorerTeam}|${g.minuteScored ?? "?"}`));
      finalGoals = goals.filter(g => !taken.has(`${g.scorerTeam}|${g.minute ?? "?"}`));
    }

    matches.push({
      matchId, round,
      matchDate: localDate,
      homeTeam: home ?? "", awayTeam: away ?? "",
      driblHome: f.homeTeamName, driblAway: f.awayTeamName,
      homeGoals: f.homeScore, awayGoals: f.awayScore,
      halfScore, exists, unmatched,
      goalsOnly: exists && finalGoals.length > 0,
      goals: finalGoals,
      statsOnly: exists && finalGoals.length === 0 && playerStats.length > 0,
      playerStats,
    });
  }

  // Two different Dribl fixtures must never resolve to the same local match
  // ID — block both from import and say why, rather than silently colliding.
  const idCounts = new Map<string, number>();
  for (const m of matches) idCounts.set(m.matchId as string, (idCounts.get(m.matchId as string) ?? 0) + 1);
  for (const m of matches) {
    if ((idCounts.get(m.matchId as string) ?? 0) > 1) {
      (m.unmatched as string[]).push(`Match ID clash: two Dribl fixtures both map to ${m.matchId}`);
    }
  }

  matches.sort((x, y) => (x.round as number) - (y.round as number) || String(x.matchDate).localeCompare(String(y.matchDate)));

  // Flag display names claimed FRESH this sync (no prior dribl_name_map row) on
  // each club's line-up block, so the coach gets a review nudge before the
  // roster silently grows a new spelling (e.g. a surname variant of a player
  // they already entered by first name).
  const freshByClub = new Map<string, Set<string>>();
  for (const [club, book] of booksByClub) {
    // A fresh claim that adopted an existing roster spelling is NOT new to the
    // coach — only genuinely unseen names deserve the warning.
    const unseen = book.fresh.map(f => f.displayName).filter(n => !book.roster.has(n.toLowerCase()));
    if (unseen.length > 0) freshByClub.set(club, new Set(unseen));
  }
  for (const m of matches) {
    const shownInStats = new Set<string>();
    for (const ps of m.playerStats as Array<{ club: string; rows: Array<{ playerName: string }>; newNames?: string[] }>) {
      const fresh = freshByClub.get(ps.club);
      if (!fresh) continue;
      const hits = [...new Set(ps.rows.map(r => r.playerName).filter(n => fresh.has(n)))];
      if (hits.length > 0) {
        ps.newNames = hits;
        for (const n of hits) shownInStats.add(`${ps.club}|${n}`);
      }
    }
    // Goal-only imports (no line-up published) can still learn a brand-new
    // scorer name — surface those on the match too, minus any already flagged
    // via a line-up block, so no fresh name slips in unreviewed.
    const goalHits = [...new Set(
      (m.goals as Array<{ scorerTeam: string; scorer: string }>)
        .filter(g => g.scorer && g.scorer !== "Own Goal" && freshByClub.get(g.scorerTeam)?.has(g.scorer) && !shownInStats.has(`${g.scorerTeam}|${g.scorer}`))
        .map(g => `${g.scorer} (${g.scorerTeam})`),
    )];
    if (goalHits.length > 0) m.newGoalNames = goalHits;
  }

  // Persist any newly claimed display names so they stay stable forever.
  // Row-by-row with onConflictDoNothing: if a concurrent run already claimed a
  // full name or display name, that claim wins and this run's alternative is
  // simply dropped — the next preview reloads the winner and re-derives a free
  // variant for the loser, so the map converges without ever holding duplicates.
  for (const [club, book] of booksByClub) {
    for (const f of book.fresh) {
      await db
        .insert(driblNameMapTable)
        .values({ seasonId, club, fullName: f.fullName, displayName: f.displayName })
        .onConflictDoNothing();
    }
  }

  // Persist / clear no-lineup markers learned this pass. Skip persisting while
  // the browser-fallback assembly is still waiting on line-up payloads —
  // otherwise "not fetched yet" would be recorded as "no sheet exists".
  if (needLineups.length === 0) {
    if (freshNoLineups.length > 0) {
      await db.insert(driblNoLineupTable)
        .values(freshNoLineups.map(m => ({ seasonId, matchId: m.matchId, club: m.club })))
        .onConflictDoNothing();
    }
    for (const c of clearedNoLineups) {
      await db.delete(driblNoLineupTable).where(and(
        eq(driblNoLineupTable.seasonId, seasonId),
        eq(driblNoLineupTable.matchId, c.matchId),
        eq(driblNoLineupTable.club, c.club),
      ));
    }
  }

  return { matches, needDetail, needLineups, skippedNoLineups };
}

// ── Name-map management ───────────────────────────────────────────────────────
// The coach's control over what Dribl full names appear as in the roster.
// Editing a mapping also renames every already-saved stat/goal row this season,
// so fixing a surname variant merges it into the preferred name instead of
// leaving a duplicate behind.

router.get("/entry/dribl-name-map", async (req, res): Promise<void> => {
  const query = ListDriblNameMapQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId, club } = query.data;
  const rows = await db
    .select({ id: driblNameMapTable.id, club: driblNameMapTable.club, fullName: driblNameMapTable.fullName, displayName: driblNameMapTable.displayName })
    .from(driblNameMapTable)
    .where(and(eq(driblNameMapTable.seasonId, seasonId), eq(driblNameMapTable.club, club)));
  // How many saved stat rows each display name currently owns — shows the
  // coach which mappings actually carry data.
  const statRows = await db
    .select({ playerName: leaguePlayerStatsTable.playerName })
    .from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), eq(leaguePlayerStatsTable.club, club)));
  const counts = new Map<string, number>();
  for (const r of statRows) counts.set(r.playerName, (counts.get(r.playerName) ?? 0) + 1);
  res.json(ListDriblNameMapResponse.parse({
    rows: rows
      .map(r => ({ ...r, statRows: counts.get(r.displayName) ?? 0 }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }));
});

router.put("/entry/dribl-name-map/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = UpdateDriblNameMapBody.safeParse(req.body);
  if (!Number.isInteger(id) || !body.success) {
    res.status(400).json({ error: body.success ? "Bad id" : body.error.message });
    return;
  }
  const [row] = await db.select().from(driblNameMapTable).where(eq(driblNameMapTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Mapping not found" });
    return;
  }
  // Id-addressed write: the central middleware can't see the league scope, so
  // check against the row's own league here.
  const leagueId = await leagueIdForSeason(row.seasonId);
  if (leagueId == null || !(await mayTouchLeagueRow(req, leagueId, "data-entry"))) {
    res.status(403).json({ error: "No access to this league" });
    return;
  }
  const newName = body.data.displayName.trim();
  const oldName = row.displayName;
  if (!newName || newName === oldName) {
    res.json(UpdateDriblNameMapResponse.parse({ displayName: oldName, renamedStats: 0, renamedGoals: 0, renamedMirror: 0 }));
    return;
  }
  const [season] = await db.select({ year: seasonsTable.year }).from(seasonsTable).where(eq(seasonsTable.id, row.seasonId));
  try {
    const result = await db.transaction(async (tx) => {
      await tx.update(driblNameMapTable).set({ displayName: newName }).where(eq(driblNameMapTable.id, id));
      // League tables — what the roster and player charts are built from.
      const renamedStats = (await tx.update(leaguePlayerStatsTable).set({ playerName: newName })
        .where(and(
          eq(leaguePlayerStatsTable.seasonId, row.seasonId),
          eq(leaguePlayerStatsTable.club, row.club),
          eq(leaguePlayerStatsTable.playerName, oldName),
        )).returning({ id: leaguePlayerStatsTable.id })).length;
      const renamedScorers = (await tx.update(leagueGoalsTable).set({ scorer: newName })
        .where(and(
          eq(leagueGoalsTable.seasonId, row.seasonId),
          eq(leagueGoalsTable.scorerTeam, row.club),
          eq(leagueGoalsTable.scorer, oldName),
        )).returning({ id: leagueGoalsTable.id })).length;
      const renamedAssists = (await tx.update(leagueGoalsTable).set({ assist: newName })
        .where(and(
          eq(leagueGoalsTable.seasonId, row.seasonId),
          eq(leagueGoalsTable.scorerTeam, row.club),
          eq(leagueGoalsTable.assist, oldName),
        )).returning({ id: leagueGoalsTable.id })).length;
      // Legacy focus-club mirror (player_stats/players/goals) — year-scoped.
      let renamedMirror = 0;
      if (season?.year) {
        const mirrorRows = await tx.update(playerStatsTable).set({ playerName: newName })
          .where(and(
            eq(playerStatsTable.club, row.club),
            eq(playerStatsTable.year, season.year),
            eq(playerStatsTable.playerName, oldName),
          )).returning({ id: playerStatsTable.id });
        renamedMirror += mirrorRows.length;
        if (mirrorRows.length > 0) {
          // Keep players rows consistent: repoint stats at an existing player
          // with the new name, or rename the old player row when there isn't one.
          const [target] = await tx.select({ id: playersTable.id }).from(playersTable)
            .where(and(eq(playersTable.name, newName), eq(playersTable.club, row.club)));
          if (target) {
            for (const m of mirrorRows) {
              await tx.update(playerStatsTable).set({ playerId: target.id }).where(eq(playerStatsTable.id, m.id));
            }
          } else {
            await tx.update(playersTable).set({ name: newName })
              .where(and(eq(playersTable.name, oldName), eq(playersTable.club, row.club)));
          }
        }
        renamedMirror += (await tx.update(goalsTable).set({ scorer: newName })
          .where(and(
            eq(goalsTable.seasonId, row.seasonId),
            eq(goalsTable.scorerTeam, row.club),
            eq(goalsTable.scorer, oldName),
          )).returning({ id: goalsTable.id })).length;
        renamedMirror += (await tx.update(goalsTable).set({ assist: newName })
          .where(and(
            eq(goalsTable.seasonId, row.seasonId),
            eq(goalsTable.scorerTeam, row.club),
            eq(goalsTable.assist, oldName),
          )).returning({ id: goalsTable.id })).length;
      }
      return { renamedStats, renamedGoals: renamedScorers + renamedAssists, renamedMirror };
    });
    res.json(UpdateDriblNameMapResponse.parse({ displayName: newName, ...result }));
  } catch (e) {
    if (pgErrorCode(e) === "23505") {
      res.status(409).json({ error: `"${newName}" is already used by another mapped player in ${row.club} this season` });
      return;
    }
    throw e;
  }
});

router.delete("/entry/dribl-name-map/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const [row] = await db.select().from(driblNameMapTable).where(eq(driblNameMapTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Mapping not found" });
    return;
  }
  const leagueId = await leagueIdForSeason(row.seasonId);
  if (leagueId == null || !(await mayTouchLeagueRow(req, leagueId, "data-entry"))) {
    res.status(403).json({ error: "No access to this league" });
    return;
  }
  await db.delete(driblNameMapTable).where(eq(driblNameMapTable.id, id));
  res.json(DeleteDriblNameMapResponse.parse({ deleted: true }));
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Tells the browser what to fetch from Dribl when the server itself is blocked.
router.get("/entry/dribl-config", async (req, res): Promise<void> => {
  const query = GetDriblConfigQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const seasonRow = await loadSeasonRow(query.data.seasonId);
  if (!seasonRow) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  const dribl = driblLeagueFor(seasonRow.leagueName);
  if (!dribl) {
    res.status(400).json({ error: `Dribl sync isn't set up for ${seasonRow.leagueName} yet` });
    return;
  }
  res.json(GetDriblConfigResponse.parse({ driblLeague: dribl.league, driblCompetition: dribl.competition, driblYear: seasonRow.year, driblTenantSlug: dribl.tenant }));
});

// Server-side fetch path.
router.get("/entry/dribl-preview", async (req, res): Promise<void> => {
  const query = GetDriblPreviewQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId } = query.data;
  const seasonRow = await loadSeasonRow(seasonId);
  if (!seasonRow) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  const dribl = driblLeagueFor(seasonRow.leagueName);
  if (!dribl) {
    res.status(400).json({ error: `Dribl sync isn't set up for ${seasonRow.leagueName} yet` });
    return;
  }
  const driblLeague = dribl.league;

  try {
    const tenant = await driblTenant(dribl.tenant);
    const { hash: seasonHash, title: seasonTitle } = await driblSeasonHash(tenant, seasonRow.year, dribl.tenant);
    const competition = await driblCompetitionHash(tenant, dribl.competition, dribl.tenant);

    // Page through the whole season's fixtures and keep only this league's
    // games. NOTE: the /results feed silently drops early-season rounds —
    // /fixtures is the complete list (and carries HT scores in the row).
    const fixtures: NormFixture[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 60; page++) {
      const params: Record<string, string> = { tenant, season: seasonHash, competition, date_range: "all" };
      if (cursor) params.cursor = cursor;
      const data = await driblGet("/fixtures", params, dribl.tenant);
      const rows = data?.data ?? [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const a = row.attributes ?? {};
        if (a.league_name === driblLeague && !a.bye_flag) {
          fixtures.push({
            fullRound: String(a.full_round ?? ""), date: String(a.date ?? ""), status: String(a.status ?? ""),
            homeTeamName: String(a.home_team_name ?? ""), awayTeamName: String(a.away_team_name ?? ""),
            homeScore: a.home_score ?? null, awayScore: a.away_score ?? null,
            homeScoreHt: a.home_score_half ?? null, awayScoreHt: a.away_score_half ?? null,
            matchHashId: String(a.match_hash_id ?? ""),
          });
        }
      }
      cursor = data?.meta?.next_cursor ?? null;
      if (!cursor) break;
    }

    const { matches, skippedNoLineups, suggestedClubs } = await buildPreview(
      seasonId, seasonRow, fixtures,
      async (hash) => {
        const mc = await driblGet(`/matchcentre/${hash}`, { tenant }, dribl.tenant);
        const a = mc?.data?.attributes ?? {};
        return {
          homeScoreHt: a.home_score_ht ?? null,
          awayScoreHt: a.away_score_ht ?? null,
          homeTeamHashId: String(a.home_team_hash_id ?? ""),
          awayTeamHashId: String(a.away_team_hash_id ?? ""),
          ftFirstHalf: typeof a.ft_first_half_duration === "number" ? a.ft_first_half_duration : null,
          ftSecondHalf: typeof a.ft_second_half_duration === "number" ? a.ft_second_half_duration : null,
          events: (a.match_events ?? [])
            .filter((ev: any) => ev.type === "goal")
            .map((ev: any) => ({
              teamId: String(ev.team_id ?? ""),
              minute: typeof ev.minute === "number" ? ev.minute : null,
              ownGoal: Boolean(ev.own_goal),
              penalty: Boolean(ev.penalty_kick),
              name: String(ev.name ?? ""),
            })),
          subs: (a.match_events ?? [])
            .filter((ev: any) => ev.type === "sub")
            .map((ev: any) => ({
              teamId: String(ev.team_id ?? ""),
              minute: typeof ev.minute === "number" ? ev.minute : null,
              outName: String(ev.out_name ?? ""), inName: String(ev.in_name ?? ""),
              outJersey: String(ev.out_jersey ?? ""), inJersey: String(ev.in_jersey ?? ""),
            })),
        };
      },
      async (matchHash, teamHash) => {
        try {
          const lu = await driblGet(`/matchcentre-match-members/match/${matchHash}/team/${teamHash}`, { tenant }, dribl.tenant);
          const rows = Array.isArray(lu) ? lu : lu?.data ?? [];
          return rows.map((r: any) => {
            const a = r?.attributes ?? r ?? {};
            return {
              firstName: String(a.first_name ?? ""), lastName: String(a.last_name ?? ""),
              jersey: String(a.jersey ?? ""),
              starting: Boolean(a.starting), playing: Boolean(a.playing),
              isGoalkeeper: Boolean(a.is_goalkeeper), roleSlug: String(a.role_slug ?? "player"),
            };
          });
        } catch (e) {
          logger.warn({ matchHash, teamHash, err: String(e) }, "Dribl line-up fetch failed — skipping player rows");
          // null (not []) — a fetch failure must never be recorded as
          // "Dribl has no sheet for this game".
          return null;
        }
      },
      // NOTE: don't trust the generated zod coercion here — zod.coerce.boolean()
      // turns ANY non-empty string (including "false") into true. Only the
      // literal string "true" means re-check.
      String(req.query.recheckNoLineups ?? "") === "true",
    );

    res.json(GetDriblPreviewResponse.parse({ driblSeason: seasonTitle, driblLeague, matches, needDetail: [], needLineups: [], skippedNoLineups, suggestedClubs }));
  } catch (e) {
    logger.error({ err: String(e) }, "Dribl preview failed");
    res.status(502).json({ error: `Couldn't reach Dribl: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// Browser-supplied path: the client fetched the raw Dribl JSON itself and posts
// trimmed fixtures (and, on the second pass, match-centre detail) for assembly.
router.post("/entry/dribl-preview", async (req, res): Promise<void> => {
  const parsed = AssembleDriblPreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const seasonRow = await loadSeasonRow(b.seasonId);
  if (!seasonRow) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  const dribl = driblLeagueFor(seasonRow.leagueName);
  if (!dribl) {
    res.status(400).json({ error: `Dribl sync isn't set up for ${seasonRow.leagueName} yet` });
    return;
  }
  const driblLeague = dribl.league;

  const detailByHash = new Map<string, NormDetail>();
  for (const mc of b.matchCentres ?? []) {
    detailByHash.set(mc.matchHashId, {
      homeScoreHt: mc.homeScoreHt, awayScoreHt: mc.awayScoreHt,
      homeTeamHashId: mc.homeTeamHashId,
      awayTeamHashId: mc.awayTeamHashId,
      ftFirstHalf: mc.ftFirstHalf ?? null,
      ftSecondHalf: mc.ftSecondHalf ?? null,
      events: mc.events.map((ev: { teamId: string; minute: number | null; ownGoal: boolean; penalty: boolean; name: string }) => ({
        teamId: ev.teamId, minute: ev.minute, ownGoal: ev.ownGoal, penalty: ev.penalty, name: ev.name,
      })),
      subs: (mc.subs ?? []).map(s => ({
        teamId: s.teamId, minute: s.minute,
        outName: s.outName, inName: s.inName,
        outJersey: s.outJersey, inJersey: s.inJersey,
      })),
    });
  }
  const lineupByKey = new Map<string, NormLineupPlayer[]>();
  for (const lu of b.lineups ?? []) {
    lineupByKey.set(`${lu.matchHashId}|${lu.teamHashId}`, lu.players.map(p => ({
      firstName: p.firstName, lastName: p.lastName, jersey: p.jersey,
      starting: p.starting, playing: p.playing, isGoalkeeper: p.isGoalkeeper, roleSlug: p.roleSlug,
    })));
  }

  const { matches, needDetail, needLineups, skippedNoLineups, suggestedClubs } = await buildPreview(
    b.seasonId, seasonRow, b.fixtures,
    async (hash) => detailByHash.get(hash) ?? null,
    async (matchHash, teamHash) => lineupByKey.get(`${matchHash}|${teamHash}`) ?? null,
    b.recheckNoLineups ?? false,
  );

  res.json(GetDriblPreviewResponse.parse({
    driblSeason: b.driblSeason ?? seasonRow.year,
    driblLeague, matches, needDetail, needLineups, skippedNoLineups, suggestedClubs,
  }));
});

export default router;
