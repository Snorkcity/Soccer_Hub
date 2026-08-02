/**
 * Team GPS Match Report deck — same dark family as the player GPS / testing
 * reports. Renders the computed GpsMatchReportModel (see gpsMatchReport.ts).
 */
import { groupInsights, type GpsMatchReportModel, type PlayerLine, type InsightLine } from "./gpsMatchReport";

// ── Brand (identical to playerGpsReport.ts) ──────────────────────────────────
const NAVY = "0F2C43";
const BG = "0C2436";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const PURPLE = "B07CF0";
const ORANGE = "ED8936";
const INK = "DEEBF4";
const GREY = "8FAEC2";
const PAPER = "FFFFFF";
const TINT = "16374E";
const LINE = "265271";
const GRID = "1E4058";
const GOOD = "5CD6A9";   // above-normal green (reads on navy)
const BAD = "F08A8A";    // under-normal red (soft, not alarming)

const W = 13.33;
const H = 7.5;

const fmt = (v: number | null | undefined, d: number, unit?: string) =>
  v == null ? "—" : `${v.toFixed(d)}${unit ? ` ${unit}` : ""}`;
const deltaText = (pct: number | null) =>
  pct == null ? "" : `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`;

type Runs = Array<{ text: string; options?: Record<string, unknown> }>;
type Cell = { text: string | Runs; options?: Record<string, unknown> };

