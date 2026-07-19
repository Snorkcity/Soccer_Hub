/**
 * Friday pre-match deck — player-facing briefing for the night before a game.
 * Same navy exec style as the Monday report, plus green striped pitch
 * diagrams (lineup, shapes, set pieces). Punchy dot points, never overload.
 */
import PptxGenJS from "pptxgenjs";

const NAVY = "0F2C43";
const CARD = "17395A";
const CARD_LINE = "23496E";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const PAPER = "FFFFFF";
const MUTED = "9FB3C4";
const RED = "E85C5C";

// Pitch greens — alternating mowing stripes.
const GRASS_A = "2E7D46";
const GRASS_B = "35914F";
const LINE_W = 1.25;

const W = 13.33;
const H = 7.5;
const MX = 0.6;

export interface PitchPlayer {
  /** 0–1 across the pitch (0 = left touchline). */
  px: number;
  /** 0–1 down the pitch (0 = attacking goal at top, 1 = our goal line). */
  py: number;
  label: string; // short label on the dot (e.g. initials or shirt role)
  name?: string; // full name under the dot
  color?: string; // dot fill override (e.g. GK)
}

export interface SetPieceGroup {
  role: string;
  players: string[];
}

export interface PrematchInput {
  round: string;
  opponent: string;
  matchDate: string;
  generatedOn: string;
  formationName: string;
  lineup: PitchPlayer[]; // XI, positioned
  subs: string[];
  ourBp: { players: PitchPlayer[]; notes: string[] };
  ourBpo: { players: PitchPlayer[]; notes: string[] };
  theirBp: { players: PitchPlayer[]; notes: string[] };
  theirBpo: { players: PitchPlayer[]; notes: string[] };
  theirFormationName: string;
  theirFormationBpoName?: string;
  objectivesBp: UnitObjectives;
  objectivesBpo: UnitObjectives;
  cornersFor: { groups: SetPieceGroup[]; players: PitchPlayer[] };
  cornersFor2?: { groups: SetPieceGroup[]; players: PitchPlayer[] };
  cornersAgainst: { groups: SetPieceGroup[]; players: PitchPlayer[] };
  cornersAgainstLabel?: string;
  freeKicks: SetPieceGroup[];
}

export interface UnitObjectives {
  theme: string;
  gk: string[];
  defenders: string[];
  midfielders: string[];
  attackers: string[];
}

function darkSlide(pptx: PptxGenJS, kicker: string, title: string, textX = MX): PptxGenJS.Slide {
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addText(kicker.toUpperCase(), {
    x: textX, y: 0.42, w: W - MX - textX, h: 0.3,
    fontSize: 11, color: SKY, bold: true, charSpacing: 4,
  });
  s.addText(title, {
    x: textX, y: 0.68, w: W - MX - textX, h: 0.7,
    fontSize: 30, color: PAPER, bold: true,
  });
  s.addShape("rect", { x: textX, y: 1.48, w: 1.1, h: 0.05, fill: { color: SKY_DARK } });
  return s;
}

function footer(slide: PptxGenJS.Slide, text: string) {
  slide.addText(text, {
    x: MX, y: H - 0.42, w: W - 2 * MX, h: 0.3,
    fontSize: 8.5, color: MUTED, align: "right",
  });
}

/**
 * Full vertical pitch (attacking goal at top) with mowing stripes.
 * Returns a plotter that converts 0–1 pitch coords to slide inches.
 */
