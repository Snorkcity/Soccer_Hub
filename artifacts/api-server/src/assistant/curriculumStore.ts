/**
 * Coach Assistant knowledge base: sync + in-memory retrieval.
 *
 * On boot, syncCurriculum() upserts the parsed curriculum snapshot
 * (lib/db/src/data/curriculum.json) into curriculum_chunks, deletes stale
 * rows, and embeds any chunks missing embeddings (OpenAI direct — the AI
 * integrations proxy has no embeddings endpoint). All rows are then cached
 * in memory; retrieval is cosine similarity over ~600 vectors, so no
 * pgvector requirement.
 */
import { db } from "@workspace/db";
import { curriculumChunksTable } from "@workspace/db/schema";
import { inArray, isNull, notInArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

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

const EMBED_MODEL = "text-embedding-3-small";

function embedKey(): string | null {
  // Embeddings must go direct to OpenAI — the integrations proxy doesn't support them.
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
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  const out: number[][] = new Array(texts.length);
  for (const d of json.data) out[d.index] = d.embedding;
  return out;
}

// ── in-memory cache ──────────────────────────────────────────────────────────
let cache: CurriculumChunk[] | null = null;

export async function loadChunks(force = false): Promise<CurriculumChunk[]> {
  if (cache && !force) return cache;
  const rows = await db.select().from(curriculumChunksTable);
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

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── boot sync ────────────────────────────────────────────────────────────────
export async function syncCurriculum(): Promise<void> {
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

  // Upsert by content-hash id (unchanged rows keep their embeddings)
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
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
  await db.delete(curriculumChunksTable)
    .where(notInArray(curriculumChunksTable.id, chunks.map((c) => c.id)));

  // Embed anything missing an embedding
  const pending = await db
    .select({
      id: curriculumChunksTable.id,
      headingPath: curriculumChunksTable.headingPath,
      content: curriculumChunksTable.content,
    })
    .from(curriculumChunksTable)
    .where(isNull(curriculumChunksTable.embedding));

  if (pending.length > 0) {
    if (!embedKey()) {
      logger.warn({ pending: pending.length }, "Curriculum chunks need embeddings but OPENAI_API_KEY is not set");
    } else {
      logger.info({ pending: pending.length }, "Embedding curriculum chunks...");
      const EBATCH = 64;
      for (let i = 0; i < pending.length; i += EBATCH) {
        const slice = pending.slice(i, i + EBATCH);
        const vecs = await embedTexts(slice.map((r) => `${r.headingPath}\n${r.content}`.slice(0, 24000)));
        for (let j = 0; j < slice.length; j++) {
          await db
            .update(curriculumChunksTable)
            .set({ embedding: vecs[j], updatedAt: sql`now()` })
            .where(inArray(curriculumChunksTable.id, [slice[j].id]));
        }
      }
    }
  }

  await loadChunks(true);
  logger.info({ chunks: chunks.length }, "Curriculum sync complete");
}
