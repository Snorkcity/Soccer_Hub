/**
 * Player athletic testing report — generates a branded PPTX from the Testing tab data.
 * Same visual language as the GPS season report (navy/sky brand, header bar,
 * insight bar, footer) so every document that leaves the club looks like ours.
 *
 * The football commentary is the point of this report: every number is tied to
 * a game situation — what the player can trust, and what opponents will try.
 */

// ── Input types ──────────────────────────────────────────────────────────────

export interface TestingMetricValue {
  id: string; // matches the app's MetricKey ids ("split010", "verticalM", ...)
  label: string; // e.g. "0-10m Split (s)" — carries the unit
  decimals: number;
  lowerIsBetter: boolean;
  you: number | null;
  /** 100 = best in squad; ties share 100 (same convention as the app). */
  percentile: number | null;
  squadAvg: number | null;
  posAvg: number | null; // average of the player's position group, null if unknown pos
  squadBest: number | null;
  prevYou: number | null; // same player, previous testing year
}

export interface TestingReportInput {
  playerName: string;
  position: string | null; // position group, e.g. "Midfielder" — null/Unknown hidden
  teamLabel: string;
  year: string;
  prevYear: string | null; // only set when the player has results in it
  squadSize: number;
  coachNote?: string;
  generatedOn: string; // e.g. "15 July 2026"
  metrics: TestingMetricValue[]; // in display order
}

// ── Brand (kept identical to the GPS report) ─────────────────────────────────

const NAVY = "0F2C43";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const PURPLE = "9B5DE5";
const ORANGE = "ED8936";
const INK = "1C2B36";
const GREY = "647484";
const PAPER = "FFFFFF";
const TINT = "EFF7FB";

const W = 13.33;
const H = 7.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number | null, d: number) => (v == null ? "—" : v.toFixed(d));

const get = (metrics: TestingMetricValue[], id: string) => metrics.find(m => m.id === id);
const pctOf = (metrics: TestingMetricValue[], id: string): number | null =>
  get(metrics, id)?.percentile ?? null;

/** "better than 72% of the squad" style line; percentile already 100=best. */
const standingWords = (p: number | null): string | null =>
  p == null ? null : p >= 100 ? "best in the squad" : `better than ${p}% of the squad`;

// ── Football commentary — coach voice, addressed to the player ──────────────
// Top third of the squad earns a "trust" line; bottom third a "be aware" line
// framed around what OPPONENTS will try, never as a weakness.

const HIGH = 67;
const LOW = 33;

function buildTrustNotes(metrics: TestingMetricValue[]): string[] {
  const p = (id: string) => pctOf(metrics, id);
  const out: string[] = [];

  const s010 = p("split010");
  if (s010 != null && s010 >= HIGH)
    out.push("Explosive first 10 metres — in a 1v1 you can let it come to a stop and trust your first step: react late when defending, or stop the defender dead and accelerate away on the ball.");

  const s1020 = p("split1020");
  if (s1020 != null && s1020 >= HIGH)
    out.push("You hold your speed through the middle of a sprint — once you get ahead in a race, you tend to stay ahead.");

  const s2030 = p("split2030");
  if (s2030 != null && s2030 >= HIGH)
    out.push("Flying 20–30 metres — you can push the ball past an opponent and simply outrun her. You don't need to beat anyone with a trick.");

  const t30 = p("total30m");
  if (t30 != null && t30 >= HIGH)
    out.push("One of the quickest over 30 metres in the squad — recovery runs and space in behind are yours to own.");

  const vert = Math.max(p("verticalM") ?? -1, p("verticalStart") ?? -1, p("verticalTotal") ?? -1);
  if (vert >= HIGH)
    out.push("Big vertical jump — back yourself in the key areas at set pieces, attacking and defending. First contact is there to be won.");

  const bals = p("balsomS");
  if (bals != null && bals >= HIGH)
    out.push("Sharp change of direction — tight areas and twisting 1v1s are where you're at your best. Keep the game turning and opponents can't live with you.");

  const horiz = p("horizontalM");
  if (horiz != null && horiz >= HIGH)
    out.push("Strong horizontal power — hard to knock off the ball, and quick off the mark in duels.");

  return out;
}

