/**
 * Practice-library embeddings for AI session generation.
 *
 * Each library practice (Warmup / Activations / Main Part / End Games) gets a
 * text-embedding-3-small vector of its title + section + slide text, stored on
 * the practices row (jsonb) and cached in memory. Retrieval is cosine
 * similarity over ~350 vectors — same pattern as the curriculum store.
 */
import { db, practicesTable } from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { cosine, embedTexts } from "./curriculumStore";
import { logger } from "../lib/logger";

const EMBED_CHAPTERS = ["Warmup", "Activations", "Main Part", "End Games", "Uploads"];

export interface PracticeEntry {
  id: number;
  ordinal: number;
  chapter: string;
  sectionName: string | null;
  title: string | null;
  text: string;
  embedding: number[] | null;
  /** coach's review: warmup | introduction | main | endgame | unusable; null = not reviewed yet */
  reviewPart: string | null;
  /** coach's sub-category tags, e.g. ["A5"] or ["MP6","MP7"] */
  reviewTags: string[];
}

/** Call after any review save so the next generation sees fresh tags. */
export function invalidatePracticeCache(): void {
  cache = null;
}

/** Flatten a practice's paras into readable text (skips 1-char slide-corner labels). */
export function practiceText(title: string | null, sectionName: string | null, paras: unknown): string {
  const lines: string[] = [];
  if (Array.isArray(paras)) {
    for (const p of paras) {
      const t = typeof (p as { text?: unknown })?.text === "string" ? ((p as { text: string }).text).trim() : "";
      if (t.length > 1 && t.toUpperCase() !== (title ?? "").toUpperCase()) lines.push(t);
    }
  }
  return [title ?? "", sectionName ?? "", ...lines].filter(Boolean).join("\n");
}

let cache: PracticeEntry[] | null = null;

export async function loadPractices(force = false): Promise<PracticeEntry[]> {
  if (cache && !force) return cache;
  const rows = await db
    .select({
      id: practicesTable.id,
      ordinal: practicesTable.ordinal,
      chapter: practicesTable.chapter,
      sectionName: practicesTable.sectionName,
      title: practicesTable.title,
      paras: practicesTable.paras,
      embedding: practicesTable.embedding,
      reviewPart: practicesTable.reviewPart,
      reviewTags: practicesTable.reviewTags,
    })
    .from(practicesTable)
    .where(and(eq(practicesTable.kind, "practice"), inArray(practicesTable.chapter, EMBED_CHAPTERS)));
  cache = rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    chapter: r.chapter ?? "",
    sectionName: r.sectionName,
    title: r.title,
    text: practiceText(r.title, r.sectionName, r.paras),
    embedding: (r.embedding as number[] | null) ?? null,
    reviewPart: r.reviewPart,
    reviewTags: Array.isArray(r.reviewTags) ? (r.reviewTags as string[]) : [],
  }));
  return cache;
}

/** Top-k practices in a chapter (optionally filtered) by cosine similarity to the query vector. */
export function rankPractices(
  entries: PracticeEntry[],
  queryVec: number[],
  chapter: string,
  k: number,
  filter?: (e: PracticeEntry) => boolean,
): PracticeEntry[] {
  return entries
    // Coach uploads live in their own chapter but compete everywhere their
    // reviewPart tag allows (the usableFor filter locks them to their slot).
    .filter((e) => (e.chapter === chapter || (e.chapter === "Uploads" && e.reviewPart != null)) && e.embedding && (!filter || filter(e)))
    .map((e) => ({ e, score: cosine(queryVec, e.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.e);
}

/** Boot sync: embed any library practices that don't have an embedding yet. */
export async function syncPracticeEmbeddings(): Promise<void> {
  const pending = await db
    .select({
      id: practicesTable.id,
      title: practicesTable.title,
      sectionName: practicesTable.sectionName,
      paras: practicesTable.paras,
    })
    .from(practicesTable)
    .where(
      and(
        eq(practicesTable.kind, "practice"),
        inArray(practicesTable.chapter, EMBED_CHAPTERS),
        isNull(practicesTable.embedding),
      ),
    );
  if (pending.length > 0) {
    if (!process.env.OPENAI_API_KEY) {
      logger.warn({ pending: pending.length }, "Practices need embeddings but OPENAI_API_KEY is not set");
    } else {
      logger.info({ pending: pending.length }, "Embedding library practices...");
      const BATCH = 64;
      for (let i = 0; i < pending.length; i += BATCH) {
        const slice = pending.slice(i, i + BATCH);
        // Untitled variation slides can have no text at all — embed a minimal
        // placeholder so the API accepts the batch (they'll rank low, which is right).
        const vecs = await embedTexts(
          slice.map((r) => practiceText(r.title, r.sectionName, r.paras).slice(0, 24000) || `${r.sectionName ?? "practice"} (untitled variation slide)`),
        );
        for (let j = 0; j < slice.length; j++) {
          await db
            .update(practicesTable)
            .set({ embedding: vecs[j], updatedAt: sql`now()` })
            .where(eq(practicesTable.id, slice[j].id));
        }
      }
    }
  }
  await loadPractices(true);
  logger.info({ pending: pending.length }, "Practice embeddings sync complete");
}
