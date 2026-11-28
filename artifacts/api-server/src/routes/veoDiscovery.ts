import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, leaguesTable, seasonsTable, matchesTable, veoMatchesTable } from "@workspace/db";
import {
  DiscoverVeoRecordingsBody, DiscoverVeoRecordingsResponse,
  ImportVeoRecordingBody, ImportVeoRecordingResponse,
} from "@workspace/api-zod";
import { getSessionUser, canSeeYear } from "../middlewares/entryAuth";
import { defaultVeoCreds, listClubRecordings, listTeams, opponentFromVeoTitle } from "../lib/veo";
import { signRecording, verifyRecording } from "../lib/veoDiscovery";

const router = Router();

async function campaign(leagueId: number, seasonId: number) {
  const [row] = await db.select({
    year: seasonsTable.year, focusClub: leaguesTable.focusClub,
  }).from(seasonsTable).innerJoin(leaguesTable, eq(seasonsTable.leagueId, leaguesTable.id))
    .where(and(eq(seasonsTable.id, seasonId), eq(leaguesTable.id, leagueId))).limit(1);
  return row;
}

router.post("/entry/veo-discover", async (req, res): Promise<void> => {
  const input = DiscoverVeoRecordingsBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose a team and campaign first." }); return; }
  const { leagueId, seasonId } = input.data;
  const user = await getSessionUser(req);
  const scope = await campaign(leagueId, seasonId);
  if (!user || !scope || !canSeeYear(user, leagueId, scope.year, "data-entry")) {
    res.status(403).json({ error: "No access to this team and campaign." }); return;
  }
  if (!scope.focusClub) { res.status(400).json({ error: "This competition has no configured club." }); return; }
  const creds = defaultVeoCreds();
  const secret = process.env.SESSION_SECRET;
  if (!creds || !secret) { res.status(503).json({ error: "Veo connection is not configured." }); return; }
  // Only clubhouses already configured for this Hub club are trusted sources.
  const mappings = await db.select({ club: leaguesTable.veoClubSlug })
    .from(leaguesTable).where(eq(leaguesTable.focusClub, scope.focusClub));
  const clubs = [...new Set(mappings.map(r => r.club).filter((s): s is string => !!s))];
  if (!clubs.length) { res.status(400).json({ error: "No shared Veo sources are configured for this club." }); return; }
  const existing = await db.select({
    recordingId: veoMatchesTable.veoMatchId, removedAt: veoMatchesTable.removedAt,
  }).from(veoMatchesTable).innerJoin(leaguesTable, eq(veoMatchesTable.leagueId, leaguesTable.id))
    .where(eq(leaguesTable.focusClub, scope.focusClub));
  const fixtures = await db.select({
    id: matchesTable.id, opponent: matchesTable.opponent, matchDate: matchesTable.matchDate,
  }).from(matchesTable).where(eq(matchesTable.seasonId, seasonId));
  const recordings: Array<{
    token: string; recordingId: string; title: string; startsAt: string | null;
    source: string; team: string; imported: boolean; removed: boolean;
  }> = [];
  const sourcesChecked: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const club of clubs) {
    try {
      const teams = await listTeams(creds, club);
      const rows = await listClubRecordings(creds, club);
      sourcesChecked.push(club);
      let unresolved = 0;
      for (const rec of rows) {
        if (!rec.identifier || seen.has(rec.identifier)) continue;
        const rawTeam = rec.team as unknown;
        const teamKey = typeof rawTeam === "string" ? rawTeam
          : rawTeam && typeof rawTeam === "object" ? (rawTeam as { slug?: string; id?: string }).slug ?? (rawTeam as { id?: string }).id : undefined;
        const exact = teams.filter(t => t.slug === teamKey || t.id === teamKey);
        const byName = teams.filter(t => t.name === teamKey || t.name === rec.team__name);
        const candidates = exact.length ? exact : byName;
        const team = candidates.length === 1 ? candidates[0] : undefined;
        // Team UUID is mandatory: the wrong UUID silently misattributes player analytics.
        if (!team?.id || !team.slug) {
          unresolved++;
          continue;
        }
        seen.add(rec.identifier);
        const previous = existing.filter(r => r.recordingId === rec.identifier);
        recordings.push({
          recordingId: rec.identifier, title: rec.title ?? "Untitled recording",
          startsAt: rec.start ?? null, source: club, team: team.name || team.slug,
          imported: previous.some(r => !r.removedAt), removed: previous.length > 0 && previous.every(r => !!r.removedAt),
          token: signRecording({
            userId: user.id, leagueId, seasonId, expiresAt: Date.now() + 30 * 60_000,
            recordingId: rec.identifier, title: rec.title ?? "Untitled recording",
            startsAt: rec.start ?? null, clubSlug: club, teamSlug: team.slug, teamId: team.id,
          }, secret),
        });
      }
      if (unresolved) warnings.push(`${club}: ${unresolved} recordings have no uniquely identifiable Veo team and were left out to protect player analytics.`);
    } catch (err) {
      req.log.warn({ err, club }, "veo: shared-source discovery failed");
      warnings.push(`${club}: could not check this source. Try Fetch new videos again.`);
    }
  }
  recordings.sort((a, b) => (b.startsAt ?? "").localeCompare(a.startsAt ?? ""));
  res.json(DiscoverVeoRecordingsResponse.parse({ recordings, sourcesChecked, warnings, fixtures, campaignYear: scope.year }));
});

