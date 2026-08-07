import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Goal-coding dropdown vocabulary (2026-08): the coach's house coding standard
 * for the Goals-tab dropdowns. Global (not per-league) — one standard across
 * every competition. One row per field; `options` is an ordered string[].
 * Fields: goalTypes, assistTypes, howPenetrated, buildupLanes, finishTypes.
 */
export const goalVocabTable = pgTable("goal_vocab", {
  field: text("field").primaryKey(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type GoalVocabRow = typeof goalVocabTable.$inferSelect;
