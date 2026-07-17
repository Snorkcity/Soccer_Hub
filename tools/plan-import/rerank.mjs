/**
 * Rerank spike: for each docx image, take top-N signature candidates and ask
 * the vision model which candidate (if any) is the SAME drill diagram.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

const lib = JSON.parse(readFileSync("/tmp/sig-lib.json", "utf8"));
const docx = JSON.parse(readFileSync("/tmp/sig-docx.json", "utf8"));

function simScore(a, b) {
  let s = 0;
  if (a.pitch === b.pitch) s += 3;
  if (a.bg === b.bg) s += 1;
  const cols = new Set([...Object.keys(a.dots ?? {}), ...Object.keys(b.dots ?? {})]);
  for (const c of cols) {
    const x = a.dots?.[c] ?? 0, y = b.dots?.[c] ?? 0;
    if (x === 0 && y === 0) continue;
    s += 2 * (1 - Math.abs(x - y) / Math.max(x, y));
    if ((x === 0) !== (y === 0)) s -= 1.5;
  }
  for (const k of ["balls", "goals", "minigoals", "cones", "zones"]) {
    const x = a[k] ?? 0, y = b[k] ?? 0;
    if (x === y) s += 1; else s -= Math.min(Math.abs(x - y) * 0.4, 1.5);
  }
  if ((a.keeper ?? false) === (b.keeper ?? false)) s += 0.5;
  return s;
}

const img = (p) => ({
  type: "image_url",
  image_url: { url: `data:image/png;base64,${readFileSync(p).toString("base64")}` },
});

async function ask(messages) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: "gpt-5.4", messages }),
    });
    if (res.status === 429) {
      const ra = res.headers.get("retry-after") ?? "15";
      let wait = Number(ra) * 1000;
      if (!Number.isFinite(wait)) wait = new Date(ra).getTime() - Date.now();
      if (!Number.isFinite(wait) || wait < 0) wait = 15000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 120000) + Math.random() * 3000));
      continue;
    }
    const j = await res.json();
    if (j.error) { await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); continue; }
    return j.choices?.[0]?.message?.content ?? "";
  }
  return "";
}

const TOPN = 6;
const results = [];
for (const [f, sig] of Object.entries(docx)) {
  const ranked = Object.entries(lib)
    .map(([lf, ls]) => ({ lf, score: simScore(sig, ls) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, TOPN);
  const content = [
    {
      type: "text",
      text: `Image 0 is a football training-drill diagram taken from a coach's session plan. Images 1-${TOPN} are candidate diagrams from the coach's master practice library (same source material, possibly different rendering style/colours/cropping). Which candidate shows the SAME drill (same playing-area layout, same player arrangement/patterns)? Rendering colour differences do not matter; the drill structure must match. Reply ONLY with JSON: {"match": <candidate number 1-${TOPN} or 0 if none match>, "confidence": "high"|"medium"|"low", "why": "<15 words"}`,
    },
    img(join("/tmp/docxflat", f)),
    ...ranked.map((r) => img(join("/tmp/librender", r.lf))),
  ];
  const txt = await ask([{ role: "user", content }]);
  const m = txt.match(/\{[\s\S]*\}/);
  const verdict = m ? JSON.parse(m[0]) : { match: -1, why: txt.slice(0, 80) };
  const matched = verdict.match >= 1 ? ranked[verdict.match - 1].lf : null;
  results.push({ f, matched, verdict, candidates: ranked.map((r) => r.lf) });
  console.log(`${f} -> ${matched ?? "NONE"} (${verdict.confidence ?? "?"}) ${verdict.why ?? ""}`);
}
writeFileSync("/tmp/rerank-results.json", JSON.stringify(results, null, 2));
