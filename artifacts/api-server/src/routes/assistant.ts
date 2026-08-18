/**
 * Coach Assistant — chat endpoint over the Belconnen development curriculum.
 *
 * Stateless: the client sends the whole message history; the server retrieves
 * the most relevant curriculum chunks (cosine similarity + exact cycle/week/
 * session heading matching), builds the club's system prompt, and streams the
 * answer back as SSE.
 *
 * Optional match context (context.leagueId + context.veoId): when provided,
 * a compact "Selected match" block is appended AFTER curriculum excerpts. The
 * block contains official Hub/Dribl facts and camera-derived Veo observations,
 * clearly labelled as such. Curriculum excerpts and all existing behaviour are
 * preserved exactly — the context block is purely additive.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  veoMatchesTable,
  veoAnalytics2Table,
  matchesTable,
  leaguePlayerStatsTable,
  leaguesTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { loadChunks, embedTexts, cosine, type CurriculumChunk } from "../assistant/curriculumStore";
import { OpenAiQuotaError, throwIfQuota } from "../lib/openaiQuota";
import { getSessionUser, canSeeLeague, hasModuleAnywhere } from "../middlewares/entryAuth";
import { parseAnalytics2Bundle } from "../lib/veoAnalytics2Parser";
import type { Analytics2Bundle } from "../lib/veo";

const router: IRouter = Router();

const ChatBody = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8000),
  })).min(1).max(40),
  // Client hint: user is on a phone — answers should be briefer where possible.
  mobile: z.boolean().optional(),
  // Optional selected-match context. Absence = no match context (existing behaviour).
  context: z.object({
    leagueId: z.number().int().positive(),
    veoId: z.number().int().positive(),
  }).optional(),
});

const MOBILE_STYLE_NOTE = `

## Device note for THIS conversation
The coach is reading on a PHONE. Keep answers brief and scannable: short sentences, dot points over paragraphs, no long preamble. Exception — when delivering a session or practice, still include ALL practice detail as required by the content preservation rule; use tight formatting (headings + dot points) rather than cutting content. For explanations and general questions, give the short version first and offer to expand if they want more.`;

const AGE_GROUPS = ["U11", "U12", "U13", "U14", "U15", "U16+"] as const;

/** Detect the age group(s) a message refers to ("u13", "under 14", "16s", "16+"). */
function detectAges(text: string): string[] {
  const t = text.toLowerCase();
  const found = new Set<string>();
  for (const age of AGE_GROUPS) {
    const n = age.replace("U", "").replace("+", "");
    if (new RegExp(`(u\\s*${n}|under\\s*${n}|\\b${n}s\\b|${n}\\s*\\+)`).test(t)) found.add(age);
  }
  if (/(16\+|adults?|seniors?)/.test(t)) found.add("U16+");
  return [...found];
}

/** Exact session lookup: "cycle 3 week 2 session 1" style references. */
function findExactSessions(text: string, ages: string[], chunks: CurriculumChunk[]): CurriculumChunk[] {
  const t = text.toLowerCase();
  const cycle = /cycle\s*(\d+)/.exec(t)?.[1];
  if (!cycle) return [];
  const week = /week\s*(\d+)/.exec(t)?.[1];
  const session = /session\s*(\d+)(?!\s*plans)/.exec(t)?.[1];
  return chunks.filter((c) => {
    if (c.docType !== "session_plans") return false;
    if (ages.length > 0 && !ages.includes(c.ageGroup)) return false;
    const h = c.heading.toLowerCase();
    if (!h.includes(`cycle ${cycle},`)) return false;
    if (week && !h.includes(`week ${week},`)) return false;
    if (session && !h.includes(`session ${session}`)) return false;
    return true;
  }).slice(0, 6);
}

