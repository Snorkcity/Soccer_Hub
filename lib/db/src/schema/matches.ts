import { pgTable, serial, text, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const matchStatisticSourceValues = ["official", "veo", "unknown"] as const;
export type MatchStatisticSource = (typeof matchStatisticSourceValues)[number];

export const matchesTable = pgTable("matches", {
  id: serial("id").primaryKey(),
  matchId: text("match_id").notNull(),
  matchDate: text("match_date"),
  venue: text("venue"),
  opponent: text("opponent").notNull(),
  halfScore: text("half_score"),
  fullScore: text("full_score"),
  goalsScored: integer("goals_scored"),
  goalsConceded: integer("goals_conceded"),
  cleanSheet: boolean("clean_sheet"),
  formation: text("formation"),
  oppFormation: text("opp_formation"),
  conditions: text("conditions"),
  possession: numeric("possession", { precision: 5, scale: 2 }),
  possessionSource: text("possession_source").notNull().default("unknown"),
  shots: integer("shots"),
  shotsSource: text("shots_source").notNull().default("unknown"),
  passes: integer("passes"),
  passesSource: text("passes_source").notNull().default("unknown"),
  oppShots: integer("opp_shots"),
  oppShotsSource: text("opp_shots_source").notNull().default("unknown"),
  oppPasses: integer("opp_passes"),
  oppPassesSource: text("opp_passes_source").notNull().default("unknown"),
  quadrantPoints: text("quadrant_points"),
  teamId: integer("team_id").notNull(),
  seasonId: integer("season_id").notNull(),
});

export const insertMatchSchema = createInsertSchema(matchesTable).omit({ id: true });
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matchesTable.$inferSelect;
