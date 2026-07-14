import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  leagueMatchesTable,
  leagueGoalsTable,
  leaguePlayerStatsTable,
  matchesTable,
  goalsTable,
  playerStatsTable,
  playersTable,
} from "@workspace/db";
import {
  ListLeagueMatchesQueryParams,
  ListLeagueMatchesResponse,
  GetGoalOptionsQueryParams,
  GetGoalOptionsResponse,
  CreateEntryMatchBody,
  CreateEntryMatchResponse,
  CreateEntryGoalBody,
  CreateEntryGoalResponse,
  SaveEntryPlayerStatsBody,
  SaveEntryPlayerStatsResponse,
  ExtractPlayersFromImageBody,
  ExtractPlayersFromImageResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const FOCUS_CLUB = "Belconnen";
const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));

// ── League fixtures (entry pickers) ──────────────────────────────────────────
router.get("/entry/league-matches", async (req, res): Promise<void> => {
  const query = ListLeagueMatchesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, query.data.seasonId))
    .orderBy(desc(leagueMatchesTable.matchDate));
  res.json(ListLeagueMatchesResponse.parse(rows.map(r => ({
    id: r.id, matchId: r.matchId, matchDate: r.matchDate,
    homeTeam: r.homeTeam, awayTeam: r.awayTeam, fullScore: r.fullScore,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals,
  }))));
});

// ── Dropdown vocabulary (keeps spellings consistent with existing data) ──────
router.get("/entry/goal-options", async (req, res): Promise<void> => {
  const query = GetGoalOptionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId } = query.data;

  const distinct = (values: (string | null)[]): string[] =>
    Array.from(new Set(values.filter((v): v is string => !!v && v.trim().length > 0))).sort();

  const goalRows = await db
    .select({
      goalType: leagueGoalsTable.goalType,
      assistType: leagueGoalsTable.assistType,
      howPenetrated: leagueGoalsTable.howPenetrated,
      buildupLane: leagueGoalsTable.buildupLane,
      finishType: leagueGoalsTable.finishType,
    })
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));

  const matchRows = await db
    .select({
      conditions: matchesTable.conditions,
      venue: matchesTable.venue,
      formation: matchesTable.formation,
      oppFormation: matchesTable.oppFormation,
    })
    .from(matchesTable)
    .where(eq(matchesTable.seasonId, seasonId));

  res.json(GetGoalOptionsResponse.parse({
    goalTypes: distinct(goalRows.map(r => r.goalType)),
    assistTypes: distinct(goalRows.map(r => r.assistType)),
    howPenetrated: distinct(goalRows.map(r => r.howPenetrated)),
    buildupLanes: distinct(goalRows.map(r => r.buildupLane)),
    finishTypes: distinct(goalRows.map(r => r.finishType)),
    conditions: distinct(matchRows.map(r => r.conditions)),
    venues: distinct(matchRows.map(r => r.venue)),
    formations: distinct([...matchRows.map(r => r.formation), ...matchRows.map(r => r.oppFormation)]),
  }));
});