router.post("/entry/veo-import", async (req, res): Promise<void> => {
  const input = ImportVeoRecordingBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Invalid recording confirmation." }); return; }
  const { leagueId, seasonId, token, matchId } = input.data;
  const user = await getSessionUser(req);
  const scope = await campaign(leagueId, seasonId);
  if (!user || !scope || !canSeeYear(user, leagueId, scope.year, "data-entry")) {
    res.status(403).json({ error: "No access to this team and campaign." }); return;
  }
  const value = process.env.SESSION_SECRET && verifyRecording(token, process.env.SESSION_SECRET, { userId: user.id, leagueId, seasonId });
  if (!scope.focusClub) { res.status(400).json({ error: "This competition has no configured club." }); return; }
  if (!value) { res.status(400).json({ error: "This preview expired or belongs to another team/campaign. Fetch new videos again." }); return; }
  if (matchId != null) {
    const [match] = await db.select({ id: matchesTable.id }).from(matchesTable)
      .where(and(eq(matchesTable.id, matchId), eq(matchesTable.seasonId, seasonId))).limit(1);
    if (!match) { res.status(400).json({ error: "That fixture does not belong to this team and campaign." }); return; }
  }
  try {
    const veoId = await db.transaction(async tx => {
      // Serialize the same recording across all teams, not just within one league.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${value.recordingId}))`);
      const [previous] = await tx.select({ id: veoMatchesTable.id }).from(veoMatchesTable)
        .innerJoin(leaguesTable, eq(veoMatchesTable.leagueId, leaguesTable.id))
        .where(and(eq(veoMatchesTable.veoMatchId, value.recordingId), eq(leaguesTable.focusClub, scope.focusClub!))).limit(1);
      if (previous) throw new Error("ALREADY_IMPORTED");
      if (matchId != null) {
        const [linked] = await tx.select({ id: veoMatchesTable.id }).from(veoMatchesTable)
          .where(and(eq(veoMatchesTable.leagueId, leagueId), eq(veoMatchesTable.matchId, matchId), sql`${veoMatchesTable.removedAt} IS NULL`)).limit(1);
        if (linked) throw new Error("FIXTURE_LINKED");
      }
      const [saved] = await tx.insert(veoMatchesTable).values({
        leagueId, veoMatchId: value.recordingId, veoTeamSlug: value.teamSlug,
        title: value.title, opponent: opponentFromVeoTitle(value.title), startsAt: value.startsAt,
        matchId: matchId ?? null, confirmedSource: {
          clubSlug: value.clubSlug, teamSlug: value.teamSlug, teamId: value.teamId, campaignYear: scope.year,
        }, syncedAt: new Date().toISOString(),
      }).returning({ id: veoMatchesTable.id });
      return saved.id;
    });
    res.json(ImportVeoRecordingResponse.parse({ ok: true, veoId }));
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_IMPORTED") {
      res.status(409).json({ error: "This recording is already saved or archived in the Hub. It has not been imported again." }); return;
    }
    if (err instanceof Error && err.message === "FIXTURE_LINKED" || (err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "This fixture already has a recording. Use Match links to review it; nothing was replaced." }); return;
    }
    throw err;
  }
});

export default router;