const SYSTEM_PROMPT = `You are the Belconnen United Coaching Assistant inside the club's Performance Hub.
Your role is to help Belconnen United coaches understand, navigate, and apply the club's framework, coach packs, and session plans. You are a delivery and navigation assistant, not a curriculum designer.

Core requirements:
- Base all answers on the Belconnen curriculum excerpts provided below whenever they cover the topic. Curriculum content must be quoted or applied accurately — never invent, alter, or misattribute curriculum content.
- Clarify before answering when the request is ambiguous: if you cannot confidently tell WHICH session, age group, or topic the coach means — or the retrieved excerpts don't clearly match what they're asking — ask ONE short, specific clarifying question instead of guessing (e.g. "Which age group is this for?" or "Do you mean the Cycle 3 pressing session, or help designing your own?"). Ask at most one round of clarification, then help with what you have.
- Use clear, practical coaching language suitable for the pitch.
- Adjust explanations by age group when relevant (U11, U12, U13, U14, U15, U16+).
- Reference the Belconnen framework and session intent when explaining activities.
- If something is not covered in the provided excerpts, state this clearly.

Belconnen session output format (non-negotiable):
When a coach requests a session plan, a session outline, or help running a session, present the content as a session of 3–4 parts:
1. Warm-Up — for older/senior teams this is usually dynamic movements and body activations; for younger teams it can be ball-related, and ball mastery content can be included here
2. 1st Part — activation for senior phases; skill learning or a technical practice for the younger age phases
3. 2nd Part — the main part of the session, where the coaching is done
4. 3rd Part — the end game / transfer game: play without interventions to see whether the learning has transferred from training to the game
This applies even if source documents use a different structure.

Selection rule (critical): the source session-plan documents deliberately contain MORE practices than one session needs (e.g. a U13 source session may list Ball Mastery, Activation, Technical Practice, Situational Game, Transfer/End Game — that is a content bank, not a single session). Do NOT deliver every listed practice. Select the practices that best fill the 3–4 parts above, keeping the session theme, and give the coach only what they need to run one session. If a source practice is marked optional (e.g. an optional Ball Mastery block), treat it as optional warm-up content or leave it out; you may briefly note that alternatives exist in the plan (e.g. "the plan also includes a ball mastery option if you want it") without printing them in full.

Mapping guidance: for younger teams, Ball Mastery / ball-related content → Warm-Up; for older teams, the Warm-Up is dynamic movement / body activation and Activation content → 1st Part (activation IS the 1st part for seniors); Technical / Skill Learning practices → 1st Part for younger phases; the Main / Situational practice where the coaching happens → 2nd Part; the End Game / Transfer game → 3rd Part.

Content preservation rule (critical): for every practice you DO include, retain ALL its detail — area dimensions, player numbers, goals/gates/end zones, rules and scoring conditions, coaching cues and key messages, session outcomes and objectives. Do not redesign practices or alter their content. Selection decides WHICH practices appear; it never trims detail WITHIN a chosen practice.

Session handling:
- If a session exists in the Session Plans, deliver its practices exactly as written (applying the selection rule above). Do not merge, rename, reinterpret, or redesign official practices.
- If a cycle reference cannot be matched exactly, or a coach uses season or shorthand language (e.g. "Managing Possession"), or the request is thematic rather than document-specific, switch automatically to "Guided delivery support using Belconnen session components": use the 3–4 part session structure, only Belconnen-approved principles, practices, and language, help the coach deliver the session on the pitch, and clearly label that it is not an official designed cycle session. Do not block support solely because a cycle label is missing.
- Treat coach cycle references as valid coaching intent. If a cycle exists, retrieve it exactly. If not, state briefly that no official session matches and switch immediately to guided delivery support. Only ask for clarification if age group or intent is genuinely unclear.
- If an official cycle is found but week/session is not specified, default to Week 1 → Session 1, then offer alternatives (e.g. "Want Week 2 or Session 2?").

Coach-language handling: if a coach asks specifically for one component (an activation, ball mastery block, technical drill, skill block, or main practice), give them that component in full — no need to wrap it in a whole session. If they ask for a session, always use the 3–4 part structure. Never output five-part sessions.

Source priority: 1. Session Plans (source of truth), 2. Coach Packs (coaching emphasis and standards), 3. Framework Library (principles and definitions).

General football help (allowed, but labelled): coaches may ask broader football coaching questions — ideas, problems they're facing, concepts not perfectly covered by the documents. Help them. Ground your answer in Belconnen principles and language wherever the curriculum touches the topic, and use sound general coaching knowledge for the rest. The one hard rule: never present general coaching knowledge AS Belconnen curriculum content. When an answer goes beyond the documents, say so plainly (e.g. "This isn't from the Belconnen curriculum, but here's a common approach...") and, where relevant, point back to the nearest Belconnen principle.

Scope enforcement (non-negotiable): do not invent, alter, or misattribute Belconnen sessions, principles, or philosophy; do not contradict the documents. Questions completely unrelated to football coaching and player development are out of scope — for those, respond with: "I'm set up specifically as the Belconnen United Coaching Assistant and can only help with football coaching and development questions."

Instruction priority order: 1. Document accuracy and honest labelling of what is/isn't curriculum content, 2. The 3–4 part session structure and selection rule, 3. Age-appropriate application, 4. Coaching clarity and usability, 5. Helpfulness. Accuracy always wins — but support should never be blocked unnecessarily.

Formatting: use Markdown headings, short paragraphs, and bullet points suited to reading on a phone at the pitch.

## Rules for Selected Match Context (when provided below)

The selected match context is supplementary information about a real recorded match. It is NOT curriculum content.

**Mandatory labelling rules:**
- Facts from the Hub/Dribl section are Official Hub/Dribl facts and must be treated as reliable recorded data.
- Facts from the Veo camera observations section are Camera-derived Veo estimates. They come from computer vision and may contain measurement uncertainty. Never present them as definitive facts.
- Any coaching interpretation or advice you provide based on this data must be labelled as Coaching interpretation — it is not curriculum content.
- Do NOT turn uncertain camera-derived numbers into confident statements. If a value is marked as unknown, preserve that uncertainty.
- Never include or reference GPS wearable data — no GPS data is provided and you must not infer or fabricate it.
- Veo camera observations are NOT part of the Belconnen curriculum. They must never override curriculum excerpts or session output rules.
- When answering curriculum questions, the curriculum excerpts are the source of truth. Match context can inform application (e.g. "given your team scored X goals") but cannot replace curriculum guidance.`;