function buildAwareNotes(metrics: TestingMetricValue[]): string[] {
  const p = (id: string) => pctOf(metrics, id);
  const out: string[] = [];

  const s010 = p("split010");
  if (s010 != null && s010 <= LOW)
    out.push("Quick starters will try to bring the 1v1 to a standstill and beat you from a standing start — stay touch-tight and don't let the duel stop.");

  const s1020 = p("split1020");
  if (s1020 != null && s1020 <= LOW)
    out.push("In a longer race opponents can pull away through the middle metres — make your move early and keep duels short, sharp and close to the ball.");

  const s2030 = p("split2030");
  if (s2030 != null && s2030 <= LOW)
    out.push("Fast opponents will look to knock the ball past you and run — win the duel early with body position and anticipation, before it becomes a straight footrace.");

  const vert = Math.max(p("verticalM") ?? -1, p("verticalStart") ?? -1, p("verticalTotal") ?? -1);
  const hasVert = [p("verticalM"), p("verticalStart"), p("verticalTotal")].some(v => v != null);
  if (hasVert && vert !== -1 && vert <= LOW)
    out.push("Taller opponents will target you in the air at set pieces — take the ground job: edge of the box, the short option, or a smaller marker. That's a role, not a demotion.");

  const bals = p("balsomS");
  if (bals != null && bals <= LOW)
    out.push("Tricky, twisting attackers will try to keep turning you — show them into a straight race on your terms instead of a spin contest on theirs.");

  const horiz = p("horizontalM");
  if (horiz != null && horiz <= LOW)
    out.push("Physical opponents will try to make every duel a shoving contest — beat them with timing and positioning. Arrive first and the shove never happens.");

  return out;
}

/** One-line sprint identity from the first-step and top-gear percentiles. */
function speedTypeLine(metrics: TestingMetricValue[]): string {
  const a = pctOf(metrics, "split010");
  const b = pctOf(metrics, "split2030");
  if (a == null || b == null) return "Not enough sprint data to call your speed type yet.";
  if (a >= HIGH && b >= HIGH) return "Speed type: quick everywhere — explosive early and still pulling away late. Very few players have both.";
  if (a >= HIGH) return "Speed type: explosive starter — your race is won in the first ten metres, so play in the moments where it starts and stops.";
  if (b >= HIGH) return "Speed type: flying finisher — you build into top gear, so the longer the race, the more it favours you.";
  if (a <= LOW && b <= LOW) return "Speed type: the straight race isn't your game — keep duels early, physical and clever, and you take speed out of the contest.";
  return "Speed type: even across all three phases — no phase to hide, no phase to lean on.";
}

// ── Generator ────────────────────────────────────────────────────────────────

