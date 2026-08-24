/**
 * Voice reflection interview endpoints.
 *
 * These run on the coach's own OpenAI key (OPENAI_API_KEY) against
 * api.openai.com directly — NOT the Replit AI proxy — per the coach's
 * explicit request that all interviews use his OpenAI account.
 *
 * Flow (state machine lives client-side):
 *  - /speak    — text → mp3 (question read aloud)
 *  - /turn     — audio answer → transcript + next action
 *                 phase "answer":  thin answer → one gentle probe, else confirm
 *                 phase "confirm": coach reply → "next" or "continue"
 *  - /writeup  — full Q&A → journal field content in the coach's voice
 */
import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  leagueMatchesTable,
  leagueGoalsTable,
  leaguePlayerStatsTable,
  leaguesTable,
  matchPrepReportsTable,
  matchReportsTable,
  seasonsTable,
  veoMatchesTable,
} from "@workspace/db";
import { focusClubForLeagueRequest, focusClubForRequest, focusClubForSeason } from "../lib/focusClub";
import { canSeeLeague, getSessionUser, hasModule } from "../middlewares/entryAuth";
import { summarisePassDetails } from "./veo";
import { effectiveVeoPeriods } from "../lib/veoDirection";
import { dnaCatOfType, dnaCatLabel } from "../lib/goalDnaStory";
import { goalIntelReads, type IntelGoal } from "../lib/goalIntel";
import { recentResultLines, resolveAssistantOpponent } from "../lib/assistantConversation";
import {
  JournalInterviewSpeakBody,
  JournalInterviewTurnBody,
  JournalInterviewWriteupBody,
  CreateWeekAheadBriefBody,
  CreatePrematchBriefBody,
  CreatePrematchTalkBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const OPENAI_BASE = "https://api.openai.com/v1";

function apiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

function noKey(res: import("express").Response) {
  return res.status(503).json({
    error:
      "OpenAI API key is not configured. Voice interviews need the coach's OpenAI key (OPENAI_API_KEY).",
  });
}

/** Parse model JSON output defensively — model drift must never 500. */
function safeJsonParse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export { OpenAiQuotaError } from "../lib/openaiQuota";
import { OpenAiQuotaError, throwIfQuota } from "../lib/openaiQuota";

async function openaiJson(path: string, body: unknown, key: string): Promise<any> {
  const r = await fetch(`${OPENAI_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throwIfQuota(r.status, text);
    throw new Error(`OpenAI ${path} failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return r.json();
}

async function transcribe(audioBase64: string, mimeType: string, key: string): Promise<string> {
  const buf = Buffer.from(audioBase64, "base64");
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mimeType }), `answer.${ext}`);
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("language", "en");
  const r = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!r.ok) {
    const text = await r.text();
    throwIfQuota(r.status, text);
    throw new Error(`OpenAI transcription failed (${r.status}): ${text.slice(0, 300)}`);
  }
  const json = (await r.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/** Coach writing-style reference, distilled from his A-licence Journal-1. */
const COACH_STYLE = `You write as Scott Conlon, an experienced Australian football (soccer) coach:
Women's First Grade coach and Technical Director at Belconnen United FC, completing his A Licence.
His written voice: first person, direct and practical, reflective but never flowery or corporate.
Plain Australian English. Short, confident sentences. He connects football to developing people
(confidence, resilience, decision-making). He uses his club's language naturally: pressing triggers,
build-up, compactness, transitions, big/medium/small game fortnights, "the field is the fitness".
He is honest about his own mistakes and states what he will do about them.
Never invent facts he did not say. Never add motivational fluff, headings, or bullet points unless
the answer naturally lists things. Keep each field to the substance of what he actually said,
tidied into clear prose.`;

// POST /journal/interview/speak — text to spoken audio (mp3)
router.post("/journal/interview/speak", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = JournalInterviewSpeakBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const r = await fetch(`${OPENAI_BASE}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        input: parsed.data.text,
        instructions:
          "Speak like a sharp, friendly sports radio interviewer talking to a football coach. Lively, punchy delivery — a touch quicker than normal speech, but let personality come through. Quirky, playful, and characterful — lean into the charm. Warm but efficient, never flat or rushed.",
        response_format: "mp3",
        speed: 1.05,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throwIfQuota(r.status, text);
      throw new Error(`OpenAI TTS failed (${r.status}): ${text.slice(0, 300)}`);
    }
    const audio = Buffer.from(await r.arrayBuffer());
    return res.json({ audioBase64: audio.toString("base64"), mimeType: "audio/mpeg" });
  } catch (err) {
    return next(err);
  }
});

// POST /journal/interview/turn — transcribe an answer and decide what happens next
router.post("/journal/interview/turn", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = JournalInterviewTurnBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { phase, question, hint, priorAnswer, probeUsed, audioBase64, audioMimeType, mode } =
      parsed.data;

    const transcript = await transcribe(audioBase64, audioMimeType ?? "audio/webm", key);
    if (!transcript) {
      return res.json({
        transcript: "",
        action: phase === "confirm" ? "continue" : "confirm",
        say: "Sorry, I didn't catch that — could you say it again?",
      });
    }

    if (mode === "date") {
      // The coach said when the session/game was ("today", "last Tuesday",
      // "the 15th"...). Resolve it to dd.mm.yyyy against today's date in
      // Canberra. If unclear, dateResolved is null and the client keeps today.
      const todayLong = new Date().toLocaleDateString("en-AU", {
        timeZone: "Australia/Canberra",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const judge = await openaiJson(
        "/chat/completions",
        {
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Today is ${todayLong} (Canberra, Australia). A football coach was asked when a training session or game took place. Resolve his spoken reply to a calendar date IN THE PAST OR TODAY (day references like "Tuesday" mean the most recent such day, today included).
Return JSON: {"date": "dd.mm.yyyy" | null}. Use null only if the reply gives no usable day/date.`,
            },
            { role: "user", content: transcript },
          ],
        },
        key,
      );
      const out = safeJsonParse(judge?.choices?.[0]?.message?.content);
      const dateResolved =
        typeof out.date === "string" && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(out.date.trim())
          ? out.date.trim()
          : null;
      return res.json({ transcript, action: "next", say: null, dateResolved });
    }

    if (phase === "confirm") {
      // Coach was asked "anything to add, or move to the next question?"
      const judge = await openaiJson(
        "/chat/completions",
        {
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `A football coach was just asked a short check-in like "Anything to add?" or "Anything more on that one?" (meaning: add more, or move to the next question) after answering an interview question. Classify his spoken reply.
Return JSON: {"decision": "next" | "continue", "hasSubstance": boolean}.
"next" = he is happy to move on (e.g. "no that's it", "next", "move on", "all good").
"continue" = he wants to add more or is already adding more content.
"hasSubstance" = true if the reply itself contains real additional answer content (not just "yes I want to add something").`,
            },
            { role: "user", content: `Question was: ${question}\n\nHis reply: ${transcript}` },
          ],
        },
        key,
      );
      const out = safeJsonParse(judge?.choices?.[0]?.message?.content);
      // Fallback on model drift: treat as "he has more to say" with substance,
      // so nothing he said is ever dropped.
      const decision = out.decision === "next" ? "next" : "continue";
      const hasSubstance = typeof out.hasSubstance === "boolean" ? out.hasSubstance : true;
      if (decision === "next") {
        return res.json({ transcript: "", action: "next", say: null });
      }
      return res.json({
        transcript: hasSubstance ? transcript : "",
        action: "continue",
        say: hasSubstance ? null : "Go ahead — I'm listening.",
      });
    }

    // phase === "answer": decide whether one gentle probe is warranted
    if (!probeUsed) {
      const judge = await openaiJson(
        "/chat/completions",
        {
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You are interviewing a football coach for his reflection journal. He just answered a question. Decide if ONE short, gentle follow-up probe would clearly draw out something valuable he hinted at but didn't expand on. Only probe if the answer is thin or clearly leaves an interesting thread hanging — a solid answer needs no probe.
Return JSON: {"probe": string | null}. The probe must be a single conversational question, max 20 words, in plain spoken English.`,
            },
            {
              role: "user",
              content: `Question: ${question}${hint ? `\n(Context for the question: ${hint})` : ""}${priorAnswer ? `\nEarlier part of his answer: ${priorAnswer}` : ""}\n\nHis answer: ${transcript}`,
            },
          ],
        },
        key,
      );
      const out = safeJsonParse(judge?.choices?.[0]?.message?.content);
      // Fallback on model drift: no probe, straight to confirm.
      if (typeof out.probe === "string" && out.probe.trim()) {
        return res.json({ transcript, action: "probe", say: out.probe.trim() });
      }
    }
    return res.json({ transcript, action: "confirm", say: null });
  } catch (err) {
    return next(err);
  }
});

// POST /journal/interview/writeup — Q&A transcript → journal fields in coach voice
router.post("/journal/interview/writeup", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = JournalInterviewWriteupBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { qa, title } = parsed.data;

    const qaText = qa
      .map(
        (item, i) =>
          `### Field ${i + 1}\nfieldId: ${item.fieldId}\nQuestion: ${item.label}${item.hint ? `\nContext: ${item.hint}` : ""}\nSpoken answer(s):\n${item.answers.map((a) => `- ${a}`).join("\n")}`,
      )
      .join("\n\n");

    const result = await openaiJson(
      "/chat/completions",
      {
        model: "gpt-4o",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${COACH_STYLE}

The coach answered journal questions out loud in an interview. Turn each spoken answer into written journal content for that field.
Rules:
- Return JSON: an object whose keys are EXACTLY the fieldIds given, values are the written-up text.
- Stay faithful to what he said — tidy the spoken language (remove filler, false starts, repetition) but keep his meaning, examples and personality.
- Short fields (names, scores, codes, venues, times) should be just the value, not a sentence.
- If he gave no usable answer for a field, return an empty string for it.
- Length should match what he said: a short answer stays short. Do not pad.`,
          },
          {
            role: "user",
            content: `Journal block: ${title ?? parsed.data.kind}\n\n${qaText}`,
          },
        ],
      },
      key,
    );
    const raw = safeJsonParse(result?.choices?.[0]?.message?.content);
    const content: Record<string, string> = {};
    let any = false;
    for (const item of qa) {
      const v = raw[item.fieldId];
      content[item.fieldId] = typeof v === "string" ? v : "";
      if (content[item.fieldId]) any = true;
    }
    const hadAnswers = qa.some((item) => item.answers.length > 0);
    if (hadAnswers && !any) {
      // Model output drifted — don't silently hand back an empty draft.
      return res.status(502).json({ error: "The write-up came back empty. Please try again." });
    }
    return res.json({ content });
  } catch (err) {
    return next(err);
  }
});

// POST /journal/prematch-brief — BP/BPO key objectives (per unit) for the Friday deck
router.post("/journal/prematch-brief", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = CreatePrematchBriefBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { opponent, formation, gamePlanNotes, scoutText } = parsed.data;

    const sections = [
      formation ? `## Our formation\n${formation}` : "",
      gamePlanNotes ? `## The coach's game plan notes for this match\n${gamePlanNotes}` : "",
      scoutText ? `## Scout data on ${opponent}\n${scoutText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const unitShape = `{"theme": string, "gk": string[], "defenders": string[], "midfielders": string[], "attackers": string[]}`;
    const result = await openaiJson(
      "/chat/completions",
      {
        model: "gpt-4o",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are the head coach of Belconnen United (NPLW football) writing key objectives for the players' pre-match briefing. This week's opponent: ${opponent}.
Coaching identity: controlled positional play (Guardiola-style) — passionate but calm, very detail-specific. We control tempo, keep the ball, create through patience and positioning.
Return JSON: {"bp": ${unitShape}, "bpo": ${unitShape}}.
- "bp" = with the ball (in possession). "bpo" = without the ball (out of possession).
- "theme": one short headline line for that phase (e.g. "Control the tempo. Keep them under pressure.").
- Each unit (gk/defenders/midfielders/attackers): exactly 2 bullets, direct address to the players ("Stay composed — your calmness sets our tempo.").
- Punchy and simple — players must not be overloaded. Each bullet under 18 words. Plain spoken Australian English (defence, organisation), no jargon beyond common football terms (6, 8, 10, press, block).
- Ground bullets in the coach's notes and scout data where given; never invent facts about the opponent.`,
          },
          { role: "user", content: sections || "(no extra input — write from the coaching identity)" },
        ],
      },
      key,
    );
    const out = safeJsonParse(result?.choices?.[0]?.message?.content);
    const cleanArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    const cleanUnit = (v: unknown) => {
      const u = (v ?? {}) as Record<string, unknown>;
      return {
        theme: typeof u.theme === "string" ? u.theme : "",
        gk: cleanArr(u.gk),
        defenders: cleanArr(u.defenders),
        midfielders: cleanArr(u.midfielders),
        attackers: cleanArr(u.attackers),
      };
    };
    const bp = cleanUnit(out.bp);
    const bpo = cleanUnit(out.bpo);
    const empty = (u: ReturnType<typeof cleanUnit>) =>
      !u.theme && !u.gk.length && !u.defenders.length && !u.midfielders.length && !u.attackers.length;
    if (empty(bp) && empty(bpo)) {
      return res.status(502).json({ error: "The objectives came back empty. Please try again." });
    }
    return res.json({ bp, bpo });
  } catch (err) {
    return next(err);
  }
});

