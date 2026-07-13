import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, matchesTable } from "@workspace/db";
import {
  ListMatchesQueryParams,
  ListMatchesResponse,
  CreateMatchBody,
  CreateMatchResponse,
  GetMatchParams,
  GetMatchResponse,
  UpdateMatchParams,
  UpdateMatchBody,
  UpdateMatchResponse,
} from "@workspace/api-zod";

/** Convert a number|null|undefined to string|null for Drizzle numeric columns */
const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));

const router: IRouter = Router();

router.get("/matches", async (req, res): Promise<void> => {
  const query = ListMatchesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId, limit } = query.data;

  let q = db.select().from(matchesTable).$dynamic();
  const conditions = [];
  if (teamId) conditions.push(eq(matchesTable.teamId, teamId));
  if (seasonId) conditions.push(eq(matchesTable.seasonId, seasonId));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(matchesTable.matchDate));
  if (limit) q = q.limit(limit);

  const rows = await q;
  const mapped = rows.map(r => ({
    ...r,
    possession: r.possession != null ? parseFloat(r.possession) : null,
    result: computeResult(r.goalsScored, r.goalsConceded),
  }));
  res.json(ListMatchesResponse.parse(mapped));
});

router.post("/matches", async (req, res): Promise<void> => {
  const parsed = CreateMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [match] = await db.insert(matchesTable).values({ ...parsed.data, possession: n2s(parsed.data.possession) }).returning();
  res.status(201).json(CreateMatchResponse.parse({ ...match, result: computeResult(match.goalsScored, match.goalsConceded), possession: match.possession != null ? parseFloat(match.possession) : null }));
});

router.get("/matches/:id", async (req, res): Promise<void> => {
  const params = GetMatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, params.data.id));
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.json(GetMatchResponse.parse({ ...match, result: computeResult(match.goalsScored, match.goalsConceded), possession: match.possession != null ? parseFloat(match.possession) : null }));
});

router.patch("/matches/:id", async (req, res): Promise<void> => {
  const params = UpdateMatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [match] = await db.update(matchesTable).set({ ...parsed.data, possession: n2s(parsed.data.possession) }).where(eq(matchesTable.id, params.data.id)).returning();
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.json(UpdateMatchResponse.parse({ ...match, result: computeResult(match.goalsScored, match.goalsConceded), possession: match.possession != null ? parseFloat(match.possession) : null }));
});

function computeResult(goalsScored: number | null, goalsConceded: number | null): string | null {
  if (goalsScored == null || goalsConceded == null) return null;
  if (goalsScored > goalsConceded) return "W";
  if (goalsScored < goalsConceded) return "L";
  return "D";
}

export default router;
