import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Reflection journal (A-diploma "reality based journal" + everyday coach
 * reflections). A cycle is N weeks of planning/reflection blocks; entries
 * hold the freeform content per (week, kind). Standalone reflections
 * (post-training / post-match, incl. future voice interviews) are entries
 * with cycleId NULL.
 */
export const journalCyclesTable = pgTable("journal_cycles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  weeksCount: integer("weeks_count").notNull().default(6),
  startDate: text("start_date"), // coach's format, free text e.g. "3.08.2026"
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Weekly blocks inside a cycle (mirrors the course template slides). */
export const JOURNAL_CYCLE_KINDS = [
  "weekly_planner",
  "weekly_review",
  "game_preview",
  "game_tactics",
  "game_analysis",
] as const;
export type JournalCycleKind = (typeof JOURNAL_CYCLE_KINDS)[number];

/** Standalone (cycle-less) reflection kinds — quick post-training / post-match. */
export const JOURNAL_STANDALONE_KINDS = ["session_reflection", "match_reflection"] as const;
export type JournalStandaloneKind = (typeof JOURNAL_STANDALONE_KINDS)[number];

export const journalEntriesTable = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").references(() => journalCyclesTable.id, { onDelete: "cascade" }),
  weekNo: integer("week_no"), // 1-based, NULL for standalone reflections
  kind: text("kind").notNull(),
  title: text("title"), // standalone reflections: e.g. "U17 training Tue"
  entryDate: text("entry_date"), // coach's format, free text
  source: text("source").notNull().default("manual"), // manual | voice
  /** Field-id → text, field ids defined client-side per kind. */
  content: jsonb("content").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
