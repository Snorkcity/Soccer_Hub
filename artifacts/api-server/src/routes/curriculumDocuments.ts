/**
 * Superadmin-only curriculum document management API.
 *
 * GET    /curriculum-documents              — list all documents with status
 * POST   /curriculum-documents             — add a new DOCX document
 * POST   /curriculum-documents/:id/replace — replace an existing document
 * POST   /curriculum-documents/:id/reindex — re-index active document content
 * DELETE /curriculum-documents/:id         — delete (requires confirm=true)
 *
 * Uploaded DOCX bytes are transient: accepted as bounded base64 JSON,
 * validated, parsed in memory, then discarded. Only parsed chunks and
 * metadata are persisted.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  curriculumDocumentsTable,
  curriculumDocumentVersionsTable,
  curriculumChunksTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { getSessionUser } from "../middlewares/entryAuth";
import { parseDocxBase64, type ParsedChunk } from "../lib/docxParser";
import { embedTexts, invalidateChunkCache, embedVersionChunks } from "../assistant/curriculumStore";
import {
  AddCurriculumDocumentBody,
  ReplaceCurriculumDocumentBody,
  ReindexCurriculumDocumentBody,
  ListCurriculumDocumentsResponse,
  AddCurriculumDocumentResponse,
  ReplaceCurriculumDocumentResponse,
  ReindexCurriculumDocumentResponse,
  DeleteCurriculumDocumentBody,
} from "@workspace/api-zod";
import crypto from "node:crypto";

const router: IRouter = Router();

// ── Auth guard: every route requires superadmin ──────────────────────────────

async function requireSuperadmin(req: Request, res: Response): Promise<boolean> {
  const user = await getSessionUser(req);
  if (!user || !user.isSuperadmin) {
    res.status(403).json({ error: "Superadmin access required" });
    return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(prefix: string, ...parts: string[]): string {
  return crypto
    .createHash("sha1")
    .update(`${prefix}:${parts.join(":")}`)
    .digest("hex")
    .slice(0, 16);
}

function docKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getNextVersionNumber(documentId: string): Promise<number> {
  const last = await db
    .select({ versionNumber: curriculumDocumentVersionsTable.versionNumber })
    .from(curriculumDocumentVersionsTable)
    .where(eq(curriculumDocumentVersionsTable.documentId, documentId))
    .orderBy(desc(curriculumDocumentVersionsTable.versionNumber))
    .limit(1);
  return (last[0]?.versionNumber ?? 0) + 1;
}

async function recordFailedVersion(
  documentId: string,
  filename: string,
  error: string,
): Promise<void> {
  const versionNumber = await getNextVersionNumber(documentId);
  const versionId = makeId("ver", documentId, String(versionNumber));
  await db.insert(curriculumDocumentVersionsTable).values({
    id: versionId,
    documentId,
    versionNumber,
    filename,
    contentHash: makeId("failed", filename, error),
    status: "failed",
    chunkCount: 0,
    embeddedCount: 0,
    error: error.slice(0, 1000),
  });
}

/**
 * Insert parsed chunks into the DB for a given document+version.
 * Returns count of inserted chunks.
 */
async function insertVersionChunks(
  documentId: string,
  versionId: string,
  chunks: ParsedChunk[],
): Promise<number> {
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    await db
      .insert(curriculumChunksTable)
      .values(
        slice.map((c) => ({
          id: `${versionId}:${c.id}`,
          docTitle: c.docTitle,
          docType: c.docType,
          ageGroup: c.ageGroup,
          heading: c.heading,
          headingPath: c.headingPath,
          content: c.content,
          sortOrder: c.sortOrder,
          documentId,
          versionId,
        })),
      )
      .onConflictDoNothing();
  }
  return chunks.length;
}

/**
 * Atomically set a document's active version:
 * 1. Set version status → ready, publishedAt = now
 * 2. Set document activeVersionId → versionId, updatedAt = now
 */
async function activateVersion(documentId: string, versionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(curriculumDocumentVersionsTable)
      .set({ status: "ready", publishedAt: new Date(), updatedAt: sql`now()` })
      .where(
        and(
          eq(curriculumDocumentVersionsTable.id, versionId),
          eq(curriculumDocumentVersionsTable.documentId, documentId),
        ),
      );
    await tx
      .update(curriculumDocumentsTable)
      .set({ activeVersionId: versionId, updatedAt: sql`now()` })
      .where(eq(curriculumDocumentsTable.id, documentId));
    await tx.execute(sql`
      DELETE FROM seed_markers
      WHERE key = 'curriculum-deleted:' || (
        SELECT key FROM curriculum_documents WHERE id = ${documentId}
      )
    `);
  });
}