// ── Record a fixture ──────────────────────────────────────────────────────────
// Writes league_matches always; when Belconnen is one of the two clubs, also
// writes the Belconnen `matches` row (with the Veo team stats) so the coach
// never enters the same fixture twice.
router.post("/entry/match", async (req, res): Promise<void> => {
  const parsed = CreateEntryMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  if (b.homeTeam.trim() === b.awayTeam.trim()) {
    res.status(400).json({ error: "Home and away team must be different clubs" });
    return;
  }

  const [existing] = await db
    .select({ id: leagueMatchesTable.id })
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, b.matchId), eq(leagueMatchesTable.seasonId, b.seasonId)));
  if (existing) {
    res.status(409).json({ error: `Match ID "${b.matchId}" already exists this season` });
    return;
  }

  const fullScore = `${b.homeGoals}-${b.awayGoals}`;
  // Single transaction: the league row and the Belconnen row commit together or not at all
  const { leagueMatch, belconnenMatchId } = await db.transaction(async (tx) => {
    const [leagueMatch] = await tx.insert(leagueMatchesTable).values({
      matchId: b.matchId,
      matchDate: b.matchDate,
      homeTeam: b.homeTeam.trim(),
      awayTeam: b.awayTeam.trim(),
      fullScore,
      halfScore: b.halfScore ?? null,
      homeGoals: b.homeGoals,
      awayGoals: b.awayGoals,
      seasonId: b.seasonId,
    }).returning();

    let belconnenMatchId: number | null = null;
    const isHome = b.homeTeam.trim() === FOCUS_CLUB;
    const isAway = b.awayTeam.trim() === FOCUS_CLUB;
    if (isHome || isAway) {
      const goalsScored = isHome ? b.homeGoals : b.awayGoals;
      const goalsConceded = isHome ? b.awayGoals : b.homeGoals;
      const [match] = await tx.insert(matchesTable).values({
      matchId: b.matchId,
      matchDate: b.matchDate,
      venue: b.venue ?? null,
      opponent: isHome ? b.awayTeam.trim() : b.homeTeam.trim(),
      halfScore: b.halfScore ?? null,
      fullScore,
      goalsScored,
      goalsConceded,
      cleanSheet: goalsConceded === 0,
      formation: b.formation ?? null,
      oppFormation: b.oppFormation ?? null,
      conditions: b.conditions ?? null,
      possession: n2s(b.possession),
      shots: b.shots ?? null,
      passes: b.passes ?? null,
      oppShots: b.oppShots ?? null,
      oppPasses: b.oppPasses ?? null,
      teamId: b.teamId,
      seasonId: b.seasonId,
    }).returning();
      belconnenMatchId = match.id;
    }
    return { leagueMatch, belconnenMatchId };
  });

  res.status(201).json(CreateEntryMatchResponse.parse({
    leagueMatchId: leagueMatch.id,
    belconnenMatchId,
    fullScore,
  }));
});

