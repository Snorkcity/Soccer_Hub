import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import {
  db, teamsTable, seasonsTable, matchesTable, playerStatsTable, goalsTable,
  leagueMatchesTable, leagueGoalsTable, leaguePlayerStatsTable, playersTable,
  clubsTable, leaguesTable,
} from "./index";
import { eq, and, inArray } from "drizzle-orm";

// ── Reserves 2026 import ──────────────────────────────────────────────────────
// Additive + idempotent: only touches the ACT NPLW Reserve league's 2026 season
// and the Belconnen Reserves team. Safe to re-run (deletes then re-inserts that
// scope only). Never deletes firsts (ACT NPLW) data. Run against dev or prod by
// pointing the usual DB env at the right database.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Works both unbundled (src/) and as the esbuild bundle emitted into lib/db/.
const dataDir = fs.existsSync(path.resolve(__dirname, "./data/reserves-2026"))
  ? path.resolve(__dirname, "./data/reserves-2026")
  : path.resolve(__dirname, "./src/data/reserves-2026");

const LEAGUE_NAME = "ACT NPLW Reserve";
const SEASON_YEAR = "2026";
const TEAM_NAME = "Belconnen Reserves";
const OLD_TEAM_NAME = "Belconnen United FC Women's Reserves";
const FOCUS_CLUB = "BelReserves"; // club string used throughout Luke's sheet

// Scorer/Assist spellings in the league tab that differ from the roster tab.
// Same rationale as NAME_FIXUPS in seed.ts — map typo → roster spelling.
// "Tahli" (CroatiaRes assist, R5) and "Emily" (OlympicRes assist, R4) have no
// roster match (first names only) and are deliberately left as-is.
const NAME_FIXUPS: Record<string, string> = {
  Millin: "Milin",              // CroatiaRes
  Mcrae: "McRae",               // OlympicRes
  "Pavier-Jones": "Pavier-jones", // WanderersRes (unprefixed variant)
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
function bool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return null;
}
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function canonName(v: unknown): string | null {
  const s = str(v);
  return s == null ? null : (NAME_FIXUPS[s] ?? s);
}
function readCsv(file: string): Record<string, string>[] {
  return parse(fs.readFileSync(path.join(dataDir, file), "utf8"), { columns: true, skip_empty_lines: true });
}

