import { Router, type Request } from "express";
import {
  db, gpsSessionsTable, gpsPlayerAliasesTable, gpsPlayerPositionsTable, leaguesTable,
  gpsDevelopmentContextTable, gpsDevelopmentFeedbackTable, gpsDevelopmentReferencesTable,
} from "@workspace/db";
import { and, eq, desc, sql, getTableColumns } from "drizzle-orm";
import {
  GetGpsDevelopmentQueryParams, GetGpsDevelopmentResponse, CreateGpsDevelopmentFeedbackBody,
  CreateGpsDevelopmentFeedbackResponse, DeleteGpsDevelopmentFeedbackQueryParams,
  SaveGpsDevelopmentMatchContextBody, developmentGames, developmentProfile, developmentSummary,
  developmentMetrics, developmentSquad, type DevelopmentContext, type GpsDevelopmentGame,
  fixtureCode,
  type GpsDevelopmentExternal, type GpsDevelopmentProfile, type GpsDevelopmentPeer,
} from "@workspace/api-zod";
import { getSessionUser, hasModule } from "../middlewares/entryAuth";
import { focusClubForLeagueRequest } from "../lib/focusClub";
import { fixtureOpponentMap, ownFixtureOpponentMap } from "./gpsSessions";

const router = Router();

async function evidence(req: Request, leagueId: number, year: string, playerName?: string, squad?: string) {
  const user = await getSessionUser(req);
  if (!user || !hasModule(user, leagueId, "gps")) throw Object.assign(new Error("No access to GPS in this league"), { status: 403 });
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) throw Object.assign(new Error("League not found"), { status: 404 });
  const club = await focusClubForLeagueRequest(req, leagueId);
  const sourceId = league.gpsSourceLeagueId ?? leagueId;
  const [source] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, sourceId));
  // Legacy GPS uploads belong to the source league's focus club. Never expose
  // those rows to another club with a grant in the same league.
  const ownsData = club === (source?.focusClub ?? "Belconnen") && club === (league.focusClub ?? "Belconnen");
  const feedSquad = league.gpsSourceSquad;
  const canonicalName = sql<string>`coalesce(${gpsPlayerAliasesTable.canonical},${gpsSessionsTable.playerName})`;
  const [raw, positions, contexts, references] = await Promise.all([
    ownsData ? db.select({ ...getTableColumns(gpsSessionsTable), playerName: canonicalName }).from(gpsSessionsTable)
      .leftJoin(gpsPlayerAliasesTable, eq(gpsPlayerAliasesTable.alias, gpsSessionsTable.playerName))
      .where(eq(gpsSessionsTable.leagueId, sourceId)).orderBy(gpsSessionsTable.id) : Promise.resolve([]),
    db.select().from(gpsPlayerPositionsTable),
    db.select().from(gpsDevelopmentContextTable).where(and(eq(gpsDevelopmentContextTable.leagueId, sourceId), eq(gpsDevelopmentContextTable.club, club))),
    db.select().from(gpsDevelopmentReferencesTable).where(eq(gpsDevelopmentReferencesTable.population, "adult-male")),
  ]);
  const roles = new Map(positions.map(p => [p.playerName, p.role ?? (p.position === "GK" ? "GK" : null)]));
  const grouped = new Map<string, typeof raw>();
  const [sourceOpponents, feedOpponents] = await Promise.all([
    ownsData ? fixtureOpponentMap(sourceId) : Promise.resolve(new Map<string, string>()),
    feedSquad ? ownFixtureOpponentMap(leagueId) : Promise.resolve(new Map<string, string>()),
  ]);
  for (const r of raw) {
    const grade = developmentSquad(r.round);
    // Match the existing read-only feed: source firsts are accessible as the
    // explicit higher-grade comparison, never another unrelated squad.
    if (feedSquad && grade !== feedSquad && grade !== "1sts") continue;
    const code = fixtureCode(r.round);
    const opponent = feedSquad && grade === feedSquad
      ? code ? feedOpponents.get(`${r.year}|${code}`) ?? null : null
      : r.opponent ?? (code ? sourceOpponents.get(`${r.year}|${grade}|${code}`) ?? null : null);
    grouped.set(r.playerName, [...(grouped.get(r.playerName) ?? []), { ...r, opponent }]);
  }
  const byPlayer = new Map<string, GpsDevelopmentGame[]>();
  for (const [name, rows] of grouped) {
    if (name === "Unknown") continue;
    byPlayer.set(name, developmentGames(rows, roles.get(name) ?? null,
      contexts.filter(c => c.playerName === name) as DevelopmentContext[]));
  }
  const players = [...byPlayer].flatMap(([name, games]) => {
    const selected = games.filter(g => g.year === year && (!feedSquad || g.squad === feedSquad) && (!squad || squad === "__all__" || g.squad === squad));
    return selected.length ? [{ playerName: name, squad: selected.at(-1)!.squad, role: roles.get(name) ?? null, appearances: selected.length }] : [];
  }).sort((a, b) => a.playerName.localeCompare(b.playerName));
  const visible = new Set(players.map(p => p.playerName));
  let profile: GpsDevelopmentProfile | null = null;
  if (playerName) {
    if (!visible.has(playerName)) throw Object.assign(new Error("Player not found in this scope and season"), { status: 404 });
    const role = roles.get(playerName) ?? null;
    const games = byPlayer.get(playerName)!;
    const peers: GpsDevelopmentPeer[] = [];
    if (role && role !== "GK") {
      const grades = [...new Set([...byPlayer.values()].flatMap(gs => gs.filter(g => g.year === year).map(g => g.squad)))];
      for (const grade of grades) {
        const samples = [...byPlayer].flatMap(([name, gs]) => gs
          .filter(g => g.year === year && g.squad === grade && g.role === role && g.qualifies)
          .map(game => ({ name, game })));
        if (samples.length) peers.push({
          squad: grade, role, playerGames: samples.length, players: new Set(samples.map(s => s.name)).size,
          inferredRoles: samples.filter(s => s.game.roleSource === "default").length,
          metrics: developmentMetrics(role).map(m => developmentSummary(samples.map(s => s.game), m.id)),
        });
      }
    }
    // Never apply adult-male research to the women's competition.
    const isMens = /NPLM|Men|Male/i.test(source?.name ?? "") && !/Women|Female|NPLW/i.test(source?.name ?? "");
    const external = isMens ? references.filter(r => r.data.role === role).map(r => r.data as unknown as GpsDevelopmentExternal) : [];
    profile = developmentProfile(playerName, year, role, games, peers, external);
    if (feedSquad) profile.warnings.push("This is a read-only GPS feed. Edit match context and save feedback from the source league.");
  }
  const feedback = playerName ? await db.select().from(gpsDevelopmentFeedbackTable)
    .where(and(eq(gpsDevelopmentFeedbackTable.leagueId, leagueId), eq(gpsDevelopmentFeedbackTable.club, club),
      eq(gpsDevelopmentFeedbackTable.playerName, playerName)))
    .orderBy(desc(gpsDevelopmentFeedbackTable.createdAt)) : [];
  return { league, club, user, canEdit: ownsData && !league.gpsSourceLeagueId,
    years: [...new Set([...byPlayer.values()].flatMap(gs => gs.map(g => g.year)))].sort().reverse(),
    players, profile, feedback: feedback.map(f => ({ ...f, createdAt: f.createdAt.toISOString(), snapshot: f.snapshot as unknown as GpsDevelopmentProfile })) };
}

