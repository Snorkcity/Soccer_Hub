import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Belconnen United development-curriculum knowledge base for the Coach
 * Assistant. One row per document section (a session plan, a coach-pack
 * section, a framework...), extracted from the 14 club docx files by
 * scripts/parse_curriculum.py → lib/db/src/data/curriculum.json.
 *
 * `embedding` holds a text-embedding-3-small vector (1536 floats, jsonb) —
 * the api-server loads all rows into memory and does cosine similarity there,
 * so no pgvector requirement.
 */
export const curriculumChunksTable = pgTable("curriculum_chunks", {
  id:          text("id").primaryKey(),          // sha1 of docTitle|headingPath|content
  docTitle:    text("doc_title").notNull(),      // e.g. "U11 Session Plans"
  docType:     text("doc_type").notNull(),       // framework | coach_pack | session_plans | curriculum
  ageGroup:    text("age_group").notNull(),      // U11..U16+ | All
  heading:     text("heading").notNull(),
  headingPath: text("heading_path").notNull(),
  content:     text("content").notNull(),
  sortOrder:   integer("sort_order").notNull().default(0),
  embedding:   jsonb("embedding"),               // number[] | null until embedded
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type CurriculumChunkRow = typeof curriculumChunksTable.$inferSelect;
