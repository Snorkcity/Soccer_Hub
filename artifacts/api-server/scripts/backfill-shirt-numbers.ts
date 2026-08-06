// One-off: backfill league_player_stats.shirt_number for an already-synced
// Dribl season. Re-fetches the season's fixtures + line-ups from Dribl and
// stamps jersey numbers onto the existing player rows (matched via the
// dribl_name_map book, same as the sync). Never touches names or minutes.
//
// Usage:
//   DATABASE_URL=... NODE_ENV=production node /tmp/backfill-shirt-numbers.js "ACT NPLM" [--apply]
// Without --apply it's a dry run (prints what it would do).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import {
  db, leaguesTable, seasonsTable, clubsTable,
  leagueMatchesTable, leaguePlayerStatsTable, driblNameMapTable,
} from "@workspace/db";

const execFileAsync = promisify(execFile);
const DRIBL_API = "https://mc-api.dribl.com/api";

function driblHeaders(tenantSlug: string) {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "application/json",
    Origin: `https://${tenantSlug}.dribl.com`,
    Referer: `https://${tenantSlug}.dribl.com/`,
  };
}

async function driblGet(path: string, params: Record<string, string>, tenantSlug: string): Promise<any> {
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

function driblLeagueFor(leagueName: string): { tenant: string; league: string; competition: string } | null {
  if (/NPLM.*U.?23/i.test(leagueName)) return { tenant: "capital", league: "NPLM U23", competition: "National Premier League Men's" };
  if (/NPLM/i.test(leagueName)) return { tenant: "capital", league: "NPLM 1st Grade", competition: "National Premier League Men's" };
  if (/NPLW.*Reserve/i.test(leagueName)) return { tenant: "capital", league: "NPLW Reserve Grade", competition: "National Premier League Women's" };
  if (/NPLW/i.test(leagueName)) return { tenant: "capital", league: "NPLW 1st Grade", competition: "National Premier League Women's" };
  return null;
}

function matchClub(driblTeamName: string, clubs: string[]): string | null {
  const hay = driblTeamName.toLowerCase();
  const sorted = [...clubs].sort((a, b) => b.length - a.length);
  for (const club of sorted) if (hay.includes(club.toLowerCase())) return club;
  return null;
}

function toLocalDbDate(utc: string): string {
  const d = new Date(utc.includes("T") ? utc : `${utc.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(d).replaceAll("-", "/");
}

async function main() {
  const leagueName = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!leagueName) throw new Error('Usage: backfill-shirt-numbers "<league name>" [--apply]');

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.name, leagueName));
  if (!league) throw new Error(`No league named "${leagueName}"`);
  const seasons = await db.select().from(seasonsTable).where(eq(seasonsTable.leagueId, league.id));
  if (seasons.length !== 1) throw new Error(`Expected exactly 1 season for ${leagueName}, found ${seasons.length} — pass a season filter`);
  const season = seasons[0];
  const dribl = driblLeagueFor(leagueName);
  if (!dribl) throw new Error(`No Dribl mapping for ${leagueName}`);

  const clubs = (await db.select({ name: clubsTable.name }).from(clubsTable).where(eq(clubsTable.leagueId, league.id))).map(c => c.name);

  // Existing matches keyed the same way as the sync: round|home|away, date|home|away.
  const existing = await db.select().from(leagueMatchesTable).where(eq(leagueMatchesTable.seasonId, season.id));
  const existingByKey = new Map<string, string>();
  for (const r of existing) {
    const round = /^R(\d+)-/.exec(r.matchId)?.[1];
    if (round) existingByKey.set(`r${round}|${r.homeTeam}|${r.awayTeam}`, r.matchId);
    if (r.matchDate) existingByKey.set(`d${r.matchDate}|${r.homeTeam}|${r.awayTeam}`, r.matchId);
  }

  // Name book: full name -> stored display name (per club).
  const mapRows = await db.select().from(driblNameMapTable).where(eq(driblNameMapTable.seasonId, season.id));
  const nameMap = new Map<string, string>(); // `${club}|${fullLower}` -> displayName
  for (const m of mapRows) nameMap.set(`${m.club}|${m.fullName}`, m.displayName);

  // Player rows still missing a number, keyed matchId|club|playerName.
  const statRows = await db.select({
    id: leaguePlayerStatsTable.id, matchId: leaguePlayerStatsTable.matchId,
    club: leaguePlayerStatsTable.club, playerName: leaguePlayerStatsTable.playerName,
  }).from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, season.id), isNull(leaguePlayerStatsTable.shirtNumber)));
  const rowByKey = new Map<string, number>();
  const clubsNeedingByMatch = new Map<string, Set<string>>();
  for (const r of statRows) {
    if (!r.club) continue;
    rowByKey.set(`${r.matchId}|${r.club}|${r.playerName}`, r.id);
    const set = clubsNeedingByMatch.get(r.matchId) ?? new Set<string>();
    set.add(r.club);
    clubsNeedingByMatch.set(r.matchId, set);
  }
  console.log(`${statRows.length} player rows missing numbers across ${clubsNeedingByMatch.size} matches`);

  const tenant = (await driblGet("/tenants", { slug: dribl.tenant }, dribl.tenant))?.data?.id;
  const seasonsData = (await driblGet("/list/seasons", { tenant }, dribl.tenant))?.data ?? [];
  const seasonHash = seasonsData.find((s: any) => String(s.name ?? s.title ?? "").includes(season.year))?.id;
  if (!seasonHash) throw new Error(`No Dribl season matching year ${season.year}`);
  const comps = (await driblGet("/list/competitions", { tenant }, dribl.tenant))?.data ?? [];
  const competition = comps.find((c: any) => (c.name ?? c.title) === dribl.competition)?.id;
  if (!competition) throw new Error(`No Dribl competition "${dribl.competition}"`);

  // Page all fixtures for this league.
  const fixtures: Array<{ round: number; date: string; home: string | null; away: string | null; matchHashId: string }> = [];
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
        fixtures.push({
          round: parseInt(String(a.full_round ?? "").replace(/\D/g, ""), 10) || 0,
          date: String(a.date ?? ""),
          home: matchClub(String(a.home_team_name ?? ""), clubs),
          away: matchClub(String(a.away_team_name ?? ""), clubs),
          matchHashId: String(a.match_hash_id ?? ""),
        });
      }
    }
    cursor = data?.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  console.log(`${fixtures.length} Dribl fixtures for ${dribl.league}`);

  let updated = 0, unmatchedNames = 0, matchesTouched = 0;
  for (const f of fixtures) {
    if (!f.home || !f.away || !f.matchHashId) continue;
    const localDate = toLocalDbDate(f.date);
    const matchId = existingByKey.get(`r${f.round}|${f.home}|${f.away}`)
      ?? (localDate ? existingByKey.get(`d${localDate}|${f.home}|${f.away}`) : undefined);
    if (!matchId) continue;
    const needClubs = clubsNeedingByMatch.get(matchId);
    if (!needClubs || needClubs.size === 0) continue;

    // Team hashes come from the match centre detail.
    const mc = await driblGet(`/matchcentre/${f.matchHashId}`, { tenant }, dribl.tenant);
    const det = mc?.data?.attributes ?? {};
    const sides: Array<{ club: string; teamHash: string }> = [
      { club: f.home, teamHash: String(det.home_team_hash_id ?? "") },
      { club: f.away, teamHash: String(det.away_team_hash_id ?? "") },
    ];
    let touched = false;
    for (const side of sides) {
      if (!needClubs.has(side.club) || !side.teamHash) continue;
      let lineup: any[];
      try {
        const lu = await driblGet(`/matchcentre-match-members/match/${f.matchHashId}/team/${side.teamHash}`, { tenant }, dribl.tenant);
        lineup = Array.isArray(lu) ? lu : lu?.data ?? [];
      } catch (e) {
        console.warn(`  ${matchId} ${side.club}: line-up fetch failed (${String(e)})`);
        continue;
      }
      for (const r of lineup) {
        const a = r?.attributes ?? r ?? {};
        const jersey = String(a.jersey ?? "").trim();
        if (!jersey) continue;
        const full = `${String(a.first_name ?? "")} ${String(a.last_name ?? "")}`.trim().toLowerCase();
        const display = nameMap.get(`${side.club}|${full}`);
        if (!display) { unmatchedNames++; continue; }
        const rowId = rowByKey.get(`${matchId}|${side.club}|${display}`);
        if (rowId == null) continue;
        if (apply) {
          await db.update(leaguePlayerStatsTable).set({ shirtNumber: jersey }).where(eq(leaguePlayerStatsTable.id, rowId));
        }
        updated++;
        touched = true;
      }
    }
    if (touched) { matchesTouched++; console.log(`  ${matchId}: done (running total ${updated})`); }
  }
  console.log(`${apply ? "UPDATED" : "DRY RUN — would update"} ${updated} rows across ${matchesTouched} matches; ${unmatchedNames} line-up names had no name-map entry`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