// POST /journal/prematch-talk — talking points for the Friday deck team-talk
// box, drawing on previous talks/decks vs the same opponent plus recorded
// last-meeting facts and the saved Monday brief.
router.post("/journal/prematch-talk", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = CreatePrematchTalkBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { opponent, seasonId, gamePlanNotes } = parsed.data;
    let { leagueId } = parsed.data;

    // Keep league and season consistent: derive the league from the season
    // where possible, and reject a leagueId that doesn't belong to it.
    if (seasonId != null) {
      const [season] = await db
        .select({ leagueId: seasonsTable.leagueId })
        .from(seasonsTable)
        .where(eq(seasonsTable.id, seasonId));
      if (!season) return res.status(400).json({ error: "Unknown seasonId" });
      if (leagueId != null && leagueId !== season.leagueId) {
        return res.status(400).json({ error: "seasonId and leagueId belong to different leagues" });
      }
      leagueId = season.leagueId;
    }

    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    let focusClub: string | null = null;
    let includeVeo = false;
    if (leagueId != null) {
      if (
        !user.isSuperadmin
        && (!canSeeLeague(user, leagueId) || !hasModule(user, leagueId, "match-prep"))
      ) {
        return res.status(403).json({ error: "No Match Prep access for this league" });
      }
      focusClub = await focusClubForLeagueRequest(req, leagueId);
      const [leagueScope] = await db
        .select({ focusClub: leaguesTable.focusClub })
        .from(leaguesTable)
        .where(eq(leaguesTable.id, leagueId))
        .limit(1);
      const defaultClub = leagueScope?.focusClub?.trim() || "Belconnen";
      includeVeo =
        (user.isSuperadmin || hasModule(user, leagueId, "veo"))
        && focusClub.toLowerCase() === defaultClub.toLowerCase();
    }

    const [lastMeeting, prevVsOpponent, mondayBrief, scoutText, ourPassing, oppPassing] = await Promise.all([
      seasonId != null && focusClub
        ? lastMeetingFacts(seasonId, opponent, focusClub).catch(() => [])
        : Promise.resolve([]),
      leagueId != null && focusClub
        ? previousDecksVsOpponentText(leagueId, opponent, focusClub).catch(() => null)
        : Promise.resolve(null),
      leagueId != null && focusClub
        ? mondayBriefTextForOpponent(leagueId, opponent, focusClub).catch(() => null)
        : Promise.resolve(null),
      seasonId != null
        ? opponentScoutFingerprint(seasonId, opponent).catch(() => null)
        : Promise.resolve(null),
      leagueId != null && focusClub && includeVeo
        ? recentPassingContext(leagueId, focusClub).catch(() => null)
        : Promise.resolve(null),
      leagueId != null && focusClub && includeVeo
        ? opponentPassingContext(leagueId, focusClub, opponent).catch(() => null)
        : Promise.resolve(null),
    ]);

    const sections = [
      prevVsOpponent
        ? `## What the coach told the team the last time(s) we prepared for ${opponent}\n${prevVsOpponent}`
        : "",
      lastMeeting.length
        ? `## What actually happened last time we played ${opponent} this season (recorded facts)\n${lastMeeting.join("\n")}`
        : "",
      mondayBrief ? `## This week's Monday prep brief for the ${opponent} game\n${mondayBrief}` : "",
      scoutText
        ? `## Scouting fingerprint on ${opponent} (computed from recorded league data)\n${scoutText}`
        : "",
      ourPassing ? `## Our possession & passing trends (Veo data)\n${ourPassing}` : "",
      oppPassing ? `## ${opponent}'s Veo passing numbers — last recorded meeting\n${oppPassing}` : "",
      gamePlanNotes ? `## The coach's game plan notes for this match\n${gamePlanNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await openaiJson(
      "/chat/completions",
      {
        model: "gpt-4o",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are the head coach of ${focusClub ?? "the requesting club"} drafting the short talking points for the pre-match team talk. This week's opponent: ${opponent}.
Coaching identity: controlled positional play (Guardiola-style) — passionate but calm, very detail-specific. We control tempo, keep the ball, create through patience and positioning.
Return JSON: {"lines": string[]} — 5 to 8 talking points, one line each.
- Direct address to the players, spoken not written ("Their goals come from the right — show them onto the left back.").
- Each line under 20 words. Plain spoken Australian English (defence, organisation), no jargon beyond common football terms (6, 8, 10, press, block).
- Ground every line in the input: previous talks vs this opponent, recorded last-meeting facts, the Monday brief, the scouting fingerprint, and the Veo possession/passing data. Never invent facts about the opponent.
- When the scouting fingerprint is provided, at least two lines must turn its specific patterns (e.g. set-piece share, favourite lane, transition threat, named scorers) into instructions for the players. Cite only patterns actually stated — do not extrapolate beyond them.
- If Veo possession/passing data is provided (for us or for them), incorporate any meaningful pattern into a line — e.g. if we've been high-possession lately ("control the tempo — this is how we play"), or if they had unusually high 6+ pass strings in the last meeting ("they can move it — stay compact, press the trigger").
- If a previous talk vs this opponent is provided, carry forward what is still relevant rather than starting from scratch — continuity in the message matters.
- If the last-meeting facts are provided, at least one line must build on what actually happened.
- No headings, no numbering, no motivational filler ("give 110%") — every line must be specific and actionable.`,
          },
          { role: "user", content: sections || "(no extra input — write from the coaching identity)" },
        ],
      },
      key,
    );
    const out = safeJsonParse(result?.choices?.[0]?.message?.content);
    const lines = Array.isArray(out.lines)
      ? out.lines.filter((x): x is string => typeof x === "string" && !!x.trim())
      : [];
    if (!lines.length) {
      return res.status(502).json({ error: "The talking points came back empty. Please try again." });
    }
    return res.json({ lines });
  } catch (err) {
    return next(err);
  }
});