function drawPitch(
  s: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
): (px: number, py: number) => { x: number; y: number } {
  // Striped turf — 7 vertical mowing bands running down the pitch.
  const bands = 7;
  const bw = w / bands;
  for (let i = 0; i < bands; i++) {
    s.addShape("rect", {
      x: x + i * bw, y, w: bw, h,
      fill: { color: i % 2 === 0 ? GRASS_A : GRASS_B },
    });
  }
  const line = { color: PAPER, width: LINE_W };
  // Outline + halfway.
  s.addShape("rect", { x, y, w, h, fill: { type: "none" }, line });
  s.addShape("line", { x, y: y + h / 2, w, h: 0, line });
  // Centre circle.
  const cr = w * 0.13;
  s.addShape("ellipse", {
    x: x + w / 2 - cr, y: y + h / 2 - cr, w: cr * 2, h: cr * 2,
    fill: { type: "none" }, line,
  });
  // Penalty + goal areas, both ends.
  const paW = w * 0.58;
  const paH = h * 0.14;
  const gaW = w * 0.28;
  const gaH = h * 0.055;
  for (const top of [true, false]) {
    const paY = top ? y : y + h - paH;
    const gaY = top ? y : y + h - gaH;
    s.addShape("rect", {
      x: x + (w - paW) / 2, y: paY, w: paW, h: paH, fill: { type: "none" }, line,
    });
    s.addShape("rect", {
      x: x + (w - gaW) / 2, y: gaY, w: gaW, h: gaH, fill: { type: "none" }, line,
    });
  }
  return (px, py) => ({ x: x + px * w, y: y + py * h });
}

/** Player dot + optional name plate under it. */
function drawPlayers(
  s: PptxGenJS.Slide,
  plot: (px: number, py: number) => { x: number; y: number },
  players: PitchPlayer[],
  opts?: { r?: number; nameSize?: number },
) {
  const r = opts?.r ?? 0.21;
  for (const p of players) {
    const { x, y } = plot(p.px, p.py);
    s.addShape("ellipse", {
      x: x - r, y: y - r, w: r * 2, h: r * 2,
      fill: { color: p.color ?? SKY_DARK }, line: { color: PAPER, width: 1.25 },
    });
    s.addText(p.label, {
      x: x - r, y: y - r, w: r * 2, h: r * 2,
      fontSize: r > 0.18 ? 10 : 8.5, color: PAPER, bold: true,
      align: "center", valign: "middle",
    });
    if (p.name) {
      s.addText(p.name, {
        x: x - 0.75, y: y + r - 0.02, w: 1.5, h: 0.24,
        fontSize: opts?.nameSize ?? 9, color: PAPER, bold: true,
        align: "center", valign: "top",
        outline: { size: 0.7, color: "1F2937" },
      });
    }
  }
}

/** Right-hand notes column of accent-bar cards. */
function noteCards(s: PptxGenJS.Slide, x: number, w: number, notes: string[], top = 1.85) {
  const gap = 0.16;
  const n = Math.min(notes.length, 6);
  if (!n) return;
  const cardH = Math.min(1.0, (H - top - 0.6 - gap * (n - 1)) / n);
  for (let i = 0; i < n; i++) {
    const y = top + i * (cardH + gap);
    s.addShape("roundRect", {
      x, y, w, h: cardH,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
    });
    s.addShape("rect", { x, y: y + 0.12, w: 0.06, h: cardH - 0.24, fill: { color: SKY } });
    s.addText(notes[i], {
      x: x + 0.25, y, w: w - 0.5, h: cardH,
      fontSize: 14, color: PAPER, valign: "middle",
    });
  }
}

/** Penalty-box view for corner/free-kick slides (goal at top). */
function drawBoxView(
  s: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
): (px: number, py: number) => { x: number; y: number } {
  const bands = 5;
  const bh = h / bands;
  for (let i = 0; i < bands; i++) {
    s.addShape("rect", {
      x, y: y + i * bh, w, h: bh,
      fill: { color: i % 2 === 0 ? GRASS_A : GRASS_B },
    });
  }
  const line = { color: PAPER, width: LINE_W };
  s.addShape("rect", { x, y, w, h, fill: { type: "none" }, line });
  // Goal mouth.
  const goalW = w * 0.16;
  s.addShape("rect", {
    x: x + (w - goalW) / 2, y: y - 0.12, w: goalW, h: 0.12,
    fill: { color: PAPER },
  });
  // Six-yard + penalty box (view is roughly the final quarter of the pitch).
  const paW = w * 0.62;
  const paH = h * 0.52;
  const gaW = w * 0.3;
  const gaH = h * 0.2;
  s.addShape("rect", { x: x + (w - paW) / 2, y, w: paW, h: paH, fill: { type: "none" }, line });
  s.addShape("rect", { x: x + (w - gaW) / 2, y, w: gaW, h: gaH, fill: { type: "none" }, line });
  // Penalty spot.
  s.addShape("ellipse", {
    x: x + w / 2 - 0.03, y: y + paH * 0.72 - 0.03, w: 0.06, h: 0.06, fill: { color: PAPER },
  });
  return (px, py) => ({ x: x + px * w, y: y + py * h });
}

