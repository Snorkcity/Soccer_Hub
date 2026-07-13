import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, goalsTable } from "@workspace/db";

const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));
import {
  ListGoalsQueryParams,
  ListGoalsResponse,
  CreateGoalBody,
  CreateGoalResponse,
  UpdateGoalParams,
  UpdateGoalBody,
  UpdateGoalResponse,
  DeleteGoalParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/goals", async (req, res): Promise<void> => {
  const query = ListGoalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { matchId, teamId, seasonId, scorerTeam } = query.data;

  const conditions = [];
  if (matchId) conditions.push(eq(goalsTable.matchId, matchId));
  if (teamId) conditions.push(eq(goalsTable.teamId, teamId));
  if (seasonId) conditions.push(eq(goalsTable.seasonId, seasonId));
  if (scorerTeam) conditions.push(eq(goalsTable.scorerTeam, scorerTeam));

  const rows = await db
    .select()
    .from(goalsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(goalsTable.minuteScored);

  const mapped = rows.map(r => ({
    ...r,
    goalX: r.goalX != null ? parseFloat(r.goalX) : null,
    goalY: r.goalY != null ? parseFloat(r.goalY) : null,
  }));

  res.json(ListGoalsResponse.parse(mapped));
});

router.post("/goals", async (req, res): Promise<void> => {
  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [goal] = await db.insert(goalsTable).values({ ...parsed.data, goalX: n2s(parsed.data.goalX), goalY: n2s(parsed.data.goalY) }).returning();
  res.status(201).json(CreateGoalResponse.parse({ ...goal, goalX: goal.goalX != null ? parseFloat(goal.goalX) : null, goalY: goal.goalY != null ? parseFloat(goal.goalY) : null }));
});

router.patch("/goals/:id", async (req, res): Promise<void> => {
  const params = UpdateGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [goal] = await db.update(goalsTable).set({ ...parsed.data, goalX: n2s(parsed.data.goalX), goalY: n2s(parsed.data.goalY) }).where(eq(goalsTable.id, params.data.id)).returning();
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  res.json(UpdateGoalResponse.parse({ ...goal, goalX: goal.goalX != null ? parseFloat(goal.goalX) : null, goalY: goal.goalY != null ? parseFloat(goal.goalY) : null }));
});

router.delete("/goals/:id", async (req, res): Promise<void> => {
  const params = DeleteGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [goal] = await db.delete(goalsTable).where(eq(goalsTable.id, params.data.id)).returning();
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
