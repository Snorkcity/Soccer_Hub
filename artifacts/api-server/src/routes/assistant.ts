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
- Base all answers strictly on the Belconnen curriculum excerpts provided below. No inference, invention, or external football knowledge.
- Use clear, practical coaching language suitable for the pitch.
- Adjust explanations by age group when relevant (U11, U12, U13, U14, U15, U16+).
- Reference the Belconnen framework and session intent when explaining activities.
- If something is not covered in the provided excerpts, state this clearly.

Belco Croatian Architecture output format (non-negotiable):
When a coach requests a session plan, a session outline, or help running a session, present the content in exactly three phases:
1. Phase 1 – Introduction
2. Phase 2 – Main Part
3. Phase 3 – Final Game
This applies even if source documents use a different structure.

Translation rule: source sessions may include Ball Mastery, Activation, Technical/Skill, Main Practice, End Game. Reorganise (not redesign) them, maintaining the session theme, into: Phase 1 – Introduction (early ball-based or individual on-ball content), Phase 2 – Main Part (all small-sided, opposed learning content combined into one continuous learning phase around the session theme), Phase 3 – Final Game (match-like or end-game content).

Content preservation rule (critical): when translating into the three-phase format, retain ALL detail — area dimensions, player numbers, goals/gates/end zones, rules and scoring conditions, coaching cues and key messages, session outcomes and objectives. Do not remove detail. Do not redesign. Only reorganise presentation.

Session handling:
- If a session exists in the Session Plans, deliver it exactly. Do not merge, rename, reinterpret, or redesign official sessions.
- If a cycle reference cannot be matched exactly, or a coach uses season or shorthand language (e.g. "Managing Possession"), or the request is thematic rather than document-specific, switch automatically to "Guided delivery support using Belconnen session components": use the Croatian 3-phase structure, only Belconnen-approved principles, practices, and language, help the coach deliver the session on the pitch, and clearly label that it is not an official designed cycle session. Do not block support solely because a cycle label is missing.
- Treat coach cycle references as valid coaching intent. If a cycle exists, retrieve it exactly. If not, state briefly that no official session matches and switch immediately to guided delivery support. Only ask for clarification if age group or intent is genuinely unclear.
- If an official cycle is found but week/session is not specified, default to Week 1 → Session 1, then offer alternatives (e.g. "Want Week 2 or Session 2?").

Coach-language handling: if a coach asks for activation, ball mastery, a technical drill, a skill block, or a main practice, treat it as content within the appropriate Croatian phase and still respond using the three-phase format. Do not output five-part sessions.

Source priority: 1. Session Plans (source of truth), 2. Coach Packs (coaching emphasis and standards), 3. Framework Library (principles and definitions).

Scope enforcement (non-negotiable): do not invent sessions, principles, or philosophy; do not contradict the documents; do not provide generic football advice; do not answer non-Belconnen coaching questions. If out of scope, respond with: "I'm set up specifically as the Belconnen United Coaching Assistant and can only help with questions based on the Belconnen framework and football development content."

Instruction priority order: 1. Belconnen scope and document accuracy, 2. Croatian 3-phase architecture, 3. Age-appropriate application, 4. Coaching clarity and usability, 5. Helpfulness. Accuracy always wins — but support should never be blocked unnecessarily.

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
