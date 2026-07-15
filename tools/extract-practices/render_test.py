#!/usr/bin/env python3
"""Render extracted diagrams to SVG/PNG to eyeball extraction fidelity.
Mirrors the intended frontend SVG renderer semantics.

Usage: python3 render_test.py practices.json out_dir ordinal [ordinal...]
"""
import json, sys, math, os, subprocess, html

def esc(s):
    return html.escape(str(s), quote=True)

def transform_attr(sh):
    cx, cy = sh["x"] + sh["w"] / 2, sh["y"] + sh["h"] / 2
    parts = []
    if sh.get("rot"):
        parts.append(f"rotate({sh['rot']} {cx} {cy})")
    if sh.get("fh") or sh.get("fv"):
        sx = -1 if sh.get("fh") else 1
        sy = -1 if sh.get("fv") else 1
        parts.append(f"translate({cx} {cy}) scale({sx} {sy}) translate({-cx} {-cy})")
    return f' transform="{" ".join(parts)}"' if parts else ""

def render(slide, canvas):
    W, H = canvas["w"], canvas["h"]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="sans-serif">']
    out.append(f'<rect width="{W}" height="{H}" fill="{slide.get("bg", "#FFFFFF")}"/>')
    out.append('<defs>'
               '<marker id="tri" markerWidth="7" markerHeight="7" refX="5.2" refY="2.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,2.5 L0,5 Z" fill="context-stroke"/></marker>'
               '<marker id="arrow" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6" fill="none" stroke="context-stroke" stroke-width="1.2"/></marker>'
               '</defs>')
    for sh in slide["shapes"]:
        k = sh.get("kind")
        if k == "pic":
            x, y, w, h = sh["x"], sh["y"], sh["w"], sh["h"]
            if sh["icon"] == "person":
                tint = sh.get("tint", "#888888")
                out.append(f'<g{transform_attr(sh)}><ellipse cx="{x+w/2}" cy="{y+h*0.14}" rx="{w*0.32}" ry="{h*0.14}" fill="{tint}"/>'
                           f'<path d="M {x+w*0.1} {y+h*0.30} h {w*0.8} v {h*0.28} h -{w*0.16} v {h*0.42} h -{w*0.18} v -{h*0.3} h -{w*0.12} v {h*0.3} h -{w*0.18} v -{h*0.42} h -{w*0.16} Z" fill="{tint}"/></g>')
            elif sh["icon"] == "ball":
                r = min(w, h) / 2
                out.append(f'<circle cx="{x+w/2}" cy="{y+h/2}" r="{r}" fill="#FFFFFF" stroke="#222" stroke-width="1"/>'
                           f'<circle cx="{x+w/2}" cy="{y+h/2}" r="{r*0.45}" fill="#222"/>')
            else:
                out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#DDD" stroke="#999"/>')
            continue
        if k not in ("shape", "conn"):
            continue
        x, y, w, h = sh["x"], sh["y"], sh["w"], sh["h"]
        geom = sh.get("geom", "rect")
        fill = sh.get("fill", "none")
        fa = sh.get("fillAlpha", 1)
        stroke = sh.get("stroke")
        sw = sh.get("strokeW", 0.75)
        dash = {"dash": 'stroke-dasharray="7 5"', "dot": 'stroke-dasharray="2 4"'}.get(sh.get("dash"), "")
        markers = ""
        if sh.get("arrowTail"):
            markers += ' marker-end="url(#tri)"'
        if sh.get("arrowHead"):
            markers += ' marker-start="url(#tri)"'
        common = f'fill="{fill}" fill-opacity="{fa}"' + (f' stroke="{stroke}" stroke-width="{sw}" {dash}' if stroke else ' stroke="none"')
        tr = transform_attr(sh)

        if k == "conn" or geom in ("line", "straightConnector1"):
            x1, y1, x2, y2 = x, y, x + w, y + h
            if sh.get("fh"):
                x1, x2 = x2, x1
            if sh.get("fv"):
                y1, y2 = y2, y1
            rot = sh.get("rot")
            g_open = ""
            g_close = ""
            if rot:
                cx, cy = x + w / 2, y + h / 2
                g_open, g_close = f'<g transform="rotate({rot} {cx} {cy})">', "</g>"
            out.append(f'{g_open}<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke or "#333"}" stroke-width="{max(sw,1)}" {dash}{markers}/>{g_close}')
        elif geom == "custom" and sh.get("path"):
            out.append(f'<path d="{sh["path"]}" {common}{markers} stroke-linejoin="round"/>')
        elif geom == "ellipse":
            out.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" {common}{tr}/>')
        elif geom in ("triangle",):
            out.append(f'<polygon points="{x+w/2},{y} {x+w},{y+h} {x},{y+h}" {common}{tr}/>')
        elif geom == "trapezoid":
            out.append(f'<polygon points="{x+w*0.25},{y} {x+w*0.75},{y} {x+w},{y+h} {x},{y+h}" {common}{tr}/>')
        elif geom == "diamond":
            out.append(f'<polygon points="{x+w/2},{y} {x+w},{y+h/2} {x+w/2},{y+h} {x},{y+h/2}" {common}{tr}/>')
        elif geom == "pie":
            out.append(f'<path d="M {x+w/2} {y+h/2} L {x+w/2} {y} A {w/2} {h/2} 0 0 1 {x+w} {y+h/2} Z" {common}{tr}/>')
        elif geom == "arc":
            out.append(f'<path d="M {x+w/2} {y} A {w/2} {h/2} 0 0 1 {x+w} {y+h/2}" fill="none" stroke="{stroke or "#333"}" stroke-width="{sw}"{tr}/>')
        elif geom in ("snip2SameRect", "can", "hexagon", "roundRect"):
            out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" {common}{tr}/>')
        else:  # rect + fallback
            out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" {common}{tr}/>')

        for i, p in enumerate(sh.get("paras", [])[:14]):
            fs = min(p.get("size") or 12, 16) * (960 / 720) * 0.75
            ty = y + fs * 1.2 * (i + 1)
            if ty > y + h + 4:
                break
            anchor, tx = ("middle", x + w / 2) if w < 120 else ("start", x + 4)
            out.append(f'<text x="{tx}" y="{ty}" font-size="{fs:.1f}" text-anchor="{anchor}" fill="{p.get("color") or "#111"}"{" font-weight=\"bold\"" if p.get("bold") else ""}>{esc(p["text"][:60])}</text>')
    out.append("</svg>")
    return "\n".join(out)


def main():
    data = json.load(open(sys.argv[1]))
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    by_ord = {s["ordinal"]: s for s in data["slides"]}
    for arg in sys.argv[3:]:
        s = by_ord[int(arg)]
        svg = render(s, data["canvas"])
        base = os.path.join(outdir, f"slide{arg}")
        open(base + ".svg", "w").write(svg)
        subprocess.run(["magick", "-density", "110", "-background", "white",
                        base + ".svg", base + ".png"], check=True)
        print("rendered", base + ".png", "|", s["kind"], "|", s.get("title"))


if __name__ == "__main__":
    main()
