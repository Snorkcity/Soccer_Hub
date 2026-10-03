import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { usersTable } from "./users";

export const veoGoalSequenceReviewsTable = pgTable("veo_goal_sequence_reviews", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  veoMatchId: text("veo_match_id").notNull(),
  goalKey: text("goal_key").notNull(),
  hubGoalId: integer("hub_goal_id"),
  // The four decisions are kept independently so an unclear passer does not
  // discard useful scorer/zone evidence.
  decisions: jsonb("decisions").$type<Record<string, "correct" | "incorrect" | "unclear">>().notNull().default({}),
  sourceSnapshot: jsonb("source_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqueGoal: uniqueIndex("veo_goal_sequence_reviews_unique").on(t.leagueId, t.veoMatchId, t.goalKey),
}));

export const insertVeoGoalSequenceReviewSchema = createInsertSchema(veoGoalSequenceReviewsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertVeoGoalSequenceReview = z.infer<typeof insertVeoGoalSequenceReviewSchema>;
export type VeoGoalSequenceReview = typeof veoGoalSequenceReviewsTable.$inferSelect;