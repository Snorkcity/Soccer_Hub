/**
 * Player GPS season report — generates a branded PPTX from the Player GPS tab data.
 * Self-contained: caller maps app data into ReportInput; pptxgenjs is lazy-loaded.
 */

// ── Input types ──────────────────────────────────────────────────────────────

export interface ReportMetric {
  id: string;
  title: string;
  unit: string;
  decimals: number;
  /** Plain-language line shown under the chart title, coach-voice. */
  blurb: string;
  /** true when a season TOTAL makes sense (distance etc.); false for peaks/rates. */
  summable: boolean;
}

export interface ReportGame {
  round: string;
  opponent: string | null;
  dateLabel: string | null; // dd/mm/yyyy as recorded
  mins: number | null;
  values: Record<string, number | null>; // metricId -> game total
  accel: number | null; // accel count >3 m/s²
  decel: number | null;
  maxAcc: number | null; // m/s²
  maxDec: number | null;
}

export interface ReportInput {
  playerName: string;
  seasonLabel: string;
  teamLabel: string;
  coachNote?: string;
  generatedOn: string; // e.g. "14 July 2026"
  metrics: ReportMetric[];
  games: ReportGame[]; // chronological, oldest first
}

// ── Brand ────────────────────────────────────────────────────────────────────

const NAVY = "0F2C43";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const PURPLE = "9B5DE5";
const INK = "1C2B36";
const GREY = "647484";
const PAPER = "FFFFFF";
const TINT = "EFF7FB";

const W = 13.33;
const H = 7.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number | null, d: number, unit?: string) =>
  v == null ? "—" : `${v.toFixed(d)}${unit ? ` ${unit}` : ""}`;

