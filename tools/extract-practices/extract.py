#!/usr/bin/env python3
"""
Extract the BUFC session-practice library from the coach's PowerPoint deck.

Reads the .pptx (a zip of XML), walks every slide's shape tree (including
nested groups), resolves theme colours, and emits practices.json with one
record per slide: classification (chapter cover / section marker / practice /
legend...), title guess, all text paragraphs, and a fully-resolved diagram
(shapes in pixel coordinates at a 960px-wide canvas) ready for SVG rendering.

Usage:  python3 extract.py <deck.pptx> <out.json>
"""
import sys, re, json, zipfile, colorsys, io, math
from xml.etree import ElementTree as ET
from collections import Counter

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"

def q(ns, tag):
    return f"{{{ns}}}{tag}"

CANVAS_W = 960.0  # px; slide is scaled so its width == 960


# ── colour helpers ────────────────────────────────────────────────────────────

def apply_lum(hex6, lum_mod, lum_off):
    r, g, b = (int(hex6[i:i+2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = max(0.0, min(1.0, l * lum_mod + lum_off))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return f"{round(r*255):02X}{round(g*255):02X}{round(b*255):02X}"


class Deck:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.scheme = {}       # dk1/lt1/... -> hex
        self.clr_map = {}      # bg1/tx1/... -> dk1/lt1/...
        self._load_theme()
        self.slide_files = self._ordered_slides()
        self.media_kind = self._classify_media()

    def read_xml(self, name):
        return ET.fromstring(self.z.read(name))

    def _load_theme(self):
        root = self.read_xml("ppt/theme/theme1.xml")
        cs = root.find(f".//{q(A,'clrScheme')}")
        for child in cs:
            tag = child.tag.split('}')[1]
            srgb = child.find(q(A, "srgbClr"))
            sysc = child.find(q(A, "sysClr"))
            if srgb is not None:
                self.scheme[tag] = srgb.get("val")
            elif sysc is not None:
                self.scheme[tag] = sysc.get("lastClr", "000000")
        master = self.read_xml("ppt/slideMasters/slideMaster1.xml")
        cm = master.find(f".//{q(P,'clrMap')}")
        if cm is not None:
            self.clr_map = dict(cm.attrib)

    def resolve_color(self, node):
        """node = <a:srgbClr>/<a:schemeClr>/... ; returns (hex, alpha 0-1) or None"""
        if node is None:
            return None
        tag = node.tag.split('}')[1]
        if tag == "srgbClr":
            hex6 = node.get("val")
        elif tag == "schemeClr":
            key = node.get("val")
            key = self.clr_map.get(key, key)
            hex6 = self.scheme.get(key, "000000")
        elif tag == "sysClr":
            hex6 = node.get("lastClr", "000000")
        elif tag == "prstClr":
            hex6 = {"black": "000000", "white": "FFFFFF"}.get(node.get("val"), "808080")
        else:
            return None
        lum_mod, lum_off, alpha = 1.0, 0.0, 1.0
        for mod in node:
            mtag = mod.tag.split('}')[1]
            v = mod.get("val")
            if v is None:
                continue
            v = int(v) / 100000.0
            if mtag == "lumMod":
                lum_mod = v
            elif mtag == "lumOff":
                lum_off = v
            elif mtag == "alpha":
                alpha = v
            elif mtag == "shade":
                lum_mod *= v
            elif mtag == "tint":
                lum_mod, lum_off = v, 1.0 - v
        return "#" + apply_lum(hex6, lum_mod, lum_off), round(alpha, 3)

    def _ordered_slides(self):
        pres = self.read_xml("ppt/presentation.xml")
        rels = self.read_xml("ppt/_rels/presentation.xml.rels")
        rid_to_target = {rel.get("Id"): rel.get("Target")
                         for rel in rels if "slide" in rel.get("Target", "")
                         and rel.get("Type", "").endswith("/slide")}
        sld_sz = pres.find(q(P, "sldSz"))
        self.slide_cx = int(sld_sz.get("cx"))
        self.slide_cy = int(sld_sz.get("cy"))
        out = []
        for sid in pres.find(q(P, "sldIdLst")):
            target = rid_to_target[sid.get(q(R, "id"))]
            out.append("ppt/" + target.lstrip("./"))
        return out

    def _classify_media(self):
        """person icons are 228x587-ish PNG silhouettes; ball is image3.jpg."""
        kinds = {}
        try:
            from PIL import Image
            have_pil = True
        except ImportError:
            have_pil = False
        for name in self.z.namelist():
            if not name.startswith("ppt/media/"):
                continue
            short = name.split("/")[-1]
            kind, tint = "image", None
            if have_pil and short.lower().endswith(("png", "jpg", "jpeg")):
                try:
                    im = Image.open(io.BytesIO(self.z.read(name))).convert("RGBA")
                    w, h = im.size
                    if 1.8 < h / max(w, 1) < 3.2 and h > 100:      # tall silhouette
                        kind = "person"
                        px = im.getpixel((w // 2, h // 3))
                        if px[3] > 100:
                            tint = f"#{px[0]:02X}{px[1]:02X}{px[2]:02X}"
                    elif "image3." in short:
                        kind = "ball"
                    elif w <= 40 and h <= 40:
                        kind = "ball"                              # small ball icons
                except Exception:
                    pass
            elif "image3." in short:
                kind = "ball"
            kinds[short] = {"kind": kind, "tint": tint}
        return kinds

    def slide_background(self, slide_root, slide_file):
        """Resolve slide bg colour: slide → layout → master; default white."""
        def bg_from(root):
            bg = root.find(f".//{q(P,'bg')}")
            if bg is None:
                return None
            fill = bg.find(f".//{q(A,'solidFill')}")
            if fill is not None and len(fill):
                res = self.resolve_color(fill[0])
                if res:
                    return res[0]
            return None
        c = bg_from(slide_root)
        if c:
            return c
        rels = self.slide_rels(slide_file.replace("ppt/", ""))
        layout = next((t for t in rels.values() if "slideLayout" in t), None)
        if layout:
            layout_name = "ppt/slideLayouts/" + layout.split("/")[-1]
            try:
                lroot = self.read_xml(layout_name)
                c = bg_from(lroot)
                if c:
                    return c
                lrels_name = layout_name.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels"
                lrels = ET.fromstring(self.z.read(lrels_name))
                master = next((r.get("Target") for r in lrels
                               if "slideMaster" in r.get("Target", "")), None)
                if master:
                    mroot = self.read_xml("ppt/slideMasters/" + master.split("/")[-1])
                    c = bg_from(mroot)
                    if c:
                        return c
            except KeyError:
                pass
        return "#FFFFFF"

    def slide_rels(self, slide_file):
        rels_name = slide_file.replace("slides/", "slides/_rels/") + ".rels"
        if not rels_name.startswith("ppt/"):
            rels_name = "ppt/" + rels_name
        out = {}
        try:
            rels = self.read_xml(rels_name)
        except KeyError:
            return out
        for rel in rels:
            out[rel.get("Id")] = rel.get("Target", "")
        return out


# ── geometry helpers ─────────────────────────────────────────────────────────

class Xform:
    """Accumulated group transform: x' = ox + (x - cx) * sx  (same for y)."""
    __slots__ = ("ox", "oy", "cx", "cy", "sx", "sy")

    def __init__(self, ox=0.0, oy=0.0, cx=0.0, cy=0.0, sx=1.0, sy=1.0):
        self.ox, self.oy, self.cx, self.cy, self.sx, self.sy = ox, oy, cx, cy, sx, sy

    def apply(self, x, y):
        return self.ox + (x - self.cx) * self.sx, self.oy + (y - self.cy) * self.sy

    def scale(self):
        return self.sx, self.sy


def parse_xfrm(sp_pr):
    xfrm = sp_pr.find(q(A, "xfrm")) if sp_pr is not None else None
    if xfrm is None:
        return None
    off = xfrm.find(q(A, "off"))
    ext = xfrm.find(q(A, "ext"))
    if off is None or ext is None:
        return None
    return {
        "x": int(off.get("x")), "y": int(off.get("y")),
        "w": int(ext.get("cx")), "h": int(ext.get("cy")),
        "rot": int(xfrm.get("rot", "0")) / 60000.0,
        "fh": xfrm.get("flipH") == "1",
        "fv": xfrm.get("flipV") == "1",
        "xfrm": xfrm,
    }


def custgeom_path(sp_pr, frame, xf, scale_px):
    """Convert a:custGeom to an absolute SVG path string in canvas px."""
    cg = sp_pr.find(q(A, "custGeom"))
    if cg is None:
        return None
    paths = cg.findall(f".//{q(A,'path')}")
    if not paths:
        return None
    x0, y0 = xf.apply(frame["x"], frame["y"])
    sx, sy = xf.scale()
    w_emu, h_emu = frame["w"] * sx, frame["h"] * sy
    rot = math.radians(frame["rot"])
    cx_px = (x0 + w_emu / 2) * scale_px
    cy_px = (y0 + h_emu / 2) * scale_px

    def pt(px_str, py_str, pw, ph):
        fx = int(px_str) / pw if pw else 0.0
        fy = int(py_str) / ph if ph else 0.0
        if frame["fh"]:
            fx = 1.0 - fx
        if frame["fv"]:
            fy = 1.0 - fy
        x = (x0 + fx * w_emu) * scale_px
        y = (y0 + fy * h_emu) * scale_px
        if rot:
            dx, dy = x - cx_px, y - cy_px
            x = cx_px + dx * math.cos(rot) - dy * math.sin(rot)
            y = cy_px + dx * math.sin(rot) + dy * math.cos(rot)
        return round(x, 1), round(y, 1)

    d = []
    for path in paths:
        pw = int(path.get("w", "0")) or 1
        ph = int(path.get("h", "0")) or 1
        for cmd in path:
            ctag = cmd.tag.split('}')[1]
            pts = cmd.findall(q(A, "pt"))
            if ctag == "moveTo" and pts:
                x, y = pt(pts[0].get("x"), pts[0].get("y"), pw, ph)
                d.append(f"M {x} {y}")
            elif ctag == "lnTo" and pts:
                x, y = pt(pts[0].get("x"), pts[0].get("y"), pw, ph)
                d.append(f"L {x} {y}")
            elif ctag == "cubicBezTo" and len(pts) == 3:
                coords = [pt(p.get("x"), p.get("y"), pw, ph) for p in pts]
                d.append("C " + " ".join(f"{x} {y}" for x, y in coords))
            elif ctag == "quadBezTo" and len(pts) == 2:
                coords = [pt(p.get("x"), p.get("y"), pw, ph) for p in pts]
                d.append("Q " + " ".join(f"{x} {y}" for x, y in coords))
            elif ctag == "arcTo":
                pass  # rare in this deck; the surrounding line segs approximate
            elif ctag == "close":
                d.append("Z")
    return " ".join(d) if d else None


# ── shape walker ─────────────────────────────────────────────────────────────

DASH_MAP = {"dash": "dash", "sysDash": "dash", "lgDash": "dash",
            "dashDot": "dash", "lgDashDot": "dash", "lgDashDotDot": "dash",
            "dot": "dot", "sysDot": "dot", "sysDashDot": "dash"}


def extract_line(deck, sp_pr, style):
    ln = sp_pr.find(q(A, "ln")) if sp_pr is not None else None
    color, width_emu, dash = None, 9525, "solid"
    head, tail = None, None
    if ln is not None:
        width_emu = int(ln.get("w", "9525"))
        if ln.find(q(A, "noFill")) is not None:
            return None
        fill = ln.find(q(A, "solidFill"))
        if fill is not None and len(fill):
            res = deck.resolve_color(fill[0])
            if res:
                color = res[0]
        pd = ln.find(q(A, "prstDash"))
        if pd is not None:
            dash = DASH_MAP.get(pd.get("val"), "solid")
        he = ln.find(q(A, "headEnd"))
        te = ln.find(q(A, "tailEnd"))
        if he is not None and he.get("type", "none") != "none":
            head = he.get("type")
        if te is not None and te.get("type", "none") != "none":
            tail = te.get("type")
    if color is None and style is not None:
        ln_ref = style.find(q(A, "lnRef"))
        if ln_ref is not None and len(ln_ref):
            res = deck.resolve_color(ln_ref[0])
            if res:
                color = res[0]
    if color is None:
        return {"color": None, "w": width_emu, "dash": dash, "head": head, "tail": tail}
    return {"color": color, "w": width_emu, "dash": dash, "head": head, "tail": tail}


def extract_fill(deck, sp_pr, style):
    if sp_pr is not None:
        if sp_pr.find(q(A, "noFill")) is not None:
            return None
        fill = sp_pr.find(q(A, "solidFill"))
        if fill is not None and len(fill):
            return deck.resolve_color(fill[0])
        if sp_pr.find(q(A, "blipFill")) is not None:
            return ("#BBBBBB", 1.0)
        grad = sp_pr.find(q(A, "gradFill"))
        if grad is not None:
            first = grad.find(f".//{q(A,'gs')}")
            if first is not None and len(first):
                return deck.resolve_color(first[0])
    if style is not None:
        fill_ref = style.find(q(A, "fillRef"))
        if fill_ref is not None and int(fill_ref.get("idx", "0")) > 0 and len(fill_ref):
            return deck.resolve_color(fill_ref[0])
    return None


def extract_paragraphs(deck, sp):
    tx = sp.find(q(P, "txBody"))
    if tx is None:
        tx = sp.find(q(A, "txBody"))
    if tx is None:
        return []
    paras = []
    for para in tx.findall(q(A, "p")):
        runs, size, bold, color = [], None, False, None
        for r in para.findall(q(A, "r")):
            t = r.find(q(A, "t"))
            if t is None or t.text is None:
                continue
            runs.append(t.text)
            rpr = r.find(q(A, "rPr"))
            if rpr is not None:
                if rpr.get("sz") and size is None:
                    size = int(rpr.get("sz")) / 100.0
                if rpr.get("b") == "1":
                    bold = True
                sf = rpr.find(q(A, "solidFill"))
                if sf is not None and len(sf) and color is None:
                    res = deck.resolve_color(sf[0])
                    if res:
                        color = res[0]
        text = "".join(runs).strip()
        if text:
            paras.append({"text": text, "size": size, "bold": bold, "color": color})
    return paras


def walk(deck, node, xf, scale_px, rels, out, warn):
    for child in node:
        tag = child.tag.split('}')[1]
        if tag == "grpSp":
            gsp_pr = child.find(q(P, "grpSpPr"))
            frame = parse_xfrm(gsp_pr)
            if frame is None:
                walk(deck, child, xf, scale_px, rels, out, warn)
                continue
            xfrm = frame["xfrm"]
            ch_off = xfrm.find(q(A, "chOff"))
            ch_ext = xfrm.find(q(A, "chExt"))
            cx = int(ch_off.get("x")) if ch_off is not None else frame["x"]
            cy = int(ch_off.get("y")) if ch_off is not None else frame["y"]
            cw = int(ch_ext.get("cx")) if ch_ext is not None else frame["w"]
            chh = int(ch_ext.get("cy")) if ch_ext is not None else frame["h"]
            gx, gy = xf.apply(frame["x"], frame["y"])
            psx, psy = xf.scale()
            sx = (frame["w"] / cw if cw else 1.0) * psx
            sy = (frame["h"] / chh if chh else 1.0) * psy
            if frame["rot"] or frame["fh"] or frame["fv"]:
                warn["group_rot_flip"] += 1
            walk(deck, child, Xform(gx, gy, cx, cy, sx, sy), scale_px, rels, out, warn)
        elif tag in ("sp", "cxnSp"):
            sp_pr = child.find(q(P, "spPr"))
            style = child.find(q(P, "style"))
            frame = parse_xfrm(sp_pr)
            paras = extract_paragraphs(deck, child) if tag == "sp" else []
            if frame is None:
                if paras:
                    out.append({"kind": "floatingText", "paras": paras})
                continue
            x, y = xf.apply(frame["x"], frame["y"])
            sx, sy = xf.scale()
            rec = {
                "kind": "conn" if tag == "cxnSp" else "shape",
                "x": round(x * scale_px, 1), "y": round(y * scale_px, 1),
                "w": round(frame["w"] * sx * scale_px, 1),
                "h": round(frame["h"] * sy * scale_px, 1),
            }
            if frame["rot"]:
                rec["rot"] = round(frame["rot"], 1)
            if frame["fh"]:
                rec["fh"] = True
            if frame["fv"]:
                rec["fv"] = True
            geom = sp_pr.find(q(A, "prstGeom")) if sp_pr is not None else None
            if geom is not None:
                rec["geom"] = geom.get("prst")
                # preset adjust values: pie/arc angles, trapezoid slant
                adjs = {}
                av = geom.find(q(A, "avLst"))
                if av is not None:
                    for gd in av:
                        fmla = gd.get("fmla", "")
                        if fmla.startswith("val "):
                            try:
                                adjs[gd.get("name")] = int(fmla.split()[1])
                            except ValueError:
                                pass
                if rec["geom"] in ("pie", "chord"):
                    rec["startDeg"] = round(adjs.get("adj1", 0) / 60000.0, 1)
                    rec["endDeg"] = round(adjs.get("adj2", 16200000) / 60000.0, 1)
                elif rec["geom"] == "arc":
                    rec["startDeg"] = round(adjs.get("adj1", 16200000) / 60000.0, 1)
                    rec["endDeg"] = round(adjs.get("adj2", 0) / 60000.0, 1)
                elif rec["geom"] == "trapezoid" and "adj" in adjs:
                    rec["adj"] = round(adjs["adj"] / 100000.0, 3)
            else:
                path = custgeom_path(sp_pr, frame, xf, scale_px) if sp_pr is not None else None
                if path:
                    rec["geom"] = "custom"
                    rec["path"] = path
                else:
                    rec["geom"] = "rect"
            fill = extract_fill(deck, sp_pr, style)
            if fill:
                rec["fill"] = fill[0]
                if fill[1] < 1:
                    rec["fillAlpha"] = fill[1]
            line = extract_line(deck, sp_pr, style)
            if line:
                if line["color"]:
                    rec["stroke"] = line["color"]
                rec["strokeW"] = round(line["w"] / 12700.0, 2)  # pt
                if line["dash"] != "solid":
                    rec["dash"] = line["dash"]
                if line["head"]:
                    rec["arrowHead"] = line["head"]
                if line["tail"]:
                    rec["arrowTail"] = line["tail"]
            if paras:
                rec["paras"] = paras
            out.append(rec)
        elif tag == "pic":
            sp_pr = child.find(q(P, "spPr"))
            frame = parse_xfrm(sp_pr)
            if frame is None:
                continue
            blip = child.find(f".//{q(A,'blip')}")
            media = None
            if blip is not None:
                target = rels.get(blip.get(q(R, "embed")), "")
                media = target.split("/")[-1] if target else None
            info = deck.media_kind.get(media, {"kind": "image", "tint": None})
            x, y = xf.apply(frame["x"], frame["y"])
            sx, sy = xf.scale()
            rec = {
                "kind": "pic", "icon": info["kind"],
                "x": round(x * scale_px, 1), "y": round(y * scale_px, 1),
                "w": round(frame["w"] * sx * scale_px, 1),
                "h": round(frame["h"] * sy * scale_px, 1),
            }
            if info["tint"]:
                rec["tint"] = info["tint"]
            if frame["rot"]:
                rec["rot"] = round(frame["rot"], 1)
            out.append(rec)
        elif tag == "graphicFrame":
            # tables: keep their text so no coaching content is lost
            cells = []
            for t in child.iter(q(A, "t")):
                if t.text and t.text.strip():
                    cells.append(t.text.strip())
            if cells:
                out.append({"kind": "floatingText",
                            "paras": [{"text": " | ".join(cells), "size": None,
                                       "bold": False, "color": None}]})
            warn["graphicFrame"] += 1


# ── slide classification ─────────────────────────────────────────────────────

SECTION_RE = re.compile(r"^\s*(?:[AMX]|MP|EG|M)\s?\d{1,2}\s?\.")
CODE_RE = re.compile(r"\b((?:A|MP|EG|X)(?:-[A-Z]{1,4}){1,2})-?(\d+)?\b")

CHAPTER_BY_PREFIX = {
    "A": "Activations", "MP": "Main Part", "EG": "End Games", "X": "Miscellaneous",
}


def classify_slides(slides):
    """Assign kind + section to each slide record (mutates)."""
    current = {"chapter": "Front Matter", "sectionCode": None, "sectionName": None}
    for s in slides:
        all_text = " ".join(p["text"] for p in s["paras"])
        first = s["paras"][0]["text"] if s["paras"] else ""
        kind = "practice"
        if s["ordinal"] <= 2:
            kind = "frontmatter"
        elif "SUB-CATEGORIES" in all_text:
            kind = "chapterIndex"
        elif "◀" in all_text or (SECTION_RE.match(first) and (CODE_RE.search(all_text) or len(all_text) < 40)):
            kind = "sectionMarker"
            m = CODE_RE.search(all_text)
            name = re.sub(r"\s*(?:[AMX]|MP|EG|M)\s?\d{1,2}\s?\.\s*", "", first).strip()
            code = m.group(1) if m else None
            if code is None and SECTION_RE.match(first):
                code = first.split(".")[0].replace(" ", "")
            current = {
                "chapter": CHAPTER_BY_PREFIX.get((code or "").split("-")[0], current["chapter"]),
                "sectionCode": code,
                "sectionName": name or None,
            }
        elif "S.Conlon – Session Library" in all_text or "S.Conlon - Session Library" in all_text:
            kind = "chapterCover"
            title = first.strip().title()
            current = {"chapter": title, "sectionCode": None, "sectionName": None}
        s["kind"] = kind
        s["chapter"] = current["chapter"]
        s["sectionCode"] = current["sectionCode"]
        s["sectionName"] = current["sectionName"]


def guess_title(paras):
    for p in paras:
        t = p["text"].strip()
        if 3 <= len(t) <= 70 and (t.isupper() or p["bold"] or (p["size"] or 0) >= 16):
            if t.upper() in ("RULES", "PROGRESSIONS", "COACHING POINTS", "TASKS", "C"):
                continue
            return t
    for p in paras:
        t = p["text"].strip()
        if 3 <= len(t) <= 70:
            return t
    return None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    deck = Deck(src)
    scale_px = CANVAS_W / deck.slide_cx
    canvas_h = round(deck.slide_cy * scale_px, 1)
    warn = Counter()
    slides = []
    for i, sf in enumerate(deck.slide_files):
        root = deck.read_xml(sf)
        rels = deck.slide_rels(sf.replace("ppt/", ""))
        sp_tree = root.find(f".//{q(P,'spTree')}")
        shapes = []
        walk(deck, sp_tree, Xform(), scale_px, rels, shapes, warn)
        paras = []
        for sh in shapes:
            for p in sh.get("paras", []):
                paras.append(p)
        slides.append({
            "ordinal": i + 1,
            "file": sf.split("/")[-1],
            "bg": deck.slide_background(root, sf),
            "paras": paras,
            "shapes": [s for s in shapes if s.get("kind") != "floatingText"],
        })
    classify_slides(slides)
    for s in slides:
        s["title"] = guess_title(s["paras"]) if s["kind"] == "practice" else (
            s["paras"][0]["text"] if s["paras"] else None)
    out = {
        "source": src.split("/")[-1],
        "canvas": {"w": CANVAS_W, "h": canvas_h},
        "slides": slides,
    }
    json.dump(out, open(dst, "w"), ensure_ascii=False)
    kinds = Counter(s["kind"] for s in slides)
    print("slides:", len(slides), dict(kinds))
    print("warnings:", dict(warn))
    titled = sum(1 for s in slides if s["kind"] == "practice" and s["title"])
    print("practices with title:", titled, "/", kinds["practice"])


if __name__ == "__main__":
    main()