/**
 * Build the response shape for a document (with active version info).
 */
async function buildDocumentResponse(docId: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(curriculumDocumentsTable)
    .where(eq(curriculumDocumentsTable.id, docId))
    .limit(1);
  if (!rows[0]) return null;
  const doc = rows[0];

  // Get latest version (for status reporting)
  const latestVersion = await db
    .select()
    .from(curriculumDocumentVersionsTable)
    .where(eq(curriculumDocumentVersionsTable.documentId, docId))
    .orderBy(desc(curriculumDocumentVersionsTable.versionNumber))
    .limit(1);

  // Get active version details
  let activeVersion: typeof curriculumDocumentVersionsTable.$inferSelect | null = null;
  if (doc.activeVersionId) {
    const activeRows = await db
      .select()
      .from(curriculumDocumentVersionsTable)
      .where(eq(curriculumDocumentVersionsTable.id, doc.activeVersionId))
      .limit(1);
    activeVersion = activeRows[0] ?? null;
  }

  const latest = latestVersion[0] ?? null;
  return {
    id: doc.id,
    key: doc.key,
    title: doc.title,
    docType: doc.docType,
    ageGroup: doc.ageGroup,
    activeVersionId: doc.activeVersionId,
    activeFilename: activeVersion?.filename ?? null,
    activeVersionNumber: activeVersion?.versionNumber ?? null,
    activeChunkCount: activeVersion?.chunkCount ?? 0,
    activeEmbeddedCount: activeVersion?.embeddedCount ?? 0,
    filename: latest?.filename ?? null,
    versionNumber: latest?.versionNumber ?? null,
    status: latest?.status ?? "none",
    isActive: !!doc.activeVersionId && doc.activeVersionId === activeVersion?.id,
    isReady: activeVersion?.status === "ready",
    chunkCount: latest?.chunkCount ?? 0,
    embeddedCount: latest?.embeddedCount ?? 0,
    error: latest?.status === "failed" ? (latest?.error ?? null) : null,
    uploadedAt: latest?.createdAt?.toISOString() ?? null,
    publishedAt: activeVersion?.publishedAt?.toISOString() ?? null,
    updatedAt: doc.updatedAt?.toISOString() ?? null,
    createdAt: doc.createdAt?.toISOString() ?? null,
  };
}

// ── GET /curriculum-documents ─────────────────────────────────────────────────

router.get("/curriculum-documents", async (req, res): Promise<void> => {
  if (!await requireSuperadmin(req, res)) return;

  const docs = await db
    .select()
    .from(curriculumDocumentsTable)
    .orderBy(curriculumDocumentsTable.title);

  const results = await Promise.all(docs.map((d) => buildDocumentResponse(d.id)));
  res.json(ListCurriculumDocumentsResponse.parse(results.filter(Boolean) as unknown[]));
});

// ── POST /curriculum-documents ────────────────────────────────────────────────

