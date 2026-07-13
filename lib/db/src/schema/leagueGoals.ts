import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Every goal in the league across ALL clubs (superset of the Belconnen-only `goals` table).
// Powers opponent scouting: a selected club's scored/conceded broken down by their opponents.
// Carries the SAME rich detail fields as the Belconnen `goals` table so detail-by-type
// and the goal-location map work for every club, not just Belconnen.
export const leagueGoalsTable = pgTable("league_goals", {
  id: serial("id").primaryKey(),
  matchId: text("match_id").notNull(),
  matchDate: text("match_date"),
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  scorerTeam: text("scorer_team"),
  minuteScored: integer("minute_scored"),
  scorer: text("scorer"),
  assist: text("assist"),
  goalType: text("goal_type"),
  assistType: text("assist_type"),
  howPenetrated: text("how_penetrated"),
  buildupLane: text("buildup_lane"),
  firstTimeFinish: boolean("first_time_finish"),
  finishType: text("finish_type"),
  passString: text("pass_string"),
  goalX: text("goal_x"),
  goalY: text("goal_y"),
  seasonId: integer("season_id").notNull(),
});

export const insertLeagueGoalSchema = createInsertSchema(leagueGoalsTable).omit({ id: true });
export type InsertLeagueGoal = z.infer<typeof insertLeagueGoalSchema>;
export type LeagueGoal = typeof leagueGoalsTable.$inferSelect;
