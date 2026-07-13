import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, athleticTestsTable } from "@workspace/db";

const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));
import {
  ListAthleticTestsQueryParams,
  ListAthleticTestsResponse,
  CreateAthleticTestBody,
  CreateAthleticTestResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const p = (v: string | null | undefined) => (v != null ? parseFloat(v) : null);

function mapRow(r: typeof athleticTestsTable.$inferSelect) {
  return {
    ...r,
    verticalStart: p(r.verticalStart),
    verticalM: p(r.verticalM),
    verticalTotal: p(r.verticalTotal),
    horizontalM: p(r.horizontalM),
    balsomS: p(r.balsomS),
    split010: p(r.split010),
    split1020: p(r.split1020),
    split2030: p(r.split2030),
    total30m: p(r.total30m),
  };
}

router.get("/athletic-tests", async (req, res): Promise<void> => {
  const query = ListAthleticTestsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { playerId, year, teamId } = query.data;

  const conditions = [];
  if (playerId) conditions.push(eq(athleticTestsTable.playerId, playerId));
  if (year) conditions.push(eq(athleticTestsTable.year, year));
  if (teamId) conditions.push(eq(athleticTestsTable.teamId, teamId));

  const rows = await db
    .select()
    .from(athleticTestsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(athleticTestsTable.playerName);

  res.json(ListAthleticTestsResponse.parse(rows.map(mapRow)));
});

router.post("/athletic-tests", async (req, res): Promise<void> => {
  const parsed = CreateAthleticTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [test] = await db.insert(athleticTestsTable).values({
    ...d,
    verticalStart: n2s(d.verticalStart), verticalM: n2s(d.verticalM), verticalTotal: n2s(d.verticalTotal),
    horizontalM: n2s(d.horizontalM), balsomS: n2s(d.balsomS),
    split010: n2s(d.split010), split1020: n2s(d.split1020), split2030: n2s(d.split2030), total30m: n2s(d.total30m),
  }).returning();
  res.status(201).json(CreateAthleticTestResponse.parse(mapRow(test)));
});

export default router;