async function importReserves() {
  console.log("Importing ACT NPLW Reserve 2026...");

  // ── League + season (create if missing) ────────────────────────────────────
  let [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.name, LEAGUE_NAME));
  if (!league) {
    [league] = await db.insert(leaguesTable).values({ name: LEAGUE_NAME, region: "ACT", focusClub: FOCUS_CLUB }).returning();
    console.log(`Created league ${LEAGUE_NAME} (id ${league.id})`);
  } else if ((league as { focusClub?: string | null }).focusClub !== FOCUS_CLUB) {
    await db.update(leaguesTable).set({ focusClub: FOCUS_CLUB }).where(eq(leaguesTable.id, league.id));
  }

  let [season] = await db.select().from(seasonsTable)
    .where(and(eq(seasonsTable.leagueId, league.id), eq(seasonsTable.year, SEASON_YEAR)));
  if (!season) {
    [season] = await db.insert(seasonsTable)
      .values({ leagueId: league.id, year: SEASON_YEAR, label: `${SEASON_YEAR} Reserves Season`, isActive: true }).returning();
    console.log(`Created season ${season.label} (id ${season.id})`);
  }

  // ── Team (rename legacy placeholder, enable analytics) ─────────────────────
  let [team] = await db.select().from(teamsTable).where(eq(teamsTable.name, TEAM_NAME));
  if (!team) [team] = await db.select().from(teamsTable).where(eq(teamsTable.name, OLD_TEAM_NAME));
  if (!team) {
    [team] = await db.insert(teamsTable)
      .values({ name: TEAM_NAME, gender: "female", ageGroup: "Seniors", analyticsEnabled: true }).returning();
    console.log(`Created team ${TEAM_NAME} (id ${team.id})`);
  } else {
    await db.update(teamsTable).set({ name: TEAM_NAME, analyticsEnabled: true }).where(eq(teamsTable.id, team.id));
  }

  // ── Clubs (reserve league's own club rows; names match the data) ───────────
  const clubRows = [
    { leagueId: league.id, name: "BelReserves",    primaryColor: "#87CEEB" },
    { leagueId: league.id, name: "CroatiaRes",     primaryColor: "#DC143C" },
    { leagueId: league.id, name: "MajuraRes",      primaryColor: "#4169E1" },
    { leagueId: league.id, name: "OlympicRes",     primaryColor: "#000080" },
    { leagueId: league.id, name: "TuggeranongRes", primaryColor: "#008000" },
    { leagueId: league.id, name: "WanderersRes",   primaryColor: "#B22222" },
  ];
  const existingClubs = await db.select().from(clubsTable).where(eq(clubsTable.leagueId, league.id));
  const existingClubNames = new Set(existingClubs.map(c => c.name));
  const newClubs = clubRows.filter(c => !existingClubNames.has(c.name));
  if (newClubs.length > 0) await db.insert(clubsTable).values(newClubs);
  console.log(`Clubs: ${newClubs.length} inserted, ${existingClubNames.size} already present`);

  // ── Wipe previous reserves import (this scope only) ────────────────────────
  const oldMatches = await db.select({ id: matchesTable.id }).from(matchesTable)
    .where(and(eq(matchesTable.teamId, team.id), eq(matchesTable.seasonId, season.id)));
  if (oldMatches.length > 0) {
    const ids = oldMatches.map(m => m.id);
    await db.delete(playerStatsTable).where(inArray(playerStatsTable.matchId, ids));
  }
  await db.delete(goalsTable).where(and(eq(goalsTable.teamId, team.id), eq(goalsTable.seasonId, season.id)));
  await db.delete(matchesTable).where(and(eq(matchesTable.teamId, team.id), eq(matchesTable.seasonId, season.id)));
  await db.delete(leagueGoalsTable).where(eq(leagueGoalsTable.seasonId, season.id));
  await db.delete(leagueMatchesTable).where(eq(leagueMatchesTable.seasonId, season.id));
  await db.delete(leaguePlayerStatsTable).where(eq(leaguePlayerStatsTable.seasonId, season.id));

  // ── CSVs ────────────────────────────────────────────────────────────────────
  const matchRows = readCsv("team-based.csv");
  const psRows = readCsv("player-based.csv");
  const lgRows = readCsv("league-based.csv");

  // ── Players (insert only names not already known) ───────────────────────────
  // Keyed by name+club: same surname at two clubs (e.g. Williams at OlympicRes
  // AND CroatiaRes, or a firsts player of the same name) must not share a row.
  const pKey = (name: string, club: string | null) => `${name}\u0000${club ?? ""}`;
  const existingPlayers = await db.select().from(playersTable);
  const playerIdMap = new Map(existingPlayers.map(p => [pKey(p.name, p.club), p.id]));
  const newPlayers = new Map<string, { name: string; position: string | null; club: string | null }>();
  for (const row of psRows) {
    const name = str(row["Player Name"]);
    if (!name) continue;
    const key = pKey(name, str(row["Country"]));
    if (playerIdMap.has(key) || newPlayers.has(key)) continue;
    newPlayers.set(key, { name, position: str(row["Position"]), club: str(row["Country"]) });
  }
  if (newPlayers.size > 0) {
    const inserted = await db.insert(playersTable).values(Array.from(newPlayers.values())).returning();
    for (const p of inserted) playerIdMap.set(pKey(p.name, p.club), p.id);
  }
  console.log(`Players: ${newPlayers.size} new`);

  // ── Belconnen Reserves matches ──────────────────────────────────────────────
  const matchValues = matchRows.map(row => ({
    matchId: str(row["Match ID"]) ?? "unknown",
    matchDate: str(row["Match Date"]),
    venue: str(row["Venue"]),
    opponent: str(row["Opponent"]) ?? "Unknown",
    halfScore: str(row["Half-score"]),
    fullScore: str(row["Full-score"]),
    goalsScored: int(row["Goals Scored"]),
    goalsConceded: int(row["Goals Conceded"]),
    cleanSheet: bool(row["Clean sheet"]),
    formation: str(row["Formation"]),
    oppFormation: str(row["Opp-formation"]),
    conditions: str(row["Conditions"]),
    possession: str(row["Possession"]),
    shots: int(row["Shots"]),
    passes: int(row["Passes"]),
    oppShots: int(row["Opp-shots"]),
    oppPasses: int(row["Opp-passes"]),
    quadrantPoints: str(row["Quadrant Points"]),
    teamId: team.id,
    seasonId: season.id,
  }));
  const insertedMatches = await db.insert(matchesTable).values(matchValues).returning();
  const matchIdMap = new Map(insertedMatches.map(m => [m.matchId, m.id]));
  console.log(`Matches: ${insertedMatches.length}`);

  // ── Player stats (players in Belconnen Reserves' matches, both clubs) ───────
  const psValues = psRows.filter(row => matchIdMap.has(str(row["Match ID"]) ?? "")).map(row => {
    const pName = str(row["Player Name"]) ?? "Unknown";
    return {
      matchId: matchIdMap.get(str(row["Match ID"])!)!,
      playerId: playerIdMap.get(pKey(pName, str(row["Country"]))) ?? 0,
      playerName: pName,
      minsPlayed: int(row["Mins Played"]),
      position: str(row["Position"]),
      discipline: str(row["Discipline"]),
      started: bool(row["Start"]),
      appearance: bool(row["Appearance"]),
      club: str(row["Country"]),
      year: str(row["Year"]),
    };
  });
  for (let i = 0; i < psValues.length; i += 200) {
    await db.insert(playerStatsTable).values(psValues.slice(i, i + 200));
  }
  console.log(`Player stats: ${psValues.length}`);

  // ── Goals in Belconnen Reserves' matches ────────────────────────────────────
  const goalValues = lgRows
    .filter(row => matchIdMap.has(str(row["Match ID"]) ?? "") && str(row["Scorer Team"]))
    .map(row => ({
      matchId: matchIdMap.get(str(row["Match ID"])!)!,
      recording: str(row["Recording"]),
      matchDate: str(row["Match Date"]),
      homeTeam: str(row["Home Team"]),
      awayTeam: str(row["Away Team"]),
      scorerTeam: str(row["Scorer Team"]),
      minuteScored: int(row["Minute Scored"]),
      scorer: canonName(row["Scorer"]),
      assist: canonName(row["Assist"]),
      goalType: str(row["Goal Type"]),
      assistType: str(row["Assist type"]),
      howPenetrated: str(row["How penetrated"]),
      buildupLane: str(row["Buildup Lane"]),
      firstTimeFinish: bool(row["First-time finish"]),
      finishType: str(row["Finish Type"]),
      passString: str(row["Pass-string"]),
      goalX: str(row["Goal X"]),
      goalY: str(row["Goal Y"]),
      teamId: team.id,
      seasonId: season.id,
    }));
  if (goalValues.length > 0) await db.insert(goalsTable).values(goalValues);
  console.log(`Goals: ${goalValues.length}`);

  // ── League matches (whole league, distinct fixtures) ────────────────────────
  const seenLeagueMatch = new Map<string, typeof leagueMatchesTable.$inferInsert>();
  for (const row of lgRows) {
    const mid = str(row["Match ID"]);
    if (!mid || seenLeagueMatch.has(mid)) continue;
    const fscore = str(row["Full-score"]);
    let homeGoals: number | null = null;
    let awayGoals: number | null = null;
    if (fscore) {
      const [h, a] = fscore.split("-").map(p => parseInt(p.trim(), 10));
      if (!isNaN(h)) homeGoals = h;
      if (!isNaN(a)) awayGoals = a;
    }
    seenLeagueMatch.set(mid, {
      matchId: mid,
      matchDate: str(row["Match Date"]),
      homeTeam: str(row["Home Team"]) ?? "Unknown",
      awayTeam: str(row["Away Team"]) ?? "Unknown",
      fullScore: fscore,
      homeGoals,
      awayGoals,
      seasonId: season.id,
    });
  }
  await db.insert(leagueMatchesTable).values(Array.from(seenLeagueMatch.values()));
  console.log(`League matches: ${seenLeagueMatch.size}`);

  // ── League goals (whole league) ─────────────────────────────────────────────
  const leagueGoalValues = lgRows
    .filter(row => str(row["Match ID"]) && str(row["Scorer Team"]))
    .map(row => ({
      matchId: str(row["Match ID"])!,
      matchDate: str(row["Match Date"]),
      homeTeam: str(row["Home Team"]),
      awayTeam: str(row["Away Team"]),
      scorerTeam: str(row["Scorer Team"]),
      minuteScored: int(row["Minute Scored"]),
      scorer: canonName(row["Scorer"]),
      assist: canonName(row["Assist"]),
      goalType: str(row["Goal Type"]),
      assistType: str(row["Assist type"]),
      howPenetrated: str(row["How penetrated"]),
      buildupLane: str(row["Buildup Lane"]),
      firstTimeFinish: bool(row["First-time finish"]),
      finishType: str(row["Finish Type"]),
      passString: str(row["Pass-string"]),
      goalX: str(row["Goal X"]),
      goalY: str(row["Goal Y"]),
      seasonId: season.id,
    }));
  for (let i = 0; i < leagueGoalValues.length; i += 200) {
    await db.insert(leagueGoalsTable).values(leagueGoalValues.slice(i, i + 200));
  }
  console.log(`League goals: ${leagueGoalValues.length}`);

  // ── League player stats (whole league) ──────────────────────────────────────
  const lpsValues = psRows.filter(row => str(row["Match ID"])).map(row => ({
    matchId: str(row["Match ID"])!,
    playerName: str(row["Player Name"]) ?? "Unknown",
    minsPlayed: int(row["Mins Played"]),
    position: str(row["Position"]),
    discipline: str(row["Discipline"]),
    started: bool(row["Start"]),
    appearance: bool(row["Appearance"]),
    club: str(row["Country"]),
    year: str(row["Year"]),
    seasonId: season.id,
  }));
  for (let i = 0; i < lpsValues.length; i += 200) {
    await db.insert(leaguePlayerStatsTable).values(lpsValues.slice(i, i + 200));
  }
  console.log(`League player stats: ${lpsValues.length}`);

  console.log("Reserves import complete!");
}

importReserves().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
