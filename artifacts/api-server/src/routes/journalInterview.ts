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
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, leagueMatchesTable, leagueGoalsTable, matchPrepReportsTable } from "@workspace/db";
import { focusClubForSeason } from "../lib/focusClub";
import { dnaCatOfType, dnaCatLabel } from "../lib/goalDnaStory";
import {
  JournalInterviewSpeakBody,
  JournalInterviewTurnBody,
  JournalInterviewWriteupBody,
  CreateWeekAheadBriefBody,
  CreatePrematchBriefBody,
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

// ── Week-ahead server-side context lookups ─────────────────────────────────

/** Headline-fact lines from the most recent league meeting vs `opponent` this season. */
export async function lastMeetingFacts(seasonId: number, opponent: string): Promise<string[]> {
  const focus = await focusClubForSeason(seasonId);
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

/** Condensed text from our latest saved Friday pre-match deck whose game has been played. */
export async function previousDeckText(leagueId: number): Promise<string | null> {
  const rows = await db
    .select()
    .from(matchPrepReportsTable)
    .where(
      and(eq(matchPrepReportsTable.leagueId, leagueId), eq(matchPrepReportsTable.kind, "friday")),
    );
  const now = Date.now();
  const time = (md: string | null) => {
    if (!md) return NaN;
    const t = new Date(md).getTime(); // "2 August 2026" parses in V8
    return Number.isNaN(t) ? NaN : t;
  };
  const played = rows
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

// POST /journal/week-ahead-brief — review bullets + prep pointers for the Monday report
router.post("/journal/week-ahead-brief", async (req, res, next) => {
  try {
    const key = apiKey();
    if (!key) return noKey(res);
    const parsed = CreateWeekAheadBriefBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { opponent, seasonId, leagueId, reflectionsText, lastVsOpponentText, theirGamesText,
      ourGamesText, lastMeetingText, lastReportText } = parsed.data;

    // Server-side context: the last league meeting vs this opponent and our
    // latest saved pre-match deck. Both are optional — first meeting of the
    // season / no saved deck simply contributes nothing.
    const [lastMeeting, prevDeck] = await Promise.all([
      seasonId != null ? lastMeetingFacts(seasonId, opponent).catch(() => []) : Promise.resolve([]),
      leagueId != null ? previousDeckText(leagueId).catch(() => null) : Promise.resolve(null),
    ]);

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
      theirGamesText ? `## ${opponent}'s last 3 games\n${theirGamesText}` : "",
      ourGamesText ? `## Our (Belconnen) last 3 games\n${ourGamesText}` : "",
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
            content: `You are an assistant coach preparing a Monday "Week Ahead" briefing for the head coach of Belconnen United (NPLW football). This week's opponent: ${opponent}.
Return JSON: {"review": string[], "pointers": string[]}.
- "review": 3-5 bullets summarising the coach's OWN recent reflections — what went well, what he flagged to fix, and anything he said he'd do differently. Write in second person ("you noted..."). Only use what he actually wrote.
- "pointers": 3-6 short, practical prep pointers for the week ahead, drawing the opponent's recent results/scorers, the last meeting's recorded facts, our last match report, and his own notes together (e.g. dangers to plan for, threads to carry into the two training sessions).
- If the last-meeting facts or last match report are provided, at least one pointer must build on them — continuity from what actually happened, not generic advice. When the input includes our match plan from our most recent game, carry forward anything still relevant rather than starting from scratch.
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
    if (!review.length && !pointers.length) {
      return res.status(502).json({ error: "The briefing came back empty. Please try again." });
    }
    return res.json({ review, pointers, lastMeeting });
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
    const facts = await lastMeetingFacts(seasonId, opponent);
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
