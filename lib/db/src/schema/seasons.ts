import { pgTable, serial, text, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

// A season is one league's year, e.g. "ACT NPLW 2026". All match/goal/player
// data hangs off seasonId, so scoping by league falls out of this link.
// The partial unique index guarantees at most ONE active season per league.
export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  year: text("year").notNull(),
  label: text("label").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
}, (t) => [
  uniqueIndex("seasons_one_active_per_league").on(t.leagueId).where(sql`${t.isActive}`),
]);

export const insertSeasonSchema = createInsertSchema(seasonsTable).omit({ id: true });
export type InsertSeason = z.infer<typeof insertSeasonSchema>;
export type Season = typeof seasonsTable.$inferSelect;
