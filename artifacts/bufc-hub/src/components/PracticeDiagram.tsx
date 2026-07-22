import { useMemo, type JSX } from "react";

/**
 * Renders an extracted practice diagram (from the coaching slide deck) as SVG.
 * The diagram data is produced by tools/extract-practices/extract.py: shapes
 * carry pixel coordinates on a 960-wide canvas, resolved colours, dashes,
 * arrowheads, rotation/flips, plus text paragraphs.
 */

export interface DiagramPara {
  text: string;
  size?: number | null;
  bold?: boolean;
  color?: string | null;
}

export interface DiagramShape {
  kind: "shape" | "conn" | "pic";
  geom?: string;
  icon?: string;
  tint?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  fh?: boolean;
  fv?: boolean;
  startDeg?: number;
  endDeg?: number;
  adj?: number;
  fill?: string;
  fillAlpha?: number;
  stroke?: string;
  strokeW?: number;
  dash?: string;
  arrowHead?: string;
  arrowTail?: string;
  path?: string;
  paras?: DiagramPara[];
}

export interface DiagramData {
  bg?: string;
  canvas?: { w: number; h: number };
  shapes?: DiagramShape[];
  /** Image-based diagram (imported from old session plans): data URI or URL. */
  img?: string;
}

function transformAttr(sh: DiagramShape): string | undefined {
  const cx = sh.x + sh.w / 2;
  const cy = sh.y + sh.h / 2;
  const parts: string[] = [];
  if (sh.rot) parts.push(`rotate(${sh.rot} ${cx} ${cy})`);
  if (sh.fh || sh.fv) {
    parts.push(`translate(${cx} ${cy}) scale(${sh.fh ? -1 : 1} ${sh.fv ? -1 : 1}) translate(${-cx} ${-cy})`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

function markerId(color: string): string {
  return `arw-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
}

const DASH: Record<string, string> = { dash: "7 5", dot: "2 4" };

function ShapeEl({ sh, i }: { sh: DiagramShape; i: number }) {
  const { x, y, w, h } = sh;
  const fill = sh.fill ?? "none";
  const fa = sh.fillAlpha ?? 1;
  const sw = sh.strokeW ?? 0.75;
  const dash = sh.dash ? DASH[sh.dash] : undefined;
  const tr = transformAttr(sh);

  if (sh.kind === "pic") {
    if (sh.icon === "person") {
      const tint = sh.tint ?? "#888888";
      return (
        <g transform={tr}>
          <ellipse cx={x + w / 2} cy={y + h * 0.14} rx={w * 0.32} ry={h * 0.14} fill={tint} />
          <path
            d={`M ${x + w * 0.1} ${y + h * 0.3} h ${w * 0.8} v ${h * 0.28} h ${-w * 0.16} v ${h * 0.42} h ${-w * 0.18} v ${-h * 0.3} h ${-w * 0.12} v ${h * 0.3} h ${-w * 0.18} v ${-h * 0.42} h ${-w * 0.16} Z`}
            fill={tint}
          />
        </g>
      );
    }
    if (sh.icon === "ball") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) / 2;
      // Classic football: central black pentagon + seam lines to the edge
      const vertex = (k: number, rad: number) => {
        const a = ((-90 + k * 72) * Math.PI) / 180;
        return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as const;
      };
      const pentagon = [0, 1, 2, 3, 4].map((k) => vertex(k, r * 0.38).join(",")).join(" ");
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill="#FFFFFF" stroke="#111" strokeWidth={Math.max(r * 0.09, 0.8)} />
          <polygon points={pentagon} fill="#111" />
          {[0, 1, 2, 3, 4].map((k) => {
            const [ix, iy] = vertex(k, r * 0.38);
            const [ox, oy] = vertex(k, r * 0.92);
            return <line key={k} x1={ix} y1={iy} x2={ox} y2={oy} stroke="#111" strokeWidth={Math.max(r * 0.08, 0.7)} />;
          })}
        </g>
      );
    }
    return <rect x={x} y={y} width={w} height={h} fill="#DDDDDD" stroke="#999999" strokeWidth={0.5} />;
  }

  const markerEnd = sh.arrowTail && sh.stroke ? `url(#${markerId(sh.stroke)})` : undefined;
  const markerStart = sh.arrowHead && sh.stroke ? `url(#${markerId(sh.stroke)})` : undefined;

  // Word-wrap paragraphs to the shape's width (SVG <text> doesn't wrap itself)
  const lines: Array<{ text: string; fs: number; bold?: boolean; color?: string | null }> = [];
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
    return (
      <text
        key={j}
        x={centered ? x + w / 2 : x + 4}
        y={cursorY}
        fontSize={ln.fs}
        textAnchor={centered ? "middle" : "start"}
        fill={ln.color ?? "#111111"}
        fontWeight={ln.bold ? 700 : 400}
      >
        {ln.text}
      </text>
    );
  });

  let el: JSX.Element;
  const common = {
    fill,
    fillOpacity: fa,
    stroke: sh.stroke ?? "none",
    strokeWidth: sh.stroke ? sw : 0,
    strokeDasharray: dash,
    transform: tr,
  };

  if (sh.kind === "conn" || sh.geom === "line" || sh.geom === "straightConnector1") {
    let [x1, y1, x2, y2] = [x, y, x + w, y + h];
    if (sh.fh) [x1, x2] = [x2, x1];
    if (sh.fv) [y1, y2] = [y2, y1];
    el = (
      <g transform={sh.rot ? `rotate(${sh.rot} ${x + w / 2} ${y + h / 2})` : undefined}>
        <line
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={sh.stroke ?? "#333333"}
          strokeWidth={Math.max(sw, 1)}
          strokeDasharray={dash}
          markerEnd={markerEnd}
          markerStart={markerStart}
        />
      </g>
    );
  } else if (sh.geom === "custom" && sh.path) {
    el = <path d={sh.path} {...common} markerEnd={markerEnd} markerStart={markerStart} strokeLinejoin="round" />;
  } else if (sh.geom === "ellipse") {
    el = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  } else if (sh.geom === "triangle") {
    el = <polygon points={`${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`} {...common} />;
  } else if (sh.geom === "trapezoid") {
    // PowerPoint slants trapezoid sides by adj (default 25%) of the SHORTEST side
    const inset = (sh.adj ?? 0.25) * Math.min(w, h);
    el = <polygon points={`${x + inset},${y} ${x + w - inset},${y} ${x + w},${y + h} ${x},${y + h}`} {...common} />;
  } else if (sh.geom === "diamond") {
    el = <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} {...common} />;
  } else if (sh.geom === "pie" || sh.geom === "chord" || sh.geom === "arc") {
    // OOXML angles: 0° = 3 o'clock, positive = clockwise (matches SVG's y-down)
    const start = sh.startDeg ?? (sh.geom === "arc" ? 270 : 0);
    const end = sh.endDeg ?? (sh.geom === "arc" ? 0 : 270);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    const pt = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return `${cx + rx * Math.cos(rad)} ${cy + ry * Math.sin(rad)}`;
    };
    const delta = ((end - start) % 360 + 360) % 360;
    // delta 0 means a full 360° sweep (e.g. adj1 === adj2); a single SVG arc
    // command with identical endpoints renders nothing, so use an ellipse.
    if (delta === 0) {
      el =
        sh.geom === "arc" ? (
          <ellipse
            cx={cx} cy={cy} rx={rx} ry={ry}
            fill="none"
            stroke={sh.stroke ?? "#333333"}
            strokeWidth={sw}
            strokeDasharray={dash}
            transform={tr}
          />
        ) : (
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} />
        );
      return (
        <g key={i}>
          {el}
          {texts}
        </g>
      );
    }
    const largeArc = delta > 180 ? 1 : 0;
    const arcPart = `M ${pt(start)} A ${rx} ${ry} 0 ${largeArc} 1 ${pt(end)}`;
    if (sh.geom === "arc") {
      el = (
        <path
          d={arcPart}
          fill="none"
          stroke={sh.stroke ?? "#333333"}
          strokeWidth={sw}
          strokeDasharray={dash}
          transform={tr}
        />
      );
    } else if (sh.geom === "chord") {
      el = <path d={`${arcPart} Z`} {...common} />;
    } else {
      el = <path d={`M ${cx} ${cy} L ${pt(start)} A ${rx} ${ry} 0 ${largeArc} 1 ${pt(end)} Z`} {...common} />;
    }
  } else {
    const rounded = sh.geom === "roundRect" || sh.geom === "snip2SameRect" || sh.geom === "can" || sh.geom === "hexagon";
    el = <rect x={x} y={y} width={w} height={h} rx={rounded ? 4 : 0} {...common} />;
  }

  return (
    <g key={i}>
      {el}
      {texts}
    </g>
  );
}

