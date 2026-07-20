import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Saved Match Prep reports — Monday "Week Ahead" briefings and Friday pre-match decks. */
export const MATCH_PREP_REPORT_KINDS = ["monday", "friday"] as const;
export type MatchPrepReportKind = (typeof MATCH_PREP_REPORT_KINDS)[number];

export const matchPrepReportsTable = pgTable("match_prep_reports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // monday | friday
  title: text("title").notNull(), // e.g. "R16 v Canberra Croatia"
  opponent: text("opponent"),
  matchDate: text("match_date"), // coach's format, free text
  /** Whole editor state — the Friday deck Draft, or the Monday briefing fields. */
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
