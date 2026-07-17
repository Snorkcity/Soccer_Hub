#!/usr/bin/env python3
"""Parse coach session-plan .docx files into structured JSON.

Documents are a sequence of blocks: [diagram image] [optional heading]
[table1: rules/tasks/progressions/coaching points] [table2: players/size/
timing/scoring/intensity]. Headings vary across seasons ("Warmup",
"Dynamic warmup", "Technical warmup", "Game training", "Training game", ...)
and are sometimes missing entirely, in which case block order decides the part.

Usage: parse_docx.py <dir-with-docx> <out-dir>
"""
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

PART_HEADINGS = {
    "warmup": "warmup", "warm up": "warmup", "warm-up": "warmup",
    "dynamic warmup": "warmup", "dynamic warm up": "warmup",
    "activation": "activation",
    "introduction": "introduction", "intro": "introduction",
    "technical warmup": "introduction", "technical warm up": "introduction",
    "possession": "introduction",
    "main part": "main", "main": "main", "game training": "main",
    "end game": "endgame", "endgame": "endgame", "end-game": "endgame",
    "training game": "endgame", "game": "endgame",
}
STOP_HEADINGS = {"cone layout", "comments", "squad", "notes"}
# position fallback when headings are absent (typical 4-block session)
ORDER4 = ["warmup", "introduction", "main", "endgame"]

LABELS = {
    "rules/explanation": "rules", "rules": "rules", "explanation": "rules",
    "tasks": "tasks", "coaching messages": "tasks", "task": "tasks",
    "progressions": "progressions", "progression": "progressions",
    "coaching points": "coachingPoints", "coaching point": "coachingPoints",
    "comments": "coachingPoints",
    "players": "players", "size": "size", "timing": "timing",
    "scoring": "scoring", "intensity": "intensity",
}
GHOST_VALUES = {"warmup", "team:player:", "team:", "player:", "teamplayer:"}


def cell_text(tc):
    paras = []
    for p in tc.findall(W + "p"):
        t = "".join(x.text or "" for x in p.iter(W + "t")).strip()
        if t:
            paras.append(t)
    return "\n".join(paras)


def para_text(el):
    return "".join(t.text or "" for t in el.iter(W + "t")).strip()


def images_of(el, relmap):
    out = []
    for blip in el.iter(A + "blip"):
        tgt = relmap.get(blip.get(R + "embed"))
        if tgt and tgt.lower().endswith((".png", ".jpg", ".jpeg")):
            out.append(os.path.basename(tgt))
    return out


def table_kind(tbl):
    rows = tbl.findall(W + "tr")
    if not rows:
        return None, rows
    first = [cell_text(tc).strip().lower().rstrip(":") for tc in rows[0].findall(W + "tc")]
    if first and first[0] == "comments":
        return "comments", rows
    if len(rows) > 5 and len(rows[1].findall(W + "tc")) >= 3:
        c0 = cell_text(rows[1].findall(W + "tc")[0]).strip()
        if re.fullmatch(r"\d+", c0):
            return "squad", rows
    keys = [LABELS.get(c) for c in first]
    if any(keys):
        if "players" in [LABELS.get(c) for c in first]:
            return "meta", rows
        return "fields", rows
    # tables whose first row is blank but later rows carry labels
    for tr in rows[1:]:
        cs = [cell_text(tc).strip().lower().rstrip(":") for tc in tr.findall(W + "tc")]
        if any(LABELS.get(c) for c in cs):
            return "fields", rows
    return None, rows


def parse_label_table(rows, fields):
    i = 0
    while i < len(rows):
        cells = [cell_text(tc) for tc in rows[i].findall(W + "tc")]
        keys = [LABELS.get(c.strip().lower().rstrip(":")) for c in cells]
        if any(keys) and i + 1 < len(rows):
            vals = [cell_text(tc) for tc in rows[i + 1].findall(W + "tc")]
            for ci, k in enumerate(keys):
                if k and ci < len(vals) and vals[ci].strip():
                    v = vals[ci].strip()
                    norm = re.sub(r"\s+", "", v.lower())
                    if v.lower().rstrip(":") in LABELS or norm in GHOST_VALUES or v.lower() in PART_HEADINGS:
                        continue
                    # strip ghost prefixes like "Team:\nPlayer:" bleeding into real text
                    v = re.sub(r"^(team:|player:)\s*", "", v, flags=re.I).strip()
                    if not v:
                        continue
                    fields[k] = (fields.get(k, "") + "\n" + v).strip() if fields.get(k) else v
            i += 2
        else:
            i += 1


