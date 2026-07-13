import { pgTable, serial, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  year: text("year").notNull(),
  label: text("label").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
});

export const insertSeasonSchema = createInsertSchema(seasonsTable).omit({ id: true });
export type InsertSeason = z.infer<typeof insertSeasonSchema>;
export type Season = typeof seasonsTable.$inferSelect;
