/**
 * Coach Assistant — chat endpoint over the Belconnen development curriculum.
 *
 * Stateless: the client sends the whole message history; the server retrieves
 * the most relevant curriculum chunks (cosine similarity + exact cycle/week/
 * session heading matching), builds the club's system prompt, and streams the
 * answer back as SSE.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { loadChunks, embedTexts, cosine, type CurriculumChunk } from "../assistant/curriculumStore";

const router: IRouter = Router();

const ChatBody = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8000),
  })).min(1).max(40),
});

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

Formatting: use Markdown headings, short paragraphs, and bullet points suited to reading on a phone at the pitch.`;

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        max_completion_tokens: 8192,
        stream: true,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n## Belconnen curriculum excerpts retrieved for this question\n\n${context}` },
          ...messages,
        ],
      }),
    });
    if (!aiRes.ok || !aiRes.body) {
      const text = await aiRes.text();
      logger.error({ status: aiRes.status, text: text.slice(0, 400) }, "Assistant chat request failed");
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
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "The assistant had a problem answering — please try again." })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "The assistant had a problem answering — please try again." });
    }
  }
});

export default router;
