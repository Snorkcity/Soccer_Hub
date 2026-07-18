/**
 * Monday "Week Ahead" report — exec-level briefing deck.
 * Dark club-branded slides, scoreboard cards and punchy pull-out bullets
 * rather than long tables. Read before choosing the week's two sessions.
 */
import PptxGenJS from "pptxgenjs";

const NAVY = "0F2C43"; // slide background
const CARD = "17395A"; // card fill on navy
const CARD_LINE = "23496E";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const PAPER = "FFFFFF";
const MUTED = "9FB3C4"; // muted text on navy
const WIN = "2EB67D";
const LOSS = "E85C5C";
const DRAW = "8A9BAB";

const W = 13.33;
const H = 7.5;
const MX = 0.6;

export interface WeekAheadGame {
  date: string;
  opponent: string;
  result: string; // "W 3–1" style
  scorers: string;
}

export interface WeekAheadReflection {
  title: string;
  date: string;
  rows: Array<[string, string]>;
}

export interface WeekAheadInput {
  weekOf: string;
  opponent: string;
  author: string;
  generatedOn: string;
  review: string[];
  pointers: string[];
  lastVsOpponent: WeekAheadReflection | null;
  theirGames: WeekAheadGame[];
  ourGames: WeekAheadGame[];
}

function darkSlide(pptx: PptxGenJS, kicker: string, title: string): PptxGenJS.Slide {
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addText(kicker.toUpperCase(), {
    x: MX, y: 0.42, w: W - 2 * MX, h: 0.3,
    fontSize: 11, color: SKY, bold: true, charSpacing: 4,
  });
  s.addText(title, {
    x: MX, y: 0.68, w: W - 2 * MX, h: 0.7,
    fontSize: 30, color: PAPER, bold: true,
  });
  s.addShape("rect", { x: MX, y: 1.48, w: 1.1, h: 0.05, fill: { color: SKY_DARK } });
  return s;
}

function footer(slide: PptxGenJS.Slide, text: string) {
  slide.addText(text, {
    x: MX, y: H - 0.42, w: W - 2 * MX, h: 0.3,
    fontSize: 8.5, color: MUTED, align: "right",
  });
}

/** Stacked accent-bar cards for bullets. */
function bulletCards(s: PptxGenJS.Slide, lines: string[], opts?: { numbered?: boolean }) {
  const top = 1.85;
  const gap = 0.16;
  const n = Math.min(lines.length, 6);
  const cardH = Math.min(0.95, (H - top - 0.6 - gap * (n - 1)) / n);
  for (let i = 0; i < n; i++) {
    const y = top + i * (cardH + gap);
    s.addShape("roundRect", {
      x: MX, y, w: W - 2 * MX, h: cardH,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
    });
    s.addShape("rect", { x: MX, y: y + 0.12, w: 0.06, h: cardH - 0.24, fill: { color: SKY } });
    if (opts?.numbered) {
      s.addText(String(i + 1), {
        x: MX + 0.18, y, w: 0.65, h: cardH,
        fontSize: 26, color: SKY, bold: true, valign: "middle",
      });
    }
    s.addText(lines[i], {
      x: MX + (opts?.numbered ? 0.85 : 0.3), y,
      w: W - 2 * MX - (opts?.numbered ? 1.15 : 0.6), h: cardH,
      fontSize: 15, color: PAPER, valign: "middle",
    });
  }
}

/** One scoreboard card: result chip, big score, opponent, scorers. */
function gameCard(s: PptxGenJS.Slide, g: WeekAheadGame, x: number, y: number, w: number, h: number) {
  s.addShape("roundRect", {
    x, y, w, h,
    fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
  });
  const letter = (g.result.trim()[0] ?? "").toUpperCase();
  const chip = letter === "W" ? WIN : letter === "L" ? LOSS : DRAW;
  const score = g.result.replace(/^[WLD]\s*/i, "");
  s.addShape("roundRect", {
    x: x + 0.2, y: y + 0.2, w: 0.42, h: 0.42,
    fill: { color: chip }, rectRadius: 0.08,
  });
  s.addText(letter || "–", {
    x: x + 0.2, y: y + 0.2, w: 0.42, h: 0.42,
    fontSize: 16, color: PAPER, bold: true, align: "center", valign: "middle",
  });
  s.addText(score, {
    x: x + 0.72, y: y + 0.1, w: 1.7, h: 0.62,
    fontSize: 28, color: PAPER, bold: true, valign: "middle",
  });
  s.addText(`vs ${g.opponent}   •   ${g.date}`, {
    x: x + 2.35, y: y + 0.1, w: w - 2.55, h: 0.62,
    fontSize: 12.5, color: SKY, bold: true, valign: "middle",
  });
  s.addText(g.scorers || " ", {
    x: x + 0.24, y: y + 0.72, w: w - 0.48, h: h - 0.84,
    fontSize: 10.5, color: MUTED, valign: "top",
  });
}

