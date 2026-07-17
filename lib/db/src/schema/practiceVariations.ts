import { pgTable, serial, integer, text, date, timestamp } from "drizzle-orm/pg-core";
import { practicesTable } from "./practices";

/**
 * Historical wording variations for a library practice, imported from the
 * coach's old finished session plans (.docx). When a coach picks a practice
 * in the session builder, these appear as selectable pre-fill guidance.
 */
export const practiceVariationsTable = pgTable("practice_variations", {
  id:             serial("id").primaryKey(),
  practiceId:     integer("practice_id").notNull().references(() => practicesTable.id, { onDelete: "cascade" }),
  sourceFile:     text("source_file").notNull(),   // original docx filename
  sessionDate:    date("session_date"),            // parsed from the filename (YYMMDD)
  part:           text("part").notNull(),          // warmup | activation | introduction | main | endgame
  rules:          text("rules"),
  tasks:          text("tasks"),
  progressions:   text("progressions"),
  coachingPoints: text("coaching_points"),
  players:        text("players"),
  size:           text("size"),
  timing:         text("timing"),
  scoring:        text("scoring"),
  intensity:      text("intensity"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export type PracticeVariationRow = typeof practiceVariationsTable.$inferSelect;
