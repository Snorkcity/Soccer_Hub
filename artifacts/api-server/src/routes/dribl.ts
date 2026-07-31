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
import { db, leagueMatchesTable, leagueGoalsTable, leaguePlayerStatsTable, seasonsTable, leaguesTable, clubsTable, driblNameMapTable, driblNoLineupTable } from "@workspace/db";
import {
  GetDriblPreviewQueryParams,
  GetDriblPreviewResponse,
  GetDriblConfigQueryParams,
  GetDriblConfigResponse,
  AssembleDriblPreviewBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const router: IRouter = Router();

const DRIBL_API = "https://mc-api.dribl.com/api";
const DRIBL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://capital.dribl.com",
  Referer: "https://capital.dribl.com/",
};

// Which Dribl league + competition a local league maps to. The competition
// hash filters the fixtures feed down from thousands of rows (every grade in
// the ACT) to just the NPL games. Extend as leagues are added.
function driblLeagueFor(leagueName: string): { league: string; competition: string } | null {
  if (/NPLM/i.test(leagueName)) return { league: "NPLM 1st Grade", competition: "National Premier League Men's" };
  if (/NPLW.*Reserve/i.test(leagueName)) return { league: "NPLW Reserve Grade", competition: "National Premier League Women's" };
  if (/NPLW/i.test(leagueName)) return { league: "NPLW 1st Grade", competition: "National Premier League Women's" };
  return null;
}

// Cloudflare fingerprints Node's TLS stack and returns 403 for fetch/https
// requests even with browser headers, but curl's fingerprint passes. So all
// server-side Dribl calls shell out to curl.
async function driblGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${DRIBL_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const args = ["-sS", "-m", "30", "-w", "\n%{http_code}"];
  for (const [k, v] of Object.entries(DRIBL_HEADERS)) args.push("-H", `${k}: ${v}`);
  args.push(url.toString());
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 20 * 1024 * 1024 });
  const cut = stdout.lastIndexOf("\n");
  const status = stdout.slice(cut + 1).trim();
  if (status !== "200") throw new Error(`Dribl ${path} responded ${status}`);
  return JSON.parse(stdout.slice(0, cut));
}

// Tenant + season hashes never change once issued — cache for the process.
let tenantCache: string | null = null;
async function driblTenant(): Promise<string> {
  if (tenantCache) return tenantCache;
  const data = await driblGet("/tenants", { slug: "capital" });
  const id: string | undefined = data?.data?.id ?? data?.data?.hash_id ?? data?.data?.[0]?.id;
  if (!id) throw new Error("Could not resolve Dribl tenant for capital.dribl.com");
  tenantCache = id;
  return id;
}

const competitionHashCache = new Map<string, string>();
async function driblCompetitionHash(tenant: string, name: string): Promise<string> {
  const cached = competitionHashCache.get(name);
  if (cached) return cached;
  const data = await driblGet("/list/competitions", { tenant });
  const rows: Array<{ id: string; name?: string; title?: string }> = data?.data ?? [];
  const pick = rows.find(c => (c.name ?? c.title) === name);
  if (!pick) throw new Error(`Dribl has no "${name}" competition for Capital Football`);
  competitionHashCache.set(name, pick.id);
  return pick.id;
}

const seasonHashCache = new Map<string, string>();
async function driblSeasonHash(tenant: string, year: string): Promise<{ hash: string; title: string }> {
  const cached = seasonHashCache.get(year);
  if (cached) return { hash: cached, title: year };
  const data = await driblGet("/list/seasons", { tenant });
  const rows: Array<{ id: string; title: string; year: number; is_current: boolean }> = data?.data ?? [];
  const matches = rows.filter(s => String(s.year) === year);
  const pick = matches.find(s => s.is_current) ?? matches[matches.length - 1];
  if (!pick) throw new Error(`Dribl has no ${year} season for Capital Football`);
  seasonHashCache.set(year, pick.id);
  return { hash: pick.id, title: pick.title };
}