// ── Record a goal ─────────────────────────────────────────────────────────────
// Writes league_goals always; when the fixture involves Belconnen, duplicates
// the row into the legacy Belconnen `goals` table (keyed by matches.id) so the
// team-tab charts keep working without re-entry.
router.post("/entry/goal", async (req, res): Promise<void> => {
  const parsed = CreateEntryGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, b.matchId), eq(leagueMatchesTable.seasonId, b.seasonId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture with Match ID "${b.matchId}" this season — record the match first` });
    return;
  }
  if (b.scorerTeam !== fixture.homeTeam && b.scorerTeam !== fixture.awayTeam) {
    res.status(400).json({ error: `Scorer team must be ${fixture.homeTeam} or ${fixture.awayTeam}` });
    return;
  }

  const detail = {
    matchDate: fixture.matchDate,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    scorerTeam: b.scorerTeam,
    minuteScored: b.minuteScored ?? null,
    scorer: b.scorer ?? null,
    assist: b.assist ?? null,
    goalType: b.goalType ?? null,
    assistType: b.assistType ?? null,
    howPenetrated: b.howPenetrated ?? null,
    buildupLane: b.buildupLane ?? null,
    firstTimeFinish: b.firstTimeFinish ?? null,
    finishType: b.finishType ?? null,
    passString: b.passString ?? null,
  };

  // Single transaction: league goal + legacy Belconnen copy commit together
  const { leagueGoal, belconnenGoalId } = await db.transaction(async (tx) => {
    const [leagueGoal] = await tx.insert(leagueGoalsTable).values({
      matchId: b.matchId,
      ...detail,
      goalX: n2s(b.goalX),
      goalY: n2s(b.goalY),
      seasonId: b.seasonId,
    }).returning();

    let belconnenGoalId: number | null = null;
    if (fixture.homeTeam === FOCUS_CLUB || fixture.awayTeam === FOCUS_CLUB) {
      const [match] = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(and(
          eq(matchesTable.matchId, b.matchId),
          eq(matchesTable.seasonId, b.seasonId),
          eq(matchesTable.teamId, b.teamId),
        ));
      if (match) {
        const [goal] = await tx.insert(goalsTable).values({
          matchId: match.id,
          ...detail,
          goalX: n2s(b.goalX),
          goalY: n2s(b.goalY),
          teamId: b.teamId,
          seasonId: b.seasonId,
        }).returning();
        belconnenGoalId = goal.id;
      } else {
        logger.warn({ matchId: b.matchId }, "Belconnen fixture missing from matches table — goal saved to league only");
      }
    }
    return { leagueGoal, belconnenGoalId };
  });

  res.status(201).json(CreateEntryGoalResponse.parse({
    leagueGoalId: leagueGoal.id,
    belconnenGoalId,
  }));
});

// ── Save player rows for one club in one match ────────────────────────────────
// Replace semantics: re-saving the same match+club overwrites the previous rows,
// so a re-upload after a fix never double-counts. When the fixture involves
// Belconnen, rows are mirrored into the legacy player_stats table (per-player
// FK), creating players on first sight.
router.post("/entry/player-stats", async (req, res): Promise<void> => {
  const parsed = SaveEntryPlayerStatsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, b.matchId), eq(leagueMatchesTable.seasonId, b.seasonId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture with Match ID "${b.matchId}" this season — record the match first` });
    return;
  }
  if (b.club !== fixture.homeTeam && b.club !== fixture.awayTeam) {
    res.status(400).json({ error: `Club must be ${fixture.homeTeam} or ${fixture.awayTeam}` });
    return;
  }
  if (b.rows.length === 0) {
    res.status(400).json({ error: "No player rows to save" });
    return;
  }
  const names = b.rows.map(r => r.playerName.trim());
  if (new Set(names).size !== names.length) {
    res.status(400).json({ error: "Duplicate player names in the rows — each player should appear once" });
    return;
  }

  const year = b.year ?? (fixture.matchDate ? fixture.matchDate.slice(0, 4) : null);

  // Single transaction: replace (delete+insert) both the league rows and the
  // legacy mirror atomically — a failed insert can never wipe existing rows.
  const { replaced, belconnenCopies } = await db.transaction(async (tx) => {
    const replaced = (await tx
      .delete(leaguePlayerStatsTable)
      .where(and(
        eq(leaguePlayerStatsTable.matchId, b.matchId),
        eq(leaguePlayerStatsTable.seasonId, b.seasonId),
        eq(leaguePlayerStatsTable.club, b.club),
      ))
      .returning({ id: leaguePlayerStatsTable.id })).length;

    await tx.insert(leaguePlayerStatsTable).values(b.rows.map(r => ({
      matchId: b.matchId,
      playerName: r.playerName.trim(),
      minsPlayed: r.minsPlayed ?? null,
      position: r.position ?? null,
      discipline: r.discipline ?? null,
      started: r.started,
      appearance: r.appearance,
      club: b.club,
      year,
      seasonId: b.seasonId,
    })));

    // Mirror into the legacy Belconnen-scoped table when this fixture is a
    // Belconnen game (it stores BOTH teams' rows for those games).
    let belconnenCopies = 0;
    if (fixture.homeTeam === FOCUS_CLUB || fixture.awayTeam === FOCUS_CLUB) {
      const [match] = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(and(
          eq(matchesTable.matchId, b.matchId),
          eq(matchesTable.seasonId, b.seasonId),
          eq(matchesTable.teamId, b.teamId),
        ));
      if (match) {
        await tx.delete(playerStatsTable).where(and(
          eq(playerStatsTable.matchId, match.id),
          eq(playerStatsTable.club, b.club),
        ));
        for (const r of b.rows) {
          const name = r.playerName.trim();
          let [player] = await tx
            .select({ id: playersTable.id })
            .from(playersTable)
            .where(and(eq(playersTable.name, name), eq(playersTable.club, b.club)));
          if (!player) {
            [player] = await tx.insert(playersTable).values({
              name,
              position: r.position ?? null,
              club: b.club,
            }).returning({ id: playersTable.id });
          }
          await tx.insert(playerStatsTable).values({
            matchId: match.id,
            playerId: player.id,
            playerName: name,
            minsPlayed: r.minsPlayed ?? null,
            position: r.position ?? null,
            discipline: r.discipline ?? null,
            started: r.started,
            appearance: r.appearance,
            club: b.club,
            year,
          });
          belconnenCopies++;
        }
      } else {
        logger.warn({ matchId: b.matchId }, "Belconnen fixture missing from matches table — player rows saved to league only");
      }
    }
    return { replaced, belconnenCopies };
  });

  res.json(SaveEntryPlayerStatsResponse.parse({
    saved: b.rows.length,
    replaced,
    belconnenCopies,
  }));
});

