/**
 * Feasibility spike: match diagram images from old session-plan .docx files
 * back to library practices.
 *
 * Approach: render every practice diagram (DB JSON -> SVG -> PNG via resvg),
 * normalise by cropping to the content bounding box, downscale to 32x32 grey,
 * compute aHash+dHash fingerprints. Do the same for docx images (wrapped in an
 * SVG <image>), then rank by Hamming distance.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import pg from "pg";
import { Resvg } from "@resvg/resvg-js";
import { PracticeDiagram, type DiagramData } from "../../artifacts/bufc-hub/src/components/PracticeDiagram";

const OUT = "/tmp/matchcheck";
mkdirSync(OUT, { recursive: true });

// ── raster helpers ───────────────────────────────────────────────────────────
interface Raster { pixels: Buffer; width: number; height: number }

function renderSvg(svg: string, width: number): Raster {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  const img = r.render();
  return { pixels: img.pixels, width: img.width, height: img.height };
}

function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function rasterizePng(buf: Buffer, width: number): Raster {
  const { w, h } = pngSize(buf);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><image width="${w}" height="${h}" xlink:href="data:image/png;base64,${buf.toString("base64")}"/></svg>`;
  return renderSvg(svg, width);
}

function gray(r: Raster, x: number, y: number): number {
  const i = (y * r.width + x) * 4;
  const a = r.pixels[i + 3] / 255;
  // composite on white
  const rr = r.pixels[i] * a + 255 * (1 - a);
  const gg = r.pixels[i + 1] * a + 255 * (1 - a);
  const bb = r.pixels[i + 2] * a + 255 * (1 - a);
  return 0.299 * rr + 0.587 * gg + 0.114 * bb;
}

/** Crop to content bounding box (pixels differing from the corner background). */
function contentBBox(r: Raster): { x0: number; y0: number; x1: number; y1: number } {
  const bg = gray(r, 0, 0);
  const tol = 26;
  let x0 = r.width, y0 = r.height, x1 = 0, y1 = 0;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (Math.abs(gray(r, x, y) - bg) > tol) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return { x0: 0, y0: 0, x1: r.width - 1, y1: r.height - 1 };
  return { x0, y0, x1, y1 };
}

const N = 32;

/** Box-sample the bbox region down to NxN grey values. */
function thumb(r: Raster): Float64Array {
  const { x0, y0, x1, y1 } = contentBBox(r);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const out = new Float64Array(N * N);
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      const sx0 = x0 + Math.floor((tx * bw) / N);
      const sx1 = x0 + Math.max(Math.floor(((tx + 1) * bw) / N), Math.floor((tx * bw) / N) + 1);
      const sy0 = y0 + Math.floor((ty * bh) / N);
      const sy1 = y0 + Math.max(Math.floor(((ty + 1) * bh) / N), Math.floor((ty * bh) / N) + 1);
      let sum = 0, n = 0;
      for (let y = sy0; y < sy1 && y <= y1; y++)
        for (let x = sx0; x < sx1 && x <= x1; x++) { sum += gray(r, x, y); n++; }
      out[ty * N + tx] = n ? sum / n : 255;
    }
  }
  return out;
}

interface Hashes { a: bigint; d: bigint }

function hashes(t: Float64Array): Hashes {
  let mean = 0;
  for (const v of t) mean += v;
  mean /= t.length;
  let a = 0n, d = 0n;
  let bit = 0n;
  for (let i = 0; i < t.length; i++) {
    if (t[i] > mean) a |= 1n << bit;
    bit++;
  }
  bit = 0n;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N - 1; x++) {
      if (t[y * N + x] > t[y * N + x + 1]) d |= 1n << bit;
      bit++;
    }
  return { a, d };
}

function hamming(x: bigint, y: bigint): number {
  let v = x ^ y;
  let c = 0;
  while (v) { c += Number(v & 1n); v >>= 1n; }
  return c;
}

function dist(h1: Hashes, h2: Hashes): number {
  return hamming(h1.a, h2.a) + hamming(h1.d, h2.d);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new pg.Client({ connectionString: process.env.DEV_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    "SELECT id, ordinal, kind, title, diagram FROM practices",
  );
  await client.end();
  console.log(`practices: ${rows.length}`);

  const lib: Array<{ id: number; ordinal: number; kind: string; title: string | null; h: Hashes; png: Buffer }> = [];
  for (const row of rows) {
    try {
      const svg = renderToStaticMarkup(
        React.createElement(PracticeDiagram, { diagram: row.diagram as DiagramData }),
      ).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      const raster = renderSvg(svg, 300);
      const h = hashes(thumb(raster));
      const png = new Resvg(svg, { fitTo: { mode: "width", value: 480 } }).render().asPng();
      mkdirSync("/tmp/librender", { recursive: true });
      writeFileSync(`/tmp/librender/p${row.id}.png`, Buffer.from(png));
      lib.push({ id: row.id, ordinal: row.ordinal, kind: row.kind, title: row.title, h, png: Buffer.from(png) });
    } catch (e) {
      console.log(`render failed for practice ${row.id}: ${(e as Error).message}`);
    }
  }
  console.log(`library rendered: ${lib.length}`);

  // sample docx files (extracted images live in /tmp/docximg/<file>/)
  const sampleDir = "/tmp/docximg";
  const results: string[] = [];
  for (const dir of readdirSync(sampleDir)) {
    for (const img of readdirSync(join(sampleDir, dir))) {
      const buf = readFileSync(join(sampleDir, dir, img));
      const { w, h: ph } = pngSize(buf);
      if (w < 250 || ph < 150) continue; // skip tiny decorations
      const ar = w / ph;
      if (ar > 0.85 && ar < 1.15 && w > 700) continue; // club badge (square-ish, big)
      let raster: Raster;
      try {
        raster = rasterizePng(buf, 300);
      } catch { continue; }
      const hh = hashes(thumb(raster));
      const ranked = lib
        .map((p) => ({ p, d: dist(hh, p.h) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      const tag = `${dir}__${img}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      writeFileSync(join(OUT, `${tag}`), buf);
      ranked.forEach((r, i) => {
        writeFileSync(join(OUT, `${tag}.match${i + 1}_p${r.p.id}_d${r.d}.png`), r.p.png);
      });
      const line = `${dir}/${img} (${w}x${ph}) -> ` + ranked
        .map((r) => `#${r.p.id}[${r.p.kind}] "${r.p.title ?? "untitled slide " + r.p.ordinal}" d=${r.d}`)
        .join(" | ");
      results.push(line);
      console.log(line);
    }
  }
  writeFileSync(join(OUT, "results.txt"), results.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
