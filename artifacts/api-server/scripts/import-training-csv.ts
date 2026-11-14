/**
 * Add one approved CSV to an external database without publishing its contents.
 * Dry-run by default. Requires explicit target, club and --commit to write.
 * Bundle with esbuild, then run with NODE_ENV=production (for logger transport).
 */
import { readFile } from "node:fs/promises";
import { and, eq, or, sql } from "drizzle-orm";
import { parseTrainingCsv } from "../src/lib/gpsTrainingCsv";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const target = arg("--target"), filename = arg("--file"), leagueName = arg("--league");
const year = arg("--year"), club = arg("--club");
if (!["development", "production"].includes(target) || !filename || !leagueName || !club || !/^\d{4}$/.test(year ?? "")) {
  throw new Error("Required: --target development|production --file CSV --league NAME --year YYYY --club NAME [--commit]");
}
const connection = target === "production" ? process.env.PROD_DATABASE_URL : process.env.DEV_DATABASE_URL;
if (!connection || process.env.NODE_ENV !== "production") throw new Error("Explicit external target and NODE_ENV=production are required.");
process.env.DATABASE_URL = connection;
const { db, pool, gpsTrainingTable, leaguesTable, seasonsTable, seasonRosterTable } = await import("@workspace/db");
try {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.name, leagueName));
  if (!league || (league.focusClub?.trim() || "Belconnen") !== club || league.gpsSourceLeagueId) {
    throw new Error("Target competition/club does not match the approved source GPS hub.");
  }
  const [campaign] = await db.select().from(seasonsTable).where(and(eq(seasonsTable.leagueId, league.id), eq(seasonsTable.year, year)));
  if (!campaign) throw new Error("The target campaign does not exist.");
  const roster = await db.select({
    id: seasonRosterTable.id, playerName: seasonRosterTable.playerName,
    squad: seasonRosterTable.squad, positionCode: seasonRosterTable.positionCode,
  }).from(seasonRosterTable).innerJoin(seasonsTable, eq(seasonsTable.id, seasonRosterTable.seasonId))
    .where(and(eq(seasonsTable.year, year),
      or(eq(seasonsTable.leagueId, league.id), eq(seasonRosterTable.gpsLeagueId, league.id))));
  const { session, unmatchedNames, ambiguousNames } = parseTrainingCsv(await readFile(filename, "utf8"),
    { leagueId: league.id, year, sourceFilename: filename.split("/").pop() }, roster);
  if (unmatchedNames.length || ambiguousNames.length) throw new Error("Unresolved player identities: use the interactive upload preview.");
  console.log(JSON.stringify({ target, league: league.name, club, year, date: session.date,
    players: new Set(session.rows.map(r => r.sourceName)).size, rows: session.rows.length, mode: args.includes("--commit") ? "insert-only" : "dry-run" }));
  if (args.includes("--commit")) {
    await db.transaction(async tx => {
      const lock = `${league.id}:${club}:${year}:${session.date}:${session.title}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
      const inserted = await tx.insert(gpsTrainingTable).values({
        leagueId: league.id, club, year, date: session.date, title: session.title,
        sourceFilename: session.sourceFilename, sourceHash: session.sourceHash,
        rows: session.rows, warnings: session.warnings, version: 1,
        plannedMinutes: session.plannedMinutes, scheduledStartTime: null, allowances: [],
      }).onConflictDoNothing().returning({ id: gpsTrainingTable.id });
      console.log(inserted.length ? "Inserted approved training session." : "Session already exists; left untouched.");
    });
  }
} finally {
  await pool.end();
}
