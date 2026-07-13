import { pgTable, serial, text, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const goalsTable = pgTable("goals", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull(),
  recording: text("recording"),
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
  goalX: numeric("goal_x", { precision: 6, scale: 2 }),
  goalY: numeric("goal_y", { precision: 6, scale: 2 }),
  teamId: integer("team_id").notNull(),
  seasonId: integer("season_id").notNull(),
});

export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goalsTable.$inferSelect;
