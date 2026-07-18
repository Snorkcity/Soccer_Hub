/**
 * Reflection journal PPTX export — follows the A-diploma "Reality Based
 * Journal" template structure (weekly planner, weekly review, game preview,
 * game tactics, game analysis per week) with the club's report branding.
 */
import PptxGenJS from "pptxgenjs";
import { CYCLE_KIND_ORDER, KIND_DEFS, type JournalCycleKind } from "./journalFields";

const NAVY = "0F2C43";
const SKY = "87CEEB";
const SKY_DARK = "4FA8CF";
const GREY = "647484";
const INK = "1C2B36";
const PAPER = "FFFFFF";
const TINT = "EFF7FB";

const W = 13.33;
const H = 7.5;
const MX = 0.55; // side margin

export interface JournalExportEntry {
  weekNo: number | null;
  kind: string;
  content: Record<string, string>;
}

export interface JournalExportInput {
  title: string;
  author: string;
  weeksCount: number;
  startDate: string | null;
  generatedOn: string;
  entries: JournalExportEntry[];
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

function qaTable(
  slide: PptxGenJS.Slide,
  rows: Array<[string, string]>,
  opts?: { labelW?: number },
) {
  const labelW = opts?.labelW ?? 3.4;
  const tableRows: PptxGenJS.TableRow[] = rows.map(([q, a]) => [
    {
      text: q,
      options: {
        bold: true, color: NAVY, fontSize: 11, fill: { color: TINT },
        valign: "top" as const,
      },
    },
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

export function buildJournalPptx(input: JournalExportInput): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = input.author;
  pptx.title = input.title;

  const byWeekKind = new Map<string, Record<string, string>>();
  for (const e of input.entries) {
    if (e.weekNo != null) byWeekKind.set(`${e.weekNo}:${e.kind}`, e.content);
  }

  // ── Title slide ──
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: H - 1.1, w: W, h: 0.06, fill: { color: SKY } });
    s.addText("REALITY BASED JOURNAL", {
      x: MX, y: 2.35, w: W - 2 * MX, h: 0.4,
      fontSize: 14, color: SKY, bold: true, charSpacing: 4, align: "center",
    });
    s.addText(input.title, {
      x: MX, y: 2.8, w: W - 2 * MX, h: 1.1,
      fontSize: 40, color: PAPER, bold: true, align: "center",
    });
    s.addText(
      [
        { text: input.author, options: { bold: true, color: PAPER } },
        { text: input.startDate ? `   •   Starting ${input.startDate}` : "", options: { color: SKY } },
        { text: `   •   ${input.weeksCount} week cycle`, options: { color: SKY } },
      ],
      { x: MX, y: 4.0, w: W - 2 * MX, h: 0.4, fontSize: 15, align: "center" },
    );
  }

  // ── Overview slide ──
  {
    const s = pptx.addSlide();
    header(s, "Journal contents", "Overview");
    const lines = [
      `Weekly Planner (x${input.weeksCount})`,
      `Weekly Review & Reflection (x${input.weeksCount})`,
      `Game Preview — oppositional analysis (x${input.weeksCount})`,
      "Game Tactics including set plays",
      `Game Analysis & Reflections (x${input.weeksCount})`,
    ];
    s.addText(
      lines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true } })),
      { x: MX + 0.2, y: 1.7, w: W - 2 * MX - 0.4, h: 3.4, fontSize: 17, color: INK, lineSpacing: 34 },
    );
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  // ── Weekly slides ──
  for (let week = 1; week <= input.weeksCount; week++) {
    for (const kind of CYCLE_KIND_ORDER) {
      const def = KIND_DEFS[kind as JournalCycleKind];
      const content = byWeekKind.get(`${week}:${kind}`) ?? {};
      const s = pptx.addSlide();
      header(s, `Week ${week} of ${input.weeksCount}`, def.title);
      qaTable(
        s,
        def.fields.map((f) => [f.label, (content[f.id] ?? "").trim()]),
      );
      footer(s, `${input.author} — Week ${week} — ${def.title}`);
    }
  }

  // ── Video evidence slide ──
  {
    const s = pptx.addSlide();
    header(s, "Supporting material", "Video Evidence");
    s.addText(
      "Video evidence links (cloud storage — Dropbox, Google Drive, SharePoint etc.):",
      { x: MX, y: 1.5, w: W - 2 * MX, h: 0.4, fontSize: 14, color: INK, bold: true },
    );
    s.addShape("rect", {
      x: MX, y: 2.05, w: W - 2 * MX, h: 3.4,
      fill: { color: TINT }, line: { color: SKY_DARK, width: 1 },
    });
    footer(s, `${input.author} — generated ${input.generatedOn}`);
  }

  return pptx;
}
