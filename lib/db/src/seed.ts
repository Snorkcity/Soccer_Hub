import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { db, teamsTable, seasonsTable, matchesTable, playerStatsTable, goalsTable, leagueMatchesTable, leagueGoalsTable, leaguePlayerStatsTable, gpsSessionsTable, athleticTestsTable, playersTable, clubsTable, leaguesTable } from "./index";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../../attached_assets");

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function bool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return null;
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Canonical player-name fixups. The league-based CSV (Scorer/Assist) sometimes spells
// a player differently from the player-based roster CSV (Player Name), which carries the
// minutes. When they disagree, goal/assist attribution can't join to a player's minutes,
// so those goals show up with 0 mins. Map each known typo → the roster spelling so the
// join succeeds. Verified: each typo's goal-matches overlap 100% with the roster player's
// appearances. Add new entries here rather than editing the raw CSV, so corrections
// survive a fresh data re-upload.
const NAME_FIXUPS: Record<string, string> = {
  McGhee: "McGhie",        // Croatia
  McQueenie: "Mcqueenie",  // Croatia
  McGelliot: "Mcelligott", // Majura
  Buytewag: "Buyteweg",    // Wanderers
};
function canonName(v: unknown): string | null {
  const s = str(v);
  if (s == null) return null;
  return NAME_FIXUPS[s] ?? s;
}