/** Condensed text from our saved Friday decks vs the SAME opponent (most recent first, up to 2). */
export async function previousDecksVsOpponentText(
  leagueId: number,
  opponent: string,
  club: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(matchPrepReportsTable)
    .where(
      and(
        eq(matchPrepReportsTable.leagueId, leagueId),
        eq(matchPrepReportsTable.club, club),
        eq(matchPrepReportsTable.kind, "friday"),
      ),
    );
  const opp = opponent.trim().toLowerCase();
  const now = Date.now();
  const time = (md: string | null) => {
    if (!md) return NaN;
    const t = new Date(md).getTime();
    return Number.isNaN(t) ? NaN : t;
  };
  const matches = rows
    .filter((r) => {
      const dataOpp =
        typeof (r.data as Record<string, unknown> | null)?.opponent === "string"
          ? ((r.data as Record<string, unknown>).opponent as string)
          : "";
      const name = (r.opponent ?? dataOpp).trim().toLowerCase();
      return !!name && name === opp;
    })
    .map((r) => ({ r, t: time(r.matchDate) }))
    .filter((x) => !Number.isNaN(x.t) && x.t <= now)
    .sort((a, b) => b.t - a.t)
    .slice(0, 2);
  if (!matches.length) return null;

  const blocks = matches
    .map(({ r }) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
      const parts = [
        `Deck saved for ${r.opponent ?? opponent}${r.matchDate ? ` (${r.matchDate})` : ""}`,
        str("commentsTrends") && `Team-talk lines: ${str("commentsTrends")}`,
        str("gamePlan") && `Game plan: ${str("gamePlan")}`,
        str("theirBpNotes") && `Their BP notes: ${str("theirBpNotes")}`,
        str("theirBpoNotes") && `Their BPO notes: ${str("theirBpoNotes")}`,
      ].filter(Boolean) as string[];
      return parts.length > 1 ? parts.join("\n") : "";
    })
    .filter(Boolean);
  if (!blocks.length) return null;
  return blocks.join("\n\n").slice(0, 2500);
}

