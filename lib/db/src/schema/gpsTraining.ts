import { doublePrecision, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

/** Training is isolated from match GPS and scoped to the authenticated club.
 * JSON holds parsed measurements, never uploaded file bytes.
 */
export const gpsTrainingTable = pgTable("gps_training_sessions", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  club: text("club").notNull(),
  year: text("year").notNull(),
  date: text("session_date").notNull(),
  title: text("title").notNull(),
  sourceFilename: text("source_filename").notNull(),
  sourceHash: text("source_hash").notNull(),
  version: integer("version").notNull().default(1),
  plannedMinutes: doublePrecision("planned_minutes").notNull().default(90),
  scheduledStartTime: text("scheduled_start_time"),
  allowances: jsonb("allowances").notNull().default([]),
  rows: jsonb("rows").notNull(),
  warnings: jsonb("warnings").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("gps_training_session_scope_unique").on(t.leagueId, t.club, t.year, t.date, t.title),
]);
