import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Managed curriculum document registry.
 *
 * A document has a stable key/title/docType/ageGroup and points to the
 * currently active version. The version model allows atomic replacement:
 * stage a new version, parse + embed fully, then flip activeVersionId.
 * Old active content stays served on failure.
 */
export const curriculumDocumentsTable = pgTable("curriculum_documents", {
  id:              text("id").primaryKey(),          // stable UUID-like key
  key:             text("key").notNull().unique(),    // deterministic slug e.g. "u11-coach-pack"
  title:           text("title").notNull(),
  docType:         text("doc_type").notNull(),        // framework | coach_pack | session_plans | curriculum
  ageGroup:        text("age_group").notNull(),        // U11..U16+ | All
  activeVersionId: text("active_version_id"),          // FK to curriculum_document_versions (nullable on creation)
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export type CurriculumDocumentRow = typeof curriculumDocumentsTable.$inferSelect;

/**
 * Version history for a managed curriculum document.
 * status: processing → ready (success) or failed
 */
export const curriculumDocumentVersionsTable = pgTable("curriculum_document_versions", {
  id:            text("id").primaryKey(),
  documentId:    text("document_id").notNull(),       // FK → curriculum_documents.id
  versionNumber: integer("version_number").notNull().default(1),
  filename:      text("filename").notNull(),
  contentHash:   text("content_hash").notNull(),       // sha1 of parsed chunks
  status:        text("status").notNull().default("processing"), // processing | ready | failed
  chunkCount:    integer("chunk_count").notNull().default(0),
  embeddedCount: integer("embedded_count").notNull().default(0),
  error:         text("error"),                        // last error message
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  publishedAt:   timestamp("published_at"),            // set when this version becomes active
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});

export type CurriculumDocumentVersionRow = typeof curriculumDocumentVersionsTable.$inferSelect;

/**
 * Belconnen United development-curriculum knowledge base for the Coach
 * Assistant. One row per document section (a session plan, a coach-pack
 * section, a framework...).
 *
 * `embedding` holds a text-embedding-3-small vector (1536 floats, jsonb) —
 * the api-server loads all rows into memory and does cosine similarity there,
 * so no pgvector requirement.
 *
 * documentId + versionId link chunks to managed documents/versions.
 * Both are nullable only for the migration bootstrap path.
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
  documentId:  text("document_id"),              // FK → curriculum_documents.id (nullable for migration)
  versionId:   text("version_id"),               // FK → curriculum_document_versions.id (nullable for migration)
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type CurriculumChunkRow = typeof curriculumChunksTable.$inferSelect;
