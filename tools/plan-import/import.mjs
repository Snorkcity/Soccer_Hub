/**
 * Import old session plans: match diagrams to library practices, create new
 * image-based practices for unmatched diagrams, clean up typos, and insert
 * practice_variations rows.
 *
 * Prereqs:
 *   - /tmp/parsed/<file>.json        (parse_docx.py output)
 *   - /tmp/oldplans/<file>.docx      (source docs, for image extraction)
 *   - /tmp/sig-lib.json              (library signatures; signature.mjs sign /tmp/librender)
 *   - /tmp/librender/p<id>.png       (library renders, for rerank)
 *
 * Usage: node import.mjs <file1.docx> <file2.docx> ...
 *        node import.mjs --all
 * Idempotent per source file (re-import deletes that file's variations first).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { Resvg } from "@resvg/resvg-js";

const BASE = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const PARSED = "/tmp/parsed";
const PLANS = "/tmp/oldplans";
const IMGCACHE = "/tmp/import-imgs";
const STATE_FILE = "/tmp/import-state.json"; // imageSha -> {practiceId} | {none:true}
mkdirSync(IMGCACHE, { recursive: true });

const FIELD_KEYS = ["rules", "tasks", "progressions", "coachingPoints", "players", "size", "timing", "scoring", "intensity"];
const PART_ORDER = ["warmup", "activation", "introduction", "main", "endgame"];

// ── AI helpers ───────────────────────────────────────────────────────────────
async function chat(model, content, tries = 6) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
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
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return "";
}

const imgPart = (buf) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${buf.toString("base64")}` } });
const jsonOf = (txt) => { const m = txt?.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };

// ── signatures (same scheme as signature.mjs) ────────────────────────────────
const SIG_PROMPT = readFileSync(new URL("./signature.mjs", import.meta.url), "utf8").match(/const PROMPT = `([\s\S]*?)`;/)[1];

// Colour-agnostic: the docx tool and our SVG renderer use totally different
// palettes/backgrounds, so compare dot-group SIZES (sorted), totals and object
// counts — never colours or background.
function simScore(a, b) {
  let s = 0;
  const groups = (x) => Object.values(x.dots ?? {}).filter((n) => n > 0).sort((p, q) => q - p);
  const ga = groups(a), gb = groups(b);
  const ta = ga.reduce((x, y) => x + y, 0), tb = gb.reduce((x, y) => x + y, 0);
  if (ta || tb) s += 4 * (1 - Math.abs(ta - tb) / Math.max(ta, tb, 1));
  const n = Math.max(ga.length, gb.length);
  for (let i = 0; i < n; i++) {
    const x = ga[i] ?? 0, y = gb[i] ?? 0;
    if (x && y) s += 1.5 * (1 - Math.abs(x - y) / Math.max(x, y));
    else s -= 1;
  }
  for (const k of ["balls", "goals", "minigoals", "cones", "zones"]) {
    const x = a[k] ?? 0, y = b[k] ?? 0;
    if (x === y) s += 1; else s -= Math.min(Math.abs(x - y) * 0.4, 1.5);
  }
  if ((a.keeper ?? false) === (b.keeper ?? false)) s += 0.5;
  if (a.pitch === b.pitch) s += 1;
  // desc-token overlap rescues cases where the two signers categorised the
  // same visual element differently (e.g. dot-grid counted as pitch vs dots)
  const STOP = new Set(["a", "an", "the", "of", "with", "and", "in", "on", "at", "to", "two", "small", "large"]);
  const toks = (x) => new Set(String(x.desc ?? "").toLowerCase().match(/[a-z]+/g)?.filter((w) => !STOP.has(w)) ?? []);
  const A = toks(a), B = toks(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const uni = new Set([...A, ...B]).size;
  if (uni) s += 5 * (inter / uni);
  return s;
}

// ── image extraction ─────────────────────────────────────────────────────────
function extractImages(docx) {
  const dir = join(IMGCACHE, docx.replace(".docx", ""));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    execSync(`cd ${JSON.stringify(dir)} && unzip -j -o -qq ${JSON.stringify(join(PLANS, docx))} "word/media/*" || true`);
  }
  return dir;
}

function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

/** Downscale a PNG for storage as a data URI (max 640px wide). */
function shrinkPng(buf) {
  const { w, h } = pngSize(buf);
  const target = Math.min(w, 640);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><image width="${w}" height="${h}" xlink:href="data:image/png;base64,${buf.toString("base64")}"/></svg>`;
  const out = new Resvg(svg, { fitTo: { mode: "width", value: target } }).render();
  return { png: Buffer.from(out.asPng()), w: out.width, h: out.height };
}

function isDiagramCandidate(buf) {
  try {
    const { w, h } = pngSize(buf);
    if (w < 250 || h < 150) return false;
    if (w / h > 0.85 && w / h < 1.15 && w > 700) return false; // club badge
    return true;
  } catch { return false; }
}

// ── matching ─────────────────────────────────────────────────────────────────
const libSig = JSON.parse(readFileSync("/tmp/sig-lib.json", "utf8"));
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

const OVERRIDES = existsSync("/tmp/import-overrides.json")
  ? JSON.parse(readFileSync("/tmp/import-overrides.json", "utf8"))
  : {};

async function matchImage(buf, sha, client, docx, part, fields) {
  if (OVERRIDES[sha]) return { practiceId: OVERRIDES[sha], override: true };
  if (state[sha]) return state[sha];

  // 1. signature (cached separately so decision resets don't re-sign)
  let sig = state[`sig:${sha}`];
  if (!sig) {
    const sigTxt = await chat("gpt-5.4-mini", [{ type: "text", text: SIG_PROMPT }, imgPart(buf)]);
    sig = jsonOf(sigTxt);
    if (!sig) { state[sha] = { none: true, reason: "signature failed" }; saveState(); return state[sha]; }
    state[`sig:${sha}`] = sig;
    saveState();
  }

  // 2. shortlist + rerank against the library
  const ranked = Object.entries(libSig)
    .map(([lf, ls]) => ({ lf, score: simScore(sig, ls) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 10);
  const content = [
    { type: "text", text: `Image 0 is a football training-drill diagram from a coach's session plan. Images 1-10 are candidates from the coach's master practice library (same source material, drawn in a different tool — colours, backgrounds and icon styles ALWAYS differ, ignore them). Which candidate shows the SAME drill (same playing-area layout, same player arrangement/patterns)? Reply ONLY JSON: {"match": <1-10 or 0 if none>, "confidence": "high"|"medium"|"low"}` },
    imgPart(buf),
    ...ranked.map((r) => imgPart(readFileSync(join("/tmp/librender", r.lf)))),
  ];
  const verdict = jsonOf(await chat("gpt-5.4", content));
  if (verdict && verdict.match >= 1 && verdict.confidence !== "low") {
    const pick = ranked[verdict.match - 1];
    // strict pairwise confirmation to weed out plausible-but-wrong candidates
    const confirm = jsonOf(await chat("gpt-5.4", [
      { type: "text", text: `These two images are football training-drill diagrams of possibly the same drill drawn in two different tools. IGNORE all colours, background, icon style (dots vs human figures), line thickness and cropping — these always differ between the tools. Judge ONLY the drill's spatial structure: number and arrangement of playing areas/boxes/zones, goals, and where player groups are positioned. Answer yes if the underlying drill layout is the same, no if the structure differs (different zone counts, different grid arrangement, different goal setup). Reply ONLY JSON: {"same": true|false, "why": "<12 words"}` },
      imgPart(buf),
      imgPart(readFileSync(join("/tmp/librender", pick.lf))),
    ]));
    if (confirm?.same) {
      const practiceId = Number(pick.lf.match(/^p(\d+)\.png$/)[1]);
      state[sha] = { practiceId, confidence: verdict.confidence };
      saveState();
      return state[sha];
    }
  }

  // 3. no library match -> compare against practices we already created from imports
  const { rows: imported } = await client.query(
    "SELECT id, source_file FROM practices WHERE source_file LIKE 'import:%'",
  );
  const importedShas = imported.map((r) => ({ id: r.id, sha: r.source_file.split(":")[2] }));
  const prior = importedShas.find((r) => r.sha === sha);
  if (prior) { state[sha] = { practiceId: prior.id, new: true }; saveState(); return state[sha]; }

  // near-duplicate check against imported signatures kept in state
  const near = Object.entries(state)
    .filter(([, v]) => v.newPracticeId && v.sig)
    .map(([s, v]) => ({ s, v, score: simScore(sig, v.sig) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .filter((c) => c.score > 8);
  if (near.length) {
    const cmp = [
      { type: "text", text: `Image 0 is a football drill diagram. Images 1-${near.length} are other diagrams. Which is the SAME drill (identical layout)? Reply ONLY JSON: {"match": <1-${near.length} or 0>}` },
      imgPart(buf),
      ...near.map((c) => imgPart(readFileSync(join(IMGCACHE, c.v.imgPath)))),
    ];
    const v2 = jsonOf(await chat("gpt-5.4", cmp));
    if (v2 && v2.match >= 1) {
      state[sha] = { practiceId: near[v2.match - 1].v.newPracticeId, new: true };
      saveState();
      return state[sha];
    }
  }

  // 4. create a new image-based practice
  const titleTxt = await chat("gpt-5.4-mini", [
    { type: "text", text: `Give a SHORT title (3-6 words, plain football coaching language, no quotes) for this training drill. Coach's notes: ${(fields.rules ?? "").slice(0, 300)}` },
    imgPart(buf),
  ]);
  const title = (titleTxt || "Imported drill").trim().replace(/^["']|["']$/g, "").slice(0, 80);
  const { png, w, h } = shrinkPng(buf);
  const diagram = { bg: "#FFFFFF", canvas: { w, h }, img: `data:image/png;base64,${png.toString("base64")}` };
  // Show the coach's own write-up on the library card too (not just as a variation)
  const paras = ["rules", "tasks", "progressions", "coachingPoints"]
    .map((k) => (fields[k] ?? "").trim())
    .filter(Boolean)
    .map((text) => ({ text }));
  const { rows: [np] } = await client.query(
    `INSERT INTO practices (ordinal, kind, chapter, section_code, section_name, title, paras, diagram, needs_review, source_file)
     VALUES ((SELECT GREATEST(COALESCE(MAX(ordinal),0),9999)+1 FROM practices), 'practice', 'From old plans', 'OLD', 'Imported from session plans', $1, $4, $2, false, $3)
     RETURNING id`,
    [title, JSON.stringify(diagram), `import:${docx}:${sha}`, JSON.stringify(paras)],
  );
  const rel = join(docx.replace(".docx", ""), state.__imgname ?? "");
  state[sha] = { practiceId: np.id, new: true, newPracticeId: np.id, sig, imgPath: state.__imgname };
  saveState();
  console.log(`    NEW practice #${np.id} "${title}"`);
  return state[sha];
}

// ── typo cleanup ─────────────────────────────────────────────────────────────
async function cleanFields(fields) {
  const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => v && v.trim()));
  if (!Object.keys(present).length) return fields;
  const txt = await chat("gpt-5.4-mini", [{
    type: "text",
    text: `Fix ONLY spelling typos and obvious punctuation slips in this football coach's session notes. Keep her exact wording, tone, line breaks, abbreviations and player names. Do NOT rephrase, expand or reformat. Return ONLY the same JSON with corrected values:\n${JSON.stringify(present)}`,
  }]);
  const fixed = jsonOf(txt);
  if (!fixed) return fields;
  const out = { ...fields };
  for (const k of Object.keys(present)) if (typeof fixed[k] === "string" && fixed[k].trim()) out[k] = fixed[k];
  return out;
}

// ── per-file import ──────────────────────────────────────────────────────────
function dateFromFilename(f) {
  const m = f.match(/^(\d{2})(\d{2})(\d{2})-/);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

async function importFile(client, docx) {
  const parsedPath = join(PARSED, docx.replace(".docx", ".json"));
  if (!existsSync(parsedPath)) { console.log(`  no parse for ${docx}, skipping`); return; }
  const doc = JSON.parse(readFileSync(parsedPath, "utf8"));
  const imgDir = extractImages(docx);
  let sessionDate = dateFromFilename(docx);
  // Guard against typo'd impossible dates (e.g. 2023-11-31) that Postgres rejects
  if (sessionDate) {
    const d = new Date(`${sessionDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== sessionDate) sessionDate = null;
  }
  console.log(`\n=== ${docx} (${sessionDate ?? "no date"})`);

  await client.query("DELETE FROM practice_variations WHERE source_file = $1", [docx]);

  for (const part of PART_ORDER) {
    const p = doc.parts[part];
    if (!p) continue;
    const hasText = Object.values(p.fields).some((v) => v && v.trim());
    if (!hasText) continue;

    // pick the first usable diagram image for the part
    let practiceId = null;
    for (const imgName of p.images) {
      const path = join(imgDir, imgName);
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      if (!isDiagramCandidate(buf)) continue;
      const sha = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      state.__imgname = join(docx.replace(".docx", ""), imgName);
      const m = await matchImage(buf, sha, client, docx, part, p.fields);
      if (m.practiceId) practiceId = m.practiceId;
      break;
    }
    if (!practiceId) { console.log(`  ${part}: no diagram match — skipped`); continue; }

    const fields = await cleanFields(Object.fromEntries(FIELD_KEYS.map((k) => [k, p.fields[k] ?? null])));
    await client.query(
      `INSERT INTO practice_variations (practice_id, source_file, session_date, part, rules, tasks, progressions, coaching_points, players, size, timing, scoring, intensity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [practiceId, docx, sessionDate, part,
       fields.rules, fields.tasks, fields.progressions, fields.coachingPoints,
       fields.players, fields.size, fields.timing, fields.scoring, fields.intensity],
    );
    console.log(`  ${part}: -> practice #${practiceId}`);
  }
}

// ── entry ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const files = args[0] === "--all"
  ? readdirSync(PLANS).filter((f) => f.endsWith(".docx") && !f.startsWith("~$"))
  : args;
const client = new pg.Client({ connectionString: process.env.DEV_DATABASE_URL });
await client.connect();
for (const f of files) {
  try { await importFile(client, basename(f)); }
  catch (e) { console.log(`FAILED ${f}: ${e.message}`); }
}
delete state.__imgname;
saveState();
await client.end();
console.log("\ndone");