export async function generateTeamGpsMatchReport(
  model: GpsMatchReportModel,
  coachNote: string | undefined,
  output: "download" | "base64" = "download",
): Promise<{ fileName: string; base64?: string }> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = model.teamLabel;
  const matchLine = `${model.round}${model.opponent ? ` v ${model.opponent}` : ""}`;
  pptx.title = `GPS Match Report — ${matchLine}`;

  // ── Title ──────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    s.addText("GPS MATCH REPORT", { x: 0.9, y: 1.5, w: 11, h: 0.5, fontSize: 20, color: SKY, bold: true, charSpacing: 6 });
    s.addText(matchLine, { x: 0.9, y: 2.1, w: 11.5, h: 1.4, fontSize: 48, color: PAPER, bold: true });
    s.addText([model.teamLabel, model.dateLabel].filter(Boolean).join("  •  "), {
      x: 0.9, y: 3.55, w: 11, h: 0.5, fontSize: 20, color: "C9E4F2",
    });
    s.addText(`${model.players.length} players tracked  •  Generated ${model.generatedOn}`, {
      x: 0.9, y: 4.1, w: 11, h: 0.4, fontSize: 14, color: "8FB3C7",
    });
    s.addText("The physical story of the game — every number in its context.", {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 12, italic: true, color: "6E93A8",
    });
  }

  // ── Team at a glance ───────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "The team, at a glance", "Each tile compares this game with the squad's season average game (arrow = vs a normal week).");
    const tiles = model.team.filter(t => t.value != null);
    const tw = 3.85, th = 1.5, gx = 0.35, x0 = 0.75, y0 = 1.55;
    tiles.slice(0, 6).forEach((t, i) => {
      const x = x0 + (i % 3) * (tw + gx);
      const y = y0 + Math.floor(i / 3) * (th + 0.3);
      s.addShape("roundRect", { x, y, w: tw, h: th, fill: { color: TINT }, rectRadius: 0.08, line: { color: LINE, width: 1 } });
      s.addText(fmt(t.value, t.decimals, t.unit), { x: x + 0.25, y: y + 0.15, w: tw - 0.5, h: 0.55, fontSize: 26, bold: true, color: SKY });
      s.addText(t.label.toUpperCase(), { x: x + 0.25, y: y + 0.72, w: tw - 0.5, h: 0.3, fontSize: 10.5, color: GREY, charSpacing: 2 });
      if (t.deltaPct != null) {
        s.addText(`${deltaText(t.deltaPct)} vs a normal game (${fmt(t.seasonAvg, t.decimals, t.unit)})`, {
          x: x + 0.25, y: y + 1.02, w: tw - 0.5, h: 0.35, fontSize: 10, italic: true,
          color: t.deltaPct >= 0 ? GOOD : ORANGE,
        });
      }
    });
    addInsightBar(s, teamGlanceLine(model));
    addFooter(s, model);
  }

  // ── Halves ─────────────────────────────────────────────────────────────────
  if (model.halves.length) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "First half vs second half", "Summed across every player with half splits. Season columns show the squad's usual second-half change and the best/worst game this year.");
    const pctTxt = (p: number | null | undefined) =>
      p == null ? "—" : `${p >= 0 ? "up" : "down"} ${Math.abs(p).toFixed(0)}%`;
    const rows: Cell[][] = [[
      { text: "Team output", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "left" } },
      { text: "1st half", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "center" } },
      { text: "2nd half", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "center" } },
      { text: "Change", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "center" } },
      { text: "Season usual", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "center" } },
      { text: "Best · worst", options: { bold: true, color: NAVY, fill: { color: SKY }, align: "center" } },
    ]];
    for (const hl of model.halves) {
      if (hl.h1 == null && hl.h2 == null) continue;
      const fillCol = rows.length % 2 === 1 ? TINT : BG;
      const bw: Runs | string = hl.bestChange == null || hl.worstChange == null ? "—" : [
        { text: `${hl.bestChange.pct >= 0 ? "+" : "−"}${Math.abs(hl.bestChange.pct).toFixed(0)}% `, options: { color: GOOD } },
        { text: `${hl.bestChange.round}  ·  `, options: { color: GREY } },
        { text: `${hl.worstChange.pct >= 0 ? "+" : "−"}${Math.abs(hl.worstChange.pct).toFixed(0)}% `, options: { color: ORANGE } },
        { text: hl.worstChange.round, options: { color: GREY } },
      ];
      rows.push([
        { text: hl.label, options: { align: "left", color: INK, fill: { color: fillCol } } },
        { text: fmt(hl.h1, hl.decimals, hl.unit), options: { align: "center", color: PAPER, fill: { color: fillCol } } },
        { text: fmt(hl.h2, hl.decimals, hl.unit), options: { align: "center", color: PAPER, fill: { color: fillCol } } },
        { text: pctTxt(hl.changePct),
          options: { align: "center", bold: true, color: hl.changePct != null && hl.changePct < -10 ? ORANGE : SKY, fill: { color: fillCol } } },
        { text: pctTxt(hl.seasonChangePct), options: { align: "center", color: GREY, fill: { color: fillCol } } },
        { text: bw as never, options: { align: "center", fontSize: 10.5, fill: { color: fillCol } } },
      ]);
    }
    s.addTable(rows as never, {
      x: 0.55, y: 1.7, w: 12.2, colW: [3.4, 1.7, 1.7, 1.7, 1.7, 2.0],
      fontSize: 12, rowH: 0.5, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle",
    });
    const drop = model.halves.find(h => h.id === "km")?.changePct ?? null;
    addInsightBar(s, drop == null
      ? "Half splits weren't recorded for every player this round."
      : drop < -10
        ? `Running output dropped ${Math.abs(drop).toFixed(0)}% after the break — worth pairing with what you saw tactically in the second half.`
        : `Second-half running held up well (${drop >= 0 ? "up" : "down"} ${Math.abs(drop).toFixed(0)}% on the first half).`);
    addFooter(s, model);
  }

  // ── Player table ───────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "Every player, against their own normal",
      "\"vs own normal\" is one metric — running intensity (m/min) against the player's own season baseline. High-speed and season bests are flagged on the standout pages.");
    const head = ["Player", "Mins", "Km", "m/min", "HS m", "VHS m", "Top km/h", "vs own normal"];
    const rows: Cell[][] = [head.map((h, i) => ({
      text: h, options: { bold: true, color: NAVY, fill: { color: SKY }, align: i === 0 ? "left" : "center" },
    }))];
    for (const p of model.players.slice(0, 18)) {
      const fillCol = rows.length % 2 === 1 ? TINT : BG;
      const c = (text: string | Runs, opts: Record<string, unknown> = {}): Cell =>
        ({ text, options: { align: "center", color: PAPER, fill: { color: fillCol }, ...opts } });
      rows.push([
        c(p.name + (p.position ? `  ·  ${p.position}` : ""), { align: "left", color: INK }),
        c(fmt(p.mins, 0)),
        c(fmt(p.km, 2)),
        c(fmt(p.dpm, 0)),
        c(fmt(p.hsm, 0)),
        c(fmt(p.vhs, 0)),
        c(fmt(p.topSpeed, 1)),
        c(p.dpmDelta == null ? (p.baselineGames ? "—" : "first game") : deltaText(p.dpmDelta),
          { bold: true, color: p.dpmDelta == null ? GREY : p.dpmDelta >= 0 ? GOOD : p.dpmDelta <= -12 ? BAD : GREY }),
      ]);
    }
    s.addTable(rows as never, {
      x: 0.55, y: 1.6, w: 12.2, colW: [3.3, 1.0, 1.1, 1.2, 1.2, 1.3, 1.5, 1.6],
      fontSize: 10.5, rowH: 0.28, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle",
    });
    addInsightBar(s, `"vs own normal" is metres-per-minute against that player's other ${model.year} games (45+ min games only). Green = above their usual intensity.`);
    addFooter(s, model);
  }

  // ── Standouts ──────────────────────────────────────────────────────────────
  addInsightSlide(pptx, model, "What stood out", "Season bests, above-normal outputs and the athletic radar — automatically flagged, worth a mention at training.", model.standouts, GOOD);

  // ── Watch list ─────────────────────────────────────────────────────────────
  addInsightSlide(pptx, model, "Worth keeping an eye on", "Below-normal outputs and month-long slides. Context first — game state, role and selection all move these numbers.", model.watch, ORANGE);

  // ── Trend ──────────────────────────────────────────────────────────────────
  if (model.trend.length >= 2) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    addHeader(s, "How the group is tracking", `Team running output across the last ${model.trend.length} games — the physical form line under the results.`);
    const cats = model.trend.map(t => t.round);
    (s.addChart as unknown as (types: unknown, opts: unknown) => void)([
      {
        type: "bar",
        data: [{ name: "Total distance (km)", labels: cats, values: model.trend.map(t => t.kmTotal == null ? null : Number(t.kmTotal.toFixed(1))) as number[] }],
        options: { chartColors: [SKY], barGapWidthPct: 40 },
      },
      {
        type: "line",
        data: [{ name: "Average intensity (m/min)", labels: cats, values: model.trend.map(t => t.dpmAvg == null ? null : Number(t.dpmAvg.toFixed(0))) as number[] }],
        options: { chartColors: [PURPLE], lineDataSymbol: "circle", lineSize: 2, secondaryValAxis: true, secondaryCatAxis: true } as never,
      },
    ], {
      x: 0.6, y: 1.6, w: 12.1, h: 4.6,
      showLegend: true, legendPos: "b", legendFontSize: 10, legendColor: GREY,
      catGridLine: { style: "none" },
      valAxes: [
        { valAxisTitle: "km", showValAxisTitle: true, valAxisTitleFontSize: 9, valAxisTitleColor: GREY, valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "dash", color: GRID, size: 0.5 } },
        { valAxisTitle: "m/min", showValAxisTitle: true, valAxisTitleFontSize: 9, valAxisTitleColor: GREY, valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "none" } },
      ],
      catAxes: [{ catAxisLabelFontSize: 10, catAxisLabelColor: GREY }, { catAxisHidden: true }],
    });
    const first = model.trend[0], last = model.trend[model.trend.length - 1];
    const shift = first.dpmAvg && last.dpmAvg ? ((last.dpmAvg / first.dpmAvg) - 1) * 100 : null;
    addInsightBar(s, shift == null
      ? "Total bars move with how many players were tracked; the intensity line is the fairer week-to-week read."
      : `Average intensity is ${Math.abs(shift).toFixed(0)}% ${shift >= 0 ? "up" : "down"} on ${first.round}. Total bars move with player count — the intensity line is the fairer read.`);
    addFooter(s, model);
  }

  // ── Closing ────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    if (coachNote?.trim()) {
      s.addText("A NOTE FROM THE PERFORMANCE DESK", { x: 0.9, y: 1.6, w: 11, h: 0.4, fontSize: 14, bold: true, color: SKY, charSpacing: 4 });
      s.addText(coachNote.trim(), { x: 0.9, y: 2.2, w: 11.4, h: 3.4, fontSize: 20, color: PAPER, lineSpacing: 30 });
    } else {
      s.addText("Numbers are the start of the conversation, not the end of it.", {
        x: 0.9, y: 2.6, w: 11.4, h: 1.6, fontSize: 32, bold: true, color: PAPER });
      s.addText("Every figure here comes from the GPS units worn in the game, judged against each player's own season.", {
        x: 0.9, y: 4.2, w: 10.5, h: 0.8, fontSize: 16, color: "C9E4F2" });
    }
    s.addText(`${model.teamLabel}  •  ${matchLine}  •  Generated ${model.generatedOn}`, {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 11, color: "6E93A8",
    });
  }

  const safeRound = model.round.replace(/[^\w\-]+/g, "");
  const safeOpp = (model.opponent ?? "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  const fileName = `GPS_Match_Report-${safeRound}${safeOpp ? `-v-${safeOpp}` : ""}-${model.year}.pptx`;
  if (output === "base64") {
    const base64 = (await pptx.write({ outputType: "base64" })) as string;
    return { fileName, base64 };
  }
  await pptx.writeFile({ fileName });
  return { fileName };

  // ── slide furniture (matches the player report) ───────────────────────────
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
  function addFooter(s: ReturnType<typeof pptx.addSlide>, m: GpsMatchReportModel) {
    s.addText(`${m.teamLabel}  •  ${matchLine}  •  ${m.year}`, { x: 0.6, y: 7.08, w: 9, h: 0.3, fontSize: 9, color: "9FB3C0" });
  }
  function addInsightSlide(p: InstanceType<typeof PptxGenJS>, m: GpsMatchReportModel, title: string, sub: string, items: InsightLine[], accent: string) {
    const s = p.addSlide();
    s.background = { color: BG };
    addHeader(s, title, sub);
    if (!items.length) {
      s.addText(title === "What stood out"
        ? "No automatic flags this week — a steady, normal-range performance across the group."
        : "Nothing flagged — everyone was at or around their normal levels.", {
        x: 0.75, y: 3.2, w: 11.8, h: 0.6, fontSize: 16, italic: true, color: GREY, align: "center",
      });
    } else {
      const shown = items.slice(0, 9);
      // Group by player so several highlights for one player read as one block.
      const runs: Runs = groupInsights(shown).flatMap(g => {
        if (g.player == null) return g.lines.map(it => ({ text: it.text, options: { color: INK, breakLine: true } }));
        return [
          { text: g.player, options: { bold: true, color: accent, breakLine: g.lines.length > 1 } },
          ...g.lines.map((it, j) => ({
            text: g.lines.length > 1 ? `   •  ${it.text}` : ` — ${it.text}`,
            options: { color: INK, breakLine: true },
          })),
        ];
      });
      s.addText(runs as never, {
        x: 0.75, y: 1.7, w: 11.8, h: 4.5, fontSize: shown.length > 6 ? 12.5 : 14,
        lineSpacing: shown.length > 6 ? 22 : 26,
        bullet: false, paraSpaceAfter: 8,
      });
      if (items.length > 9) {
        s.addText(`+ ${items.length - 9} more in the on-screen report`, { x: 0.75, y: 6.0, w: 11.8, h: 0.3, fontSize: 11, italic: true, color: GREY });
      }
    }
    addFooter(s, m);
  }
}

function teamGlanceLine(model: GpsMatchReportModel): string {
  const dpm = model.team.find(t => t.id === "dpm");
  const hsm = model.team.find(t => t.id === "hsm");
  const bits: string[] = [];
  if (dpm?.deltaPct != null) bits.push(`intensity ${Math.abs(dpm.deltaPct).toFixed(0)}% ${dpm.deltaPct >= 0 ? "above" : "below"} a normal game`);
  if (hsm?.deltaPct != null) bits.push(`high-speed running ${Math.abs(hsm.deltaPct).toFixed(0)}% ${hsm.deltaPct >= 0 ? "up" : "down"}`);
  return bits.length
    ? `Compared with the squad's usual game: ${bits.join(", ")}. Totals move with how many players were tracked — the per-minute numbers are the honest comparison.`
    : "Season comparisons appear once the squad has more than one tracked game.";
}
