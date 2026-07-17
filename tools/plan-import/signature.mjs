/**
 * Vision-signature spike: describe each diagram image (library renders +
 * docx sample images) with a structured JSON signature via OpenAI vision,
 * then match docx images to library practices by signature similarity.
 *
 * Usage:
 *   node signature.mjs sign <dir> <out.json>   # sign all PNGs in dir (cached)
 *   node signature.mjs match <lib.json> <docx.json>
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

const PROMPT = `You are analysing a football (soccer) training-drill diagram. Return ONLY compact JSON:
{
 "pitch": "full"|"half"|"box"|"grid"|"none",   // playing area shown
 "bg": "black"|"green"|"white"|"other",
 "dots": {"<colour>": <count>, ...},           // player markers by colour (red, blue, yellow, green, white, orange, ...). Count carefully.
 "balls": <count of footballs>,
 "goals": <count of goal frames>,
 "minigoals": <count of small/mini goals>,
 "cones": <count of cone/triangle markers>,
 "arrows": <count of arrows/movement lines>,
 "zones": <count of marked zones/end-zones/shaded areas>,
 "keeper": true|false,                          // distinct goalkeeper marker
 "desc": "<=20 words describing the drill layout"
}`;

async function sign(dir, outFile) {
  const cache = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
  const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
  let done = 0;
  const queue = files.filter((f) => !cache[f]);
  console.log(`${files.length} images, ${queue.length} to sign`);
  const CONC = 4;
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      const b64 = readFileSync(join(dir, f)).toString("base64");
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const res = await fetch(`${BASE}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
            body: JSON.stringify({
              model: "gpt-5.4-mini",
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: PROMPT },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
                ],
              }],
            }),
          });
          if (res.status === 429) {
            const ra = res.headers.get("retry-after") ?? "15";
            let wait = Number(ra) * 1000;
            if (!Number.isFinite(wait)) wait = new Date(ra).getTime() - Date.now();
            if (!Number.isFinite(wait) || wait < 0) wait = 15000;
            wait = Math.min(wait, 120000) + Math.random() * 3000;
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          const j = await res.json();
          if (j.error) {
            await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
            continue;
          }
          const txt = j.choices?.[0]?.message?.content ?? "";
          const m = txt.match(/\{[\s\S]*\}/);
          if (m) { cache[f] = JSON.parse(m[0]); break; }
          console.log(`no json for ${f}: ${txt.slice(0, 120)}`);
          break;
        } catch (e) {
          console.log(`fail ${f} (attempt ${attempt}): ${e.message}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      done++;
      if (done % 40 === 0) { writeFileSync(outFile, JSON.stringify(cache)); console.log(`…${done}`); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  writeFileSync(outFile, JSON.stringify(cache));
  console.log(`signed: ${Object.keys(cache).length}`);
}

function simScore(a, b) {
  let s = 0;
  if (a.pitch === b.pitch) s += 3;
  if (a.bg === b.bg) s += 1;
  // dot colour-count similarity
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

function match(libFile, docxFile) {
  const lib = JSON.parse(readFileSync(libFile, "utf8"));
  const docx = JSON.parse(readFileSync(docxFile, "utf8"));
  for (const [img, sig] of Object.entries(docx)) {
    const ranked = Object.entries(lib)
      .map(([f, ls]) => ({ f, score: simScore(sig, ls), desc: ls.desc }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 4);
    console.log(`\n${img} :: ${sig.desc}`);
    for (const r of ranked) console.log(`   ${r.f} score=${r.score.toFixed(1)} :: ${r.desc}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "sign") await sign(args[0], args[1]);
else if (cmd === "match") match(args[0], args[1]);
