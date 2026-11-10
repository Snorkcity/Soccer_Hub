import { integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { seasonsTable } from "./seasons";
import { leaguesTable } from "./leagues";

/** A season-specific roster, independent of appearances and GPS measurements.
 * gpsLeagueId deliberately allows first grade and U23 to share a GPS hub
 * without changing their separate football competition or roster membership.
 */
export const seasonRosterTable = pgTable("season_roster", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => seasonsTable.id),
  gpsLeagueId: integer("gps_league_id").notNull().references(() => leaguesTable.id),
  playerName: text("player_name").notNull(),
  squad: text("squad").notNull(),
  positionCode: text("position_code").notNull(),
}, (t) => [uniqueIndex("season_roster_season_player_unique").on(t.seasonId, t.playerName)]);
