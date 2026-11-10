import { db, leaguesTable, seasonsTable, seasonRosterTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

// Coach-supplied 2027 squad lists. Blank screenshot rows are not players.
// Do not populate appearances or overwrite global GPS-name position records:
// names can recur across competitions and seasons.
export const NPLM_2027_ROSTERS = [
  {
    league: "ACT NPLM", squad: "1sts",
    players: [
      ["J.Smith", "GK"], ["S.Paragalli", "CB"], ["Z.Maybury", "CB"],
      ["I.Clements", "CB"], ["C.Moir", "FB"], ["J.Prior", "FB"],
      ["N.Pulician", "FB"], ["H.Billington", "CM"], ["I.Majetic", "CM"],
      ["Z.Colson", "CM"], ["T.Dorji", "F"], ["J.Bishop", "F"],
      ["T.Ringhi", "F"], ["J.Mikhael", "F"], ["B.Dickenson", "D"],
    ],
  },
  {
    league: "ACT NPLM U23", squad: "U23",
    players: [
      ["R.Dahlerup", "GK"], ["C.Moir", "GK"], ["D.Paragalli", "CB"],
      ["I.Meneses", "CB"], ["Z.Peelgrane", "CB"], ["R.Priestly", "FB"],
      ["C.Walsh", "FB"], ["J.Kocanov", "CM"], ["D.Jember", "CM"],
      ["A.Atmakur", "CM"], ["N.Baird", "CM"], ["I.Uzabeaga", "AM/F"],
      ["S.York", "F"], ["L.Donald", "F"], ["E.Georgiou", "F"],
      ["Z.Durrani", "F"],
    ],
  },
] as const;

export async function ensureNplm2027Roster(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_roster (
      id serial PRIMARY KEY,
      season_id integer NOT NULL REFERENCES seasons(id),
      gps_league_id integer NOT NULL REFERENCES leagues(id),
      player_name text NOT NULL,
      squad text NOT NULL,
      position_code text NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS season_roster_season_player_unique
    ON season_roster(season_id, player_name)
  `);
  const leagues = await db.select().from(leaguesTable)
    .where(inArray(leaguesTable.name, ["ACT NPLM", "ACT NPLM U23"]));
  const hub = leagues.find(l => l.name === "ACT NPLM");
  if (!hub) return;
  await db.transaction(async tx => {
    for (const roster of NPLM_2027_ROSTERS) {
      const league = leagues.find(l => l.name === roster.league);
      if (!league) continue;
      // Add the campaign without deactivating or modifying 2026.
      await tx.insert(seasonsTable).values({
        leagueId: league.id, year: "2027", label: `${league.name} 2027`, isActive: false,
      }).onConflictDoNothing();
      const [season] = await tx.select().from(seasonsTable)
        .where(and(eq(seasonsTable.leagueId, league.id), eq(seasonsTable.year, "2027")));
      if (!season) continue;
      await tx.insert(seasonRosterTable).values(roster.players.map(([playerName, positionCode]) => ({
        seasonId: season.id, gpsLeagueId: hub.id, playerName,
        positionCode, squad: roster.squad,
      }))).onConflictDoNothing();
    }
  });
}