function roleColumn(s: PptxGenJS.Slide, x: number, w: number, groups: SetPieceGroup[]) {
  // Normal layout: one player per line. If the cards won't fit (e.g. zonal corners
  // has 7 roles), switch to a compact layout: names joined on one line, tighter cards.
  const avail = H - 0.5 - 1.85;
  const normalTotal = groups.reduce((t, g) => t + 0.42 + Math.max(g.players.length, 1) * 0.28 + 0.16, 0);
  const compact = normalTotal > avail;
  let y = 1.85;
  for (const g of groups) {
    const rows = compact ? 1 : Math.max(g.players.length, 1);
    const cardH = compact ? 0.62 : 0.42 + rows * 0.28;
    if (y + cardH > H - 0.5) break;
    s.addShape("roundRect", {
      x, y, w, h: cardH,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
    });
    s.addText(g.role.toUpperCase(), {
      x: x + 0.2, y: y + (compact ? 0.05 : 0.08), w: w - 0.4, h: compact ? 0.24 : 0.28,
      fontSize: compact ? 9.5 : 10.5, color: SKY, bold: true, charSpacing: 2,
    });
    s.addText(g.players.length ? (compact ? g.players.join(" · ") : g.players.join("\n")) : "—", {
      x: x + 0.2, y: y + (compact ? 0.28 : 0.36), w: w - 0.4, h: compact ? 0.28 : rows * 0.28,
      fontSize: compact ? 11 : 12.5, color: PAPER, lineSpacing: compact ? 13 : 16,
    });
    y += cardH + (compact ? 0.12 : 0.16);
  }
}

function objectivesSlide(
  pptx: PptxGenJS,
  kicker: string,
  title: string,
  obj: UnitObjectives,
  foot: string,
) {
  const s = darkSlide(pptx, kicker, title);
  if (obj.theme) {
    s.addShape("roundRect", {
      x: MX, y: 1.75, w: W - 2 * MX, h: 0.62,
      fill: { color: SKY_DARK }, rectRadius: 0.08,
    });
    s.addText(obj.theme, {
      x: MX + 0.25, y: 1.75, w: W - 2 * MX - 0.5, h: 0.62,
      fontSize: 17, color: NAVY, bold: true, valign: "middle",
    });
  }
  const units: Array<[string, string[]]> = [
    ["GK", obj.gk],
    ["Defenders", obj.defenders],
    ["Midfielders", obj.midfielders],
    ["Attackers", obj.attackers],
  ];
  const top = 2.6;
  const gap = 0.22;
  const cw = (W - 2 * MX - gap) / 2;
  const ch = (H - top - 0.55 - gap) / 2;
  units.forEach(([label, lines], i) => {
    const x = MX + (i % 2) * (cw + gap);
    const y = top + Math.floor(i / 2) * (ch + gap);
    s.addShape("roundRect", {
      x, y, w: cw, h: ch,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
    });
    s.addText(label.toUpperCase(), {
      x: x + 0.25, y: y + 0.12, w: cw - 0.5, h: 0.3,
      fontSize: 11, color: SKY, bold: true, charSpacing: 3,
    });
    s.addText(
      lines.map((t) => ({ text: t, options: { bullet: { characterCode: "2022", indent: 12 } } })),
      {
        x: x + 0.25, y: y + 0.45, w: cw - 0.5, h: ch - 0.6,
        fontSize: 13.5, color: PAPER, lineSpacing: 20, valign: "top",
      },
    );
  });
  footer(s, foot);
}

