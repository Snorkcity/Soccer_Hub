/**
 * Load the extracted practice library (src/data/practices.json, produced by
 * tools/extract-practices/extract.py) into the practices table.
 *
 * Upserts by ordinal so re-running after a fresh extraction updates content
 * while PRESERVING coach-set flags (needs_review).
 *
 * Run:  pnpm --filter @workspace/db exec tsx src/seedPractices.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, pool } from "./index";
import { practicesTable } from "./schema";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Works both when run from src/ directly and when bundled elsewhere. */
function dataFile(): string {
  const candidates = [
    path.join(here, "data", "practices.json"),
    path.join(here, "src", "data", "practices.json"),
    path.resolve(process.cwd(), "lib/db/src/data/practices.json"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`practices.json not found; looked in:\n${candidates.join("\n")}`);
}

interface ExtractedSlide {
  ordinal: number;
  file: string;
  bg: string;
  kind: string;
  chapter: string | null;
  sectionCode: string | null;
  sectionName: string | null;
  title: string | null;
  paras: unknown[];
  shapes: unknown[];
}

async function main(): Promise<void> {
  const raw = JSON.parse(fs.readFileSync(dataFile(), "utf8")) as {
    source: string;
    canvas: { w: number; h: number };
    slides: ExtractedSlide[];
  };

  console.log(`Seeding ${raw.slides.length} slides from ${raw.source}...`);
  const BATCH = 20;
  for (let i = 0; i < raw.slides.length; i += BATCH) {
    const chunk = raw.slides.slice(i, i + BATCH);
    await db
      .insert(practicesTable)
      .values(chunk.map((s) => ({
        ordinal: s.ordinal,
        kind: s.kind,
        chapter: s.chapter,
        sectionCode: s.sectionCode,
        sectionName: s.sectionName,
        title: s.title,
        paras: s.paras,
        diagram: { bg: s.bg, canvas: raw.canvas, shapes: s.shapes },
        sourceFile: raw.source,
      })))
      .onConflictDoUpdate({
        target: practicesTable.ordinal,
        set: {
          kind: sql`excluded.kind`,
          chapter: sql`excluded.chapter`,
          sectionCode: sql`excluded.section_code`,
          sectionName: sql`excluded.section_name`,
          title: sql`excluded.title`,
          paras: sql`excluded.paras`,
          diagram: sql`excluded.diagram`,
          sourceFile: sql`excluded.source_file`,
          updatedAt: sql`now()`,
          // needs_review deliberately NOT overwritten — coach flags survive re-imports
        },
      });
  }
  const [{ count }] = (await db.execute(sql`SELECT count(*)::int AS count FROM practices`)).rows as Array<{ count: number }>;
  console.log(`Done — practices table now holds ${count} rows.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