function avg(vals: number[]): number | null {
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

interface MetricStats {
  seasonAvg: number | null;
  seasonTotal: number | null;
  best: { value: number; game: ReportGame } | null;
  last4Avg: number | null;
  last4PctVsSeason: number | null; // +12 => last 4 games 12% above season average
}

function metricStats(games: ReportGame[], id: string): MetricStats {
  const withVals = games.filter(g => g.values[id] != null);
  const vals = withVals.map(g => g.values[id] as number);
  const seasonAvg = avg(vals);
  const seasonTotal = vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  let best: MetricStats["best"] = null;
  for (const g of withVals) {
    const v = g.values[id] as number;
    if (!best || v > best.value) best = { value: v, game: g };
  }
  const last4 = withVals.slice(-4).map(g => g.values[id] as number);
  const last4Avg = last4.length >= 2 ? avg(last4) : null;
  const last4PctVsSeason =
    last4Avg != null && seasonAvg != null && seasonAvg !== 0
      ? ((last4Avg - seasonAvg) / seasonAvg) * 100 : null;
  return { seasonAvg, seasonTotal, best, last4Avg, last4PctVsSeason };
}

const vsLine = (g: ReportGame) => (g.opponent ? `vs ${g.opponent} (${g.round})` : g.round);

function trendWords(pct: number | null): string | null {
  if (pct == null) return null;
  if (Math.abs(pct) < 3) return "holding steady on the season average";
  return `${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "above" : "below"} the season average`;
}

// ── Generator ────────────────────────────────────────────────────────────────

export async function generatePlayerGpsReport(input: ReportInput): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = input.teamLabel;
  pptx.title = `${input.playerName} — GPS Season Report`;

  const games = input.games;
  const cats = games.map(g => g.round);

  // ── Title slide ────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    s.addText("GPS SEASON REPORT", {
      x: 0.9, y: 1.5, w: 11, h: 0.5, fontSize: 20, color: SKY, bold: true, charSpacing: 6,
    });
    s.addText(input.playerName, {
      x: 0.9, y: 2.1, w: 11.5, h: 1.4, fontSize: 54, color: PAPER, bold: true,
    });
    s.addText(`${input.teamLabel}  •  ${input.seasonLabel}`, {
      x: 0.9, y: 3.6, w: 11, h: 0.5, fontSize: 20, color: "C9E4F2",
    });
    s.addText(
      `Season to ${input.generatedOn}  •  ${games.length} game${games.length === 1 ? "" : "s"} with GPS`,
      { x: 0.9, y: 4.15, w: 11, h: 0.4, fontSize: 14, color: "8FB3C7" },
    );
    s.addText("Every sprint, every metre, every effort — measured.", {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 12, italic: true, color: "6E93A8",
    });
  }

  // ── Season snapshot slide ─────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "Season snapshot", `${input.playerName} — ${input.seasonLabel}`);

    const dist = metricStats(games, "distance");
    const hsm = metricStats(games, "hsm");
    const top = metricStats(games, "topSpeed");
    const load = metricStats(games, "load");
    const minsVals = games.map(g => g.mins).filter((m): m is number => m != null);
    const totalMins = minsVals.length ? minsVals.reduce((a, b) => a + b, 0) : null;
    const accVals = games.map(g => g.accel).filter((v): v is number => v != null);
    const decVals = games.map(g => g.decel).filter((v): v is number => v != null);

    const tiles: Array<[string, string]> = [
      ["Games with GPS", `${games.length}`],
      ["Minutes tracked", totalMins != null ? `${Math.round(totalMins)}` : "—"],
      ["Total distance", fmt(dist.seasonTotal, 1, "km")],
      ["High-speed metres", hsm.seasonTotal != null ? `${Math.round(hsm.seasonTotal)} m` : "—"],
      ["Best top speed", fmt(top.best?.value ?? null, 1, "km/h")],
      ["Hard bursts + stops", accVals.length || decVals.length
        ? `${Math.round(accVals.reduce((a, b) => a + b, 0) + decVals.reduce((a, b) => a + b, 0))}`
        : "—"],
    ];
    const tw = 3.85, th = 1.35, gx = 0.35, x0 = 0.75, y0 = 1.5;
    tiles.forEach(([label, value], i) => {
      const x = x0 + (i % 3) * (tw + gx);
      const y = y0 + Math.floor(i / 3) * (th + 0.3);
      s.addShape("roundRect", { x, y, w: tw, h: th, fill: { color: TINT }, rectRadius: 0.08, line: { color: "D7E9F2", width: 1 } });
      s.addText(value, { x: x + 0.25, y: y + 0.18, w: tw - 0.5, h: 0.6, fontSize: 28, bold: true, color: NAVY });
      s.addText(label.toUpperCase(), { x: x + 0.25, y: y + 0.85, w: tw - 0.5, h: 0.35, fontSize: 10.5, color: GREY, charSpacing: 2 });
    });

    // What stands out
    const insights: string[] = [];
    if (top.best) insights.push(`Fastest moment of the season: ${fmt(top.best.value, 1, "km/h")} ${vsLine(top.best.game)}.`);
    if (dist.best) insights.push(`Biggest running shift: ${fmt(dist.best.value, 2, "km")} covered ${vsLine(dist.best.game)}.`);
    if (hsm.best) insights.push(`Most high-speed running: ${Math.round(hsm.best.value)} m over 18 km/h ${vsLine(hsm.best.game)}.`);
    const distTrend = trendWords(dist.last4PctVsSeason);
    if (distTrend) insights.push(`Recent form: distance over the last 4 games is ${distTrend}.`);
    const loadTrend = trendWords(load.last4PctVsSeason);
    if (loadTrend && load.last4PctVsSeason != null && Math.abs(load.last4PctVsSeason) >= 10)
      insights.push(`Overall workload (player load) in the last 4 games is ${loadTrend}.`);

    s.addText("WHAT STANDS OUT", { x: 0.75, y: 5.05, w: 6, h: 0.35, fontSize: 12, bold: true, color: SKY_DARK, charSpacing: 3 });
    s.addText(
      insights.slice(0, 4).map(t => ({ text: t, options: { bullet: { code: "2022", indent: 14 }, breakLine: true } })),
      { x: 0.75, y: 5.4, w: 11.8, h: 1.7, fontSize: 13.5, color: INK, lineSpacing: 22 },
    );
    addFooter(s, input);
  }

  // ── Metric chart slides ───────────────────────────────────────────────────
  for (const m of input.metrics) {
    const stats = metricStats(games, m.id);
    if (stats.seasonAvg == null) continue; // no data at all — skip slide
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, m.title + (m.unit ? ` (${m.unit})` : ""), m.blurb);

    const vals = games.map(g => g.values[m.id]);
    const combo = [
      {
        type: "bar",
        // null (not 0) for games without this metric — renders a gap, not a fake zero bar
        data: [{ name: m.title, labels: cats, values: vals as number[] }],
        options: { chartColors: [SKY_DARK], barGapWidthPct: 40 },
      },
      {
        type: "line",
        data: [{ name: "Season average", labels: cats, values: cats.map(() => Number(stats.seasonAvg!.toFixed(m.decimals + 1))) }],
        options: { chartColors: [PURPLE], lineDataSymbol: "none", lineDash: "dash", lineSize: 1.5 },
      },
    ];
    // pptxgenjs combo charts take (typesArray, options) at runtime; the TS typings
    // only describe the single-type (type, data, options) overload, hence the cast.
    (s.addChart as unknown as (types: unknown, opts: unknown) => void)(combo, {
      x: 0.6, y: 1.55, w: 12.1, h: 4.7,
      catAxisLabelFontSize: 9, catAxisLabelColor: GREY, catAxisLabelRotate: cats.length > 10 ? -45 : 0,
      valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "dash", color: "E3EDF3", size: 0.5 },
      showLegend: true, legendPos: "b", legendFontSize: 10,
      dataLabelFormatCode: "0", showValue: false,
      catGridLine: { style: "none" },
    });

    const bits: string[] = [];
    if (stats.best) bits.push(`Best: ${fmt(stats.best.value, m.decimals, m.unit)} ${vsLine(stats.best.game)}`);
    bits.push(`Season average: ${fmt(stats.seasonAvg, m.decimals, m.unit)} per game`);
    if (m.summable && stats.seasonTotal != null) bits.push(`Season total: ${fmt(stats.seasonTotal, m.decimals === 2 ? 1 : 0, m.unit)}`);
    const tr = trendWords(stats.last4PctVsSeason);
    if (tr) bits.push(`Last 4 games: ${tr}`);
    addInsightBar(s, bits.join("   •   "));
    addFooter(s, input);
  }

  // ── Accel/decel counts slide ──────────────────────────────────────────────
  if (games.some(g => g.accel != null || g.decel != null)) {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "Accelerations / Decelerations >3 m/s²",
      "How many hard bursts and hard stops each game — the invisible work that doesn't show up as distance.");
    s.addChart("bar", [
      { name: "Accelerations", labels: cats, values: games.map(g => g.accel) as number[] },
      { name: "Decelerations", labels: cats, values: games.map(g => g.decel) as number[] },
    ], {
      x: 0.6, y: 1.55, w: 12.1, h: 4.7,
      chartColors: [SKY_DARK, PURPLE], barGapWidthPct: 40, barGrouping: "clustered",
      catAxisLabelFontSize: 9, catAxisLabelColor: GREY, catAxisLabelRotate: cats.length > 10 ? -45 : 0,
      valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "dash", color: "E3EDF3", size: 0.5 },
      showLegend: true, legendPos: "b", legendFontSize: 10,
      catGridLine: { style: "none" },
    });
    const accs = games.filter(g => g.accel != null);
    const decs = games.filter(g => g.decel != null);
    const bits: string[] = [];
    if (accs.length) {
      const bestA = accs.reduce((p, g) => ((g.accel ?? 0) > (p.accel ?? 0) ? g : p));
      bits.push(`Busiest game: ${Math.round(bestA.accel ?? 0)} accels ${vsLine(bestA)}`);
      bits.push(`Averages: ${Math.round(avg(accs.map(g => g.accel as number)) ?? 0)} accels`
        + (decs.length ? ` / ${Math.round(avg(decs.map(g => g.decel as number)) ?? 0)} decels per game` : " per game"));
    }
    addInsightBar(s, bits.join("   •   "));
    addFooter(s, input);
  }

  // ── Max accel/decel slide ─────────────────────────────────────────────────
  if (games.some(g => g.maxAcc != null || g.maxDec != null)) {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "Max Acceleration / Deceleration (m/s²)",
      "Not how often, but how hard — the single biggest burst and hardest stop each game.");
    s.addChart("bar", [
      { name: "Max acceleration", labels: cats, values: games.map(g => g.maxAcc) as number[] },
      { name: "Max deceleration", labels: cats, values: games.map(g => g.maxDec) as number[] },
    ], {
      x: 0.6, y: 1.55, w: 12.1, h: 4.7,
      chartColors: [SKY_DARK, PURPLE], barGapWidthPct: 40, barGrouping: "clustered",
      catAxisLabelFontSize: 9, catAxisLabelColor: GREY, catAxisLabelRotate: cats.length > 10 ? -45 : 0,
      valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "dash", color: "E3EDF3", size: 0.5 },
      showLegend: true, legendPos: "b", legendFontSize: 10,
      catGridLine: { style: "none" },
    });
    addFooter(s, input);
  }

  // ── Closing slide ─────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    if (input.coachNote?.trim()) {
      s.addText("A NOTE FROM YOUR COACH", { x: 0.9, y: 1.6, w: 11, h: 0.4, fontSize: 14, bold: true, color: SKY, charSpacing: 4 });
      s.addText(input.coachNote.trim(), { x: 0.9, y: 2.2, w: 11.4, h: 3.4, fontSize: 20, color: PAPER, lineSpacing: 30 });
    } else {
      s.addText(`Keep it going, ${input.playerName.split(" ")[0]}.`, { x: 0.9, y: 2.6, w: 11.4, h: 1, fontSize: 36, bold: true, color: PAPER });
      s.addText("The numbers only tell part of the story — but they show the work you're putting in every week.", {
        x: 0.9, y: 3.7, w: 10.5, h: 0.8, fontSize: 16, color: "C9E4F2" },
      );
    }
    s.addText(`${input.teamLabel}  •  ${input.seasonLabel}  •  Generated ${input.generatedOn}`, {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 11, color: "6E93A8",
    });
  }

  const safe = input.playerName.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  await pptx.writeFile({ fileName: `${safe || "Player"}-GPS-Report-${input.seasonLabel.replace(/[^\w\-]+/g, "-")}.pptx` });

  // ── slide furniture ──────────────────────────────────────────────────────
  function addHeader(s: ReturnType<typeof pptx.addSlide>, title: string, sub: string) {
    s.addShape("rect", { x: 0, y: 0, w: W, h: 0.12, fill: { color: SKY } });
    s.addText(title, { x: 0.6, y: 0.35, w: 12.1, h: 0.55, fontSize: 26, bold: true, color: NAVY });
    s.addText(sub, { x: 0.6, y: 0.95, w: 12.1, h: 0.4, fontSize: 12.5, color: GREY });
  }
  function addInsightBar(s: ReturnType<typeof pptx.addSlide>, text: string) {
    if (!text) return;
    s.addShape("roundRect", { x: 0.6, y: 6.35, w: 12.1, h: 0.62, fill: { color: TINT }, rectRadius: 0.06, line: { color: "D7E9F2", width: 1 } });
    s.addText(text, { x: 0.85, y: 6.35, w: 11.7, h: 0.62, fontSize: 11.5, color: INK, valign: "middle" });
  }
  function addFooter(s: ReturnType<typeof pptx.addSlide>, inp: ReportInput) {
    s.addText(`${inp.playerName}  •  ${inp.teamLabel}  •  ${inp.seasonLabel}`, {
      x: 0.6, y: 7.08, w: 9, h: 0.3, fontSize: 9, color: "9FB3C0",
    });
  }
}