/** Column of up-to-3 game cards under a heading. */
function formColumn(s: PptxGenJS.Slide, heading: string, games: WeekAheadGame[], x: number, w: number) {
  s.addText(heading.toUpperCase(), {
    x, y: 1.72, w, h: 0.32,
    fontSize: 13, color: SKY, bold: true, charSpacing: 2,
  });
  if (!games.length) {
    s.addText("No league data yet.", { x, y: 2.2, w, h: 0.4, fontSize: 12, color: MUTED });
    return;
  }
  const top = 2.12;
  const gap = 0.18;
  const cardH = Math.min(1.5, (H - top - 0.55 - gap * (games.length - 1)) / games.length);
  games.forEach((g, i) => gameCard(s, g, x, top + i * (cardH + gap), w, cardH));
}

export function buildWeekAheadPptx(input: WeekAheadInput): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = input.author;
  pptx.title = `Week Ahead — vs ${input.opponent}`;
  const foot = `${input.author} — generated ${input.generatedOn}`;

  // ── Cover ──
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: W, h: 0.12, fill: { color: SKY } });
    s.addShape("rect", { x: 0, y: H - 0.12, w: W, h: 0.12, fill: { color: SKY } });
    s.addText("THE WEEK AHEAD", {
      x: MX, y: 1.9, w: W - 2 * MX, h: 0.45,
      fontSize: 15, color: SKY, bold: true, charSpacing: 6, align: "center",
    });
    s.addText("Belconnen United", {
      x: MX, y: 2.45, w: W - 2 * MX, h: 0.95,
      fontSize: 48, color: PAPER, bold: true, align: "center",
    });
    s.addText([
      { text: "vs  ", options: { color: MUTED } },
      { text: input.opponent, options: { color: SKY, bold: true } },
    ], {
      x: MX, y: 3.4, w: W - 2 * MX, h: 0.85, fontSize: 40, align: "center",
    });
    s.addShape("rect", { x: W / 2 - 0.75, y: 4.5, w: 1.5, h: 0.045, fill: { color: SKY_DARK } });
    s.addText(`Week of ${input.weekOf}`, {
      x: MX, y: 4.7, w: W - 2 * MX, h: 0.4,
      fontSize: 15, color: MUTED, align: "center",
    });
  }

  // ── Last week in review ──
  if (input.review.length) {
    const s = darkSlide(pptx, "Last week", "The week in review");
    bulletCards(s, input.review);
    footer(s, foot);
  }

  // ── Last time vs opponent — pull-out quotes ──
  if (input.lastVsOpponent) {
    const r = input.lastVsOpponent;
    const s = darkSlide(
      pptx,
      "Know your opponent",
      `Last time vs ${input.opponent}${r.date ? ` — ${r.date}` : ""}`,
    );
    const result = r.rows.find(([label]) => /result/i.test(label))?.[1];
    if (result) {
      s.addText(result, {
        x: W - MX - 4.4, y: 0.68, w: 4.4, h: 0.7,
        fontSize: 24, color: SKY, bold: true, align: "right",
      });
    }
    const cards = r.rows.filter(([label]) => !/result/i.test(label)).slice(0, 4);
    const top = 1.85;
    const gap = 0.18;
    const cardH = Math.min(1.25, (H - top - 0.6 - gap * (cards.length - 1)) / Math.max(cards.length, 1));
    cards.forEach(([label, text], i) => {
      const y = top + i * (cardH + gap);
      s.addShape("roundRect", {
        x: MX, y, w: W - 2 * MX, h: cardH,
        fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
      });
      s.addText(label.toUpperCase(), {
        x: MX + 0.25, y: y + 0.1, w: W - 2 * MX - 0.5, h: 0.26,
        fontSize: 9.5, color: SKY, bold: true, charSpacing: 2,
      });
      s.addText(text, {
        x: MX + 0.25, y: y + 0.36, w: W - 2 * MX - 0.5, h: cardH - 0.46,
        fontSize: 12.5, color: PAPER, valign: "top",
      });
    });
    footer(s, foot);
  }

  // ── Form check — both clubs side by side ──
  {
    const s = darkSlide(pptx, "This coming week", "Form check — last 3 games");
    const colW = (W - 2 * MX - 0.5) / 2;
    formColumn(s, "Belconnen United", input.ourGames, MX, colW);
    formColumn(s, input.opponent, input.theirGames, MX + colW + 0.5, colW);
    footer(s, foot);
  }

  // ── Heads-up pointers ──
  if (input.pointers.length) {
    const s = darkSlide(pptx, "This coming week", "Heads-up for the week");
    bulletCards(s, input.pointers, { numbered: true });
    s.addText("Read before choosing this week's two sessions.", {
      x: MX, y: H - 0.42, w: 6, h: 0.3, fontSize: 9.5, color: SKY, italic: true,
    });
    footer(s, foot);
  }

  return pptx;
}