export async function generatePlayerTestingReport(input: TestingReportInput): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = input.teamLabel;
  pptx.title = `${input.playerName} — Athletic Testing Report`;

  const metrics = input.metrics;
  const tested = metrics.filter(m => m.you != null);
  const posLabel = input.position && input.position !== "Unknown" ? input.position : null;

  // ── Title slide ────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    s.addText("ATHLETIC TESTING REPORT", {
      x: 0.9, y: 1.5, w: 11, h: 0.5, fontSize: 20, color: SKY, bold: true, charSpacing: 6,
    });
    s.addText(input.playerName, {
      x: 0.9, y: 2.1, w: 11.5, h: 1.4, fontSize: 54, color: PAPER, bold: true,
    });
    s.addText([posLabel, input.teamLabel, input.year].filter(Boolean).join("  •  "), {
      x: 0.9, y: 3.6, w: 11, h: 0.5, fontSize: 20, color: "C9E4F2",
    });
    s.addText(
      `${tested.length} test${tested.length === 1 ? "" : "s"} completed  •  measured against a squad of ${input.squadSize}`,
      { x: 0.9, y: 4.15, w: 11, h: 0.4, fontSize: 14, color: "8FB3C7" },
    );
    s.addText("How you're built — and how to use it on the pitch.", {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 12, italic: true, color: "6E93A8",
    });
  }

  // ── Snapshot slide — headline results as tiles ────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "Your results at a glance", `${input.playerName} — ${input.year} testing day`);

    const tileIds = ["total30m", "split010", "verticalM", "horizontalM", "balsomS", "split2030"];
    const tiles = tileIds
      .map(id => get(metrics, id))
      .filter((m): m is TestingMetricValue => m != null && m.you != null)
      .slice(0, 6);

    const tw = 3.85, th = 1.5, gx = 0.35, x0 = 0.75, y0 = 1.5;
    tiles.forEach((m, i) => {
      const x = x0 + (i % 3) * (tw + gx);
      const y = y0 + Math.floor(i / 3) * (th + 0.3);
      s.addShape("roundRect", { x, y, w: tw, h: th, fill: { color: TINT }, rectRadius: 0.08, line: { color: "D7E9F2", width: 1 } });
      s.addText(fmt(m.you, m.decimals), { x: x + 0.25, y: y + 0.14, w: tw - 0.5, h: 0.6, fontSize: 26, bold: true, color: NAVY });
      s.addText(m.label.toUpperCase(), { x: x + 0.25, y: y + 0.78, w: tw - 0.5, h: 0.3, fontSize: 10, color: GREY, charSpacing: 2 });
      const stand = standingWords(m.percentile);
      if (stand) s.addText(stand, { x: x + 0.25, y: y + 1.08, w: tw - 0.5, h: 0.3, fontSize: 10.5, italic: true, color: SKY_DARK });
    });

    const bests = tested.filter(m => m.percentile != null && m.percentile >= 100);
    const bits: string[] = [];
    if (bests.length) bits.push(`Squad-best in: ${bests.map(m => m.label).join(", ")}.`);
    const strongCount = tested.filter(m => (m.percentile ?? 0) >= HIGH).length;
    if (strongCount) bits.push(`Top third of the squad in ${strongCount} of ${tested.length} tests.`);
    addInsightBar(s, bits.join("   •   ") || "Full results, squad context and what it means on the pitch — over the page.");
    addFooter(s, input);
  }

  // ── Squad standing chart — percentile per test ────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "Where you sit in the squad",
      "Each bar is your standing in the squad for that test — 100 means nobody beat you. The dashed line is the middle of the squad.");

    const withPct = metrics.filter(m => m.percentile != null);
    const labels = withPct.map(m => m.label.replace(/ \((s|m)\)$/i, ""));
    const combo = [
      {
        type: "bar",
        data: [{ name: "Squad standing", labels, values: withPct.map(m => m.percentile as number) }],
        options: { chartColors: [SKY_DARK], barGapWidthPct: 40 },
      },
      {
        type: "line",
        data: [{ name: "Squad middle", labels, values: labels.map(() => 50) }],
        options: { chartColors: [PURPLE], lineDataSymbol: "none", lineDash: "dash", lineSize: 1.5 },
      },
    ];
    (s.addChart as unknown as (types: unknown, opts: unknown) => void)(combo, {
      x: 0.6, y: 1.55, w: 12.1, h: 4.7,
      valAxisMinVal: 0, valAxisMaxVal: 100,
      catAxisLabelFontSize: 10, catAxisLabelColor: GREY,
      valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "dash", color: "E3EDF3", size: 0.5 },
      showLegend: true, legendPos: "b", legendFontSize: 10,
      catGridLine: { style: "none" },
    });

    const sorted = [...withPct].sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0));
    const bits: string[] = [];
    if (sorted.length) {
      const top = sorted[0];
      bits.push(`Strongest tool: ${top.label} (${standingWords(top.percentile)})`);
      const low = sorted[sorted.length - 1];
      if (low !== top && (low.percentile ?? 100) <= LOW) bits.push(`Worth knowing: ${low.label} is where opponents will test you`);
    }
    bits.push(speedTypeLine(metrics));
    addInsightBar(s, bits.join("   •   "));
    addFooter(s, input);
  }

  // ── Sprint story — splits vs squad / position ─────────────────────────────
  {
    const splitIds = ["split010", "split1020", "split2030", "total30m"];
    const splits = splitIds.map(id => get(metrics, id)).filter((m): m is TestingMetricValue => m != null && m.you != null);
    if (splits.length >= 2) {
      const s = pptx.addSlide();
      s.background = { color: PAPER };
      addHeader(s, "The 30 metre sprint, in three chapters",
        "0-10 is your first step, 10-20 is how you build, 20-30 is top gear. Lower is faster. Different players win different chapters — the game has room for all of them.");

      const labels = splits.map(m => m.label.replace(/ Split \(s\)| \(s\)/i, ""));
      const series = [
        { name: "You", labels, values: splits.map(m => m.you as number), color: SKY_DARK },
        { name: "Squad average", labels, values: splits.map(m => m.squadAvg ?? 0), color: PURPLE },
        ...(posLabel && splits.some(m => m.posAvg != null)
          ? [{ name: `${posLabel}s average`, labels, values: splits.map(m => m.posAvg ?? 0), color: ORANGE }]
          : []),
      ];
      s.addChart("bar", series.map(({ name, labels: l, values }) => ({ name, labels: l, values })), {
        x: 0.6, y: 1.55, w: 12.1, h: 4.7,
        chartColors: series.map(x => x.color), barGapWidthPct: 40, barGrouping: "clustered",
        catAxisLabelFontSize: 11, catAxisLabelColor: GREY,
        valAxisLabelFontSize: 10, valAxisLabelColor: GREY, valGridLine: { style: "dash", color: "E3EDF3", size: 0.5 },
        showLegend: true, legendPos: "b", legendFontSize: 10,
        dataLabelFormatCode: "0.00", showValue: true, dataLabelFontSize: 9, dataLabelColor: GREY,
        catGridLine: { style: "none" },
      });
      addInsightBar(s, speedTypeLine(metrics));
      addFooter(s, input);
    }
  }

  // ── Full numbers table ────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "Every test, with the squad around you",
      "Your result next to the squad average, " + (posLabel ? `the ${posLabel.toLowerCase()}s' average, ` : "") + "and the best mark anyone set. Sky-blue means you beat the squad average.");

    type Cell = { text: string; options?: Record<string, unknown> };
    const headCells = ["Test", "You", "Squad avg", ...(posLabel ? [`${posLabel}s avg`] : []), "Squad best", "Standing"];
    const headRow: Cell[] = headCells.map((t, i) => ({
      text: t, options: { bold: true, color: PAPER, fill: { color: NAVY }, align: i === 0 ? "left" : "center" },
    }));
    const rows: Cell[][] = [headRow];
    for (const m of metrics) {
      if (m.you == null && m.squadAvg == null) continue;
      const fillCol = rows.length % 2 === 1 ? TINT : PAPER;
      const beatsSquad = m.you != null && m.squadAvg != null
        && (m.lowerIsBetter ? m.you <= m.squadAvg : m.you >= m.squadAvg);
      rows.push([
        { text: m.label, options: { align: "left", color: INK, fill: { color: fillCol } } },
        { text: fmt(m.you, m.decimals), options: { align: "center", bold: true, color: beatsSquad ? SKY_DARK : NAVY, fill: { color: fillCol } } },
        { text: fmt(m.squadAvg, m.decimals), options: { align: "center", color: GREY, fill: { color: fillCol } } },
        ...(posLabel ? [{ text: fmt(m.posAvg, m.decimals), options: { align: "center" as const, color: GREY, fill: { color: fillCol } } }] : []),
        { text: fmt(m.squadBest, m.decimals), options: { align: "center", color: GREY, fill: { color: fillCol } } },
        { text: m.percentile == null ? "—" : m.percentile >= 100 ? "squad best" : `top ${Math.max(1, 100 - m.percentile)}%`, options: { align: "center", color: (m.percentile ?? 0) >= HIGH ? SKY_DARK : GREY, fill: { color: fillCol } } },
      ]);
    }
    const nCols = headCells.length;
    s.addTable(rows as never, {
      x: 0.75, y: 1.6, w: 11.8, colW: [3.4, ...Array(nCols - 1).fill((11.8 - 3.4) / (nCols - 1))],
      fontSize: 11.5, rowH: 0.4, border: { type: "solid", color: "D7E9F2", pt: 0.5 },
      valign: "middle",
    });
    addInsightBar(s, `"Standing" is your place in the ${input.year} squad of ${input.squadSize} — "top 25%" means three quarters of the squad didn't beat your mark.`);
    addFooter(s, input);
  }

  // ── What you can trust / Be aware of ──────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, "What this means on the pitch",
      "Numbers are only useful if they change how you play. Trust the tools you have — and know what opponents will try, so it never surprises you.");

    const trust = buildTrustNotes(metrics);
    const aware = buildAwareNotes(metrics);

    const colW = 5.85, xL = 0.75, xR = 0.75 + colW + 0.35, yTop = 1.6;
    s.addText("WHAT YOU CAN TRUST", { x: xL, y: yTop, w: colW, h: 0.35, fontSize: 13, bold: true, color: SKY_DARK, charSpacing: 3 });
    s.addText(
      (trust.length ? trust : ["A balanced athletic profile — no single tool stands out, and nothing for opponents to target. Your edge comes from using everything together."])
        .map(t => ({ text: t, options: { bullet: { code: "2022", indent: 12 }, breakLine: true, paraSpaceAfter: 8 } })),
      { x: xL, y: yTop + 0.4, w: colW, h: 4.3, fontSize: 12.5, color: INK, lineSpacing: 17, valign: "top" },
    );

    s.addText("BE AWARE OF", { x: xR, y: yTop, w: colW, h: 0.35, fontSize: 13, bold: true, color: ORANGE, charSpacing: 3 });
    s.addText(
      (aware.length ? aware : ["Nothing in this testing gives an opponent an obvious plan against you. Keep it that way."])
        .map(t => ({ text: t, options: { bullet: { code: "2022", indent: 12 }, breakLine: true, paraSpaceAfter: 8 } })),
      { x: xR, y: yTop + 0.4, w: colW, h: 4.3, fontSize: 12.5, color: INK, lineSpacing: 17, valign: "top" },
    );

    addInsightBar(s, "None of this is fixed — testing is a photo of one day, and every line here can move by next year's testing.");
    addFooter(s, input);
  }

  // ── Year on year (only when the player has previous results) ─────────────
  if (input.prevYear && metrics.some(m => m.prevYou != null && m.you != null)) {
    const s = pptx.addSlide();
    s.background = { color: PAPER };
    addHeader(s, `You vs you — ${input.prevYear} to ${input.year}`,
      "The only comparison that's entirely in your hands. Sky-blue means you beat your own mark from last time.");

    type Cell = { text: string; options?: Record<string, unknown> };
    const headRow: Cell[] = [
      { text: "Test", options: { bold: true, color: PAPER, fill: { color: NAVY }, align: "left" } },
      { text: input.prevYear, options: { bold: true, color: PAPER, fill: { color: NAVY }, align: "center" } },
      { text: input.year, options: { bold: true, color: PAPER, fill: { color: NAVY }, align: "center" } },
      { text: "Change", options: { bold: true, color: PAPER, fill: { color: NAVY }, align: "center" } },
    ];
    const rows: Cell[][] = [headRow];
    let bestGain: { label: string; words: string; score: number } | null = null;
    for (const m of metrics) {
      if (m.you == null || m.prevYou == null) continue;
      const improved = m.lowerIsBetter ? m.you < m.prevYou : m.you > m.prevYou;
      const same = m.you === m.prevYou;
      const diff = Math.abs(m.you - m.prevYou);
      const words = same ? "level" : `${diff.toFixed(m.decimals)} ${improved ? "better" : "off last time"}`;
      if (improved && m.prevYou !== 0) {
        const relGain = diff / Math.abs(m.prevYou);
        if (!bestGain || relGain > bestGain.score) bestGain = { label: m.label, words, score: relGain };
      }
      const fillCol = rows.length % 2 === 1 ? TINT : PAPER;
      rows.push([
        { text: m.label, options: { align: "left", color: INK, fill: { color: fillCol } } },
        { text: fmt(m.prevYou, m.decimals), options: { align: "center", color: GREY, fill: { color: fillCol } } },
        { text: fmt(m.you, m.decimals), options: { align: "center", bold: true, color: improved ? SKY_DARK : NAVY, fill: { color: fillCol } } },
        { text: words, options: { align: "center", color: improved ? SKY_DARK : same ? GREY : ORANGE, fill: { color: fillCol } } },
      ]);
    }
    s.addTable(rows as never, {
      x: 0.75, y: 1.6, w: 11.8, colW: [4.2, ...Array(3).fill((11.8 - 4.2) / 3)],
      fontSize: 12, rowH: 0.42, border: { type: "solid", color: "D7E9F2", pt: 0.5 },
      valign: "middle",
    });
    addInsightBar(s, bestGain
      ? `Biggest step forward: ${bestGain.label} — ${bestGain.words}. That's training showing up in the numbers.`
      : "Marks that hold steady year to year are worth something too — consistency is a result.");
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
      s.addText(`Know your tools, ${input.playerName.split(" ")[0]}.`, { x: 0.9, y: 2.6, w: 11.4, h: 1, fontSize: 36, bold: true, color: PAPER });
      s.addText("Every number in this report was run, jumped and measured by you on testing day — nothing here is guessed.", {
        x: 0.9, y: 3.7, w: 10.5, h: 0.8, fontSize: 16, color: "C9E4F2",
      });
    }
    s.addText(`${input.teamLabel}  •  ${input.year} testing  •  Generated ${input.generatedOn}`, {
      x: 0.9, y: 6.6, w: 11, h: 0.4, fontSize: 11, color: "6E93A8",
    });
  }

  const safe = input.playerName.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  await pptx.writeFile({ fileName: `${safe || "Player"}-Testing-Report-${input.year}.pptx` });

  // ── slide furniture (identical to GPS report) ─────────────────────────────
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
  function addFooter(s: ReturnType<typeof pptx.addSlide>, inp: TestingReportInput) {
    s.addText(`${inp.playerName}  •  ${inp.teamLabel}  •  ${inp.year} testing`, {
      x: 0.6, y: 7.08, w: 9, h: 0.3, fontSize: 9, color: "9FB3C0",
    });
  }
}
