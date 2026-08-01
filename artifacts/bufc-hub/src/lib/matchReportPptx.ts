/**
 * Football Match Report deck — same dark family as the team GPS match report
 * (see teamGpsMatchReport.ts). Renders the /analytics/match-report payload.
 */
import type { MatchReportResponse } from "@workspace/api-client-react";

/** Everything the deck (and a saved report) needs, frozen at save time. */
export interface FootballMatchReportModel {
  report: MatchReportResponse;
  matchLabel: string;         // "R16 v Canberra Croatia"
  round: string;              // "R16"
  opponent: string;
  matchDate: string | null;
  generatedOn: string;        // "3 August 2026"
}

// ── Brand (identical to teamGpsMatchReport.ts) ───────────────────────────────
const NAVY = "0F2C43";
const BG = "0C2436";
const SKY = "87CEEB";
const ORANGE = "ED8936";
const INK = "DEEBF4";
const GREY = "8FAEC2";
const PAPER = "FFFFFF";
const TINT = "16374E";
const LINE = "265271";
const GOOD = "5CD6A9";
const BAD = "F08A8A";

const W = 13.33;
const H = 7.5;

type Runs = Array<{ text: string; options?: Record<string, unknown> }>;
type Cell = { text: string | Runs; options?: Record<string, unknown> };