async function seed() {
  console.log("Seeding database...");

  // ─── Teams ────────────────────────────────────────────────────────────────
  console.log("Seeding teams...");
  await db.delete(teamsTable);
  const teams = [
    // The focus team is named by its in-league club name (league: ACT NPLW)
    { name: "Belconnen", gender: "female", ageGroup: "Seniors", analyticsEnabled: true },
    // Reserves + Men's 1sts stay analytics-disabled until their data is set up (they'll appear in the team dropdown once enabled).
    { name: "Belconnen United FC Women's Reserves", gender: "female", ageGroup: "Seniors", analyticsEnabled: false },
    { name: "Belconnen United FC Men's 1sts", gender: "male", ageGroup: "Seniors", analyticsEnabled: false },
    { name: "BUFC Women U16", gender: "female", ageGroup: "u16", analyticsEnabled: false },
    { name: "BUFC Women U14", gender: "female", ageGroup: "u14", analyticsEnabled: false },
    { name: "BUFC Women U13", gender: "female", ageGroup: "u13", analyticsEnabled: false },
    { name: "BUFC Women U12", gender: "female", ageGroup: "u12", analyticsEnabled: false },
    { name: "BUFC Women U11", gender: "female", ageGroup: "u11", analyticsEnabled: false },
    { name: "BUFC Men U18", gender: "male", ageGroup: "u18", analyticsEnabled: false },
    { name: "BUFC Men U16", gender: "male", ageGroup: "u16", analyticsEnabled: false },
    { name: "BUFC Men U15", gender: "male", ageGroup: "u15", analyticsEnabled: false },
    { name: "BUFC Men U14", gender: "male", ageGroup: "u14", analyticsEnabled: false },
    { name: "BUFC Men U13", gender: "male", ageGroup: "u13", analyticsEnabled: false },
    { name: "BUFC Men U12", gender: "male", ageGroup: "u12", analyticsEnabled: false },
    { name: "BUFC Men U11", gender: "male", ageGroup: "u11", analyticsEnabled: false },
  ];
  const insertedTeams = await db.insert(teamsTable).values(teams).returning();
  const womenFirsts = insertedTeams.find(t => t.name === "Belconnen")!;
  console.log(`Inserted ${insertedTeams.length} teams. Focus team ID: ${womenFirsts.id}`);

  // ─── Leagues ──────────────────────────────────────────────────────────────
  console.log("Seeding leagues...");
  await db.delete(seasonsTable);
  await db.delete(clubsTable);
  await db.delete(leaguesTable);
  const [actNplw] = await db.insert(leaguesTable).values({ name: "ACT NPLW", region: "ACT" }).returning();
  console.log(`Inserted league: ${actNplw.name}`);

  // ─── Seasons ──────────────────────────────────────────────────────────────
  console.log("Seeding seasons...");
  const seasons = [
    { leagueId: actNplw.id, year: "2026", label: "2026 Season", isActive: true },
    { leagueId: actNplw.id, year: "2025", label: "2025 Season", isActive: false },
    { leagueId: actNplw.id, year: "2024", label: "2024 Season", isActive: false },
  ];
  const insertedSeasons = await db.insert(seasonsTable).values(seasons).returning();
  const season2026 = insertedSeasons.find(s => s.year === "2026")!;
  const season2025 = insertedSeasons.find(s => s.year === "2025")!;
  const season2024 = insertedSeasons.find(s => s.year === "2024")!;
  console.log(`Inserted ${insertedSeasons.length} seasons`);

  // ─── Players ──────────────────────────────────────────────────────────────
  console.log("Seeding players...");
  await db.delete(playersTable);
  const playerBaseFile = fs.readdirSync(root).find(f => f.startsWith("player-based"));
  if (!playerBaseFile) throw new Error("player-based CSV not found");
  const playerRows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, playerBaseFile), "utf8"), { columns: true, skip_empty_lines: true });
  const uniquePlayers = new Map<string, { name: string; position: string | null; club: string | null }>();
  for (const row of playerRows) {
    const name = str(row["Player Name"]);
    if (!name || uniquePlayers.has(name)) continue;
    uniquePlayers.set(name, { name, position: str(row["Position"]), club: str(row["Country"]) });
  }
  const playerValues = Array.from(uniquePlayers.values());
  const insertedPlayers = await db.insert(playersTable).values(playerValues).returning();
  const playerIdMap = new Map(insertedPlayers.map(p => [p.name, p.id]));
  console.log(`Inserted ${insertedPlayers.length} players`);

  // ─── Matches ──────────────────────────────────────────────────────────────
  console.log("Seeding matches...");
  await db.delete(matchesTable);
  const teamBaseFile = fs.readdirSync(root).find(f => f.startsWith("team-based"));
  if (!teamBaseFile) throw new Error("team-based CSV not found");
  const matchRows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, teamBaseFile), "utf8"), { columns: true, skip_empty_lines: true });

  const matchValues = matchRows.map(row => {
    const matchId = str(row["Match ID"]) ?? "unknown";
    const yearHint = matchId.split("-")[0];
    let seasonId = season2026.id;
    if (yearHint.startsWith("2025")) seasonId = season2025.id;
    else if (yearHint.startsWith("2024")) seasonId = season2024.id;

    return {
      matchId,
      matchDate: str(row["Match Date"]),
      venue: str(row["Venue"]),
      opponent: str(row["Opponent"]) ?? "Unknown",
      halfScore: str(row["Half-score"]),
      fullScore: str(row["Full-score"]),
      goalsScored: num(row["Goals Scored"]) != null ? Math.round(num(row["Goals Scored"])!) : null,
      goalsConceded: num(row["Goals Conceded"]) != null ? Math.round(num(row["Goals Conceded"])!) : null,
      cleanSheet: bool(row["Clean sheet"]),
      formation: str(row["Formation"]),
      oppFormation: str(row["Opp-formation"]),
      conditions: str(row["Conditions"]),
      possession: str(row["Possession"]),
      shots: num(row["Shots"]) != null ? Math.round(num(row["Shots"])!) : null,
      passes: num(row["Passes"]) != null ? Math.round(num(row["Passes"])!) : null,
      oppShots: num(row["Opp-shots"]) != null ? Math.round(num(row["Opp-shots"])!) : null,
      oppPasses: num(row["Opp-passes"]) != null ? Math.round(num(row["Opp-passes"])!) : null,
      quadrantPoints: str(row["Quadrant Points"]),
      teamId: womenFirsts.id,
      seasonId,
    };
  });
  const insertedMatches = await db.insert(matchesTable).values(matchValues).returning();
  const matchIdMap = new Map(insertedMatches.map(m => [m.matchId, m.id]));
  console.log(`Inserted ${insertedMatches.length} matches`);

  // ─── Player Stats ─────────────────────────────────────────────────────────
  console.log("Seeding player stats...");
  await db.delete(playerStatsTable);
  const psFile = fs.readdirSync(root).find(f => f.startsWith("player-based"));
  if (!psFile) throw new Error("player-based CSV not found");
  const psRows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, psFile), "utf8"), { columns: true, skip_empty_lines: true });
  const psValues = psRows.filter(row => matchIdMap.has(str(row["Match ID"]) ?? "")).map(row => {
    const pName = str(row["Player Name"]) ?? "Unknown";
    return {
      matchId: matchIdMap.get(str(row["Match ID"])!)!,
      playerId: playerIdMap.get(pName) ?? 0,
      playerName: pName,
      minsPlayed: num(row["Mins Played"]) != null ? Math.round(num(row["Mins Played"])!) : null,
      position: str(row["Position"]),
      discipline: str(row["Discipline"]),
      started: bool(row["Start"]),
      appearance: bool(row["Appearance"]),
      club: str(row["Country"]),
      year: str(row["Year"]),
    };
  });
  if (psValues.length > 0) {
    await db.insert(playerStatsTable).values(psValues);
    console.log(`Inserted ${psValues.length} player stat rows`);
  }

  // ─── Goals ────────────────────────────────────────────────────────────────
  console.log("Seeding goals...");
  await db.delete(goalsTable);
  const lgFile = fs.readdirSync(root).find(f => f.startsWith("league-based"));
  if (!lgFile) throw new Error("league-based CSV not found");
  const lgRows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, lgFile), "utf8"), { columns: true, skip_empty_lines: true });

  const goalValues = lgRows.filter(row => {
    const mid = str(row["Match ID"]);
    return mid && matchIdMap.has(mid);
  }).map(row => {
    const mid = str(row["Match ID"])!;
    const dbMatchId = matchIdMap.get(mid)!;
    const match = insertedMatches.find(m => m.id === dbMatchId)!;
    const yearHint = mid.split("-")[0];
    let seasonId = season2026.id;
    if (yearHint.startsWith("2025")) seasonId = season2025.id;
    else if (yearHint.startsWith("2024")) seasonId = season2024.id;

    return {
      matchId: dbMatchId,
      recording: str(row["Recording"]),
      matchDate: str(row["Match Date"]),
      homeTeam: str(row["Home Team"]),
      awayTeam: str(row["Away Team"]),
      scorerTeam: str(row["Scorer Team"]),
      minuteScored: num(row["Minute Scored"]) != null ? Math.round(num(row["Minute Scored"])!) : null,
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
      teamId: womenFirsts.id,
      seasonId,
    };
  });
  if (goalValues.length > 0) {
    await db.insert(goalsTable).values(goalValues);
    console.log(`Inserted ${goalValues.length} goal rows`);
  }

  // ─── League Goals & League Matches (ALL clubs, full league) ─────────────────
  // The league-based CSV contains every goal in the league, not just Belconnen's.
  // These tables power opponent scouting + a full league ladder.
  console.log("Seeding league goals + matches...");
  await db.delete(leagueGoalsTable);
  await db.delete(leagueMatchesTable);

  const seasonForMatchId = (mid: string): number => {
    const yearHint = mid.split("-")[0];
    if (yearHint.startsWith("2025")) return season2025.id;
    if (yearHint.startsWith("2024")) return season2024.id;
    return season2026.id;
  };

  // Distinct fixtures with their full-time score
  const seenLeagueMatch = new Map<string, typeof leagueMatchesTable.$inferInsert>();
  for (const row of lgRows) {
    const mid = str(row["Match ID"]);
    if (!mid || seenLeagueMatch.has(mid)) continue;
    const fs = str(row["Full-score"]);
    let homeGoals: number | null = null;
    let awayGoals: number | null = null;
    if (fs) {
      const parts = fs.split("-");
      const h = parseInt((parts[0] ?? "").trim(), 10);
      const a = parseInt((parts[1] ?? "").trim(), 10);
      if (!isNaN(h)) homeGoals = h;
      if (!isNaN(a)) awayGoals = a;
    }
    seenLeagueMatch.set(mid, {
      matchId: mid,
      matchDate: str(row["Match Date"]),
      homeTeam: str(row["Home Team"]) ?? "Unknown",
      awayTeam: str(row["Away Team"]) ?? "Unknown",
      fullScore: fs,
      homeGoals,
      awayGoals,
      seasonId: seasonForMatchId(mid),
    });
  }
  const leagueMatchValues = Array.from(seenLeagueMatch.values());
  if (leagueMatchValues.length > 0) {
    await db.insert(leagueMatchesTable).values(leagueMatchValues);
    console.log(`Inserted ${leagueMatchValues.length} league matches`);
  }

  const leagueGoalValues = lgRows
    // Drop placeholder rows: 0-0 fixtures carry an empty goal row (no scorer/minute)
    .filter(row => str(row["Match ID"]) && str(row["Scorer Team"]))
    .map(row => {
      const mid = str(row["Match ID"])!;
      return {
        matchId: mid,
        matchDate: str(row["Match Date"]),
        homeTeam: str(row["Home Team"]),
        awayTeam: str(row["Away Team"]),
        scorerTeam: str(row["Scorer Team"]),
        minuteScored: num(row["Minute Scored"]) != null ? Math.round(num(row["Minute Scored"])!) : null,
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
        seasonId: seasonForMatchId(mid),
      };
    });
  if (leagueGoalValues.length > 0) {
    await db.insert(leagueGoalsTable).values(leagueGoalValues);
    console.log(`Inserted ${leagueGoalValues.length} league goals`);
  }

  // ─── League Player Stats (ALL clubs, every league fixture) ──────────────────
  // Full player-based CSV, unfiltered — powers opponent scouting on the SELECTED
  // club's own squad (minutes/starts/appearances) across their whole league season.
  console.log("Seeding league player stats...");
  await db.delete(leaguePlayerStatsTable);
  const lpsValues = psRows
    .filter(row => str(row["Match ID"]))
    .map(row => {
      const mid = str(row["Match ID"])!;
      return {
        matchId: mid,
        playerName: str(row["Player Name"]) ?? "Unknown",
        minsPlayed: num(row["Mins Played"]) != null ? Math.round(num(row["Mins Played"])!) : null,
        position: str(row["Position"]),
        discipline: str(row["Discipline"]),
        started: bool(row["Start"]),
        appearance: bool(row["Appearance"]),
        club: str(row["Country"]),
        year: str(row["Year"]),
        seasonId: seasonForMatchId(mid),
      };
    });
  for (let i = 0; i < lpsValues.length; i += 200) {
    await db.insert(leaguePlayerStatsTable).values(lpsValues.slice(i, i + 200));
  }
  console.log(`Inserted ${lpsValues.length} league player stat rows`);

  // ─── GPS Sessions ─────────────────────────────────────────────────────────
  console.log("Seeding GPS sessions...");
  await db.delete(gpsSessionsTable);

  const gpsFiles = [
    { file: fs.readdirSync(root).find(f => f.startsWith("stats_2024")), year: "2024" },
    { file: fs.readdirSync(root).find(f => f.startsWith("stats_2025")), year: "2025" },
    { file: fs.readdirSync(root).find(f => f.startsWith("individual_stats")), year: "2026" },
  ];

  let totalGps = 0;
  for (const { file, year } of gpsFiles) {
    if (!file) { console.log(`No GPS file found for ${year}`); continue; }
    const gpsRows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, file), "utf8"), { columns: true, skip_empty_lines: true });

    // Process in batches to avoid insert limits
    const batchSize = 200;
    for (let i = 0; i < gpsRows.length; i += batchSize) {
      const batch = gpsRows.slice(i, i + batchSize).map(row => ({
        sessionDate: str(row["Date"]),
        sessionTitle: str(row["Session Title"]),
        playerName: str(row["Player Name"]) ?? "Unknown",
        playerId: playerIdMap.get(str(row["Player Name"]) ?? "") ?? null,
        teamId: womenFirsts.id,
        year,
        round: str(row["Round"]),
        opponent: str(row["Opponent"]),
        splitName: str(row["Split Name"]),
        tags: str(row["Tags"]),
        minsPlayed: str(row["Mins played"]),
        distanceKm: str(row["Distance (km)"]),
        sprintDistanceM: str(row["Sprint Distance (m)"]),
        powerPlays: str(row["Power Plays"]),
        energyKcal: str(row["Energy (kcal)"]),
        impacts: str(row["Impacts"]),
        hrLoad: str(row["Hr Load"]),
        timeInRedZoneMin: str(row["Time In Red Zone (min)"]),
        playerLoad: str(row["Player Load"]),
        topSpeedMs: str(row["Top Speed (m/s)"]),
        distancePerMinMm: str(row["Distance Per Min (m/min)"]),
        powerScoreWkg: str(row["Power Score (w/kg)"]),
        workRatio: str(row["Work Ratio"]),
        hrMaxBpm: str(row["Hr Max (bpm)"]),
        maxDecelerationMss: str(row["Max Deceleration (m/s/s)"]),
        maxAccelerationMss: str(row["Max Acceleration (m/s/s)"]),
        distanceZone1Km: str(row["Distance in Speed Zone 1 (km)"]),
        distanceZone2Km: str(row["Distance in Speed Zone 2 (km)"]),
        distanceZone3Km: str(row["Distance in Speed Zone 3 (km)"]),
        distanceZone4Km: str(row["Distance in Speed Zone 4 (km)"]),
        distanceZone5Km: str(row["Distance in Speed Zone 5 (km)"]),
      }));
      await db.insert(gpsSessionsTable).values(batch);
    }
    totalGps += gpsRows.length;
    console.log(`  GPS ${year}: ${gpsRows.length} rows`);
  }
  console.log(`Total GPS sessions: ${totalGps}`);

  // ─── Athletic Tests ───────────────────────────────────────────────────────
  console.log("Seeding athletic tests...");
  await db.delete(athleticTestsTable);

  const testFiles = [
    { file: fs.readdirSync(root).find(f => f.startsWith("2025-testing")), year: "2025" },
    { file: fs.readdirSync(root).find(f => f.startsWith("2026-testing")), year: "2026" },
  ];

  let totalTests = 0;
  for (const { file, year } of testFiles) {
    if (!file) { console.log(`No testing file for ${year}`); continue; }
    const testRows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, file), "utf8"), { columns: true, skip_empty_lines: true });
    const testValues = testRows.map(row => ({
      playerId: playerIdMap.get(str(row["Player"]) ?? "") ?? null,
      playerName: str(row["Player"]) ?? "Unknown",
      teamId: womenFirsts.id,
      year,
      position: str(row["Position"]),
      verticalStart: str(row["Vertical start"]),
      verticalM: str(row["Vertical (m)"]),
      verticalTotal: str(row["Vertical Total"]),
      horizontalM: str(row["Horizontal (m)"]),
      balsomS: str(row["Balsom (s)"]),
      split010: str(row["0-10 split"]),
      split1020: str(row["10-20 split"]),
      split2030: str(row["20-30 split"]),
      total30m: str(row["Total 30m"]),
    }));
    if (testValues.length > 0) {
      await db.insert(athleticTestsTable).values(testValues);
    }
    totalTests += testValues.length;
    console.log(`  Tests ${year}: ${testValues.length} rows`);
  }
  console.log(`Total athletic tests: ${totalTests}`);

  // ─── Clubs ────────────────────────────────────────────────────────────────
  console.log("Seeding clubs...");
  await db.delete(clubsTable);
  const clubRows = [
    { leagueId: actNplw.id, name: "Belconnen",   primaryColor: "#87CEEB" },
    { leagueId: actNplw.id, name: "Croatia",     primaryColor: "#DC143C" },
    { leagueId: actNplw.id, name: "Majura",      primaryColor: "#4169E1" },
    { leagueId: actNplw.id, name: "Olympic",     primaryColor: "#000080" },
    { leagueId: actNplw.id, name: "Tuggeranong", primaryColor: "#008000" },
    { leagueId: actNplw.id, name: "Wanderers",   primaryColor: "#B22222" },
    { leagueId: actNplw.id, name: "ANU",         primaryColor: "#FFA500" },
  ];
  await db.insert(clubsTable).values(clubRows);
  console.log(`Inserted ${clubRows.length} clubs`);

  console.log("Seed complete!");
}

seed().catch(e => { console.error(e); process.exit(1); });