// ── AI screenshot reader ──────────────────────────────────────────────────────
// Sends the Dribl team-sheet screenshot to a vision model and returns rows for
// the coach to review — nothing is saved here.
router.post("/entry/extract-players", async (req, res): Promise<void> => {
  const parsed = ExtractPlayersFromImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Screenshot reader is not configured on this server (no AI credentials). Enter rows manually." });
    return;
  }

  const raw = parsed.data.imageBase64;
  const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;

  const prompt = [
    "You are reading a screenshot of a football (soccer) team sheet from the Dribl app or a similar match-day listing.",
    parsed.data.club ? `The screenshot is the team sheet for the club "${parsed.data.club}".` : "",
    "Extract EVERY player row you can see and return STRICT JSON only (no markdown, no commentary) in this exact shape:",
    `{"rows":[{"playerName":"...","minsPlayed":90,"position":"GK","discipline":null,"started":true,"appearance":true}],"warnings":["..."]}`,
    "Rules:",
    "- playerName: format as first-initial dot surname, e.g. \"J.Bloggs\", whenever a first name or initial is visible. Never return a bare surname if any first-name information is shown. If only a surname is visible, return the surname and add a warning naming that player.",
    "- minsPlayed: integer minutes if shown, otherwise null. Do not guess.",
    "- position: the position shown (GK, RB, CB, LB, DM, CM, AM, ST, F, etc.), otherwise null.",
    "- discipline: card info if shown (e.g. \"Yellow\", \"Red\"), otherwise null.",
    "- started: true if the player is in the starting lineup section, false if listed as a substitute/bench.",
    "- appearance: true if the player actually took the field (starters, and substitutes shown as having come on). Unused bench players: appearance false.",
    "- If the screenshot distinguishes starters from bench, use it. If it does not, set started=true for the first 11 and add a warning.",
    "- Add a warning for anything unreadable, ambiguous, cut off, or any duplicate names.",
  ].filter(Boolean).join("\n");

  try {
    const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_completion_tokens: 8192,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!aiRes.ok) {
      const text = await aiRes.text();
      logger.error({ status: aiRes.status, text: text.slice(0, 500) }, "AI extraction request failed");
      res.status(502).json({ error: "The screenshot reader had a problem — try again, or enter rows manually" });
      return;
    }
    const payload = await aiRes.json() as { choices?: { message?: { content?: string } }[] };
    let content = payload.choices?.[0]?.message?.content ?? "";
    content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const extracted = JSON.parse(content) as { rows?: unknown[]; warnings?: unknown[] };

    const result = ExtractPlayersFromImageResponse.safeParse({
      rows: (extracted.rows ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          playerName: String(row.playerName ?? "").trim(),
          minsPlayed: typeof row.minsPlayed === "number" && Number.isFinite(row.minsPlayed)
            ? Math.max(0, Math.min(130, Math.round(row.minsPlayed))) : null,
          position: typeof row.position === "string" && row.position.trim() ? row.position.trim() : null,
          discipline: typeof row.discipline === "string" && row.discipline.trim() ? row.discipline.trim() : null,
          started: row.started === true,
          appearance: row.appearance !== false,
        };
      }).filter(r => r.playerName.length > 0),
      warnings: (extracted.warnings ?? []).map(w => String(w)).slice(0, 20),
    });
    if (!result.success) {
      res.status(502).json({ error: "The screenshot reader returned an unexpected shape — try again" });
      return;
    }
    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "AI extraction failed");
    res.status(502).json({ error: "Could not read the screenshot — try a clearer image, or enter rows manually" });
  }
});

export default router;
