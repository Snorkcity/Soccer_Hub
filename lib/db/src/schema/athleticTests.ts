import { pgTable, serial, text, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const athleticTestsTable = pgTable("athletic_tests", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id"),
  playerName: text("player_name").notNull(),
  teamId: integer("team_id").notNull(),
  year: text("year").notNull(),
  position: text("position"),
  verticalStart: numeric("vertical_start", { precision: 6, scale: 2 }),
  verticalM: numeric("vertical_m", { precision: 6, scale: 2 }),
  verticalTotal: numeric("vertical_total", { precision: 6, scale: 2 }),
  horizontalM: numeric("horizontal_m", { precision: 6, scale: 2 }),
  balsomS: numeric("balsom_s", { precision: 6, scale: 2 }),
  split010: numeric("split_010", { precision: 6, scale: 3 }),
  split1020: numeric("split_1020", { precision: 6, scale: 3 }),
  split2030: numeric("split_2030", { precision: 6, scale: 3 }),
  total30m: numeric("total_30m", { precision: 6, scale: 3 }),
});

export const insertAthleticTestSchema = createInsertSchema(athleticTestsTable).omit({ id: true });
export type InsertAthleticTest = z.infer<typeof insertAthleticTestSchema>;
export type AthleticTest = typeof athleticTestsTable.$inferSelect;
