/**
 * Coach Assistant knowledge base: sync + in-memory retrieval.
 *
 * On boot, syncCurriculum() bootstraps managed curriculum_documents +
 * curriculum_document_versions from the static curriculum.json snapshot
 * (lib/db/src/data/curriculum.json) — once only. After managed documents
 * exist, the static snapshot is no longer authoritative; documents are
 * managed via the superadmin curriculum-documents API.
 *
 * loadChunks() retrieves ONLY chunks belonging to active+ready versions.
 * Stale/processing/failed chunks never appear in assistant answers.
 */
import { db } from "@workspace/db";
import {
  curriculumChunksTable,
  curriculumDocumentsTable,
  curriculumDocumentVersionsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

export interface CurriculumChunk {
  id: string;
  docTitle: string;
  docType: string;
  ageGroup: string;
  heading: string;
  headingPath: string;
  content: string;
  sortOrder: number;
  embedding: number[] | null;
}

import { throwIfQuota } from "../lib/openaiQuota";

const EMBED_MODEL = "text-embedding-3-small";

function embedKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = embedKey();
  if (!key) throw new Error("OPENAI_API_KEY not configured — cannot embed");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const text = await res.text();
    throwIfQuota(res.status, text);
    throw new Error(`Embeddings API ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  const out: number[][] = new Array(texts.length);
  for (const d of json.data) out[d.index] = d.embedding;
  return out;
}

// ── in-memory cache ───────────────────────────────────────────────────────────
let cache: CurriculumChunk[] | null = null;

/**
 * Load ONLY the chunks that belong to active+ready versions.
 * Falls back to un-managed (legacy bootstrap) chunks when no managed
 * documents exist yet (document_id IS NULL).
 */
export async function loadChunks(force = false): Promise<CurriculumChunk[]> {
  if (cache && !force) return cache;

  // Check whether any managed documents exist
  const managedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(curriculumDocumentsTable);
  const hasManagedDocs = (managedCount[0]?.count ?? 0) > 0;

  let rows: typeof curriculumChunksTable.$inferSelect[];

  if (!hasManagedDocs) {
    // Bootstrap path: load all chunks (legacy behaviour)
    rows = await db.select().from(curriculumChunksTable);
  } else {
    // Managed path: only chunks with active+ready versions
    // Get all active version IDs (documents with an active_version_id pointing to a ready version)
    const activeVersions = await db
      .select({ versionId: curriculumDocumentsTable.activeVersionId })
      .from(curriculumDocumentsTable)
      .innerJoin(
        curriculumDocumentVersionsTable,
        and(
          eq(curriculumDocumentVersionsTable.id, curriculumDocumentsTable.activeVersionId!),
          eq(curriculumDocumentVersionsTable.status, "ready"),
        ),
      )
      .where(isNotNull(curriculumDocumentsTable.activeVersionId));

    const versionIds = activeVersions
      .map((r) => r.versionId)
      .filter((v): v is string => v !== null);

    if (versionIds.length === 0) {
      logger.warn("No active+ready curriculum versions found — knowledge base is empty");
      cache = [];
      return cache;
    }

    rows = await db
      .select()
      .from(curriculumChunksTable)
      .where(inArray(curriculumChunksTable.versionId, versionIds));
  }

  cache = rows.map((r) => ({
    id: r.id,
    docTitle: r.docTitle,
    docType: r.docType,
    ageGroup: r.ageGroup,
    heading: r.heading,
    headingPath: r.headingPath,
    content: r.content,
    sortOrder: r.sortOrder,
    embedding: (r.embedding as number[] | null) ?? null,
  }));
  return cache;
}

export function invalidateChunkCache(): void {
  cache = null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Embed pending chunks for a given version ──────────────────────────────────
export async function embedVersionChunks(versionId: string): Promise<number> {
  const pending = await db
    .select({
      id: curriculumChunksTable.id,
      headingPath: curriculumChunksTable.headingPath,
      content: curriculumChunksTable.content,
    })
    .from(curriculumChunksTable)
    .where(
      and(
        eq(curriculumChunksTable.versionId, versionId),
        isNull(curriculumChunksTable.embedding),
      ),
    );

  if (pending.length > 0) {
    if (!embedKey()) {
      throw new Error("OPENAI_API_KEY not configured — the document was not published");
    }

    logger.info({ pending: pending.length, versionId }, "Embedding curriculum chunks...");
    const EBATCH = 64;
    for (let i = 0; i < pending.length; i += EBATCH) {
      const slice = pending.slice(i, i + EBATCH);
      const vecs = await embedTexts(slice.map((r) => `${r.headingPath}\n${r.content}`.slice(0, 24000)));
      for (let j = 0; j < slice.length; j++) {
        await db
          .update(curriculumChunksTable)
          .set({ embedding: vecs[j], updatedAt: sql`now()` })
          .where(eq(curriculumChunksTable.id, slice[j].id));
      }
    }
  }

  const [totalRows, embeddedRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(curriculumChunksTable)
      .where(eq(curriculumChunksTable.versionId, versionId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(curriculumChunksTable)
      .where(
        and(
          eq(curriculumChunksTable.versionId, versionId),
          isNotNull(curriculumChunksTable.embedding),
        ),
      ),
  ]);
  const total = totalRows[0]?.count ?? 0;
  const embedded = embeddedRows[0]?.count ?? 0;

  await db
    .update(curriculumDocumentVersionsTable)
    .set({ embeddedCount: embedded, updatedAt: sql`now()` })
    .where(eq(curriculumDocumentVersionsTable.id, versionId));

  if (total === 0 || embedded !== total) {
    throw new Error(`Curriculum indexing incomplete: ${embedded} of ${total} chunks embedded`);
  }

  return embedded;
}

// ── boot sync ─────────────────────────────────────────────────────────────────

/**
 * Deterministic document key from docTitle (matches scripts/parse_curriculum.py DOCS list).
 */
function docKey(docTitle: string): string {
  return docTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function docId(key: string): string {
  return crypto.createHash("sha1").update(`doc:${key}`).digest("hex").slice(0, 16);
}

function versionId(docId: string, versionNum: number): string {
  return crypto.createHash("sha1").update(`ver:${docId}:${versionNum}`).digest("hex").slice(0, 16);
}

/**
 * Bootstrap the static curriculum.json into managed documents/versions ONCE.
 * After managed documents exist, the static snapshot is no longer touched.
 * Reuses existing chunk embeddings when IDs match.
 */
export async function syncCurriculum(): Promise<void> {
  // ── 1. Load the static snapshot ──────────────────────────────────────────
  const fs = await import("node:fs");
  const path = await import("node:path");
  const candidates = [
    path.resolve(process.cwd(), "lib/db/src/data/curriculum.json"),
    path.resolve(process.cwd(), "../../lib/db/src/data/curriculum.json"),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) {
    logger.warn({ candidates }, "curriculum.json not found — skipping curriculum sync");
    return;
  }
  const chunks = JSON.parse(fs.readFileSync(file, "utf8")) as CurriculumChunk[];

  // ── 2. Check whether the one-time snapshot bootstrap completed ────────────
  const bootstrapMarker = await db.execute(sql`
    SELECT 1 FROM seed_markers WHERE key = 'curriculum-managed-bootstrap-v1'
  `);

  if (bootstrapMarker.rows.length > 0) {
    // Managed documents exist — static snapshot is no longer authoritative.
    // Just embed any un-embedded chunks from active versions and refresh cache.
    const activeVersions = await db
      .select({ versionId: curriculumDocumentsTable.activeVersionId })
      .from(curriculumDocumentsTable)
      .innerJoin(
        curriculumDocumentVersionsTable,
        and(
          eq(curriculumDocumentVersionsTable.id, curriculumDocumentsTable.activeVersionId!),
          eq(curriculumDocumentVersionsTable.status, "ready"),
        ),
      )
      .where(isNotNull(curriculumDocumentsTable.activeVersionId));

    for (const { versionId: vid } of activeVersions) {
      if (vid) await embedVersionChunks(vid);
    }
    await loadChunks(true);
    logger.info({ activeVersions: activeVersions.length }, "Curriculum sync: managed bootstrap already complete");
    return;
  }

  // ── 3. Bootstrap: group chunks by docTitle and create documents/versions ──
  const byDoc = new Map<string, CurriculumChunk[]>();
  for (const chunk of chunks) {
    const existing = byDoc.get(chunk.docTitle) ?? [];
    existing.push(chunk);
    byDoc.set(chunk.docTitle, existing);
  }

  // A deliberate admin deletion must survive a restart even when an unrelated
  // bootstrap document is waiting for a transient embedding failure to clear.
  const tombstoneRows = await db.execute(sql`
    SELECT key FROM seed_markers WHERE key LIKE 'curriculum-deleted:%'
  `);
  const tombstonedKeys = new Set(
    tombstoneRows.rows
      .map((row) => String((row as { key?: unknown }).key ?? ""))
      .filter((key) => key.startsWith("curriculum-deleted:"))
      .map((key) => key.slice("curriculum-deleted:".length)),
  );
  for (const title of [...byDoc.keys()]) {
    if (tombstonedKeys.has(docKey(title))) byDoc.delete(title);
  }
  const bootstrapChunks = [...byDoc.values()].flat();

  // Upsert all chunks first (reusing existing embeddings via onConflictDoNothing)
  const BATCH = 50;
  for (let i = 0; i < bootstrapChunks.length; i += BATCH) {
    const slice = bootstrapChunks.slice(i, i + BATCH);
    await db
      .insert(curriculumChunksTable)
      .values(slice.map((c) => ({
        id: c.id,
        docTitle: c.docTitle,
        docType: c.docType,
        ageGroup: c.ageGroup,
        heading: c.heading,
        headingPath: c.headingPath,
        content: c.content,
        sortOrder: c.sortOrder,
      })))
      .onConflictDoNothing();
  }

  // Remove stale chunks that are NOT part of any managed version
  // (only for un-managed chunks — document_id IS NULL)
  if (bootstrapChunks.length > 0) {
    await db.delete(curriculumChunksTable).where(
      and(
        notInArray(curriculumChunksTable.id, bootstrapChunks.map((c) => c.id)),
        isNull(curriculumChunksTable.documentId),
      ),
    );
  }

  const activeReadyRows = await db
    .select({ key: curriculumDocumentsTable.key })
    .from(curriculumDocumentsTable)
    .innerJoin(
      curriculumDocumentVersionsTable,
      and(
        eq(curriculumDocumentVersionsTable.id, curriculumDocumentsTable.activeVersionId!),
        eq(curriculumDocumentVersionsTable.status, "ready"),
      ),
    )
    .where(isNotNull(curriculumDocumentsTable.activeVersionId));
  const activeReadyKeys = new Set(activeReadyRows.map((row) => row.key));

  // Create managed document + version rows for each doc in the snapshot
  for (const [docTitle, docChunks] of byDoc) {
    const key = docKey(docTitle);
    // A superadmin may have recovered a failed initial document by publishing a
    // later version. Never reactivate snapshot v1 over that managed version.
    if (activeReadyKeys.has(key)) continue;
    const did = docId(key);
    const vid = versionId(did, 1);

    // Determine docType + ageGroup from first chunk
    const first = docChunks[0];
    const contentHash = crypto
      .createHash("sha1")
      .update(docChunks.map((c) => c.id).join(","))
      .digest("hex")
      .slice(0, 16);

    // Insert document (idempotent)
    await db
      .insert(curriculumDocumentsTable)
      .values({
        id: did,
        key,
        title: docTitle,
        docType: first.docType,
        ageGroup: first.ageGroup,
        activeVersionId: null,
      })
      .onConflictDoNothing();

    // Insert version (idempotent)
    await db
      .insert(curriculumDocumentVersionsTable)
      .values({
        id: vid,
        documentId: did,
        versionNumber: 1,
        filename: `${key}.docx`,
        contentHash,
        status: "processing",
        chunkCount: docChunks.length,
        embeddedCount: 0,
      })
      .onConflictDoNothing();

    // Link chunks to this document + version
    const chunkIds = docChunks.map((c) => c.id);
    for (let i = 0; i < chunkIds.length; i += BATCH) {
      const slice = chunkIds.slice(i, i + BATCH);
      await db
        .update(curriculumChunksTable)
        .set({ documentId: did, versionId: vid })
        .where(
          and(
            inArray(curriculumChunksTable.id, slice),
            isNull(curriculumChunksTable.documentId),
          ),
        );
    }

  }

  // ── 4. Verify every initial version before publishing it ─────────────────
  for (const [docTitle] of byDoc) {
    const key = docKey(docTitle);
    if (activeReadyKeys.has(key)) continue;
    const did = docId(key);
    const vid = versionId(did, 1);
    try {
      await embedVersionChunks(vid);
      await db.transaction(async (tx) => {
        await tx
          .update(curriculumDocumentVersionsTable)
          .set({ status: "ready", publishedAt: new Date(), error: null, updatedAt: sql`now()` })
          .where(eq(curriculumDocumentVersionsTable.id, vid));
        await tx
          .update(curriculumDocumentsTable)
          .set({ activeVersionId: vid, updatedAt: sql`now()` })
          .where(eq(curriculumDocumentsTable.id, did));
      });
    } catch (err) {
      await db
        .update(curriculumDocumentVersionsTable)
        .set({ status: "failed", error: (err as Error).message.slice(0, 1000), updatedAt: sql`now()` })
        .where(eq(curriculumDocumentVersionsTable.id, vid));
      logger.error({ err, docTitle }, "Curriculum bootstrap document was not published");
    }
  }

  const publishedRows = await db
    .select({ key: curriculumDocumentsTable.key })
    .from(curriculumDocumentsTable)
    .innerJoin(
      curriculumDocumentVersionsTable,
      and(
        eq(curriculumDocumentVersionsTable.id, curriculumDocumentsTable.activeVersionId!),
        eq(curriculumDocumentVersionsTable.status, "ready"),
      ),
    )
    .where(isNotNull(curriculumDocumentsTable.activeVersionId));
  const publishedKeys = new Set(publishedRows.map((row) => row.key));
  const missingKeys = [...byDoc.keys()]
    .map(docKey)
    .filter((key) => !publishedKeys.has(key));

  if (missingKeys.length === 0) {
    await db.execute(sql`
      INSERT INTO seed_markers (key) VALUES ('curriculum-managed-bootstrap-v1')
      ON CONFLICT DO NOTHING
    `);
  } else {
    logger.warn(
      { missingDocuments: missingKeys.length },
      "Curriculum bootstrap incomplete — it will resume on the next startup",
    );
  }
  await loadChunks(true);
  logger.info(
    { docs: byDoc.size, chunks: bootstrapChunks.length, complete: missingKeys.length === 0 },
    "Curriculum bootstrap pass finished",
  );
}
