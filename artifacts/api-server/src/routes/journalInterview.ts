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
import {
  JournalInterviewSpeakBody,
  JournalInterviewTurnBody,
  JournalInterviewWriteupBody,
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

async function openaiJson(path: string, body: unknown, key: string): Promise<any> {
  const r = await fetch(`${OPENAI_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
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
          "Speak like a sharp, friendly sports radio interviewer talking to a football coach. Brisk, energetic pace — keep it moving, don't drag words out. Warm but efficient.",
        response_format: "mp3",
      }),
    });
    if (!r.ok) {
      const text = await r.text();
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
    const { phase, question, hint, priorAnswer, probeUsed, audioBase64, audioMimeType } =
      parsed.data;

    const transcript = await transcribe(audioBase64, audioMimeType ?? "audio/webm", key);
    if (!transcript) {
      return res.json({
        transcript: "",
        action: phase === "confirm" ? "continue" : "confirm",
        say: "Sorry, I didn't catch that — could you say it again?",
      });
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
              content: `A football coach was just asked: "Anything to add, or shall we move to the next question?" after answering an interview question. Classify his spoken reply.
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

export default router;
