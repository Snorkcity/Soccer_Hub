import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A competition, e.g. "ACT NPLW", "NSW NPL", "VIC NPL". Seasons (and clubs)
// belong to a league, so the same platform can track many competitions.
export const leaguesTable = pgTable("leagues", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull().unique(),
  region:    text("region"),
  // The "focus club" whose players appear on Team/Player Insights tabs for
  // seasons in this league; all other clubs are opponents. Null falls back to
  // "Belconnen" in code (see lib/focusClub.ts).
  focusClub: text("focus_club"),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
