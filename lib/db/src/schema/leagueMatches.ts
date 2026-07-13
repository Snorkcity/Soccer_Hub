import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Full league fixtures across ALL clubs (not just Belconnen games).
// Derived from the league-based CSV's home/away teams + full-time score.
export const leagueMatchesTable = pgTable("league_matches", {
  id: serial("id").primaryKey(),
  matchId: text("match_id").notNull(),
  matchDate: text("match_date"),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  fullScore: text("full_score"),
  homeGoals: integer("home_goals"),
  awayGoals: integer("away_goals"),
  seasonId: integer("season_id").notNull(),
});

export const insertLeagueMatchSchema = createInsertSchema(leagueMatchesTable).omit({ id: true });
export type InsertLeagueMatch = z.infer<typeof insertLeagueMatchSchema>;
export type LeagueMatch = typeof leagueMatchesTable.$inferSelect;