/** Pointer/review lines from the latest saved Monday brief for this opponent. */
export async function mondayBriefTextForOpponent(
  leagueId: number,
  opponent: string,
  club: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(matchPrepReportsTable)
    .where(
      and(
        eq(matchPrepReportsTable.leagueId, leagueId),
        eq(matchPrepReportsTable.club, club),
        eq(matchPrepReportsTable.kind, "monday"),
      ),
    );
  const opp = opponent.trim().toLowerCase();
  const candidates = rows
    .filter((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const name = (r.opponent ?? (typeof d.opponent === "string" ? d.opponent : "")).trim().toLowerCase();
      return !!name && name === opp;
    })
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
  const pick = candidates[0];
  if (!pick) return null;
  const d = (pick.data ?? {}) as Record<string, unknown>;
  const arr = (k: string) =>
    Array.isArray(d[k]) ? (d[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const parts = [
    arr("pointers").length ? `Prep pointers:\n${arr("pointers").join("\n")}` : "",
    arr("review").length ? `Week review:\n${arr("review").join("\n")}` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return parts.join("\n\n").slice(0, 1500);
}

/**
 * Server-side scouting fingerprint for an upcoming opponent, computed from the
 * recorded league data for the season: record, top scorers, goal DNA mix
 * (set piece / regain-third shares), timing bands, and the transition-intel
 * scouting reads (threat lanes, press profile, set-piece people).
 *
 * Honesty rules match the rest of the app: every line is grounded in recorded
 * counts, shares only speak when the sample justifies them, and the intel
 * reads carry their own hedged, sample-aware voice.
 */
export async function opponentScoutFingerprint(
  seasonId: number,
  opponent: string,
): Promise<string | null> {
  const opp = opponent.trim().toLowerCase();
  const same = (name: string | null | undefined) => (name ?? "").trim().toLowerCase() === opp;

  const [matches, goals] = await Promise.all([
    db.select().from(leagueMatchesTable).where(eq(leagueMatchesTable.seasonId, seasonId)),
    db.select().from(leagueGoalsTable).where(eq(leagueGoalsTable.seasonId, seasonId)),
  ]);

  // ── Season record ──────────────────────────────────────────────────────────
  const played = matches.filter(
    (m) => (same(m.homeTeam) || same(m.awayTeam)) && m.homeGoals != null && m.awayGoals != null,
  );
  let won = 0, drawn = 0, lost = 0, gf = 0, ga = 0;
  for (const m of played) {
    const usHome = same(m.homeTeam);
    const f = usHome ? m.homeGoals! : m.awayGoals!;
    const a = usHome ? m.awayGoals! : m.homeGoals!;
    gf += f; ga += a;
    if (f > a) won++; else if (f < a) lost++; else drawn++;
  }
  if (!played.length) return null; // no recorded league games — nothing real to say

  const scoredRows = goals.filter((g) => same(g.scorerTeam));
  const concededRows = goals.filter(
    (g) => !same(g.scorerTeam) && (same(g.homeTeam) || same(g.awayTeam)),
  );

  const lines: string[] = [
    `Season record: ${won}W ${drawn}D ${lost}L over ${played.length} games, ${gf} scored / ${ga} conceded.`,
  ];

  // ── Top scorers ────────────────────────────────────────────────────────────
  const tally = new Map<string, number>();
  for (const g of scoredRows) {
    const n = g.scorer?.trim();
    if (n && n !== "OG") tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  const scorers = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (scorers.length) {
    lines.push(`Top scorers: ${scorers.map(([n, c]) => `${n} (${c})`).join(", ")}.`);
  }

  // ── Goal DNA mix — origin shares of their typed goals ─────────────────────
  const typed = scoredRows
    .map((g) => dnaCatOfType(g.goalType))
    .filter((c): c is NonNullable<ReturnType<typeof dnaCatOfType>> => c != null);
  if (typed.length >= 6) {
    const counts = new Map<string, number>();
    for (const c of typed) counts.set(c, (counts.get(c) ?? 0) + 1);
    const order = ["setPiece", "frontThird", "middleThird", "backThird"] as const;
    const bits = order
      .filter((c) => (counts.get(c) ?? 0) > 0)
      .map((c) => {
        const n = counts.get(c)!;
        return `${dnaCatLabel(c)} ${n} (${Math.round((n / typed.length) * 100)}%)`;
      });
    lines.push(
      `Goal DNA — where their goals come from (${typed.length} of ${scoredRows.length} goals have the story recorded): ${bits.join(", ")}.`,
    );
  }

  // ── Timing bands — late-game character ────────────────────────────────────
  const latePct = (mins: number[]) =>
    mins.length >= 5 ? (mins.filter((m) => m >= 75).length / mins.length) * 100 : null;
  const scoredMins = scoredRows.map((g) => g.minuteScored).filter((m): m is number => m != null);
  const concededMins = concededRows.map((g) => g.minuteScored).filter((m): m is number => m != null);
  const lateScore = latePct(scoredMins);
  const lateConc = latePct(concededMins);
  if (lateScore != null && lateScore >= 35) {
    lines.push(
      `${lateScore.toFixed(0)}% of their goals come after the 75th minute (${scoredMins.filter((m) => m >= 75).length} of ${scoredMins.length} with a minute recorded) — they stay dangerous to the final whistle.`,
    );
  }
  if (lateConc != null && lateConc >= 35) {
    lines.push(
      `They fade late — ${lateConc.toFixed(0)}% of what they concede comes after the 75th minute (${concededMins.filter((m) => m >= 75).length} of ${concededMins.length} with a minute recorded).`,
    );
  }

  // ── Transition-intel scouting reads — threat lanes, press, set pieces ─────
  const toIntel = (rows: typeof scoredRows): IntelGoal[] =>
    rows.map((g) => ({
      goalType: g.goalType ?? null,
      passString: g.passString ?? null,
      buildupLane: g.buildupLane ?? null,
      scorer: g.scorer ?? null,
      assist: g.assist ?? null,
      howPenetrated: g.howPenetrated ?? null,
      assistType: g.assistType ?? null,
    }));
  const intel = goalIntelReads(toIntel(scoredRows), toIntel(concededRows), "scout")
    .sort((a, b) => b.w - a.w)
    .slice(0, 4);
  for (const r of intel) lines.push(r.text);

  return lines.join("\n");
}

// ── Veo possession / passing context helpers ───────────────────────────────

type PassSummary = NonNullable<ReturnType<typeof summarisePassDetails>>;

/** Legacy Veo rows belong to the league's configured focus club. */
async function clubOwnsLegacyVeo(leagueId: number, club: string): Promise<boolean> {
  const [league] = await db
    .select({ focusClub: leaguesTable.focusClub })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId))
    .limit(1);
  const owner = league?.focusClub?.trim() || "Belconnen";
  return owner.toLowerCase() === club.trim().toLowerCase();
}

function possessionPct(s: PassSummary): number | null {
  const total = s.possessionSecUs + s.possessionSecThem;
  if (total <= 0) return null;
  return Math.round((s.possessionSecUs / total) * 100);
}

function longStringsCount(strings: PassSummary["passStringsUs"], minLen = 6): number {
  return strings.filter((e) => e.len >= minLen).reduce((acc, e) => acc + e.count, 0);
}

function thirdsDistribution(t: { defensive: number; middle: number; attacking: number }): string | null {
  const total = t.defensive + t.middle + t.attacking;
  if (total <= 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  return `def ${pct(t.defensive)}% / mid ${pct(t.middle)}% / att ${pct(t.attacking)}%`;
}

function confidenceLabel(n: number): string {
  if (n >= 6) return "Strong evidence";
  if (n >= 3) return "Emerging pattern";
  return "Observation (limited games)";
}

/**
 * Summarise our own possession/passing trends from the last `lastN`
 * Veo-recorded games for a league, in the house hedged-voice style.
 */
export async function recentPassingContext(
  leagueId: number,
  focusClub: string,
  lastN = 3,
): Promise<string | null> {
  if (!(await clubOwnsLegacyVeo(leagueId, focusClub))) return null;
  const rows = await db
    .select({
      id: veoMatchesTable.id,
      startsAt: veoMatchesTable.startsAt,
      opponent: veoMatchesTable.opponent,
      passDetails: veoMatchesTable.passDetails,
      periods: veoMatchesTable.periods,
      directionOverrides: veoMatchesTable.directionOverrides,
    })
    .from(veoMatchesTable)
    .where(
      and(
        eq(veoMatchesTable.leagueId, leagueId),
        sql`${veoMatchesTable.passDetails} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${veoMatchesTable.startsAt} DESC NULLS LAST`);

  const summaries: { opponent: string | null; s: PassSummary }[] = [];
  for (const r of rows) {
    if (summaries.length >= lastN) break;
    const s = summarisePassDetails(
      r.passDetails,
      effectiveVeoPeriods(r.periods, r.directionOverrides),
    );
    if (s) summaries.push({ opponent: r.opponent, s });
  }
  if (!summaries.length) return null;

  const n = summaries.length;
  const pcts = summaries.map((x) => possessionPct(x.s)).filter((v): v is number => v !== null);
  const strings6 = summaries.map((x) => longStringsCount(x.s.passStringsUs));

  const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const minPct = pcts.length ? Math.min(...pcts) : null;
  const maxPct = pcts.length ? Math.max(...pcts) : null;
  const avgStrings6 = Math.round(strings6.reduce((a, b) => a + b, 0) / n);

  // Thirds: average across all summaries
  const totalThirds = summaries.reduce(
    (acc, x) => ({
      defensive: acc.defensive + x.s.thirdsUs.defensive,
      middle: acc.middle + x.s.thirdsUs.middle,
      attacking: acc.attacking + x.s.thirdsUs.attacking,
    }),
    { defensive: 0, middle: 0, attacking: 0 },
  );
  const thirdsStr = thirdsDistribution(totalThirds);

  const confidence = confidenceLabel(n);
  const lines: string[] = [
    `Our possession & passing — last ${n} Veo-recorded game${n === 1 ? "" : "s"} (${confidence.toLowerCase()}):`,
  ];

  if (avgPct !== null && pcts.length > 0) {
    const rangeStr =
      pcts.length > 1 && minPct !== maxPct ? ` (range ${minPct}%–${maxPct}%)` : "";
    lines.push(`  Possession: ${avgPct}%${rangeStr} on average.`);
  }
  lines.push(`  Sequences of 6+ passes: ${avgStrings6} per game on average.`);
  if (thirdsStr) lines.push(`  Where we held the ball (combined): ${thirdsStr}.`);

  // Add a hedged observation line when there's enough to say something
  if (pcts.length >= 2) {
    if (avgPct !== null && avgPct >= 55) {
      lines.push(
        `  The available evidence suggests we've dominated possession — consistent with the build-up-heavy identity when that share has held across multiple games.`,
      );
    } else if (avgPct !== null && avgPct < 45) {
      lines.push(
        `  The available evidence suggests we've been under possession pressure recently — may indicate opponents sitting deeper or our build-up recycling breaking down.`,
      );
    }
    if (avgStrings6 >= 8) {
      lines.push(`  6+ pass sequences are consistent with a controlled, patient build-up phase.`);
    } else if (avgStrings6 <= 3) {
      lines.push(
        `  Low sustained sequence count — may indicate early ball losses, a high-press opponent, or a more direct intent from kick-off.`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Passing/possession numbers from the most recent Veo-recorded meeting vs
 * this opponent, giving their side of the story.
 */
export async function opponentPassingContext(
  leagueId: number,
  focusClub: string,
  opponent: string,
): Promise<string | null> {
  if (!(await clubOwnsLegacyVeo(leagueId, focusClub))) return null;
  const oppLc = opponent.trim().toLowerCase();
  const rows = await db
    .select({
      id: veoMatchesTable.id,
      startsAt: veoMatchesTable.startsAt,
      opponent: veoMatchesTable.opponent,
      passDetails: veoMatchesTable.passDetails,
      periods: veoMatchesTable.periods,
      directionOverrides: veoMatchesTable.directionOverrides,
    })
    .from(veoMatchesTable)
    .where(
      and(
        eq(veoMatchesTable.leagueId, leagueId),
        sql`${veoMatchesTable.passDetails} IS NOT NULL`,
        sql`LOWER(${veoMatchesTable.opponent}) = ${oppLc}`,
      ),
    )
    .orderBy(sql`${veoMatchesTable.startsAt} DESC NULLS LAST`);

  for (const r of rows) {
    const s = summarisePassDetails(
      r.passDetails,
      effectiveVeoPeriods(r.periods, r.directionOverrides),
    );
    if (!s) continue;

    const theirPct = (() => {
      const total = s.possessionSecUs + s.possessionSecThem;
      if (total <= 0) return null;
      return Math.round((s.possessionSecThem / total) * 100);
    })();
    const theirStrings6 = longStringsCount(s.passStringsThem);
    const theirThirds = thirdsDistribution(s.thirdsThem);

    const dateLbl = r.startsAt
      ? new Date(r.startsAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
      : null;

    const lines = [
      `${opponent}'s Veo numbers — last recorded meeting${dateLbl ? ` (${dateLbl})` : ""}:`,
    ];
    if (theirPct !== null) lines.push(`  Their possession: ${theirPct}%.`);
    lines.push(`  Their 6+ pass sequences: ${theirStrings6}.`);
    if (theirThirds) lines.push(`  Their possession thirds: ${theirThirds}.`);
    return lines.join("\n");
  }
  return null;
}

// ── Week-ahead server-side context lookups ─────────────────────────────────

/** Headline-fact lines from the most recent league meeting vs `opponent` this season. */
export async function lastMeetingFacts(
  seasonId: number,
  opponent: string,
  requestedFocusClub?: string,
): Promise<string[]> {
  const focus = requestedFocusClub ?? await focusClubForSeason(seasonId);
  const opp = opponent.trim().toLowerCase();
  const isMeeting = (home: string | null, away: string | null) => {
    const h = (home ?? "").trim().toLowerCase();
    const a = (away ?? "").trim().toLowerCase();
    const f = focus.trim().toLowerCase();
    return (h === f && a === opp) || (a === f && h === opp);
  };
  const matches = (
    await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.seasonId, seasonId))
  )
    .filter(
      (m) => isMeeting(m.homeTeam, m.awayTeam) && m.homeGoals != null && m.awayGoals != null,
    )
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));
  const m = matches[0];
  if (!m) return []; // first meeting of the season — nothing to report

  const usHome = (m.homeTeam ?? "").trim().toLowerCase() === focus.trim().toLowerCase();
  const our = usHome ? m.homeGoals! : m.awayGoals!;
  const their = usHome ? m.awayGoals! : m.homeGoals!;
  const res = our > their ? "won" : our < their ? "lost" : "drew";
  // league_matches dates are sortable "yyyy/mm/dd" strings — show them nicely.
  const niceDate = (md: string | null): string => {
    if (!md) return "";
    const t = new Date(md.replace(/\//g, "-"));
    return Number.isNaN(t.getTime())
      ? md
      : t.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  };
  const lines: string[] = [
    `We ${res} ${our}–${their} (${usHome ? "home" : "away"}${m.matchDate ? `, ${niceDate(m.matchDate)}` : ""}).`,
  ];

  const goals = (
    await db
      .select()
      .from(leagueGoalsTable)
      .where(
        and(eq(leagueGoalsTable.seasonId, seasonId), eq(leagueGoalsTable.matchId, m.matchId)),
      )
  ).sort((a, b) => (Number(a.minuteScored) || 999) - (Number(b.minuteScored) || 999));
  for (const g of goals) {
    const ours = (g.scorerTeam ?? "").trim().toLowerCase() === focus.trim().toLowerCase();
    const cat = dnaCatOfType(g.goalType);
    const type = g.goalType
      ? `${g.goalType}${cat ? ` — ${dnaCatLabel(cat)}` : ""}`
      : "type not recorded";
    const min = g.minuteScored ? `${g.minuteScored}' ` : "";
    lines.push(
      `${min}${ours ? "Us" : "Them"}: ${g.scorer ?? "unknown scorer"}${g.assist ? ` (assist ${g.assist})` : ""} — ${type}`,
    );
  }
  return lines;
}

/** Condensed text from our latest saved Friday pre-match deck whose game has
 * been played. Pass `opponent` to instead get the latest played deck vs that
 * club — the plan we took into the previous meeting. */
export async function previousDeckText(
  leagueId: number,
  opponent: string | undefined,
  club: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(matchPrepReportsTable)
    .where(
      and(
        eq(matchPrepReportsTable.leagueId, leagueId),
        eq(matchPrepReportsTable.club, club),
        eq(matchPrepReportsTable.kind, "friday"),
      ),
    );
  const now = Date.now();
  const time = (md: string | null) => {
    if (!md) return NaN;
    const t = new Date(md).getTime(); // "2 August 2026" parses in V8
    return Number.isNaN(t) ? NaN : t;
  };
  const oppLc = opponent?.trim().toLowerCase();
  // Older rows may only carry the opponent inside the jsonb payload.
  const rowOpp = (r: (typeof rows)[number]): string => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return (r.opponent ?? (typeof d.opponent === "string" ? d.opponent : "")).trim().toLowerCase();
  };
  const played = rows
    .filter((r) => !oppLc || rowOpp(r) === oppLc)
    .map((r) => ({ r, t: time(r.matchDate) }))
    .filter((x) => !Number.isNaN(x.t) && x.t <= now)
    .sort((a, b) => b.t - a.t);
  const pick = played[0]?.r;
  if (!pick) return null;

  const d = (pick.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  const unit = (k: string) => {
    const u = (d[k] ?? {}) as Record<string, unknown>;
    const theme = typeof u.theme === "string" ? u.theme.trim() : "";
    const arrs = ["gk", "defenders", "midfielders", "attackers"]
      .flatMap((g) => (Array.isArray(u[g]) ? (u[g] as unknown[]) : []))
      .filter((x): x is string => typeof x === "string" && !!x.trim());
    if (!theme && !arrs.length) return "";
    return `${theme ? `${theme}. ` : ""}${arrs.join("; ")}`;
  };
  const parts = [
    `Opponent: ${pick.opponent ?? (str("opponent") || "?")}${pick.matchDate ? ` (${pick.matchDate})` : ""}`,
    str("gamePlan") && `Game plan: ${str("gamePlan")}`,
    unit("bp") && `In possession: ${unit("bp")}`,
    unit("bpo") && `Out of possession: ${unit("bpo")}`,
    str("commentsTrends") && `Comments/trends: ${str("commentsTrends")}`,
    str("ourBpNotes") && `Our BP notes: ${str("ourBpNotes")}`,
    str("ourBpoNotes") && `Our BPO notes: ${str("ourBpoNotes")}`,
  ].filter(Boolean) as string[];
  if (parts.length <= 1) return null; // a deck with no written content isn't worth quoting
  return parts.join("\n").slice(0, 2000);
}

function assistantReflectionTime(entry: {
  entryDate: string | null;
  createdAt: Date;
}): number {
  const raw = entry.entryDate?.trim() ?? "";
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (dmy) {
    const parsed = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  const parsed = raw ? new Date(raw.replace(/\//g, "-")).getTime() : NaN;
  return Number.isNaN(parsed) ? entry.createdAt.getTime() : parsed;
}

function compactAssistantEvidence(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

async function recentAssistantReflections(
  leagueId: number,
  club: string,
  conversationText: string,
): Promise<string | null> {
  const rows = await db
    .select({
      kind: journalEntriesTable.kind,
      title: journalEntriesTable.title,
      entryDate: journalEntriesTable.entryDate,
      content: journalEntriesTable.content,
      source: journalEntriesTable.source,
      createdAt: journalEntriesTable.createdAt,
    })
    .from(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.leagueId, leagueId),
        eq(journalEntriesTable.club, club),
        isNull(journalEntriesTable.cycleId),
        sql`${journalEntriesTable.kind} IN ('session_reflection', 'match_reflection')`,
      ),
    )
    .orderBy(desc(journalEntriesTable.updatedAt))
    .limit(20);
  if (!rows.length) return null;

  const sorted = [...rows].sort((a, b) => assistantReflectionTime(b) - assistantReflectionTime(a));
  const threeWeeksAgo = Date.now() - 22 * 24 * 60 * 60 * 1000;
  const windowed = sorted.filter((entry) => assistantReflectionTime(entry) >= threeWeeksAgo).slice(0, 10);
  const candidates = windowed.length ? windowed : sorted.slice(0, 6);
  const queryTokens = [...new Set(
    (conversationText.toLowerCase().match(/[a-z]{5,}/g) ?? [])
      .filter((token) => ![
        "against", "based", "could", "their", "results", "recent",
        "reflections", "session", "sessions", "training", "would",
      ].includes(token)),
  )];
  const blocks = candidates
    .map((entry) => {
      const answerText = Object.values(entry.content ?? {})
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .join(" ");
      const score = queryTokens.filter((token) => answerText.toLowerCase().includes(token)).length;
      return { entry, answerText, score, time: assistantReflectionTime(entry) };
    })
    .filter(({ answerText }) => Boolean(answerText.trim()))
    .sort((a, b) => b.score - a.score || b.time - a.time)
    .slice(0, 6)
    .map(({ entry, answerText }) => {
      const kind = entry.kind === "match_reflection" ? "Match reflection" : "Session reflection";
      const label = entry.title?.trim() || kind;
      return `${label}${entry.entryDate ? ` (${entry.entryDate})` : ""} [coach-authored, ${entry.source}]\n${compactAssistantEvidence(answerText, 320)}`;
    })
    .filter(Boolean);
  return blocks.length ? blocks.join("\n\n").slice(0, 2200) : null;
}

async function savedAssistantMatchReports(
  leagueId: number,
  club: string,
  opponent: string | null,
): Promise<string | null> {
  const rows = await db
    .select({
      id: matchReportsTable.id,
      title: matchReportsTable.title,
      opponent: matchReportsTable.opponent,
      matchDate: matchReportsTable.matchDate,
      data: matchReportsTable.data,
    })
    .from(matchReportsTable)
    .where(and(
      eq(matchReportsTable.leagueId, leagueId),
      eq(matchReportsTable.club, club),
    ))
    .orderBy(desc(matchReportsTable.updatedAt))
    .limit(12);
  if (!rows.length) return null;

  const opponentKey = opponent?.trim().toLowerCase() ?? null;
  const opponentReport = opponentKey
    ? rows.find((row) => row.opponent?.trim().toLowerCase() === opponentKey)
    : null;
  const picked = [rows[0], opponentReport]
    .filter((row): row is (typeof rows)[number] => Boolean(row))
    .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index);

  const blocks = picked.map((saved) => {
    const snapshot = saved.data as {
      report?: {
        insights?: Array<{ text?: string }>;
        ballUse?: { comments?: string[] } | null;
        goalDna?: {
          comments?: string[];
          tacticalRead?: Array<{ text?: string } | string>;
        } | null;
      };
    };
    const notes = [
      ...(snapshot.report?.insights ?? []).map((entry) => entry.text),
      ...(snapshot.report?.ballUse?.comments ?? []),
      ...(snapshot.report?.goalDna?.comments ?? []),
      ...(snapshot.report?.goalDna?.tacticalRead ?? []).map((entry) =>
        typeof entry === "string" ? entry : entry.text
      ),
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .slice(0, 4)
      .map((value) => compactAssistantEvidence(value, 260));
    if (!notes.length) return "";
    return `${saved.title}${saved.matchDate ? ` (${saved.matchDate})` : ""}\n${notes.join("\n")}`;
  }).filter(Boolean);
  return blocks.length ? blocks.join("\n\n").slice(0, 1800) : null;
}

async function recentAssistantPlayerInvolvement(
  seasonId: number,
  focusClub: string,
  leagueMatches: Array<typeof leagueMatchesTable.$inferSelect>,
): Promise<string | null> {
  const focusKey = focusClub.trim().toLowerCase();
  const recentMatchIds = leagueMatches
    .filter((match) =>
      match.homeTeam.trim().toLowerCase() === focusKey
      || match.awayTeam.trim().toLowerCase() === focusKey
    )
    .filter((match) => match.homeGoals != null && match.awayGoals != null)
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
    .slice(0, 4)
    .map((match) => match.matchId);
  if (!recentMatchIds.length) return null;

  const rows = await db
    .select({
      matchId: leaguePlayerStatsTable.matchId,
      playerName: leaguePlayerStatsTable.playerName,
      minsPlayed: leaguePlayerStatsTable.minsPlayed,
      started: leaguePlayerStatsTable.started,
      appearance: leaguePlayerStatsTable.appearance,
    })
    .from(leaguePlayerStatsTable)
    .where(and(
      eq(leaguePlayerStatsTable.seasonId, seasonId),
      eq(leaguePlayerStatsTable.club, focusClub),
      inArray(leaguePlayerStatsTable.matchId, recentMatchIds),
    ));
  if (!rows.length) return null;

  const byPlayer = new Map<string, { appearances: number; starts: number; minutes: number }>();
  for (const row of rows) {
    if (row.appearance === false && !row.started && !(row.minsPlayed && row.minsPlayed > 0)) continue;
    const current = byPlayer.get(row.playerName) ?? { appearances: 0, starts: 0, minutes: 0 };
    current.appearances += 1;
    if (row.started) current.starts += 1;
    current.minutes += Math.max(0, row.minsPlayed ?? 0);
    byPlayer.set(row.playerName, current);
  }
  const leaders = [...byPlayer.entries()]
    .sort((a, b) =>
      b[1].appearances - a[1].appearances
      || b[1].starts - a[1].starts
      || b[1].minutes - a[1].minutes
      || a[0].localeCompare(b[0])
    )
    .slice(0, 8);
  if (!leaders.length) return null;

  return [
    `Recorded over the team's latest ${recentMatchIds.length} played match${recentMatchIds.length === 1 ? "" : "es"}:`,
    ...leaders.map(([name, totals]) =>
      `- ${name}: ${totals.appearances} app${totals.appearances === 1 ? "" : "s"}, ${totals.starts} start${totals.starts === 1 ? "" : "s"}, ${totals.minutes} min`
    ),
  ].join("\n");
}

export interface AssistantCoachingContextInput {
  request: Request;
  leagueId: number;
  conversationText: string;
  selectedOpponent?: string | null;
  opponentHint?: string | null;
  selectedSeasonId?: number | null;
  includeReflections: boolean;
  includeMatchPrep: boolean;
  includeMatchReports: boolean;
  includeTeamStats: boolean;
  includeVeo: boolean;
}

export interface AssistantCoachingContextResult {
  block: string;
  opponent: string | null;
  seasonId: number | null;
}

/**
 * Build the compact, league-private evidence pack used for conversational
 * Assistant recommendations. Every section states its provenance so recorded
 * results, coach reflections, analyst reads and Veo estimates cannot blur.
 */
export async function buildAssistantCoachingContext(
  input: AssistantCoachingContextInput,
): Promise<AssistantCoachingContextResult> {
  const [league] = await db
    .select({ name: leaguesTable.name })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, input.leagueId))
    .limit(1);
  const focusClub = (await focusClubForLeagueRequest(input.request, input.leagueId)).trim();

  let season = input.selectedSeasonId != null
    ? (
      await db
        .select({ id: seasonsTable.id, label: seasonsTable.label })
        .from(seasonsTable)
        .where(
          and(
            eq(seasonsTable.id, input.selectedSeasonId),
            eq(seasonsTable.leagueId, input.leagueId),
          ),
        )
        .limit(1)
    )[0]
    : null;
  if (!season) {
    season = (
      await db
        .select({ id: seasonsTable.id, label: seasonsTable.label })
        .from(seasonsTable)
        .where(eq(seasonsTable.leagueId, input.leagueId))
        .orderBy(desc(seasonsTable.isActive), desc(seasonsTable.year), desc(seasonsTable.id))
        .limit(1)
    )[0] ?? null;
  }

  const leagueMatches = season
    ? await db.select().from(leagueMatchesTable).where(eq(leagueMatchesTable.seasonId, season.id))
    : [];
  const focusKey = focusClub.toLowerCase();
  const recordedOpponents = [...new Set(
    leagueMatches
      .flatMap((match) => [match.homeTeam, match.awayTeam])
      .filter((club) => club.trim().toLowerCase() !== focusKey),
  )];
  const resolutionText = [input.conversationText, input.opponentHint].filter(Boolean).join("\n");
  const opponent = resolveAssistantOpponent(
    resolutionText,
    recordedOpponents,
    input.selectedOpponent,
  );

  const ourResults = recentResultLines(leagueMatches, focusClub);
  const theirResults = opponent ? recentResultLines(leagueMatches, opponent) : [];

  const [
    lastMeeting,
    scout,
    previousOpponentPlan,
    latestPlan,
    savedMondayBrief,
    savedMatchReports,
    ourPassing,
    opponentPassing,
    reflections,
    playerInvolvement,
  ] = await Promise.all([
    season && opponent
      ? lastMeetingFacts(season.id, opponent, focusClub).catch(() => [])
      : Promise.resolve([]),
    season && opponent
      ? opponentScoutFingerprint(season.id, opponent).catch(() => null)
      : Promise.resolve(null),
    input.includeMatchPrep && opponent
      ? previousDeckText(input.leagueId, opponent, focusClub).catch(() => null)
      : Promise.resolve(null),
    input.includeMatchPrep
      ? previousDeckText(input.leagueId, undefined, focusClub).catch(() => null)
      : Promise.resolve(null),
    input.includeMatchPrep && opponent
      ? mondayBriefTextForOpponent(input.leagueId, opponent, focusClub).catch(() => null)
      : Promise.resolve(null),
    input.includeMatchReports
      ? savedAssistantMatchReports(input.leagueId, focusClub, opponent).catch(() => null)
      : Promise.resolve(null),
    input.includeVeo
      ? recentPassingContext(input.leagueId, focusClub).catch(() => null)
      : Promise.resolve(null),
    input.includeVeo && opponent
      ? opponentPassingContext(input.leagueId, focusClub, opponent).catch(() => null)
      : Promise.resolve(null),
    input.includeReflections
      ? recentAssistantReflections(input.leagueId, focusClub, input.conversationText).catch(() => null)
      : Promise.resolve(null),
    input.includeTeamStats && season
      ? recentAssistantPlayerInvolvement(season.id, focusClub, leagueMatches).catch(() => null)
      : Promise.resolve(null),
  ]);

  const sections = [
    `## Weekly coaching decision context
This is permission-scoped evidence for the signed-in coach's team. It is NOT curriculum content.
- League: ${league?.name ?? `league ${input.leagueId}`}${season ? `; season: ${season.label}` : ""}
- Focus team: ${focusClub}
- Opponent: ${opponent ?? "not confidently identified from the selected league and conversation"}
- Private reflections, saved plans, saved reports and Veo detail below are included only when the source is authorised and owned by ${focusClub}.
- Never invent a missing result, reflection, report, scouting pattern or metric.`,
    ourResults.length
      ? `### Our recent form (Official Hub/Dribl recorded league results)\n${ourResults.map((line) => `- ${line}`).join("\n")}`
      : `### Our recent form (Official Hub/Dribl)\n- No played results are available for the selected season.`,
    playerInvolvement
      ? `### Recent player involvement (Official Hub/Dribl recorded appearances — not an injury, availability or performance judgement)\n${playerInvolvement}`
      : input.includeTeamStats
        ? `### Recent player involvement\n- No recorded appearance sample is available for this team in the selected season.`
        : `### Recent player involvement\n- Not included because this account does not have Season Stats access for the league.`,
    opponent
      ? theirResults.length
        ? `### ${opponent}'s recent form (Official Hub/Dribl recorded league results)\n${theirResults.map((line) => `- ${line}`).join("\n")}`
        : `### ${opponent}'s recent form (Official Hub/Dribl)\n- No played results are available. Say the evidence is thin.`
      : `### Opponent evidence\n- No opponent was confidently identified. Ask one short clarifying question if the answer depends on an opponent.`,
    lastMeeting.length
      ? `### Previous meeting with ${opponent} (Official Hub/Dribl recorded facts)\n${lastMeeting.map((line) => `- ${line}`).join("\n").slice(0, 1800)}`
      : "",
    scout
      ? `### ${opponent} scouting fingerprint (computed from Official Hub/Dribl league data)\n${scout.slice(0, 1800)}`
      : "",
    reflections
      ? `### Recent reflections (coach-authored interpretation — not official facts or curriculum)\n${reflections}`
      : input.includeReflections
        ? `### Recent reflections\n- No recent coach-authored reflections are available.`
        : `### Recent reflections\n- Not included because this account does not have Reflection Journal access for the league.`,
    savedMondayBrief
      ? `### Latest saved Week Ahead brief for ${opponent} (analyst/coach interpretation — not official facts or curriculum)\n${savedMondayBrief.slice(0, 1000)}`
      : "",
    previousOpponentPlan
      ? `### Previous saved match plan for ${opponent} (coach-authored plan — not official facts or curriculum)\n${previousOpponentPlan.slice(0, 1200)}`
      : !input.includeMatchPrep
        ? `### Saved Match Prep material\n- Not included because this account does not have Match Prep access for the league.`
        : "",
    latestPlan && latestPlan !== previousOpponentPlan && !previousOpponentPlan
      ? `### Our latest saved match plan (coach-authored plan — not official facts or curriculum)\n${latestPlan.slice(0, 1200)}`
      : "",
    savedMatchReports
      ? `### Saved Football Match Report notes (Hub analyst interpretation — not official facts or curriculum)\n${savedMatchReports}`
      : !input.includeMatchReports
        ? `### Saved Football Match Report notes\n- Not included because this account does not have Season Stats access for the league.`
        : "",
    ourPassing
      ? `### Our recent possession and passing (Camera-derived Veo estimates — not official facts)\n${ourPassing.slice(0, 1600)}`
      : input.includeVeo
        ? `### Veo trend evidence\n- No recent camera-derived possession and passing trend is available.`
        : `### Veo trend evidence\n- Not included because Veo access or provable club ownership is unavailable for this team.`,
    opponentPassing
      ? `### ${opponent}'s last recorded passing profile (Camera-derived Veo estimates — not official facts)\n${opponentPassing.slice(0, 1000)}`
      : "",
  ].filter(Boolean);

  return {
    block: sections.join("\n\n").slice(0, 12000),
    opponent,
    seasonId: season?.id ?? null,
  };
}

export interface WeekAheadServerEvidenceInput {
  seasonId: number | null;
  leagueId: number;
  opponent: string;
  focusClub: string;
  includeVeo: boolean;
}

/** Server-owned evidence supplied to the Monday Week Ahead generation. */
export async function buildWeekAheadServerEvidence(input: WeekAheadServerEvidenceInput) {
  const [lastMeeting, prevDeck, prevOppDeck, scout, ourPassing, oppPassing] = await Promise.all([
    input.seasonId != null
      ? lastMeetingFacts(input.seasonId, input.opponent, input.focusClub).catch(() => [])
      : Promise.resolve([]),
    previousDeckText(input.leagueId, undefined, input.focusClub).catch(() => null),
    previousDeckText(input.leagueId, input.opponent, input.focusClub).catch(() => null),
    input.seasonId != null
      ? opponentScoutFingerprint(input.seasonId, input.opponent).catch(() => null)
      : Promise.resolve(null),
    input.includeVeo
      ? recentPassingContext(input.leagueId, input.focusClub).catch(() => null)
      : Promise.resolve(null),
    input.includeVeo
      ? opponentPassingContext(input.leagueId, input.focusClub, input.opponent).catch(() => null)
      : Promise.resolve(null),
  ]);
  return { lastMeeting, prevDeck, prevOppDeck, scout, ourPassing, oppPassing };
}

// POST /journal/week-ahead-brief — review bullets + prep pointers for the Monday report
router.post("/journal/week-ahead-brief", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = CreateWeekAheadBriefBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { opponent, seasonId, reflectionsText, lastVsOpponentText, theirGamesText,
      ourGamesText, lastMeetingText, lastReportText, prevMeetingPrepText } = parsed.data;
    let { leagueId } = parsed.data;

    if (seasonId != null) {
      const [season] = await db
        .select({ leagueId: seasonsTable.leagueId })
        .from(seasonsTable)
        .where(eq(seasonsTable.id, seasonId));
      if (!season) return res.status(400).json({ error: "Unknown seasonId" });
      if (leagueId != null && leagueId !== season.leagueId) {
        return res.status(400).json({ error: "seasonId and leagueId belong to different leagues" });
      }
      leagueId = season.leagueId;
    }
    if (leagueId == null) {
      return res.status(400).json({ error: "leagueId or seasonId is required" });
    }

    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (
      !user.isSuperadmin
      && (!canSeeLeague(user, leagueId) || !hasModule(user, leagueId, "match-prep"))
    ) {
      return res.status(403).json({ error: "No Match Prep access for this league" });
    }
    const focusClub = await focusClubForLeagueRequest(req, leagueId);
    const [leagueScope] = await db
      .select({ focusClub: leaguesTable.focusClub })
      .from(leaguesTable)
      .where(eq(leaguesTable.id, leagueId))
      .limit(1);
    const defaultClub = leagueScope?.focusClub?.trim() || "Belconnen";
    const includeVeo =
      (user.isSuperadmin || hasModule(user, leagueId, "veo"))
      && focusClub.toLowerCase() === defaultClub.toLowerCase();

    // Server-side context: the last league meeting vs this opponent, our
    // latest saved pre-match deck, the deck we took into the previous meeting
    // vs this opponent, their scouting fingerprint, and Veo passing trends.
    // All optional — first meeting / no saved deck / thin data simply
    // contributes nothing.
    const { lastMeeting, prevDeck, prevOppDeck, scout, ourPassing, oppPassing } =
      await buildWeekAheadServerEvidence({
        seasonId: seasonId ?? null,
        leagueId,
        opponent,
        focusClub,
        includeVeo,
      });

    const sections = [
      reflectionsText ? `## The coach's recent reflections\n${reflectionsText}` : "",
      lastMeeting.length
        ? `## What actually happened last time we played ${opponent} this season\n${lastMeeting.join("\n")}`
        : "",
      lastVsOpponentText
        ? `## His match reflection from the last time we played ${opponent}\n${lastVsOpponentText}`
        : "",
      lastMeetingText
        ? `## What actually happened last time we played ${opponent} (recorded match facts)\n${lastMeetingText}`
        : "",
      lastReportText ? `## Our most recent match report (analyst's read of our last game)\n${lastReportText}` : "",
      prevDeck ? `## Our match plan from our most recent game\n${prevDeck}` : "",
      prevOppDeck && prevOppDeck !== prevDeck
        ? `## The match plan we took into the previous meeting vs ${opponent}\n${prevOppDeck}`
        : "",
      prevMeetingPrepText
        ? `## What we worked on in training before the last meeting vs ${opponent}\n${prevMeetingPrepText}`
        : "",
      scout ? `## ${opponent}'s season scouting fingerprint (recorded league data)\n${scout}` : "",
      ourPassing ? `## Our possession & passing trends (Veo data)\n${ourPassing}` : "",
      oppPassing ? `## ${opponent}'s Veo passing numbers — last recorded meeting\n${oppPassing}` : "",
      theirGamesText ? `## ${opponent}'s last 3 games\n${theirGamesText}` : "",
      ourGamesText ? `## Our (${focusClub}) last 3 games\n${ourGamesText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await openaiJson(
      "/chat/completions",
      {
        model: "gpt-4o",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an assistant coach preparing a Monday "Week Ahead" briefing for the head coach of ${focusClub}. This week's opponent: ${opponent}.
Return JSON: {"review": string[], "pointers": string[], "trainingFocus": string[]}.
- "review": 3-5 bullets summarising the coach's OWN recent reflections — what went well, what he flagged to fix, and anything he said he'd do differently. Write in second person ("you noted..."). Only use what he actually wrote. His reflections may span the last few weeks: when the same theme recurs across weeks, say so explicitly ("third week running you've flagged...") — a recurring thread matters more than a one-off from the latest session.
- "pointers": 3-6 short, practical prep pointers for the week ahead, drawing the opponent's recent results/scorers, the last meeting's recorded facts, our last match report, Veo possession/passing trends, and his own notes together (e.g. dangers to plan for, threads to carry into the two training sessions). Don't let the latest week dominate: weigh the last 2-3 weeks of reflections together, and where the inputs include what we worked on or planned before the previous meeting vs this opponent, connect back to it ("before the last ${opponent} game you worked on X — it paid off / it's still the gap"). When Veo passing data is provided (for us or for them), include a pointer grounded in it — e.g. if our possession has been low ("our build-up has been under pressure — look to get an early foothold this week"), or if the opponent had high sustained sequences last time ("they moved the ball well last meeting — we'll need to be compact and press our triggers").
- If the last-meeting facts or last match report are provided, at least one pointer must build on them — continuity from what actually happened, not generic advice. When the input includes our match plan from our most recent game, carry forward anything still relevant rather than starting from scratch.
- "trainingFocus": 2-4 suggested training focuses for this week's sessions. Each must be grounded in one of: something ${opponent} is strong at (recently or against us last time) that we should prepare for; something they're weak at that we could exploit; something we've struggled with recently ourselves; or something that worked last time we played them and is worth sharpening again. Name the evidence in the bullet itself ("they've scored 3 from corners in their last 3 — rehearse defending set pieces"). Only suggest what the data or his notes actually support — fewer, grounded suggestions beat padded ones.
- Use the club's principles-of-play vocabulary where it fits naturally — specifically the U16+/senior phase language, since this app serves U18s and above: patience in buildup when the opponent is organised; penetrate / break the line when the moment arrives, don't force it; be brave and take responsibility; transition is the 5-7 seconds after losing or winning the ball — think faster, move faster, dominate transitions through anticipation, not reaction; losing the ball is a collective emergency ("lose it — close it"); stay compact vertically and horizontally, reduce the space between the lines, compact when we lose it; control the tempo — accelerate or secure; fast brain, calm feet. Never force a term where it doesn't fit the facts.
- Plain spoken English, each bullet under 30 words, no headings, no numbering, no invented facts. If a section of input is missing, simply use what is there.`,
          },
          { role: "user", content: sections || "(no input provided)" },
        ],
      },
      key,
    );
    const out = safeJsonParse(result?.choices?.[0]?.message?.content);
    const clean = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    const review = clean(out.review);
    const pointers = clean(out.pointers);
    const trainingFocus = clean(out.trainingFocus);
    if (!review.length && !pointers.length) {
      return res.status(502).json({ error: "The briefing came back empty. Please try again." });
    }
    return res.json({ review, pointers, trainingFocus, lastMeeting });
  } catch (err) {
    return next(err);
  }
});

// GET /journal/last-meeting — headline facts from the last league meeting vs
// an opponent this season, shown in the Week Ahead card as soon as the
// opponent is picked.
router.get("/journal/last-meeting", async (req, res, next) => {
  try {
    const seasonId = Number(req.query.seasonId);
    const opponent = typeof req.query.opponent === "string" ? req.query.opponent.trim() : "";
    if (!Number.isFinite(seasonId) || !opponent) {
      return res.status(400).json({ error: "seasonId and opponent are required" });
    }
    const focusClub = await focusClubForRequest(req, seasonId);
    const facts = await lastMeetingFacts(seasonId, opponent, focusClub);
    return res.json({ facts });
  } catch (err) {
    return next(err);
  }
});

// Router-level error handler: turn an out-of-credits OpenAI account into a
// specific, user-facing message instead of a generic 500.
router.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (err instanceof OpenAiQuotaError) {
      return res.status(402).json({ error: err.message });
    }
    return next(err);
  },
);

export default router;
