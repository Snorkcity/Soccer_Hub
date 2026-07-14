import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const clubsTable = pgTable("clubs", {
  id:           serial("id").primaryKey(),
  leagueId:     integer("league_id").notNull().references(() => leaguesTable.id),
  name:         text("name").notNull().unique(),
  primaryColor: text("primary_color").notNull().default("#888888"),
  logoUrl:      text("logo_url"),
});

export const insertClubSchema = createInsertSchema(clubsTable).omit({ id: true });
export type InsertClub = z.infer<typeof insertClubSchema>;
export type Club = typeof clubsTable.$inferSelect;