function shapeSlide(
  pptx: PptxGenJS,
  kicker: string,
  title: string,
  players: PitchPlayer[],
  notes: string[],
  foot: string,
) {
  // Big pitch down the left, title + notes in the right column.
  const ph = H - 0.9;
  const pw = ph * 0.72;
  const tx = MX + pw + 0.7;
  const s = darkSlide(pptx, kicker, title, tx);
  const plot = drawPitch(s, MX, 0.45, pw, ph);
  drawPlayers(s, plot, players);
  noteCards(s, tx, W - MX - tx, notes);
  footer(s, foot);
}

export async function buildPrematchDeck(input: PrematchInput): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  const foot = `Belconnen United FC — Match prep · ${input.round} v ${input.opponent} · ${input.matchDate}`;

  // ── Cover ──
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.25, h: H, fill: { color: SKY_DARK } });
    s.addText("MATCH PREP — READ THE NIGHT BEFORE", {
      x: 1.0, y: 2.0, w: W - 2, h: 0.4,
      fontSize: 14, color: SKY, bold: true, charSpacing: 5,
    });
    s.addText(`${input.round} — ${input.opponent}`, {
      x: 1.0, y: 2.45, w: W - 2, h: 1.5,
      fontSize: 48, color: PAPER, bold: true,
    });
    s.addText(`Belconnen United FC · ${input.matchDate}`, {
      x: 1.0, y: 4.05, w: W - 2, h: 0.45,
      fontSize: 18, color: MUTED,
    });
    s.addShape("roundRect", {
      x: 1.0, y: 4.85, w: 4.4, h: 0.55,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.1,
    });
    s.addText(`Our shape: ${input.formationName}`, {
      x: 1.25, y: 4.85, w: 4.0, h: 0.55,
      fontSize: 15, color: PAPER, bold: true, valign: "middle",
    });
    s.addText(`Prepared ${input.generatedOn}`, {
      x: 1.0, y: H - 0.75, w: W - 2, h: 0.35, fontSize: 10, color: MUTED,
    });
  }

  // ── Lineup ──
  {
    const ph = H - 0.9;
    const pw = ph * 0.74;
    const lx = MX + pw + 0.7;
    const s = darkSlide(pptx, "Starting lineup", `Our XI — ${input.formationName}`, lx);
    const plot = drawPitch(s, MX, 0.45, pw, ph);
    drawPlayers(s, plot, input.lineup, { r: 0.24, nameSize: 10 });
    const lw = W - MX - lx;
    const half = Math.ceil(input.lineup.length / 2);
    const listCol = (names: string[], x: number, w: number) =>
      s.addText(
        names.map((t) => ({ text: t, options: { bullet: { characterCode: "2022", indent: 10 } } })),
        { x, y: 2.55, w, h: 3.0, fontSize: 14, color: PAPER, lineSpacing: 24, valign: "top" },
      );
    s.addShape("roundRect", {
      x: lx, y: 2.1, w: lw, h: 3.55,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
    });
    s.addText("STARTING XI", {
      x: lx + 0.25, y: 2.22, w: lw - 0.5, h: 0.3,
      fontSize: 11, color: SKY, bold: true, charSpacing: 3,
    });
    const names = input.lineup.map((p) => p.name || p.label);
    listCol(names.slice(0, half), lx + 0.25, lw / 2 - 0.35);
    listCol(names.slice(half), lx + lw / 2, lw / 2 - 0.35);
    s.addShape("roundRect", {
      x: lx, y: 5.85, w: lw, h: 1.05,
      fill: { color: CARD }, line: { color: CARD_LINE, width: 1 }, rectRadius: 0.06,
    });
    s.addText("SUBS", {
      x: lx + 0.25, y: 5.95, w: lw - 0.5, h: 0.3,
      fontSize: 11, color: SKY, bold: true, charSpacing: 3,
    });
    s.addText(input.subs.length ? input.subs.join("  ·  ") : "—", {
      x: lx + 0.25, y: 6.25, w: lw - 0.5, h: 0.55,
      fontSize: 13.5, color: PAPER, valign: "top",
    });
    footer(s, foot);
  }

  // ── Our shape (BP, BPO) ──
  shapeSlide(pptx, "Our shape — BP", `In possession — ${input.formationName}`,
    input.ourBp.players, input.ourBp.notes, foot);
  shapeSlide(pptx, "Our shape — BPO", "Out of possession",
    input.ourBpo.players, input.ourBpo.notes, foot);

  // ── Their shape — both pitches on one slide ──
  {
    const s = darkSlide(pptx, "Know the opponent", `${input.opponent} — likely shape`);
    const ph = H - 2.5;
    const pw = ph * 0.7;
    const colW = (W - 2 * MX) / 2;
    for (const [i, side] of ([[0, input.theirBp], [1, input.theirBpo]] as const)) {
      const cx = MX + i * colW;
      const colFormation = i === 0 ? input.theirFormationName : (input.theirFormationBpoName || input.theirFormationName);
      s.addText(`${i === 0 ? "BP" : "BPO"}${colFormation ? ` — ${colFormation}` : ""}`, {
        x: cx, y: 1.7, w: colW, h: 0.3,
        fontSize: 11, color: SKY, bold: true, charSpacing: 3,
      });
      const plot = drawPitch(s, cx + 0.15, 2.02, pw, ph);
      drawPlayers(s, plot, side.players, { r: 0.18, nameSize: 8 });
      // Notes to the right of each pitch.
      const nx = cx + pw + 0.45;
      const nw = colW - pw - 0.6;
      if (side.notes.length && nw > 1.2) {
        s.addText(
          side.notes.map((t) => ({ text: t, options: { bullet: { characterCode: "2022", indent: 10 } } })),
          { x: nx, y: 2.2, w: nw, h: ph - 0.2, fontSize: 12.5, color: PAPER, lineSpacing: 19, valign: "top" },
        );
      }
    }
    footer(s, foot);
  }

  // ── Key objectives ──
  objectivesSlide(pptx, "Key objectives — BP", "In possession", input.objectivesBp, foot);
  objectivesSlide(pptx, "Key objectives — BPO", "Out of possession", input.objectivesBpo, foot);

  // ── Set pieces ──
  const setPieceSlide = (
    kicker: string,
    title: string,
    groups: SetPieceGroup[],
    players: PitchPlayer[],
    attacking: boolean,
  ) => {
    const s = darkSlide(pptx, kicker, title);
    const bw = 6.4;
    const bh = H - 2.55;
    const plot = drawBoxView(s, MX + 0.2, 2.05, bw, bh);
    // Our players are always blue; explicit colours (e.g. the red opposition taker) win.
    void attacking;
    drawPlayers(s, plot, players.map((p) => ({ ...p, color: p.color ?? SKY_DARK })), { r: 0.19, nameSize: 8.5 });
    roleColumn(s, MX + bw + 0.75, W - MX - (MX + bw + 0.75), groups);
    footer(s, foot);
  };
  const hasVar2 = !!input.cornersFor2 && (input.cornersFor2.groups.length > 0 || input.cornersFor2.players.length > 0);
  setPieceSlide("Set pieces", "Corners — for · standard", input.cornersFor.groups, input.cornersFor.players, true);
  if (hasVar2 && input.cornersFor2) {
    setPieceSlide("Set pieces", "Corners — for · crowd the keeper", input.cornersFor2.groups, input.cornersFor2.players, true);
  }
  setPieceSlide("Set pieces", input.cornersAgainstLabel ?? "Corners — against", input.cornersAgainst.groups, input.cornersAgainst.players, false);
  {
    const s = darkSlide(pptx, "Set pieces", "Free kicks");
    roleColumn(s, MX, (W - 2 * MX - 0.3) / 2, input.freeKicks.slice(0, Math.ceil(input.freeKicks.length / 2)));
    roleColumn(s, MX + (W - 2 * MX + 0.3) / 2, (W - 2 * MX - 0.3) / 2, input.freeKicks.slice(Math.ceil(input.freeKicks.length / 2)));
    footer(s, foot);
  }

  const out = (await pptx.write({ outputType: "blob" })) as Blob;
  return out;
}