router.post("/curriculum-documents", async (req, res): Promise<void> => {
  if (!await requireSuperadmin(req, res)) return;

  const parsed = AddCurriculumDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { title, docType, ageGroup, filename, base64 } = parsed.data;
  const key = docKey(title);
  const docId = makeId("doc", key);

  // Check for duplicate key
  const existing = await db
    .select({ id: curriculumDocumentsTable.id })
    .from(curriculumDocumentsTable)
    .where(eq(curriculumDocumentsTable.key, key))
    .limit(1);
  if (existing[0]) {
    res.status(409).json({ error: `A document with key "${key}" already exists` });
    return;
  }

  // Parse DOCX (never logs base64)
  let chunks: ParsedChunk[];
  try {
    chunks = parseDocxBase64(base64, filename, { docTitle: title, docType, ageGroup });
  } catch (err) {
    req.log.warn({ filename, docType, ageGroup }, "DOCX parse failed");
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const contentHash = crypto
    .createHash("sha1")
    .update(chunks.map((c) => c.id).join(","))
    .digest("hex")
    .slice(0, 16);

  const vid = makeId("ver", docId, "1");

  // Persist document
  await db.insert(curriculumDocumentsTable).values({
    id: docId,
    key,
    title,
    docType,
    ageGroup,
    activeVersionId: null,
  });

  // Persist version (processing)
  await db.insert(curriculumDocumentVersionsTable).values({
    id: vid,
    documentId: docId,
    versionNumber: 1,
    filename,
    contentHash,
    status: "processing",
    chunkCount: chunks.length,
    embeddedCount: 0,
  });

  // Insert chunks
  await insertVersionChunks(docId, vid, chunks);

  // Update chunk count
  await db
    .update(curriculumDocumentVersionsTable)
    .set({ chunkCount: chunks.length, updatedAt: sql`now()` })
    .where(eq(curriculumDocumentVersionsTable.id, vid));

  // Embed
  let embeddedCount = 0;
  try {
    embeddedCount = await embedVersionChunks(vid);
    await activateVersion(docId, vid);
  } catch (err) {
    req.log.error({ err, versionId: vid }, "Embedding failed for new document");
    await db
      .update(curriculumDocumentVersionsTable)
      .set({ status: "failed", error: (err as Error).message, updatedAt: sql`now()` })
      .where(eq(curriculumDocumentVersionsTable.id, vid));
    // Document remains with no active version — visible in list as failed
  }

  invalidateChunkCache();

  const response = await buildDocumentResponse(docId);
  if (!response) {
    res.status(500).json({ error: "Document created but could not be retrieved" });
    return;
  }
  req.log.info({ docId, title, chunks: chunks.length, embedded: embeddedCount }, "Curriculum document added");
  res.status(201).json(AddCurriculumDocumentResponse.parse(response));
});

// ── POST /curriculum-documents/:id/replace ───────────────────────────────────

router.post("/curriculum-documents/:id/replace", async (req, res): Promise<void> => {
  if (!await requireSuperadmin(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = ReplaceCurriculumDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(curriculumDocumentsTable)
    .where(eq(curriculumDocumentsTable.id, rawId))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = existing[0];

  const { filename, base64 } = parsed.data;

  // Parse DOCX
  let chunks: ParsedChunk[];
  try {
    chunks = parseDocxBase64(base64, filename, {
      docTitle: doc.title,
      docType: doc.docType,
      ageGroup: doc.ageGroup,
    });
  } catch (err) {
    const message = (err as Error).message;
    await recordFailedVersion(rawId, filename, message);
    req.log.warn({ filename, docId: rawId }, "DOCX replace parse failed");
    res.status(400).json({ error: message });
    return;
  }

  const contentHash = crypto
    .createHash("sha1")
    .update(chunks.map((c) => c.id).join(","))
    .digest("hex")
    .slice(0, 16);

  const versionNum = await getNextVersionNumber(rawId);
  const vid = makeId("ver", rawId, String(versionNum));

  // Create staging version
  await db.insert(curriculumDocumentVersionsTable).values({
    id: vid,
    documentId: rawId,
    versionNumber: versionNum,
    filename,
    contentHash,
    status: "processing",
    chunkCount: chunks.length,
    embeddedCount: 0,
  });

  // Insert chunks (new version-scoped IDs)
  await insertVersionChunks(rawId, vid, chunks);

  await db
    .update(curriculumDocumentVersionsTable)
    .set({ chunkCount: chunks.length, updatedAt: sql`now()` })
    .where(eq(curriculumDocumentVersionsTable.id, vid));

  // Embed and then atomically flip active version
  const previousActiveVersionId = doc.activeVersionId;
  try {
    await embedVersionChunks(vid);
    await activateVersion(rawId, vid);
    req.log.info({ docId: rawId, newVersionId: vid, versionNum }, "Curriculum document replaced successfully");
  } catch (err) {
    req.log.error({ err, versionId: vid, docId: rawId }, "Embedding failed for replacement version");
    await db
      .update(curriculumDocumentVersionsTable)
      .set({ status: "failed", error: (err as Error).message, updatedAt: sql`now()` })
      .where(eq(curriculumDocumentVersionsTable.id, vid));
    // Old active version remains served
    req.log.info(
      { previousActiveVersionId, docId: rawId },
      "Replacement failed — old active version continues to be served",
    );
  }

  invalidateChunkCache();

  const response = await buildDocumentResponse(rawId);
  if (!response) {
    res.status(500).json({ error: "Document updated but could not be retrieved" });
    return;
  }
  res.json(ReplaceCurriculumDocumentResponse.parse(response));
});

// ── POST /curriculum-documents/:id/reindex ───────────────────────────────────

router.post("/curriculum-documents/:id/reindex", async (req, res): Promise<void> => {
  if (!await requireSuperadmin(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Validate request body (empty or with optional note)
  const parsedBody = ReindexCurriculumDocumentBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(curriculumDocumentsTable)
    .where(eq(curriculumDocumentsTable.id, rawId))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = existing[0];

  if (!doc.activeVersionId) {
    res.status(400).json({ error: "Document has no active version to re-index" });
    return;
  }

  // Load active version chunks (source-faithful)
  const sourceVersion = await db
    .select()
    .from(curriculumDocumentVersionsTable)
    .where(eq(curriculumDocumentVersionsTable.id, doc.activeVersionId))
    .limit(1);
  if (!sourceVersion[0] || sourceVersion[0].status !== "ready") {
    res.status(400).json({ error: "Active version is not ready — cannot re-index" });
    return;
  }

  const sourceChunks = await db
    .select()
    .from(curriculumChunksTable)
    .where(eq(curriculumChunksTable.versionId, doc.activeVersionId));

  if (sourceChunks.length === 0) {
    res.status(400).json({ error: "Active version has no chunks to re-index" });
    return;
  }

  // Stage new version copying source-faithful chunks
  const versionNum = await getNextVersionNumber(rawId);
  const vid = makeId("ver", rawId, String(versionNum));
  const contentHash = crypto
    .createHash("sha1")
    .update(sourceChunks.map((c) => c.id).join(","))
    .digest("hex")
    .slice(0, 16);

  await db.insert(curriculumDocumentVersionsTable).values({
    id: vid,
    documentId: rawId,
    versionNumber: versionNum,
    filename: sourceVersion[0].filename,
    contentHash,
    status: "processing",
    chunkCount: sourceChunks.length,
    embeddedCount: 0,
  });

  // Copy chunks to new version (new versionId linkage)
  const BATCH = 50;
  for (let i = 0; i < sourceChunks.length; i += BATCH) {
    const slice = sourceChunks.slice(i, i + BATCH);
    await db
      .insert(curriculumChunksTable)
      .values(
        slice.map((c) => ({
          id: `${vid}:${c.id.includes(":") ? c.id.slice(c.id.lastIndexOf(":") + 1) : c.id}`,
          docTitle: c.docTitle,
          docType: c.docType,
          ageGroup: c.ageGroup,
          heading: c.heading,
          headingPath: c.headingPath,
          content: c.content,
          sortOrder: c.sortOrder,
          documentId: rawId,
          versionId: vid,
        })),
      )
      .onConflictDoNothing();
  }

  await db
    .update(curriculumDocumentVersionsTable)
    .set({ chunkCount: sourceChunks.length, updatedAt: sql`now()` })
    .where(eq(curriculumDocumentVersionsTable.id, vid));

  // Embed and atomically flip
  try {
    await embedVersionChunks(vid);
    await activateVersion(rawId, vid);
    req.log.info({ docId: rawId, newVersionId: vid, versionNum }, "Curriculum document re-indexed successfully");
  } catch (err) {
    req.log.error({ err, versionId: vid, docId: rawId }, "Re-index embedding failed");
    await db
      .update(curriculumDocumentVersionsTable)
      .set({ status: "failed", error: (err as Error).message, updatedAt: sql`now()` })
      .where(eq(curriculumDocumentVersionsTable.id, vid));
  }

  invalidateChunkCache();

  const response = await buildDocumentResponse(rawId);
  if (!response) {
    res.status(500).json({ error: "Document re-indexed but could not be retrieved" });
    return;
  }
  res.json(ReindexCurriculumDocumentResponse.parse(response));
});

// ── DELETE /curriculum-documents/:id ─────────────────────────────────────────

router.delete("/curriculum-documents/:id", async (req, res): Promise<void> => {
  if (!await requireSuperadmin(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = DeleteCurriculumDocumentBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirm !== true) {
    res.status(400).json({ error: "Explicit confirmation is required to delete this document" });
    return;
  }

  const existing = await db
    .select()
    .from(curriculumDocumentsTable)
    .where(eq(curriculumDocumentsTable.id, rawId))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = existing[0];

  // Tombstone + delete in one transaction. The tombstone prevents an
  // incomplete initial bootstrap from silently restoring this document.
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO seed_markers (key)
      SELECT ${`curriculum-deleted:${doc.key}`}
      WHERE NOT EXISTS (
        SELECT 1 FROM seed_markers WHERE key = 'curriculum-managed-bootstrap-v1'
      )
      ON CONFLICT DO NOTHING
    `);
    await tx
      .delete(curriculumChunksTable)
      .where(eq(curriculumChunksTable.documentId, rawId));
    await tx
      .delete(curriculumDocumentVersionsTable)
      .where(eq(curriculumDocumentVersionsTable.documentId, rawId));
    await tx
      .delete(curriculumDocumentsTable)
      .where(eq(curriculumDocumentsTable.id, rawId));
  });

  invalidateChunkCache();

  req.log.info({ docId: rawId, title: doc.title }, "Curriculum document deleted");
  res.json({ ok: true });
});

export default router;