router.get("/gps-development", async (req, res) => {
  const parsed = GetGpsDevelopmentQueryParams.safeParse(req.query);
  if (!parsed.success || parsed.data.leagueId <= 0 || !/^20\d{2}$/.test(parsed.data.year)) return res.status(400).json({ error: "Valid leagueId and year are required" });
  const data = await evidence(req, parsed.data.leagueId, parsed.data.year, parsed.data.playerName, parsed.data.squad);
  return res.json(GetGpsDevelopmentResponse.parse(data));
});

router.post("/gps-development/feedback", async (req, res) => {
  const parsed = CreateGpsDevelopmentFeedbackBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  if (!d.note.trim() && !d.focus.trim()) return res.status(400).json({ error: "Add feedback or a development focus before saving" });
  if (d.reviewDate && (Number.isNaN(Date.parse(d.reviewDate)) || new Date(d.reviewDate).toISOString().slice(0, 10) !== d.reviewDate))
    return res.status(400).json({ error: "Review date must be a valid calendar date" });
  const data = await evidence(req, d.leagueId, d.year, d.playerName);
  if (!data.canEdit) return res.status(403).json({ error: "Save feedback from the GPS source league" });
  const [saved] = await db.insert(gpsDevelopmentFeedbackTable).values({
    leagueId: d.leagueId, club: data.club, playerName: d.playerName, year: d.year,
    note: d.note.trim(), focus: d.focus.trim(), reviewDate: d.reviewDate ?? null, createdBy: data.user.id,
    snapshot: JSON.parse(JSON.stringify(data.profile)) as Record<string, unknown>,
  }).returning();
  return res.status(201).json(CreateGpsDevelopmentFeedbackResponse.parse({ ...saved, createdAt: saved!.createdAt.toISOString() }));
});

router.delete("/gps-development/feedback", async (req, res) => {
  const parsed = DeleteGpsDevelopmentFeedbackQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { leagueId, id } = parsed.data;
  const data = await evidence(req, leagueId, String(new Date().getFullYear()));
  if (!data.canEdit) return res.status(403).json({ error: "Change feedback from the GPS source league" });
  const removed = await db.delete(gpsDevelopmentFeedbackTable)
    .where(and(eq(gpsDevelopmentFeedbackTable.id, id), eq(gpsDevelopmentFeedbackTable.leagueId, leagueId), eq(gpsDevelopmentFeedbackTable.club, data.club))).returning({ id: gpsDevelopmentFeedbackTable.id });
  if (!removed.length) return res.status(404).json({ error: "Feedback not found" });
  return res.sendStatus(204);
});

router.put("/gps-development/match-context", async (req, res) => {
  const parsed = SaveGpsDevelopmentMatchContextBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const data = await evidence(req, d.leagueId, d.year, d.playerName);
  if (!data.canEdit) return res.status(403).json({ error: "Edit match context from the GPS source league" });
  if (!data.profile?.games.some(g => g.year === d.year && g.round === d.round)) return res.status(404).json({ error: "Appearance not found" });
  await db.insert(gpsDevelopmentContextTable).values({ ...d, club: data.club }).onConflictDoUpdate({
    target: [gpsDevelopmentContextTable.leagueId, gpsDevelopmentContextTable.club, gpsDevelopmentContextTable.playerName, gpsDevelopmentContextTable.year, gpsDevelopmentContextTable.round],
    set: { role: d.role, matchType: d.matchType, comparable: d.comparable, updatedAt: new Date() },
  });
  return res.json({ ok: true });
});
export default router;