const ord = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export async function generateFootballMatchReport(
  model: FootballMatchReportModel,
  coachNote: string | undefined,
  output: "download" | "base64" = "download",
): Promise<{ fileName: string; base64?: string }> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  const { report, matchLabel } = model;
  const h = report.header;
  pptx.title = `Match Report — ${matchLabel}`;

  const resultWord = h.result === "W" ? "Win" : h.result === "L" ? "Loss" : h.result === "D" ? "Draw" : null;
  const scoreLine = h.goalsScored != null && h.goalsConceded != null
    ? `${resultWord ?? ""} ${h.goalsScored}–${h.goalsConceded}`.trim() : null;

  // ── Title ──────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    s.addText("MATCH REPORT", { x: 0.9, y: 1.5, w: 11, h: 0.5, fontSize: 20, color: SKY, bold: true, charSpacing: 6 });
    s.addText(matchLabel, { x: 0.9, y: 2.1, w: 11.5, h: 1.4, fontSize: 48, color: PAPER, bold: true });
    if (scoreLine) {
      s.addText(scoreLine + (h.cleanSheet ? "  •  Clean sheet" : ""), {
        x: 0.9, y: 3.55, w: 11, h: 0.6,
        fontSize: 26, bold: true, color: h.result === "W" ? GOOD : h.result === "L" ? BAD : ORANGE,
      });
    }
    s.addText([model.matchDate, h.venue, h.halfScore ? `HT ${h.halfScore}` : null,
      h.formation ? `Us ${h.formation}${h.oppFormation ? ` · them ${h.oppFormation}` : ""}` : null,
    ].filter(Boolean).join("  •  "), { x: 0.9, y: 4.25, w: 11, h: 0.5, fontSize: 18, color: "C9E4F2" });
    const ladderBit = report.ladderPos != null && report.teamsInLeague != null
      ? `${ord(report.ladderPos)} of ${report.teamsInLeague}${report.ladderPoints != null ? ` on ${report.ladderPoints} pts` : ""} after this round` : null;
    const formBit = report.form.length ? `Form ${report.form.map(f => f.result).join(" ")}` : null;
    s.addText([formBit, ladderBit].filter(Boolean).join("  •  ") || " ", {
      x: 0.9, y: 4.85, w: 11, h: 0.4, fontSize: 14, color: "8FB3C7",
    });
    s.addText(`The story of the game, with the season as context  •  Generated ${model.generatedOn}`, {
      x: 0.9, y: 6.6, w: 11.5, h: 0.4, fontSize: 12, italic: true, color: "6E93A8",
    });
  }

  // ── Stat tiles vs season ───────────────────────────────────────────────────
  const tiles = report.tiles.filter(t => t.value != null);
  if (tiles.length) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "The game, at a glance", "Each tile compares this match with the season average, with its rank across the season's games.");
    const tw = 3.85, th = 1.5, gx = 0.35, x0 = 0.75, y0 = 1.55;
    tiles.slice(0, 6).forEach((t, i) => {
      const x = x0 + (i % 3) * (tw + gx);
      const y = y0 + Math.floor(i / 3) * (th + 0.3);
      s.addShape("roundRect", { x, y, w: tw, h: th, fill: { color: TINT }, rectRadius: 0.08, line: { color: LINE, width: 1 } });
      s.addText(`${t.value!.toFixed(t.decimals)}${t.unit}`, { x: x + 0.25, y: y + 0.15, w: tw - 0.5, h: 0.55, fontSize: 26, bold: true, color: SKY });
      s.addText(t.label.toUpperCase(), { x: x + 0.25, y: y + 0.72, w: tw - 0.5, h: 0.3, fontSize: 10.5, color: GREY, charSpacing: 2 });
      const bits: Runs = [];
      if (t.seasonAvg != null) bits.push({ text: `season avg ${t.seasonAvg.toFixed(t.decimals === 0 ? 1 : t.decimals)}${t.unit}`, options: { color: GREY } });
      if (t.rank != null && t.outOf != null) {
        const good = t.rank <= Math.ceil(t.outOf / 3);
        const poor = t.rank > t.outOf - Math.ceil(t.outOf / 3);
        bits.push({ text: `${bits.length ? "  ·  " : ""}${t.rank === 1 ? "best" : ord(t.rank)} of ${t.outOf}`, options: { color: good ? GOOD : poor ? ORANGE : GREY, bold: true } });
      }
      if (bits.length) s.addText(bits as never, { x: x + 0.25, y: y + 1.02, w: tw - 0.5, h: 0.35, fontSize: 10, italic: true });
    });
    addInsightBar(s, "Ranks read in the stat's own direction — 'best of 12' means the best game of the season for that number.");
    addFooter(s);
  }

  // ── Goals timeline ─────────────────────────────────────────────────────────
  if (report.goals.length) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "How the goals came", "Every goal in the order they happened — ours and theirs.");
    const rows: Cell[][] = [[
      { text: "Min", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "center" } },
      { text: "Goal", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "left" } },
      { text: "Detail", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "left" } },
    ]];
    for (const g of report.goals.slice(0, 14)) {
      const fillCol = rows.length % 2 === 1 ? TINT : BG;
      const who = g.ours ? (g.scorer ?? "Goal") : `Conceded${g.scorer ? ` — ${g.scorer}` : ""}`;
      const detail = [g.ours && g.assist && g.assist !== "OG" ? `assist ${g.assist}` : null, g.note].filter(Boolean).join("  ·  ");
      rows.push([
        { text: g.minute != null ? `${g.minute}'` : "—", options: { align: "center", color: GREY, fill: { color: fillCol } } },
        { text: who, options: { align: "left", bold: true, color: g.ours ? GOOD : BAD, fill: { color: fillCol } } },
        { text: detail || "—", options: { align: "left", color: INK, fill: { color: fillCol } } },
      ]);
    }
    s.addTable(rows as never, {
      x: 0.55, y: 1.6, w: 12.2, colW: [1.0, 4.2, 7.0],
      fontSize: 11.5, rowH: 0.32, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle",
    });
    if (report.goals.length > 14) {
      s.addText(`+ ${report.goals.length - 14} more in the on-screen report`, { x: 0.75, y: 6.0, w: 11.8, h: 0.3, fontSize: 11, italic: true, color: GREY });
    }
    addFooter(s);
  }

  // ── Analyst's notes ────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "The analyst's notes", "What stood out in this game, with the season as context.");
    if (!report.insights.length) {
      s.addText("Nothing unusual to flag in this one — a game that sat within the season's normal range.", {
        x: 0.75, y: 3.2, w: 11.8, h: 0.6, fontSize: 16, italic: true, color: GREY, align: "center",
      });
    } else {
      const shown = report.insights.slice(0, 9);
      const runs: Runs = shown.flatMap(ins => ([
        { text: ins.tone === "good" ? "▲  " : ins.tone === "watch" ? "▼  " : "•  ",
          options: { bold: true, color: ins.tone === "good" ? GOOD : ins.tone === "watch" ? ORANGE : SKY } },
        { text: ins.text, options: { color: INK, breakLine: true } },
      ]));
      s.addText(runs as never, {
        x: 0.75, y: 1.7, w: 11.8, h: 4.5, fontSize: shown.length > 6 ? 12.5 : 14,
        lineSpacing: shown.length > 6 ? 22 : 26, bullet: false, paraSpaceAfter: 8,
      });
      if (report.insights.length > 9) {
        s.addText(`+ ${report.insights.length - 9} more in the on-screen report`, { x: 0.75, y: 6.0, w: 11.8, h: 0.3, fontSize: 11, italic: true, color: GREY });
      }
    }
    addFooter(s);
  }

  // ── Closing ────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    if (coachNote?.trim()) {
      s.addText("A NOTE FROM THE COACHING DESK", { x: 0.9, y: 1.6, w: 11, h: 0.4, fontSize: 14, bold: true, color: SKY, charSpacing: 4 });
      s.addText(coachNote.trim(), { x: 0.9, y: 2.2, w: 11.4, h: 3.4, fontSize: 20, color: PAPER, lineSpacing: 30 });
    } else {
      s.addText("Numbers are the start of the conversation, not the end of it.", {
        x: 0.9, y: 2.6, w: 11.4, h: 1.6, fontSize: 32, bold: true, color: PAPER });
      s.addText("Every figure here comes from the match data, judged against the rest of this season.", {
        x: 0.9, y: 4.2, w: 10.5, h: 0.8, fontSize: 16, color: "C9E4F2" });
    }
    s.addText(`${matchLabel}${model.matchDate ? `  •  ${model.matchDate}` : ""}  •  Generated ${model.generatedOn}`, {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 11, color: "6E93A8",
    });
  }

  const safeRound = model.round.replace(/[^\w\-]+/g, "");
  const safeOpp = model.opponent.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  const fileName = `Match_Report-${safeRound}${safeOpp ? `-v-${safeOpp}` : ""}.pptx`;
  if (output === "base64") {
    const base64 = (await pptx.write({ outputType: "base64" })) as string;
    return { fileName, base64 };
  }
  await pptx.writeFile({ fileName });
  return { fileName };

  // ── slide furniture (matches the GPS report) ───────────────────────────────
  function addHeader(s: ReturnType<typeof pptx.addSlide>, title: string, sub: string) {
    s.addShape("rect", { x: 0, y: 0, w: W, h: 0.12, fill: { color: SKY } });
    s.addText(title, { x: 0.6, y: 0.35, w: 12.1, h: 0.55, fontSize: 26, bold: true, color: PAPER });
    s.addText(sub, { x: 0.6, y: 0.95, w: 12.1, h: 0.4, fontSize: 12.5, color: GREY });
  }
  function addInsightBar(s: ReturnType<typeof pptx.addSlide>, text: string) {
    if (!text) return;
    s.addShape("roundRect", { x: 0.6, y: 6.35, w: 12.1, h: 0.62, fill: { color: TINT }, rectRadius: 0.06, line: { color: LINE, width: 1 } });
    s.addText(text, { x: 0.85, y: 6.35, w: 11.7, h: 0.62, fontSize: 11.5, color: INK, valign: "middle" });
  }
  function addFooter(s: ReturnType<typeof pptx.addSlide>) {
    s.addText(`Match Report  •  ${matchLabel}${model.matchDate ? `  •  ${model.matchDate}` : ""}`, {
      x: 0.6, y: 7.08, w: 9, h: 0.3, fontSize: 9, color: "9FB3C0" });
  }
}
