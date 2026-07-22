import { pgTable, serial, integer, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * The session-practice library, extracted from the coach's master PowerPoint
 * (446 slides). One row per slide. `diagram` holds the fully-resolved shape
 * list (pixel coords on a 960-wide canvas) that the frontend renders as SVG;
 * `paras` holds every text paragraph found on the slide (title, rules,
 * coaching messages...).
 *
 * kind: practice | sectionMarker | chapterCover | chapterIndex | frontmatter
 */
export const practicesTable = pgTable("practices", {
  id:          serial("id").primaryKey(),
  ordinal:     integer("ordinal").notNull().unique(), // slide position in the source deck
  kind:        text("kind").notNull(),
  chapter:     text("chapter"),        // e.g. "Activations", "Main Part"
  sectionCode: text("section_code"),   // e.g. "A-GR", "MP-D-HP"
  sectionName: text("section_name"),   // e.g. "General Rondos"
  title:       text("title"),          // best-guess title; null for untitled variation slides
  paras:       jsonb("paras").notNull().default([]),
  diagram:     jsonb("diagram").notNull(), // { bg, shapes: [...] }
  needsReview: boolean("needs_review").notNull().default(false),
  sourceFile:  text("source_file"),
  /** text-embedding-3-small vector (number[] jsonb) of title+section+paras; null until embedded */
  embedding:   jsonb("embedding"),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type PracticeRow = typeof practicesTable.$inferSelect;
