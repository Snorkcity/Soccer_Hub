import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Player appearances for EVERY club across ALL league fixtures (superset of the
// Belconnen-focused `player_stats` table, which only covers Belconnen's own matches).
// Powers opponent scouting: a selected club's minutes / starts / appearances / discipline
// across their whole league season, not just their game(s) against Belconnen.
export const leaguePlayerStatsTable = pgTable("league_player_stats", {
  id: serial("id").primaryKey(),
  matchId: text("match_id").notNull(),
  playerName: text("player_name").notNull(),
  minsPlayed: integer("mins_played"),
  position: text("position"),
  discipline: text("discipline"),
  started: boolean("started"),
  appearance: boolean("appearance"),
  club: text("country"),   // DB column stays "country"; TS property renamed to "club"
  year: text("year"),
  seasonId: integer("season_id").notNull(),
});

export const insertLeaguePlayerStatSchema = createInsertSchema(leaguePlayerStatsTable).omit({ id: true });
export type InsertLeaguePlayerStat = z.infer<typeof insertLeaguePlayerStatSchema>;
export type LeaguePlayerStat = typeof leaguePlayerStatsTable.$inferSelect;