def parse_file(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body")
    rels = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    relmap = {r.get("Id"): r.get("Target") for r in rels}

    blocks = []          # {heading, images, fields}
    pending_images = []
    pending_heading = None
    comments = None
    squad = []
    skip_next_images = False  # after "cone layout" heading

    def current_block(create=True):
        if blocks and not blocks[-1]["closed"]:
            return blocks[-1]
        if not create:
            return None
        blocks.append({"heading": None, "images": [], "fields": {}, "closed": False})
        return blocks[-1]

    for el in body:
        tag = el.tag.replace(W, "")
        if tag == "p":
            imgs = images_of(el, relmap)
            if imgs:
                if skip_next_images:
                    skip_next_images = False
                else:
                    pending_images.extend(imgs)
            t = para_text(el).lower().strip().rstrip(":")
            if t in PART_HEADINGS:
                pending_heading = PART_HEADINGS[t]
            elif t in STOP_HEADINGS:
                if t == "cone layout":
                    # cone-layout images appear BEFORE the heading in some
                    # seasons and AFTER it in others — drop both.
                    pending_images = []
                    skip_next_images = True
                pending_heading = None
        elif tag == "tbl":
            kind, rows = table_kind(el)
            if kind == "comments":
                if len(rows) > 1:
                    comments = cell_text(rows[1].findall(W + "tc")[0]) or None
                pending_images, pending_heading = [], None
            elif kind == "squad":
                for tr in rows:
                    cs = [cell_text(tc) for tc in tr.findall(W + "tc")]
                    if len(cs) >= 3 and cs[0].strip().isdigit() and (cs[1].strip() or cs[2].strip()):
                        squad.append({"num": cs[0].strip(), "pos": cs[1].strip(), "name": cs[2].strip(), "note": cs[3].strip() if len(cs) > 3 else ""})
                pending_images, pending_heading = [], None
            elif kind == "fields":
                b = {"heading": pending_heading, "images": pending_images, "fields": {}, "closed": False}
                blocks.append(b)
                pending_images, pending_heading = [], None
                parse_label_table(rows, b["fields"])
            elif kind == "meta":
                b = current_block()
                parse_label_table(rows, b["fields"])
                b["closed"] = True

    # assign parts: headings win; unheaded blocks fill remaining ORDER4 slots in order
    real = [b for b in blocks if b["fields"] or b["images"]]
    used = {b["heading"] for b in real if b["heading"]}
    order = [p for p in ORDER4 if p not in used]
    parts = {}
    for b in real:
        part = b["heading"]
        if not part:
            part = order.pop(0) if order else "extra"
        if part in parts:  # duplicate heading (e.g. two mains) -> merge images, keep both texts
            parts[part]["images"].extend(b["images"])
            for k, v in b["fields"].items():
                parts[part]["fields"][k] = (parts[part]["fields"].get(k, "") + "\n" + v).strip()
        else:
            parts[part] = {"fields": b["fields"], "images": b["images"]}

    return {
        "file": os.path.basename(path),
        "parts": parts,
        "comments": comments,
        "squad": squad,
        "leftoverImages": pending_images,
    }


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    stats = {"files": 0, "errors": [], "partCounts": {}, "noParts": [], "extra": []}
    for f in sorted(os.listdir(src)):
        if not f.endswith(".docx") or f.startswith("~$"):
            continue
        stats["files"] += 1
        try:
            doc = parse_file(os.path.join(src, f))
        except Exception as e:
            stats["errors"].append(f"{f}: {e}")
            continue
        with open(os.path.join(out, f.replace(".docx", ".json")), "w") as fh:
            json.dump(doc, fh, indent=1)
        if not doc["parts"]:
            stats["noParts"].append(f)
        if "extra" in doc["parts"]:
            stats["extra"].append(f)
        for p, d in doc["parts"].items():
            has_text = any(d["fields"].values())
            key = f"{p}:{'text' if has_text else 'EMPTY'}:{'img' if d['images'] else 'NOIMG'}"
            stats["partCounts"][key] = stats["partCounts"].get(key, 0) + 1
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
