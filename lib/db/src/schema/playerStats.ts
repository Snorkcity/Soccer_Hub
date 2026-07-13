import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const playerStatsTable = pgTable("player_stats", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull(),
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  minsPlayed: integer("mins_played"),
  position: text("position"),
  discipline: text("discipline"),
  started: boolean("started"),
  appearance: boolean("appearance"),
  club: text("country"),   // DB column stays "country"; TS property renamed to "club"
  year: text("year"),
});

export const insertPlayerStatSchema = createInsertSchema(playerStatsTable).omit({ id: true });
export type InsertPlayerStat = z.infer<typeof insertPlayerStatSchema>;
export type PlayerStat = typeof playerStatsTable.$inferSelect;
