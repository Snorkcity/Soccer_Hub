import { pgTable, serial, integer, text, jsonb, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

export const gpsDevelopmentFeedbackTable = pgTable("gps_development_feedback", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  club: text("club").notNull(),
  playerName: text("player_name").notNull(),
  year: text("year").notNull(),
  note: text("note").notNull(),
  focus: text("focus").notNull(),
  reviewDate: text("review_date"),
  snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gpsDevelopmentContextTable = pgTable("gps_development_context", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  club: text("club").notNull(),
  playerName: text("player_name").notNull(),
  year: text("year").notNull(),
  round: text("round").notNull(),
  role: text("role"),
  matchType: text("match_type").notNull(),
  comparable: boolean("comparable").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("gps_development_context_unique").on(table.leagueId, table.club, table.playerName, table.year, table.round),
]);

/** Research is data, not numbers embedded in a chart. No readiness boundaries are seeded. */
export const gpsDevelopmentReferencesTable = pgTable("gps_development_references", {
  id: text("id").primaryKey(),
  population: text("population").notNull(),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
});