export interface DiagramCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function PracticeDiagram({
  diagram,
  className,
  crop,
}: {
  diagram: DiagramData;
  className?: string;
  /** Coach's snip: only show this rectangle (canvas coords). Applied via SVG viewBox. */
  crop?: DiagramCrop | null;
}) {
  const shapes = diagram.shapes ?? [];
  const W = diagram.canvas?.w ?? 960;
  const H = diagram.canvas?.h ?? 720;
  const vb = crop && crop.w >= 20 && crop.h >= 20 ? `${crop.x} ${crop.y} ${crop.w} ${crop.h}` : `0 0 ${W} ${H}`;

  if (diagram.img) {
    return (
      <svg viewBox={vb} className={className} preserveAspectRatio="xMidYMid meet">
        <rect width={W} height={H} fill={diagram.bg ?? "#FFFFFF"} />
        <image href={diagram.img} width={W} height={H} preserveAspectRatio="xMidYMid meet" />
      </svg>
    );
  }

  const arrowColors = useMemo(() => {
    const colors = new Set<string>();
    for (const sh of shapes) {
      if ((sh.arrowHead || sh.arrowTail) && sh.stroke) colors.add(sh.stroke);
    }
    return [...colors];
  }, [shapes]);

  return (
    <svg viewBox={vb} className={className} preserveAspectRatio="xMidYMid meet" fontFamily="sans-serif">
      <defs>
        {arrowColors.map((c) => (
          <marker
            key={c}
            id={markerId(c)}
            markerWidth={7}
            markerHeight={7}
            refX={5.2}
            refY={2.5}
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,2.5 L0,5 Z" fill={c} />
          </marker>
        ))}
      </defs>
      <rect width={W} height={H} fill={diagram.bg ?? "#FFFFFF"} />
      {shapes.map((sh, i) => (
        <ShapeEl key={i} sh={sh} i={i} />
      ))}
    </svg>
  );
}
