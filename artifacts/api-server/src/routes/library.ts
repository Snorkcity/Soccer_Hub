import { Router, type IRouter } from "express";
import { eq, and, asc, type SQL } from "drizzle-orm";
import { db, practicesTable } from "@workspace/db";
import {
  ListLibraryPracticesResponse,
  FlagLibraryPracticeBody,
  FlagLibraryPracticeResponse,
} from "@workspace/api-zod";

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

  const rows = await db
    .select()
    .from(practicesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(practicesTable.ordinal));

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
  }))));
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

export default router;
