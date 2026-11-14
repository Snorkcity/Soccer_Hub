/**
 * Pure heuristic used only to steer the user — the server is the authority.
 * Order of evidence: explicit Tags (match/game wins over training), then
 * match halves, then training-specific split names. "warmup" alone never
 * makes a file training, because match exports can include warm-up rows.
 */
const TRAINING_SPECIFIC = new Set([
  "1stthird", "2ndthird", "3rdthird", "passingactivation", "technicalactivation",
  "mainpart", "endgame", "end-game", "endpart",
]);
const MATCH_HALVES = new Set(["1sthalf", "2ndhalf", "firsthalf", "secondhalf", "half1", "half2", "1h", "2h"]);
const norm = (s: string) => s.trim().toLocaleLowerCase().replace(/[\s.]+/g, "");

function parseRows(text: string, delim: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function isTrainingGpsText(raw: string): boolean {
  const text = raw.replace(/^\uFEFF/, "");
  const firstLine = text.slice(0, text.search(/\r?\n/) >>> 0);
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows = parseRows(text, delim, 20000);
  const headerIdx = rows.findIndex(r => r.some(c => norm(c) === "splitname"));
  if (headerIdx < 0) return false;
  const header = rows[headerIdx].map(norm);
  const splitCol = header.indexOf("splitname"), tagsCol = header.indexOf("tags");
  let trainingTag = false, matchTag = false, halves = false, specific = false;
  for (const r of rows.slice(headerIdx + 1)) {
    if (tagsCol >= 0) {
      const tags = (r[tagsCol] ?? "").trim().toLocaleLowerCase();
      if (/\b(match|game)\b/.test(tags)) matchTag = true;
      if (/\btraining\b/.test(tags)) trainingTag = true;
    }
    const k = norm(r[splitCol] ?? "");
    if (MATCH_HALVES.has(k)) halves = true;
    if (TRAINING_SPECIFIC.has(k)) specific = true;
  }
  if (matchTag) return false;
  if (trainingTag) return true;
  if (halves) return false;
  return specific;
}