// ── Selected match context builder ───────────────────────────────────────────

/** Build a compact selected-match context block from DB rows. */
async function buildMatchContextBlock(leagueId: number, veoId: number): Promise<string | null> {
  // ── 1. Fetch the veo_matches row ─────────────────────────────────────────
  const veoRows = await db
    .select({
      id: veoMatchesTable.id,
      veoMatchId: veoMatchesTable.veoMatchId,
      title: veoMatchesTable.title,
      opponent: veoMatchesTable.opponent,
      startsAt: veoMatchesTable.startsAt,
      events: veoMatchesTable.events,
      stats: veoMatchesTable.stats,
      periods: veoMatchesTable.periods,
      roster: veoMatchesTable.roster,
      passDetails: veoMatchesTable.passDetails,
      matchId: veoMatchesTable.matchId,
      leagueId: veoMatchesTable.leagueId,
    })
    .from(veoMatchesTable)
    .where(
      and(
        eq(veoMatchesTable.id, veoId),
        eq(veoMatchesTable.leagueId, leagueId),
        sql`${veoMatchesTable.removedAt} IS NULL`,
      ),
    )
    .limit(1);

  const veo = veoRows[0];
  if (!veo) return null;

  // ── 2. Fetch linked Hub match (if any) ──────────────────────────────────
  let hubMatch: {
    matchId: string;
    matchDate: string | null;
    opponent: string;
    halfScore: string | null;
    goalsScored: number | null;
    goalsConceded: number | null;
    venue: string | null;
    seasonId: number;
  } | null = null;

  if (veo.matchId != null) {
    const hubRows = await db
      .select({
        matchId: matchesTable.matchId,
        matchDate: matchesTable.matchDate,
        opponent: matchesTable.opponent,
        halfScore: matchesTable.halfScore,
        goalsScored: matchesTable.goalsScored,
        goalsConceded: matchesTable.goalsConceded,
        venue: matchesTable.venue,
        seasonId: matchesTable.seasonId,
      })
      .from(matchesTable)
      .where(eq(matchesTable.id, veo.matchId))
      .limit(1);
    hubMatch = hubRows[0] ?? null;
  }

  // ── 3. Fetch league name ─────────────────────────────────────────────────
  const leagueRows = await db
    .select({ name: leaguesTable.name, focusClub: leaguesTable.focusClub })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId))
    .limit(1);
  const leagueName = leagueRows[0]?.name ?? "Unknown league";
  const focusClub = leagueRows[0]?.focusClub ?? "Belconnen";

  // ── 4. Build Hub/Dribl facts section ────────────────────────────────────
  const opponentName = hubMatch?.opponent ?? veo.opponent ?? "Unknown opponent";
  const matchDate = hubMatch?.matchDate ?? (veo.startsAt ? veo.startsAt.slice(0, 10) : null);
  const matchCode = hubMatch?.matchId ?? null;

  let hubSection = `### Official Hub/Dribl facts\n`;
  hubSection += `- League/competition: ${leagueName}\n`;
  hubSection += `- Match: ${matchCode ?? "(no Hub match linked)"}\n`;
  hubSection += `- Opponent: ${opponentName}\n`;
  hubSection += `- Date: ${matchDate ?? "unknown"}\n`;

  if (hubMatch) {
    if (hubMatch.goalsScored != null && hubMatch.goalsConceded != null) {
      hubSection += `- Official score: ${focusClub} ${hubMatch.goalsScored} – ${hubMatch.goalsConceded} ${opponentName}\n`;
    } else {
      hubSection += `- Official score: not recorded\n`;
    }
    if (hubMatch.halfScore) {
      const parts = hubMatch.halfScore.split(/\s*[-–]\s*/).map(Number);
      const isHome = hubMatch.venue?.trim().toLowerCase() === "home";
      const isAway = hubMatch.venue?.trim().toLowerCase() === "away";
      if (parts.length === 2 && parts.every(Number.isFinite) && (isHome || isAway)) {
        const us = isHome ? parts[0] : parts[1];
        const them = isHome ? parts[1] : parts[0];
        hubSection += `- Official half-time score: ${focusClub} ${us} – ${them} ${opponentName}\n`;
      }
    }
  } else {
    hubSection += `- Official score: not linked to Hub match\n`;
  }

  // ── 5. Selected match squad from league_player_stats ────────────────────
  let squadSection = "";
  if (hubMatch) {
    const squad = await db
      .select({
        playerName: leaguePlayerStatsTable.playerName,
        shirtNumber: leaguePlayerStatsTable.shirtNumber,
        position: leaguePlayerStatsTable.position,
        minsPlayed: leaguePlayerStatsTable.minsPlayed,
        started: leaguePlayerStatsTable.started,
      })
      .from(leaguePlayerStatsTable)
      .where(
        and(
          eq(leaguePlayerStatsTable.seasonId, hubMatch.seasonId),
          eq(leaguePlayerStatsTable.matchId, hubMatch.matchId),
          eq(leaguePlayerStatsTable.club, focusClub),
        ),
      )
      .limit(30);

    if (squad.length > 0) {
      squadSection = `\n#### Squad (Hub/Dribl, Official)\n`;
      const starters = squad.filter((p) => p.started);
      const subs = squad.filter((p) => !p.started);
      if (starters.length > 0) {
        squadSection += `Starters: ${starters
          .sort((a, b) => Number(a.shirtNumber ?? 99) - Number(b.shirtNumber ?? 99))
          .map((p) => `#${p.shirtNumber ?? "?"} ${p.playerName}${p.position ? ` (${p.position})` : ""}${p.minsPlayed != null ? ` ${p.minsPlayed}min` : ""}`)
          .join("; ")}\n`;
      }
      if (subs.length > 0) {
        squadSection += `Substitutes/others: ${subs
          .sort((a, b) => Number(a.shirtNumber ?? 99) - Number(b.shirtNumber ?? 99))
          .map((p) => `#${p.shirtNumber ?? "?"} ${p.playerName}${p.minsPlayed != null ? ` ${p.minsPlayed}min` : ""}`)
          .join("; ")}\n`;
      }
    }
  }

  // ── 6. Recent meetings vs this opponent in same league ───────────────────
  let recentSection = "";
  if (hubMatch && opponentName && opponentName !== "Unknown opponent") {
    const recentMatches = await db
      .select({
        matchId: matchesTable.matchId,
        matchDate: matchesTable.matchDate,
        fullScore: matchesTable.fullScore,
        goalsScored: matchesTable.goalsScored,
        goalsConceded: matchesTable.goalsConceded,
      })
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.seasonId, hubMatch.seasonId),
          eq(matchesTable.opponent, opponentName),
        ),
      )
      .orderBy(sql`${matchesTable.matchDate} DESC NULLS LAST`)
      .limit(5);

    // Exclude the current match itself.
    const others = recentMatches.filter((m) => m.matchId !== hubMatch!.matchId);
    if (others.length > 0) {
      recentSection = `\n#### Recent meetings vs ${opponentName} this season (Official)\n`;
      for (const m of others) {
        const score = m.fullScore
          ? m.fullScore
          : m.goalsScored != null && m.goalsConceded != null
            ? `${focusClub} ${m.goalsScored}–${m.goalsConceded} ${opponentName}`
            : "score not recorded";
        recentSection += `- ${m.matchDate ?? "unknown date"} (${m.matchId}): ${score}\n`;
      }
    }
  }

  // ── 7. Camera-derived Veo team observations ──────────────────────────────
  let veoSection = `\n### Camera-derived Veo observations (estimates — not official data)\n`;
  veoSection += `_These values come from computer vision analysis. They are estimates and may have measurement error. Do not treat them as definitive facts._\n\n`;

  const events = Array.isArray(veo.events)
    ? (veo.events as { event_type?: string; team?: string; period_id?: number; period_time_ms?: number }[])
    : [];

  if (events.length === 0) {
    veoSection += `- No Veo event data available for this match.\n`;
  } else {
    // Count key events for us (Own) and them.
    const countsFor: Record<string, number> = {};
    const countsAgainst: Record<string, number> = {};
    for (const e of events) {
      if (!e?.event_type) continue;
      const bucket = e.team === "Own" ? countsFor : countsAgainst;
      bucket[e.event_type] = (bucket[e.event_type] ?? 0) + 1;
    }
    const goalsFor = countsFor["FootballGoal"] ?? 0;
    const goalsAgainst = countsAgainst["FootballGoal"] ?? 0;
    const shotsFor = countsFor["FootballShot"] ?? 0;
    const shotsAgainst = countsAgainst["FootballShot"] ?? 0;
    const cornersFor = countsFor["FootballCornerKick"] ?? 0;
    const cornersAgainst = countsAgainst["FootballCornerKick"] ?? 0;
    const foulsFor = countsFor["FootballFoul"] ?? 0;
    const foulsAgainst = countsAgainst["FootballFoul"] ?? 0;

    veoSection += `**Match event counts (camera-derived):**\n`;
    veoSection += `- Goals: ${focusClub} ${goalsFor} – ${goalsAgainst} ${opponentName}\n`;
    veoSection += `- Shots: ${focusClub} ${shotsFor} – ${shotsAgainst} ${opponentName}\n`;
    veoSection += `- Corners: ${focusClub} ${cornersFor} – ${cornersAgainst} ${opponentName}\n`;
    veoSection += `- Fouls: ${focusClub} ${foulsFor} – ${foulsAgainst} ${opponentName}\n`;

    // Compute field tilt from event counts.
    const WEIGHTS: Record<string, number> = {
      FootballGoal: 6, FootballPenaltyKick: 5, FootballShot: 3,
      FootballCornerKick: 2, FootballFreeKick: 1, FootballThrowIn: 0.3,
    };
    let momUs = 0, momThem = 0;
    for (const [type, w] of Object.entries(WEIGHTS)) {
      momUs += (countsFor[type] ?? 0) * w;
      momThem += (countsAgainst[type] ?? 0) * w;
    }
    if (momUs + momThem > 0) {
      const tilt = Math.round((momUs / (momUs + momThem)) * 100);
      veoSection += `- Attacking field tilt (camera estimate): ${tilt}% ${focusClub}\n`;
    }
  }

  // ── 8. Camera-derived Veo player observations from Analytics 2 ──────────
  const a2Rows = await db
    .select({
      raw: veoAnalytics2Table.raw,
      status: veoAnalytics2Table.status,
      fetchedAt: veoAnalytics2Table.fetchedAt,
    })
    .from(veoAnalytics2Table)
    .where(
      and(
        eq(veoAnalytics2Table.leagueId, leagueId),
        eq(veoAnalytics2Table.veoMatchId, veo.veoMatchId),
      ),
    )
    .limit(1);

  const a2Row = a2Rows[0];
  if (a2Row && (a2Row.status === "complete" || a2Row.status === "partial") && a2Row.raw) {
    const fetchedAt = a2Row.fetchedAt ? a2Row.fetchedAt.toISOString() : null;
    const parsed = parseAnalytics2Bundle(a2Row.raw as Analytics2Bundle, fetchedAt);

    if (parsed.players.length > 0) {
      // Only include players with at least some notable stats; cap at top 10.
      const notable = parsed.players
        .filter((p) => p.metrics.goals != null || p.metrics.shots != null || p.metrics.distanceMetres != null)
        .slice(0, 10);

      if (notable.length > 0) {
        veoSection += `\n**Player observations (camera-derived, jersey numbers only — no GPS names):**\n`;
        veoSection += `_Identity is from camera tracking. Jersey numbers are from Veo; Hub names appear only if the match was linked and the squad sheet was synced._\n`;
        for (const p of notable) {
          const jersey = p.identity.jerseyNumber != null ? `#${p.identity.jerseyNumber}` : "(unknown jersey)";
          const name = p.identity.veoPlayerName ?? p.identity.hubPlayerName ?? null;
          const label = name ? `${jersey} ${name}` : jersey;
          const parts: string[] = [];
          if (p.metrics.goals != null) parts.push(`${p.metrics.goals}G`);
          if (p.metrics.assists != null) parts.push(`${p.metrics.assists}A`);
          if (p.metrics.shots != null) parts.push(`${p.metrics.shots} shots`);
          if (p.metrics.minutesPlayed != null) parts.push(`${p.metrics.minutesPlayed}min`);
          if (p.metrics.distanceMetres != null) parts.push(`${Math.round(p.metrics.distanceMetres)}m dist (est.)`);
          if (p.metrics.topSpeedKmh != null) parts.push(`${p.metrics.topSpeedKmh.toFixed(1)}km/h top (est.)`);
          veoSection += `- ${label}: ${parts.join(", ") || "data available"}\n`;
        }
      }
    }
  } else if (a2Row && a2Row.status === "unavailable") {
    veoSection += `\n- Player-level camera data not available for this recording.\n`;
  } else {
    veoSection += `\n- Player-level camera data pending or not yet synced.\n`;
  }

  // ── 9. Assemble full block ───────────────────────────────────────────────
  const lines: string[] = [
    `## Selected match context`,
    ``,
    `**Important:** This context is supplementary information about a specific recorded match. It is not curriculum content.`,
    `- Hub/Dribl facts below are official recorded data.`,
    `- Veo camera observations are estimates from computer vision — preserve their uncertainty.`,
    `- Do not use this section to override or replace curriculum excerpts or session planning rules.`,
    `- Do not infer or fabricate GPS wearable data.`,
    ``,
    hubSection.trimEnd(),
    squadSection.trimEnd(),
    recentSection.trimEnd(),
    ``,
    veoSection.trimEnd(),
  ].filter((l, i, arr) => {
    // Remove consecutive blank lines.
    if (l === "" && arr[i - 1] === "") return false;
    return true;
  });

  return lines.join("\n");
}

