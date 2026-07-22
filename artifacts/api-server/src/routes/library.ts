import { Router, type IRouter } from "express";
import { eq, and, asc, desc, sql, type SQL } from "drizzle-orm";
import { db, practicesTable, practiceVariationsTable } from "@workspace/db";
import {
  ListLibraryPracticesResponse,
  ListPracticeVariationsResponse,
  FlagLibraryPracticeBody,
  FlagLibraryPracticeResponse,
  ReviewLibraryPracticeBody,
  ReviewLibraryPracticeResponse,
  UploadLibraryPracticeBody,
  UploadLibraryPracticeResponse,
} from "@workspace/api-zod";
import { invalidatePracticeCache, practiceText } from "../assistant/practiceStore";
import { embedTexts } from "../assistant/curriculumStore";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Practice library (extracted from the coaching slide deck) ────────────────
router.get("/library/practices", async (req, res): Promise<void> => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : "practice";
  const chapter = typeof req.query.chapter === "string" ? req.query.chapter : undefined;
  const sectionCode = typeof req.query.sectionCode === "string" ? req.query.sectionCode : undefined;

  const filters: SQL[] = [];
  if (kind !== "all") filters.push(eq(practicesTable.kind, kind));
  if (chapter) filters.push(eq(practicesTable.chapter, chapter));
  if (sectionCode) filters.push(eq(practicesTable.sectionCode, sectionCode));

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(practicesTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(practicesTable.ordinal)),
    db
      .select({
        practiceId: practiceVariationsTable.practiceId,
        part: practiceVariationsTable.part,
        n: sql<number>`count(*)::int`,
      })
      .from(practiceVariationsTable)
      .groupBy(practiceVariationsTable.practiceId, practiceVariationsTable.part),
  ]);
  const counts = new Map<number, number>();
  const parts = new Map<number, string[]>();
  for (const c of countRows) {
    counts.set(c.practiceId, (counts.get(c.practiceId) ?? 0) + c.n);
    if (c.part) {
      const list = parts.get(c.practiceId) ?? [];
      list.push(c.part);
      parts.set(c.practiceId, list);
    }
  }

  res.json(ListLibraryPracticesResponse.parse(rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    kind: r.kind,
    chapter: r.chapter,
    sectionCode: r.sectionCode,
    sectionName: r.sectionName,
    title: r.title,
    paras: r.paras,
    diagram: r.diagram,
    needsReview: r.needsReview,
    variationCount: counts.get(r.id) ?? 0,
    variationParts: parts.get(r.id) ?? [],
    reviewCrops: Array.isArray(r.reviewCrop) ? r.reviewCrop : r.reviewCrop ? [r.reviewCrop] : [],
    reviewPart: r.reviewPart,
    reviewTags: Array.isArray(r.reviewTags) ? r.reviewTags : [],
  }))));
});

router.get("/library/practices/:id/variations", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid practice id" });
    return;
  }
  const rows = await db
    .select()
    .from(practiceVariationsTable)
    .where(eq(practiceVariationsTable.practiceId, id))
    .orderBy(desc(practiceVariationsTable.sessionDate), desc(practiceVariationsTable.id));
  res.json(ListPracticeVariationsResponse.parse(rows));
});

// Coach-uploaded diagrams: an image plus part/tags, saved as a fully-reviewed
// practice in the "Uploads" chapter. Ordinals start at 100000 so deck re-imports
// (which upsert by ordinal) can never collide with uploads.
const UPLOAD_ORDINAL_BASE = 100000;

router.post("/library/practices/upload", async (req, res): Promise<void> => {
  const body = UploadLibraryPracticeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { title, part, tags, notes, imageDataUri, canvas } = body.data;
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(imageDataUri)) {
    res.status(400).json({ error: "imageDataUri must be a base64 PNG/JPEG/WebP/GIF data URI" });
    return;
  }
  if (!(canvas.w > 0 && canvas.h > 0)) {
    res.status(400).json({ error: "canvas dimensions must be positive" });
    return;
  }

  const paras = notes?.trim() ? [{ text: notes.trim() }] : [];
  // Embed now so the generator can pick it without waiting for a reboot.
  let embedding: number[] | null = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      [embedding] = await embedTexts([practiceText(title, null, paras) || title]);
    } catch (err) {
      logger.warn({ err }, "Upload embed failed — will be embedded at next boot");
    }
  }

  const [row] = await db
    .insert(practicesTable)
    .values({
      ordinal: sql`GREATEST((SELECT COALESCE(MAX(ordinal), 0) + 1 FROM practices), ${UPLOAD_ORDINAL_BASE})`,
      kind: "practice",
      chapter: "Uploads",
      sectionCode: null,
      sectionName: "Coach uploads",
      title,
      paras,
      diagram: { img: imageDataUri, canvas: { w: Math.round(canvas.w), h: Math.round(canvas.h) } },
      sourceFile: "coach-upload",
      embedding,
      reviewPart: part,
      reviewTags: tags,
      reviewCrop: [],
      reviewedAt: new Date(),
    })
    .returning({ id: practicesTable.id });

  invalidatePracticeCache();
  res.json(UploadLibraryPracticeResponse.parse({ id: row.id }));
});

router.patch("/library/practices/:id/flag", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid practice id" });
    return;
  }
  const body = FlagLibraryPracticeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(practicesTable)
    .set({ needsReview: body.data.needsReview })
    .where(eq(practicesTable.id, id))
    .returning({ id: practicesTable.id, needsReview: practicesTable.needsReview });
  if (!row) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  res.json(FlagLibraryPracticeResponse.parse(row));
});

router.patch("/library/practices/:id/review", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid practice id" });
    return;
  }
  const body = ReviewLibraryPracticeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(practicesTable)
    .set({
      reviewPart: body.data.part,
      reviewTags: body.data.tags,
      reviewCrop: body.data.crops && body.data.crops.length ? body.data.crops : null,
      reviewedAt: new Date(),
    })
    .where(eq(practicesTable.id, id))
    .returning({
      id: practicesTable.id,
      reviewPart: practicesTable.reviewPart,
      reviewTags: practicesTable.reviewTags,
      reviewCrop: practicesTable.reviewCrop,
    });
  if (!row) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  invalidatePracticeCache();
  res.json(ReviewLibraryPracticeResponse.parse({
    id: row.id,
    reviewPart: row.reviewPart,
    reviewTags: Array.isArray(row.reviewTags) ? row.reviewTags : [],
    reviewCrops: Array.isArray(row.reviewCrop) ? row.reviewCrop : row.reviewCrop ? [row.reviewCrop] : [],
  }));
});

export default router;
