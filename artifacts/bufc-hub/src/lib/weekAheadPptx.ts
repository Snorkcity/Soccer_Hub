/**
 * Monday "Week Ahead" report — a PowerPoint the coach reads before choosing
 * the two training sessions for the week. Opens with last week's review
 * (his own reflections), then turns to the coming week's opponent.
 */
import PptxGenJS from "pptxgenjs";

const NAVY = "0F2C43";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const GREY = "647484";
const INK = "1C2B36";
const PAPER = "FFFFFF";
const TINT = "EFF7FB";

const W = 13.33;
const H = 7.5;
const MX = 0.55;

export interface WeekAheadGame {
  date: string; // as shown, e.g. "12.07.2026"
  opponent: string;
  result: string; // "W 3–1" style
  scorers: string; // "Smith (2, 1 assist Jones), Brown"
}

export interface WeekAheadReflection {
  title: string;
  date: string;
  rows: Array<[string, string]>; // label → answer, empties filtered by caller
}

export interface WeekAheadInput {
  weekOf: string; // e.g. "Monday 20 July 2026"
  opponent: string;
  author: string;
  generatedOn: string;
  review: string[]; // AI bullets from his reflections
  pointers: string[]; // AI prep pointers
  reflections: WeekAheadReflection[]; // latest training (+match) reflection tables
  lastVsOpponent: WeekAheadReflection | null;
  theirGames: WeekAheadGame[];
  ourGames: WeekAheadGame[];
}

function header(slide: PptxGenJS.Slide, kicker: string, title: string) {
  slide.background = { color: PAPER };
  slide.addShape("rect", { x: 0, y: 0, w: W, h: 0.98, fill: { color: NAVY } });
  slide.addShape("rect", { x: 0, y: 0.98, w: W, h: 0.045, fill: { color: SKY } });
  slide.addText(kicker.toUpperCase(), {
    x: MX, y: 0.12, w: W - 2 * MX, h: 0.3,
    fontSize: 10, color: SKY, bold: true, charSpacing: 3,
  });
  slide.addText(title, {
    x: MX, y: 0.36, w: W - 2 * MX, h: 0.55,
    fontSize: 24, color: PAPER, bold: true,
  });
}

function footer(slide: PptxGenJS.Slide, text: string) {
  slide.addText(text, {
    x: MX, y: H - 0.42, w: W - 2 * MX, h: 0.3,
    fontSize: 8.5, color: GREY, align: "right",
  });
}

function bullets(slide: PptxGenJS.Slide, lines: string[], y = 1.6) {
  slide.addText(
    lines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true } })),
    { x: MX + 0.2, y, w: W - 2 * MX - 0.4, h: H - y - 0.9, fontSize: 16, color: INK, lineSpacing: 30, valign: "top" },
  );
}

function qaTable(slide: PptxGenJS.Slide, rows: Array<[string, string]>, labelW = 3.4) {
  const tableRows: PptxGenJS.TableRow[] = rows.map(([q, a]) => [
    { text: q, options: { bold: true, color: NAVY, fontSize: 11, fill: { color: TINT }, valign: "top" as const } },
    { text: a || " ", options: { color: INK, fontSize: 11, valign: "top" as const } },
  ]);
  slide.addTable(tableRows, {
    x: MX, y: 1.28, w: W - 2 * MX,
    colW: [labelW, W - 2 * MX - labelW],
    border: { type: "solid", color: "D7E3EC", pt: 0.75 },
    margin: 0.09,
    autoPage: false,
  });
}

