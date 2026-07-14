import { pgTable, serial, text, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

// A season is one league's year, e.g. "ACT NPLW 2026". All match/goal/player
// data hangs off seasonId, so scoping by league falls out of this link.
export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  year: text("year").notNull(),
  label: text("label").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
});

export const insertSeasonSchema = createInsertSchema(seasonsTable).omit({ id: true });
export type InsertSeason = z.infer<typeof insertSeasonSchema>;
export type Season = typeof seasonsTable.$inferSelect;
