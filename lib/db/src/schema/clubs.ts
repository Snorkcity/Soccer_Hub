import { pgTable, serial, text, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

// Club names are unique per league, not globally — the same club can appear
// in several leagues (e.g. "Belconnen" in ACT NPLW and ACT NPLW Reserves).
export const clubsTable = pgTable("clubs", {
  id:           serial("id").primaryKey(),
  leagueId:     integer("league_id").notNull().references(() => leaguesTable.id),
  name:         text("name").notNull(),
  primaryColor: text("primary_color").notNull().default("#888888"),
  logoUrl:      text("logo_url"),
}, (t) => [unique("clubs_league_name_unique").on(t.leagueId, t.name)]);

export const insertClubSchema = createInsertSchema(clubsTable).omit({ id: true });
export type InsertClub = z.infer<typeof insertClubSchema>;
export type Club = typeof clubsTable.$inferSelect;
