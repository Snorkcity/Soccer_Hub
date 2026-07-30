// ── Dribl sync (Capital Football) ─────────────────────────────────────────────
// Reads public fixture/result data from the Dribl match-centre API that powers
// capital.dribl.com and turns it into an import preview for Data Entry.
// Cloudflare blocks bare requests, so every call sends browser-like headers.
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, leagueMatchesTable, leagueGoalsTable, seasonsTable, leaguesTable, clubsTable } from "@workspace/db";
import { GetDriblPreviewQueryParams, GetDriblPreviewResponse } from "@workspace/api-zod";
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

// Which Dribl league feed a local league maps to. Extend as leagues are added.
function driblLeagueNameFor(leagueName: string): string | null {
  if (/NPLM/i.test(leagueName)) return "NPLM 1st Grade";
  return null;
}

// Cloudflare fingerprints Node's TLS stack and returns 403 for fetch/https
// requests even with browser headers, but curl's fingerprint passes. So all
// Dribl calls shell out to curl (present on Replit dev and the Railway image).
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
  const d = new Date(`${utc.replace(" ", "T")}Z`);
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

router.get("/entry/dribl-preview", async (req, res): Promise<void> => {
  const query = GetDriblPreviewQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId } = query.data;

  const [seasonRow] = await db
    .select({
      year: seasonsTable.year,
      leagueId: seasonsTable.leagueId,
      leagueName: leaguesTable.name,
      nameFormat: leaguesTable.nameFormat,
    })
    .from(seasonsTable)
    .innerJoin(leaguesTable, eq(seasonsTable.leagueId, leaguesTable.id))
    .where(eq(seasonsTable.id, seasonId));
  if (!seasonRow) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  const driblLeague = driblLeagueNameFor(seasonRow.leagueName);
  if (!driblLeague) {
    res.status(400).json({ error: `Dribl sync isn't set up for ${seasonRow.leagueName} yet — it currently covers ACT NPLM` });
    return;
  }

  const clubs = (await db.select({ name: clubsTable.name }).from(clubsTable)
    .where(eq(clubsTable.leagueId, seasonRow.leagueId))).map(c => c.name);
  const existingIds = new Set((await db.select({ matchId: leagueMatchesTable.matchId })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId))).map(r => r.matchId));
  // Goals already logged per match — so a re-sync can top up missing goals
  // (e.g. after a partial import) without ever duplicating rows.
  const goalRows = await db
    .select({ matchId: leagueGoalsTable.matchId, scorerTeam: leagueGoalsTable.scorerTeam, minuteScored: leagueGoalsTable.minuteScored, scorer: leagueGoalsTable.scorer })
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));
  const goalsByMatch = new Map<string, Array<{ scorerTeam: string | null; minuteScored: number | null; scorer: string | null }>>();
  for (const g of goalRows) {
    const list = goalsByMatch.get(g.matchId) ?? [];
    list.push(g);
    goalsByMatch.set(g.matchId, list);
  }

  try {
    const tenant = await driblTenant();
    const { hash: seasonHash, title: seasonTitle } = await driblSeasonHash(tenant, seasonRow.year);

    // Page through the whole season's results and keep only this league's completed games
    type DriblResult = {
      full_round: string; date: string; status: string; bye_flag: number;
      league_name: string; home_team_name: string; away_team_name: string;
      home_score: number | null; away_score: number | null; match_hash_id: string;
    };
    const fixtures: DriblResult[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 80; page++) {
      const params: Record<string, string> = { tenant, season: seasonHash, date_range: "all" };
      if (cursor) params.cursor = cursor;
      const data = await driblGet("/results", params);
      for (const row of data?.data ?? []) {
        const a = row.attributes as DriblResult;
        if (a.league_name === driblLeague && !a.bye_flag) fixtures.push(a);
      }
      cursor = data?.meta?.next_cursor ?? null;
      if (!cursor) break;
    }

    const matches: Array<Record<string, unknown>> = [];
    for (const f of fixtures) {
      if (f.status !== "complete" || f.home_score == null || f.away_score == null) continue;
      const home = matchClub(f.home_team_name, clubs);
      const away = matchClub(f.away_team_name, clubs);
      const unmatched: string[] = [];
      if (!home) unmatched.push(f.home_team_name);
      if (!away) unmatched.push(f.away_team_name);
      const round = parseInt(f.full_round.replace(/\D/g, ""), 10) || 0;
      const matchId = home && away ? `R${round}-${clubCode(home)}-${clubCode(away)}` : `R${round}-?`;
      const exists = existingIds.has(matchId);
      // For matches already recorded, only re-fetch detail when the logged goal
      // count falls short of the scoreline (a partial import worth topping up).
      const loggedGoals = goalsByMatch.get(matchId) ?? [];
      const goalsShort = exists && loggedGoals.length < f.home_score + f.away_score;

      let halfScore: string | null = null;
      const goals: Array<Record<string, unknown>> = [];
      if (home && away && (!exists || goalsShort)) {
        try {
          const mc = await driblGet(`/matchcentre/${f.match_hash_id}`, { tenant });
          const a = mc?.data?.attributes ?? {};
          if (a.home_score_ht != null && a.away_score_ht != null) {
            halfScore = `${a.home_score_ht}-${a.away_score_ht}`;
          }
          const homeHash = a.home_team_hash_id;
          for (const ev of a.match_events ?? []) {
            if (ev.type !== "goal") continue;
            const scorersClub = ev.team_id === homeHash ? home : away;
            const creditedClub = ev.own_goal
              ? (scorersClub === home ? away : home)
              : scorersClub;
            goals.push({
              scorerTeam: creditedClub,
              scorer: ev.own_goal ? "Own Goal" : formatPlayerName(String(ev.name ?? ""), seasonRow.nameFormat ?? "initial-surname"),
              minute: typeof ev.minute === "number" ? Math.min(ev.minute, 130) : null,
              ownGoal: Boolean(ev.own_goal),
              penalty: Boolean(ev.penalty_kick),
            });
          }
        } catch (e) {
          logger.warn({ match: f.match_hash_id, err: String(e) }, "Dribl match-centre fetch failed — importing scoreline only");
        }
      }

      // Top-up mode: keep only Dribl goals not already logged (matched on
      // credited team + minute, falling back to scorer when minute is absent).
      let finalGoals = goals;
      if (exists) {
        const taken = new Set(loggedGoals.map(g => `${g.scorerTeam}|${g.minuteScored ?? "?"}`));
        finalGoals = goals.filter(g => !taken.has(`${g.scorerTeam}|${g.minute ?? "?"}`));
      }

      matches.push({
        matchId, round,
        matchDate: toLocalDbDate(f.date),
        homeTeam: home ?? "", awayTeam: away ?? "",
        driblHome: f.home_team_name, driblAway: f.away_team_name,
        homeGoals: f.home_score, awayGoals: f.away_score,
        halfScore, exists, unmatched,
        goalsOnly: exists && finalGoals.length > 0,
        goals: finalGoals,
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
    res.json(GetDriblPreviewResponse.parse({ driblSeason: seasonTitle, driblLeague, matches }));
  } catch (e) {
    logger.error({ err: String(e) }, "Dribl preview failed");
    res.status(502).json({ error: `Couldn't reach Dribl: ${e instanceof Error ? e.message : String(e)}` });
  }
});

export default router;