function clubCode(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

/** Map a Dribl team name ("Canberra Croatia FC All Age Men 1st Grade Male") to a local club name. */
function matchClub(driblTeamName: string, clubs: string[]): string | null {
  const hay = driblTeamName.toLowerCase();
  // Longest club name first so e.g. "White Eagles" wins over any shorter accidental hit
  const sorted = [...clubs].sort((a, b) => b.length - a.length);
  for (const club of sorted) {
    if (hay.includes(club.toLowerCase())) return club;
  }
  return null;
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
};

function claimName(book: NameBook, full: string, nameFormat: string): string {
  const key = full.trim().toLowerCase();
  const existing = book.byFull.get(key);
  if (existing) return existing;
  const variants = nameVariants(full, nameFormat);
  let pick = variants[variants.length - 1];
  for (const v of variants) {
    if (!book.taken.has(v)) { pick = v; break; }
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
): Array<{ playerName: string; minsPlayed: number; started: boolean; appearance: boolean; position: string | null }> {
  const first = detail?.ftFirstHalf || 45;
  const second = detail?.ftSecondHalf || 45;
  const duration = Math.min(first + second, 130);
  const teamSubs = subs
    .filter(s => s.teamId === teamHashId && s.minute != null)
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));

  const rows: Array<{ playerName: string; minsPlayed: number; started: boolean; appearance: boolean; position: string | null }> = [];
  for (const p of players) {
    if (p.roleSlug && p.roleSlug !== "player") continue; // coaching staff etc.
    const full = `${p.firstName} ${p.lastName}`.trim();
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
): Promise<{ matches: Array<Record<string, unknown>>; needDetail: string[]; needLineups: Array<{ match: string; team: string }>; skippedNoLineups: number }> {
  const clubs = (await db.select({ name: clubsTable.name }).from(clubsTable)
    .where(eq(clubsTable.leagueId, seasonRow.leagueId))).map(c => c.name);
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
  const booksByClub = new Map<string, NameBook>();
  const bookFor = (club: string): NameBook => {
    let book = booksByClub.get(club);
    if (!book) { book = { byFull: new Map(), taken: new Set(), fresh: [] }; booksByClub.set(club, book); }
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
  for (const f of orderedFixtures) {
    if (f.status !== "complete" || f.homeScore == null || f.awayScore == null) continue;
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
    const matchId = existingId ?? (home && away ? `R${round}-${clubCode(home)}-${clubCode(away)}` : `R${round}-?`);
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
  res.json(GetDriblConfigResponse.parse({ driblLeague: dribl.league, driblCompetition: dribl.competition, driblYear: seasonRow.year }));
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
    const tenant = await driblTenant();
    const { hash: seasonHash, title: seasonTitle } = await driblSeasonHash(tenant, seasonRow.year);
    const competition = await driblCompetitionHash(tenant, dribl.competition);

    // Page through the whole season's fixtures and keep only this league's
    // games. NOTE: the /results feed silently drops early-season rounds —
    // /fixtures is the complete list (and carries HT scores in the row).
    const fixtures: NormFixture[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 60; page++) {
      const params: Record<string, string> = { tenant, season: seasonHash, competition, date_range: "all" };
      if (cursor) params.cursor = cursor;
      const data = await driblGet("/fixtures", params);
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

    const { matches, skippedNoLineups } = await buildPreview(
      seasonId, seasonRow, fixtures,
      async (hash) => {
        const mc = await driblGet(`/matchcentre/${hash}`, { tenant });
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
          const lu = await driblGet(`/matchcentre-match-members/match/${matchHash}/team/${teamHash}`, { tenant });
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

    res.json(GetDriblPreviewResponse.parse({ driblSeason: seasonTitle, driblLeague, matches, needDetail: [], needLineups: [], skippedNoLineups }));
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

  const { matches, needDetail, needLineups, skippedNoLineups } = await buildPreview(
    b.seasonId, seasonRow, b.fixtures,
    async (hash) => detailByHash.get(hash) ?? null,
    async (matchHash, teamHash) => lineupByKey.get(`${matchHash}|${teamHash}`) ?? null,
    b.recheckNoLineups ?? false,
  );

  res.json(GetDriblPreviewResponse.parse({
    driblSeason: b.driblSeason ?? seasonRow.year,
    driblLeague, matches, needDetail, needLineups, skippedNoLineups,
  }));
});

export default router;