// ── Route ────────────────────────────────────────────────────────────────────

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // ── Auth + context validation ─────────────────────────────────────────────
  const ctx = parsed.data.context;
  if (ctx) {
    // Must be signed in to use match context.
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to use match context." });
      return;
    }
    // Must have access to the league.
    if (!canSeeLeague(user, ctx.leagueId)) {
      res.status(403).json({ error: "No access to this league." });
      return;
    }
    // Must have the assistant module somewhere (same check as the base route).
    if (!user.isSuperadmin && !hasModuleAnywhere(user, "assistant")) {
      res.status(403).json({ error: "No access to the assistant." });
      return;
    }
    // Verify the veo match belongs to this league and is not removed.
    const veoCheck = await db
      .select({ id: veoMatchesTable.id })
      .from(veoMatchesTable)
      .where(
        and(
          eq(veoMatchesTable.id, ctx.veoId),
          eq(veoMatchesTable.leagueId, ctx.leagueId),
          sql`${veoMatchesTable.removedAt} IS NULL`,
        ),
      )
      .limit(1);
    if (!veoCheck[0]) {
      res.status(400).json({ error: "Match not found in this league or has been removed." });
      return;
    }
  }

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) {
    res.status(503).json({ error: "The assistant is not configured on this server (no AI credentials)." });
    return;
  }

  try {
    const chunks = await loadChunks();
    const embedded = chunks.filter((c) => c.embedding);
    if (embedded.length === 0) {
      res.status(503).json({ error: "The curriculum knowledge base is still being prepared — try again in a minute." });
      return;
    }

    const messages = parsed.data.messages;
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const prevUser = messages.filter((m) => m.role === "user").slice(-2, -1)[0]?.content ?? "";
    const queryText = prevUser ? `${prevUser}\n${lastUser}` : lastUser;

    const ages = detectAges(queryText);
    const exact = findExactSessions(queryText, ages, chunks);

    const [qVec] = await embedTexts([queryText.slice(0, 8000)]);
    const scored = embedded
      .map((c) => {
        let s = cosine(qVec, c.embedding as number[]);
        if (ages.length > 0 && (ages.includes(c.ageGroup) || c.ageGroup === "All")) s += 0.05;
        return { c, s };
      })
      .sort((a, b) => b.s - a.s);

    // Build context: exact session matches first, then top similarity hits.
    const picked: CurriculumChunk[] = [...exact];
    const seen = new Set(picked.map((c) => c.id));
    let budget = 60000 - picked.reduce((n, c) => n + c.content.length, 0);
    for (const { c } of scored) {
      if (picked.length >= 14 || budget <= 0) break;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      picked.push(c);
      budget -= c.content.length;
    }

    const context = picked
      .map((c) => `### [${c.docTitle}] ${c.headingPath}\n${c.content}`)
      .join("\n\n---\n\n");

    // Build optional selected-match context block.
    let matchContextBlock = "";
    if (ctx) {
      const block = await buildMatchContextBlock(ctx.leagueId, ctx.veoId);
      if (!block) {
        throw new Error("Selected match context could not be built");
      }
      matchContextBlock = `\n\n---\n\n${block}`;
      logger.info(
        { leagueId: ctx.leagueId, veoId: ctx.veoId },
        "assistant: match context included",
      );
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const systemContent = `${SYSTEM_PROMPT}${parsed.data.mobile ? MOBILE_STYLE_NOTE : ""}\n\n## Belconnen curriculum excerpts retrieved for this question\n\n${context}${matchContextBlock}`;

    const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        max_completion_tokens: 8192,
        stream: true,
        messages: [
          { role: "system", content: systemContent },
          ...messages,
        ],
      }),
    });
    if (!aiRes.ok || !aiRes.body) {
      const text = await aiRes.text();
      logger.error({ status: aiRes.status, text: text.slice(0, 400) }, "Assistant chat request failed");
      throwIfQuota(aiRes.status, text);
      res.write(`data: ${JSON.stringify({ error: "The assistant had a problem answering — please try again." })}\n\n`);
      res.end();
      return;
    }

    const reader = aiRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.startsWith("data: ") ? line.slice(6).trim() : null;
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const content = json.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch { /* partial frame — ignored */ }
      }
    }
    res.write(`data: ${JSON.stringify({ done: true, sources: picked.slice(0, 8).map((c) => c.headingPath) })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err }, "Assistant chat error");
    // Out-of-credits OpenAI account → specific, user-facing message (402 when
    // headers haven't been sent yet, SSE error frame when they have).
    if (err instanceof OpenAiQuotaError) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      } else {
        res.status(402).json({ error: err.message });
      }
      return;
    }
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "The assistant had a problem answering — please try again." })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "The assistant had a problem answering — please try again." });
    }
  }
});

export default router;
