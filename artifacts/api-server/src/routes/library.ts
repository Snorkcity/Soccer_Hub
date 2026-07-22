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
} from "@workspace/api-zod";
import { invalidatePracticeCache } from "../assistant/practiceStore";

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
    reviewCrop: r.reviewCrop ?? null,
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
      reviewCrop: body.data.crop ?? null,
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
    reviewCrop: row.reviewCrop ?? null,
  }));
});

export default router;
