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
  /** Set for the opponent scouting version — the league club the report is about. */
  subjectClub?: string;
  /** Veo match intelligence snapshot (optional — only when a recording is linked). */
  veo?: import("@workspace/api-client-react").VeoReportStats;
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
  const subject = model.subjectClub;
  pptx.title = subject ? `Scouting Report — ${subject} ${matchLabel}` : `Match Report — ${matchLabel}`;

  const resultWord = h.result === "W" ? "Win" : h.result === "L" ? "Loss" : h.result === "D" ? "Draw" : null;
  const scoreLine = h.goalsScored != null && h.goalsConceded != null
    ? `${resultWord ?? ""} ${h.goalsScored}–${h.goalsConceded}`.trim() : null;

  // ── Title ──────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    s.addText(subject ? `SCOUTING MATCH REPORT  •  ${subject.toUpperCase()}` : "MATCH REPORT", { x: 0.9, y: 1.5, w: 11.5, h: 0.5, fontSize: 20, color: SKY, bold: true, charSpacing: 6 });
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

  // ── GPS physical output (team report only) ─────────────────────────────────
  if (report.gps) {
    const g = report.gps;
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "Physical output", `GPS numbers for this game against the season average${g.gamesInAvg != null ? ` (${g.gamesInAvg} other games)` : ""}.`);
    const stats: Array<[string, number | null | undefined, number | null | undefined, string, number]> = [
      ["Team distance", g.totalDistanceKm, g.seasonAvgTotalDistanceKm, "km", 1],
      ["Defenders", g.defendersMPerMin, g.seasonAvgDefendersMPerMin, "m/min", 0],
      ["Midfielders", g.midfieldersMPerMin, g.seasonAvgMidfieldersMPerMin, "m/min", 0],
      ["Forwards HSM", g.forwardsHighSpeedM, g.seasonAvgForwardsHighSpeedM, "m", 0],
    ];
    const tw = 2.85, th = 1.7, gx = 0.3, x0 = 0.75, y0 = 2.0;
    stats.forEach(([label, v, sAvg, unit, dp], i) => {
      const x = x0 + i * (tw + gx);
      s.addShape("roundRect", { x, y: y0, w: tw, h: th, fill: { color: TINT }, rectRadius: 0.08, line: { color: LINE, width: 1 } });
      s.addText(label.toUpperCase(), { x: x + 0.2, y: y0 + 0.15, w: tw - 0.4, h: 0.3, fontSize: 10.5, color: GREY, charSpacing: 2 });
      s.addText(v != null ? `${v.toFixed(dp)} ${unit}` : "—", { x: x + 0.2, y: y0 + 0.45, w: tw - 0.4, h: 0.55, fontSize: 24, bold: true, color: SKY });
      if (sAvg != null) {
        const delta = v != null && sAvg > 0 ? ((v - sAvg) / sAvg) * 100 : null;
        const runs: Runs = [{ text: `season avg ${sAvg.toFixed(dp)} ${unit}`, options: { color: GREY } }];
        if (delta != null && Math.abs(delta) >= 3) runs.push({ text: `  ${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`, options: { bold: true, color: delta > 0 ? GOOD : ORANGE } });
        s.addText(runs as never, { x: x + 0.2, y: y0 + 1.1, w: tw - 0.4, h: 0.35, fontSize: 10.5, italic: true });
      }
    });
    addInsightBar(s, "Distance and intensity read against the rest of the season — a big plus on Forwards HSM usually means a game spent running in behind.");
    addFooter(s);
  }

  // ── Ball use ────────────────────────────────────────────────────────────────
  if (report.ballUse) {
    const bu = report.ballUse;
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "Ball use", "How much of the ball we had, and how often having it turned into a shot.");
    const boxes: Array<[string, string, string | null]> = [
      ["Possession", `${bu.possession}%`, bu.seasonAvgPossession != null ? `season avg ${bu.seasonAvgPossession.toFixed(0)}%` : null],
      ["Passes", bu.passes != null ? `${bu.passes}` : "—", bu.seasonAvgPasses != null ? `season avg ${bu.seasonAvgPasses.toFixed(0)}` : null],
      ["Passes per shot", bu.passesPerShot.toFixed(0), bu.seasonAvgShotsPer100 != null && bu.seasonAvgShotsPer100 > 0 ? `season avg ${(100 / bu.seasonAvgShotsPer100).toFixed(0)}` : null],
      ["Shots per 100 passes", bu.shotsPer100Passes.toFixed(1), bu.seasonAvgShotsPer100 != null ? `season avg ${bu.seasonAvgShotsPer100.toFixed(1)}` : null],
    ];
    const tw2 = 2.85, gx2 = 0.3, x02 = 0.75, y02 = 1.9;
    boxes.forEach(([label, v, sub], i) => {
      const x = x02 + i * (tw2 + gx2);
      s.addShape("roundRect", { x, y: y02, w: tw2, h: 1.6, fill: { color: TINT }, rectRadius: 0.08, line: { color: LINE, width: 1 } });
      s.addText(label.toUpperCase(), { x: x + 0.25, y: y02 + 0.15, w: tw2 - 0.5, h: 0.3, fontSize: 10.5, color: GREY, charSpacing: 2 });
      s.addText(v, { x: x + 0.25, y: y02 + 0.45, w: tw2 - 0.5, h: 0.6, fontSize: 28, bold: true, color: SKY });
      if (sub) s.addText(sub, { x: x + 0.25, y: y02 + 1.1, w: tw2 - 0.5, h: 0.3, fontSize: 10.5, italic: true, color: GREY });
    });
    if (bu.comments.length) {
      const runs: Runs = bu.comments.slice(0, 4).flatMap(c => ([
        { text: "•  ", options: { bold: true, color: SKY } },
        { text: c, options: { color: INK, breakLine: true } },
      ]));
      s.addText(runs as never, { x: 0.75, y: 3.9, w: 11.8, h: 2.2, fontSize: 13.5, lineSpacing: 24, paraSpaceAfter: 6 });
    }
    addFooter(s);
  }

  // ── Goal DNA ────────────────────────────────────────────────────────────────
  if (report.goalDna) {
    const dna = report.goalDna;
    const s = pptx.addSlide();
    s.background = { color: BG };
    // Headline badge squares (newer reports) — mirrors the on-screen
    // "Goal story" card. Older saved reports won't have them.
    const badges = (dna.insightBadges ?? []).slice(0, 4);
    if (badges.length) {
      addHeader(s, "Goal story — what today's goals tell us",
        "The headlines from today's goals — type, timing, scorers, assists and the defence — each read against the season.");
    } else {
      addHeader(s, "Goal DNA — how the goals really came",
        "Season mix by goal type vs benchmark: set pieces 27%, middle-third 48–50%, front & back thirds ~12% each.");
    }
    const AMBER = "F0B45C";
    if (badges.length) {
      const bw = 2.95, bh = 1.15, bgx = 0.3, bx0 = 0.7, by0 = 1.5;
      badges.forEach((b, i) => {
        const x = bx0 + i * (bw + bgx);
        const watch = b.tone === "watch";
        s.addShape("roundRect", { x, y: by0, w: bw, h: bh, rectRadius: 0.06,
          fill: { color: watch ? "33301C" : TINT }, line: { color: watch ? "8A6A2E" : LINE, width: 1 } });
        s.addText(b.label.toUpperCase(), { x: x + 0.2, y: by0 + 0.1, w: bw - 0.4, h: 0.28, fontSize: 9.5, charSpacing: 2, color: watch ? AMBER : GREY });
        s.addText(b.value, { x: x + 0.2, y: by0 + 0.36, w: bw - 0.4, h: 0.45, fontSize: 13, bold: true, color: INK, valign: "top" });
        if (b.sub) s.addText(b.sub, { x: x + 0.2, y: by0 + 0.8, w: bw - 0.4, h: 0.3, fontSize: 9, italic: true, color: GREY });
      });
    }
    const sidesTop = badges.length ? 2.9 : 1.55;
    const sides = [
      { d: dna.scored, title: subject ? "They scored" : "Scored", isScored: true, x: 0.7 },
      { d: dna.conceded, title: subject ? "They conceded" : "Conceded", isScored: false, x: 6.95 },
    ];
    for (const { d, title, isScored, x } of sides) {
      s.addText(`${title} — ${d.totalTyped} typed this season`, { x, y: sidesTop, w: 5.6, h: 0.35, fontSize: 14, bold: true, color: isScored ? GOOD : BAD });
      let y = sidesTop + 0.45;
      for (const c of d.categories) {
        const flagged = c.verdict != null;
        // Team report: our high scoring = good. Scouting report: THEIR high
        // scoring = threat (red/amber), their high conceding = our opening.
        const goodFlag = subject
          ? (c.verdict === "high" ? !isScored : isScored)
          : (c.verdict === "high" ? isScored : !isScored);
        s.addText(c.label, { x, y, w: 2.3, h: 0.3, fontSize: 10.5, color: INK });
        s.addShape("rect", { x: x + 2.35, y: y + 0.06, w: 2.0, h: 0.16, fill: { color: TINT }, line: { color: LINE, width: 0.5 } });
        s.addShape("rect", { x: x + 2.35, y: y + 0.06, w: Math.max(0.02, 2.0 * Math.min(100, c.pct ?? 0) / 100), h: 0.16, fill: { color: flagged ? (goodFlag ? GOOD : BAD) : SKY } });
        s.addText(`${c.pct != null ? `${c.pct.toFixed(0)}%` : "—"} / ${c.benchmarkLabel}`, { x: x + 4.45, y, w: 1.3, h: 0.3, fontSize: 9.5, color: GREY });
        y += 0.38;
      }
      // Per-goal story rows (newer reports); older saved reports fall back to
      // the legacy interpretation lines. Team deck with badges drops the rows
      // entirely — matches the on-screen card, where the badges replaced them.
      const story = (dna.matchGoals ?? []).filter(g => (g.side === "scored") === isScored);
      if (!subject && badges.length) {
        // badges cover the story — nothing per-goal on the team deck
      } else if (dna.matchGoals != null) {
        if (story.length) {
          // Scouting deck flips meaning: their scoring = threat, their conceding = our opening.
          const goodRow = subject ? !isScored : isScored;
          const runs: Runs = story.flatMap(g => ([
            { text: goodRow ? "▲  " : "▼  ", options: { bold: true, color: goodRow ? GOOD : ORANGE } },
            { text: `${g.minute != null ? `${g.minute}'` : "—"}  ${g.scorer ?? (isScored ? "Scored" : "Conceded")}`, options: { bold: true, color: INK } },
            { text: `${g.category ? ` — ${g.category}${g.timing ? (g.timing === "DT" ? ", before they reset" : ", vs a set defence") : ""}` : ""}  · ${g.badgeText}`, options: { color: GREY, breakLine: true } },
          ]));
          s.addText(runs as never, { x, y: y + 0.1, w: 5.7, h: 1.6, fontSize: 10.5, lineSpacing: 16, paraSpaceAfter: 4 });
        }
      } else if (d.matchLines.length) {
        const runs: Runs = d.matchLines.flatMap(l => ([
          { text: isScored ? "▲  " : "▼  ", options: { bold: true, color: isScored ? GOOD : ORANGE } },
          { text: l, options: { color: INK, breakLine: true } },
        ]));
        s.addText(runs as never, { x, y: y + 0.1, w: 5.7, h: 1.3, fontSize: 11, lineSpacing: 17, paraSpaceAfter: 5 });
      }
    }
    const bar = dna.dayInsights?.length ? dna.dayInsights.slice(0, 2).join("  •  ")
      : dna.tacticalRead?.length ? dna.tacticalRead.join("  ") : dna.comments.slice(0, 2).join("  •  ");
    if (bar) addInsightBar(s, bar);
    addFooter(s);
  }

  // ── What the video says (Veo match intelligence) ───────────────────────────
  if (model.veo?.linked && (model.veo.findings?.length || model.veo.radar?.length)) {
    const v = model.veo;
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "What the video says (Veo)", "Key findings from the linked recording, then our share of each battle.");
    let y = 1.7;
    for (const f of (v.findings ?? []).slice(0, 5)) {
      s.addText([
        { text: f.tone === "good" ? "▲  " : f.tone === "watch" ? "▼  " : "•  ",
          options: { bold: true, color: f.tone === "good" ? GOOD : f.tone === "watch" ? ORANGE : SKY } },
        { text: f.text, options: { color: INK } },
      ] as never, { x: 0.75, y, w: 11.8, h: 0.62, fontSize: 13, lineSpacing: 17, valign: "top" });
      y += 0.68;
    }
    // Match shape share bars as simple text rows.
    const rows = v.radar ?? [];
    if (rows.length) {
      y = Math.max(y + 0.25, 4.4);
      s.addText("MATCH SHAPE — OUR SHARE OF EACH BATTLE", { x: 0.75, y, w: 11.8, h: 0.32, fontSize: 11, bold: true, color: SKY, charSpacing: 3 });
      y += 0.42;
      for (const r of rows.slice(0, 4)) {
        const barW = 6.4, barX = 3.4;
        s.addText(r.metric, { x: 0.75, y, w: 2.5, h: 0.3, fontSize: 12, color: GREY, valign: "middle" });
        s.addShape("roundRect", { x: barX, y: y + 0.05, w: barW, h: 0.2, fill: { color: "3A5B74" }, rectRadius: 0.04 });
        s.addShape("roundRect", { x: barX, y: y + 0.05, w: Math.max(0.12, barW * (r.us / 100)), h: 0.2, fill: { color: SKY }, rectRadius: 0.04 });
        s.addText(r.rawUs, { x: barX - 0.95, y, w: 0.85, h: 0.3, fontSize: 12, bold: true, color: SKY, align: "right", valign: "middle" });
        s.addText(r.rawThem, { x: barX + barW + 0.1, y, w: 1.4, h: 0.3, fontSize: 12, bold: true, color: ORANGE, valign: "middle" });
        y += 0.4;
      }
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
  const safeSubject = subject ? subject.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") : null;
  const fileName = safeSubject
    ? `Match_Report-${safeSubject}-${safeRound}${safeOpp ? `-v-${safeOpp}` : ""}.pptx`
    : `Match_Report-${safeRound}${safeOpp ? `-v-${safeOpp}` : ""}.pptx`;
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
