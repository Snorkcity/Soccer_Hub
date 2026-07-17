"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// spike-match.tsx
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_server = require("react-dom/server");
var import_react2 = __toESM(require("react"), 1);
var import_pg = __toESM(require("pg"), 1);
var import_resvg_js = require("@resvg/resvg-js");

// ../../artifacts/bufc-hub/src/components/PracticeDiagram.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function transformAttr(sh) {
  const cx = sh.x + sh.w / 2;
  const cy = sh.y + sh.h / 2;
  const parts = [];
  if (sh.rot) parts.push(`rotate(${sh.rot} ${cx} ${cy})`);
  if (sh.fh || sh.fv) {
    parts.push(`translate(${cx} ${cy}) scale(${sh.fh ? -1 : 1} ${sh.fv ? -1 : 1}) translate(${-cx} ${-cy})`);
  }
  return parts.length ? parts.join(" ") : void 0;
}
function markerId(color) {
  return `arw-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
}
var DASH = { dash: "7 5", dot: "2 4" };
function ShapeEl({ sh, i }) {
  const { x, y, w, h } = sh;
  const fill = sh.fill ?? "none";
  const fa = sh.fillAlpha ?? 1;
  const sw = sh.strokeW ?? 0.75;
  const dash = sh.dash ? DASH[sh.dash] : void 0;
  const tr = transformAttr(sh);
  if (sh.kind === "pic") {
    if (sh.icon === "person") {
      const tint = sh.tint ?? "#888888";
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { transform: tr, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { cx: x + w / 2, cy: y + h * 0.14, rx: w * 0.32, ry: h * 0.14, fill: tint }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: `M ${x + w * 0.1} ${y + h * 0.3} h ${w * 0.8} v ${h * 0.28} h ${-w * 0.16} v ${h * 0.42} h ${-w * 0.18} v ${-h * 0.3} h ${-w * 0.12} v ${h * 0.3} h ${-w * 0.18} v ${-h * 0.42} h ${-w * 0.16} Z`,
            fill: tint
          }
        )
      ] });
    }
    if (sh.icon === "ball") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) / 2;
      const vertex = (k, rad) => {
        const a = (-90 + k * 72) * Math.PI / 180;
        return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      };
      const pentagon = [0, 1, 2, 3, 4].map((k) => vertex(k, r * 0.38).join(",")).join(" ");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx, cy, r, fill: "#FFFFFF", stroke: "#111", strokeWidth: Math.max(r * 0.09, 0.8) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", { points: pentagon, fill: "#111" }),
        [0, 1, 2, 3, 4].map((k) => {
          const [ix, iy] = vertex(k, r * 0.38);
          const [ox, oy] = vertex(k, r * 0.92);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: ix, y1: iy, x2: ox, y2: oy, stroke: "#111", strokeWidth: Math.max(r * 0.08, 0.7) }, k);
        })
      ] });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x, y, width: w, height: h, fill: "#DDDDDD", stroke: "#999999", strokeWidth: 0.5 });
  }
  const markerEnd = sh.arrowTail && sh.stroke ? `url(#${markerId(sh.stroke)})` : void 0;
  const markerStart = sh.arrowHead && sh.stroke ? `url(#${markerId(sh.stroke)})` : void 0;
  const lines = [];
  for (const p of sh.paras ?? []) {
    const fs = Math.min(p.size ?? 12, 16);
    const maxChars = Math.max(8, Math.floor((w - 8) / (fs * 0.52)));
    const words = p.text.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > maxChars) {
        lines.push({ text: line, fs, bold: p.bold, color: p.color });
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push({ text: line, fs, bold: p.bold, color: p.color });
    if (lines.length > 40) break;
  }
  let cursorY = y;
  const centered = w < 120;
  const texts = lines.map((ln, j) => {
    cursorY += ln.fs * 1.25;
    if (cursorY > y + h + 6) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "text",
      {
        x: centered ? x + w / 2 : x + 4,
        y: cursorY,
        fontSize: ln.fs,
        textAnchor: centered ? "middle" : "start",
        fill: ln.color ?? "#111111",
        fontWeight: ln.bold ? 700 : 400,
        children: ln.text
      },
      j
    );
  });
  let el;
  const common = {
    fill,
    fillOpacity: fa,
    stroke: sh.stroke ?? "none",
    strokeWidth: sh.stroke ? sw : 0,
    strokeDasharray: dash,
    transform: tr
  };
  if (sh.kind === "conn" || sh.geom === "line" || sh.geom === "straightConnector1") {
    let [x1, y1, x2, y2] = [x, y, x + w, y + h];
    if (sh.fh) [x1, x2] = [x2, x1];
    if (sh.fv) [y1, y2] = [y2, y1];
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("g", { transform: sh.rot ? `rotate(${sh.rot} ${x + w / 2} ${y + h / 2})` : void 0, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "line",
      {
        x1,
        y1,
        x2,
        y2,
        stroke: sh.stroke ?? "#333333",
        strokeWidth: Math.max(sw, 1),
        strokeDasharray: dash,
        markerEnd,
        markerStart
      }
    ) });
  } else if (sh.geom === "custom" && sh.path) {
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: sh.path, ...common, markerEnd, markerStart, strokeLinejoin: "round" });
  } else if (sh.geom === "ellipse") {
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...common });
  } else if (sh.geom === "triangle") {
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", { points: `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`, ...common });
  } else if (sh.geom === "trapezoid") {
    const inset = (sh.adj ?? 0.25) * Math.min(w, h);
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", { points: `${x + inset},${y} ${x + w - inset},${y} ${x + w},${y + h} ${x},${y + h}`, ...common });
  } else if (sh.geom === "diamond") {
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", { points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`, ...common });
  } else if (sh.geom === "pie" || sh.geom === "chord" || sh.geom === "arc") {
    const start = sh.startDeg ?? (sh.geom === "arc" ? 270 : 0);
    const end = sh.endDeg ?? (sh.geom === "arc" ? 0 : 270);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    const pt = (deg) => {
      const rad = deg * Math.PI / 180;
      return `${cx + rx * Math.cos(rad)} ${cy + ry * Math.sin(rad)}`;
    };
    const delta = ((end - start) % 360 + 360) % 360;
    if (delta === 0) {
      el = sh.geom === "arc" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "ellipse",
        {
          cx,
          cy,
          rx,
          ry,
          fill: "none",
          stroke: sh.stroke ?? "#333333",
          strokeWidth: sw,
          strokeDasharray: dash,
          transform: tr
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { cx, cy, rx, ry, ...common });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
        el,
        texts
      ] }, i);
    }
    const largeArc = delta > 180 ? 1 : 0;
    const arcPart = `M ${pt(start)} A ${rx} ${ry} 0 ${largeArc} 1 ${pt(end)}`;
    if (sh.geom === "arc") {
      el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "path",
        {
          d: arcPart,
          fill: "none",
          stroke: sh.stroke ?? "#333333",
          strokeWidth: sw,
          strokeDasharray: dash,
          transform: tr
        }
      );
    } else if (sh.geom === "chord") {
      el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: `${arcPart} Z`, ...common });
    } else {
      el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: `M ${cx} ${cy} L ${pt(start)} A ${rx} ${ry} 0 ${largeArc} 1 ${pt(end)} Z`, ...common });
    }
  } else {
    const rounded = sh.geom === "roundRect" || sh.geom === "snip2SameRect" || sh.geom === "can" || sh.geom === "hexagon";
    el = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x, y, width: w, height: h, rx: rounded ? 4 : 0, ...common });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
    el,
    texts
  ] }, i);
}
function PracticeDiagram({ diagram, className }) {
  const shapes = diagram.shapes ?? [];
  const W = diagram.canvas?.w ?? 960;
  const H = diagram.canvas?.h ?? 720;
  const arrowColors = (0, import_react.useMemo)(() => {
    const colors = /* @__PURE__ */ new Set();
    for (const sh of shapes) {
      if ((sh.arrowHead || sh.arrowTail) && sh.stroke) colors.add(sh.stroke);
    }
    return [...colors];
  }, [shapes]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: `0 0 ${W} ${H}`, className, preserveAspectRatio: "xMidYMid meet", fontFamily: "sans-serif", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: arrowColors.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "marker",
      {
        id: markerId(c),
        markerWidth: 7,
        markerHeight: 7,
        refX: 5.2,
        refY: 2.5,
        orient: "auto",
        markerUnits: "strokeWidth",
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M0,0 L6,2.5 L0,5 Z", fill: c })
      },
      c
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { width: W, height: H, fill: diagram.bg ?? "#FFFFFF" }),
    shapes.map((sh, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShapeEl, { sh, i }, i))
  ] });
}

