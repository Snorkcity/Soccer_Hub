import { pgTable, serial, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  gender: text("gender").notNull(),
  ageGroup: text("age_group").notNull(),
  analyticsEnabled: boolean("analytics_enabled").default(false).notNull(),
  clubName: text("club_name").notNull().default("Belconnen United FC"),
});

export const insertTeamSchema = createInsertSchema(teamsTable).omit({ id: true });
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;