function gamesTable(slide: PptxGenJS.Slide, games: WeekAheadGame[]) {
  const head: PptxGenJS.TableRow = ["Date", "Opponent", "Result", "Scorers & assists"].map((t) => ({
    text: t,
    options: { bold: true, color: PAPER, fontSize: 12, fill: { color: NAVY } },
  }));
  const rows: PptxGenJS.TableRow[] = games.map((g) => [
    { text: g.date, options: { color: INK, fontSize: 12, valign: "top" as const } },
    { text: g.opponent, options: { color: INK, fontSize: 12, bold: true, valign: "top" as const } },
    { text: g.result, options: { color: NAVY, fontSize: 12, bold: true, valign: "top" as const } },
    { text: g.scorers || "—", options: { color: INK, fontSize: 11, valign: "top" as const } },
  ]);
  slide.addTable([head, ...rows], {
    x: MX, y: 1.5, w: W - 2 * MX,
    colW: [1.6, 2.6, 1.4, W - 2 * MX - 5.6],
    border: { type: "solid", color: "D7E3EC", pt: 0.75 },
    margin: 0.1,
    autoPage: false,
  });
}

export function buildWeekAheadPptx(input: WeekAheadInput): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = input.author;
  pptx.title = `Week Ahead — vs ${input.opponent}`;

  // ── Cover ──
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: H - 1.1, w: W, h: 0.06, fill: { color: SKY } });
    s.addText("WEEK AHEAD", {
      x: MX, y: 2.15, w: W - 2 * MX, h: 0.4,
      fontSize: 14, color: SKY, bold: true, charSpacing: 4, align: "center",
    });
    s.addText(`Belconnen United vs ${input.opponent}`, {
      x: MX, y: 2.6, w: W - 2 * MX, h: 1.1,
      fontSize: 38, color: PAPER, bold: true, align: "center",
    });
    s.addText(
      [
        { text: `Week of ${input.weekOf}`, options: { bold: true, color: PAPER } },
        { text: `   •   ${input.author}`, options: { color: SKY } },
      ],
      { x: MX, y: 3.85, w: W - 2 * MX, h: 0.4, fontSize: 15, align: "center" },
    );
  }

  // ── Last week's review (AI bullets) ──
  if (input.review.length) {
    const s = pptx.addSlide();
    header(s, "Last week", "Your week in review");
    bullets(s, input.review);
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  // ── Latest reflections in full ──
  for (const r of input.reflections) {
    const s = pptx.addSlide();
    header(s, "Last week", `${r.title}${r.date ? ` — ${r.date}` : ""}`);
    qaTable(s, r.rows);
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  // ── Last time vs opponent ──
  if (input.lastVsOpponent) {
    const s = pptx.addSlide();
    header(
      s,
      "This coming week",
      `Last time vs ${input.opponent}${input.lastVsOpponent.date ? ` — ${input.lastVsOpponent.date}` : ""}`,
    );
    qaTable(s, input.lastVsOpponent.rows);
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  // ── Their last 3 games ──
  {
    const s = pptx.addSlide();
    header(s, "This coming week", `${input.opponent} — last ${input.theirGames.length || 3} games`);
    if (input.theirGames.length) gamesTable(s, input.theirGames);
    else s.addText("No league data available for this club yet.", { x: MX, y: 1.6, w: W - 2 * MX, h: 0.5, fontSize: 14, color: GREY });
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  // ── Our last 3 games ──
  {
    const s = pptx.addSlide();
    header(s, "This coming week", `Belconnen United — last ${input.ourGames.length || 3} games`);
    if (input.ourGames.length) gamesTable(s, input.ourGames);
    else s.addText("No league data available yet.", { x: MX, y: 1.6, w: W - 2 * MX, h: 0.5, fontSize: 14, color: GREY });
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  // ── Prep pointers ──
  if (input.pointers.length) {
    const s = pptx.addSlide();
    header(s, "This coming week", "Heads-up for the week");
    bullets(s, input.pointers);
    s.addShape("rect", { x: MX, y: H - 1.15, w: W - 2 * MX, h: 0.04, fill: { color: SKY_DARK } });
    s.addText("Read before choosing this week's two sessions.", {
      x: MX, y: H - 1.05, w: W - 2 * MX, h: 0.35, fontSize: 12, color: GREY, italic: true,
    });
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  return pptx;
}