// spike-match.tsx
var OUT = "/tmp/matchcheck";
(0, import_node_fs.mkdirSync)(OUT, { recursive: true });
function renderSvg(svg, width) {
  const r = new import_resvg_js.Resvg(svg, { fitTo: { mode: "width", value: width } });
  const img = r.render();
  return { pixels: img.pixels, width: img.width, height: img.height };
}
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function rasterizePng(buf, width) {
  const { w, h } = pngSize(buf);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><image width="${w}" height="${h}" xlink:href="data:image/png;base64,${buf.toString("base64")}"/></svg>`;
  return renderSvg(svg, width);
}
function gray(r, x, y) {
  const i = (y * r.width + x) * 4;
  const a = r.pixels[i + 3] / 255;
  const rr = r.pixels[i] * a + 255 * (1 - a);
  const gg = r.pixels[i + 1] * a + 255 * (1 - a);
  const bb = r.pixels[i + 2] * a + 255 * (1 - a);
  return 0.299 * rr + 0.587 * gg + 0.114 * bb;
}
function contentBBox(r) {
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
var N = 32;
function thumb(r) {
  const { x0, y0, x1, y1 } = contentBBox(r);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const out = new Float64Array(N * N);
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      const sx0 = x0 + Math.floor(tx * bw / N);
      const sx1 = x0 + Math.max(Math.floor((tx + 1) * bw / N), Math.floor(tx * bw / N) + 1);
      const sy0 = y0 + Math.floor(ty * bh / N);
      const sy1 = y0 + Math.max(Math.floor((ty + 1) * bh / N), Math.floor(ty * bh / N) + 1);
      let sum = 0, n = 0;
      for (let y = sy0; y < sy1 && y <= y1; y++)
        for (let x = sx0; x < sx1 && x <= x1; x++) {
          sum += gray(r, x, y);
          n++;
        }
      out[ty * N + tx] = n ? sum / n : 255;
    }
  }
  return out;
}
function hashes(t) {
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
function hamming(x, y) {
  let v = x ^ y;
  let c = 0;
  while (v) {
    c += Number(v & 1n);
    v >>= 1n;
  }
  return c;
}
function dist(h1, h2) {
  return hamming(h1.a, h2.a) + hamming(h1.d, h2.d);
}
async function main() {
  const client = new import_pg.default.Client({ connectionString: process.env.DEV_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    "SELECT id, ordinal, kind, title, diagram FROM practices"
  );
  await client.end();
  console.log(`practices: ${rows.length}`);
  const lib = [];
  for (const row of rows) {
    try {
      const svg = (0, import_server.renderToStaticMarkup)(
        import_react2.default.createElement(PracticeDiagram, { diagram: row.diagram })
      ).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      const raster = renderSvg(svg, 300);
      const h = hashes(thumb(raster));
      const png = new import_resvg_js.Resvg(svg, { fitTo: { mode: "width", value: 480 } }).render().asPng();
      (0, import_node_fs.mkdirSync)("/tmp/librender", { recursive: true });
      (0, import_node_fs.writeFileSync)(`/tmp/librender/p${row.id}.png`, Buffer.from(png));
      lib.push({ id: row.id, ordinal: row.ordinal, kind: row.kind, title: row.title, h, png: Buffer.from(png) });
    } catch (e) {
      console.log(`render failed for practice ${row.id}: ${e.message}`);
    }
  }
  console.log(`library rendered: ${lib.length}`);
  const sampleDir = "/tmp/docximg";
  const results = [];
  for (const dir of (0, import_node_fs.readdirSync)(sampleDir)) {
    for (const img of (0, import_node_fs.readdirSync)((0, import_node_path.join)(sampleDir, dir))) {
      const buf = (0, import_node_fs.readFileSync)((0, import_node_path.join)(sampleDir, dir, img));
      const { w, h: ph } = pngSize(buf);
      if (w < 250 || ph < 150) continue;
      const ar = w / ph;
      if (ar > 0.85 && ar < 1.15 && w > 700) continue;
      let raster;
      try {
        raster = rasterizePng(buf, 300);
      } catch {
        continue;
      }
      const hh = hashes(thumb(raster));
      const ranked = lib.map((p) => ({ p, d: dist(hh, p.h) })).sort((a, b) => a.d - b.d).slice(0, 3);
      const tag = `${dir}__${img}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      (0, import_node_fs.writeFileSync)((0, import_node_path.join)(OUT, `${tag}`), buf);
      ranked.forEach((r, i) => {
        (0, import_node_fs.writeFileSync)((0, import_node_path.join)(OUT, `${tag}.match${i + 1}_p${r.p.id}_d${r.d}.png`), r.p.png);
      });
      const line = `${dir}/${img} (${w}x${ph}) -> ` + ranked.map((r) => `#${r.p.id}[${r.p.kind}] "${r.p.title ?? "untitled slide " + r.p.ordinal}" d=${r.d}`).join(" | ");
      results.push(line);
      console.log(line);
    }
  }
  (0, import_node_fs.writeFileSync)((0, import_node_path.join)(OUT, "results.txt"), results.join("\n"));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
