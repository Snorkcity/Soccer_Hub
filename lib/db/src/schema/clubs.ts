import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clubsTable = pgTable("clubs", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull().unique(),
  primaryColor: text("primary_color").notNull().default("#888888"),
  logoUrl:      text("logo_url"),
});

export const insertClubSchema = createInsertSchema(clubsTable).omit({ id: true });
export type InsertClub = z.infer<typeof insertClubSchema>;
export type Club = typeof clubsTable.$inferSelect;
