#!/usr/bin/env python3
"""Parse the 14 Belconnen curriculum docx files into structured JSON chunks.

Chunking: split on headings. Each chunk = one heading section (e.g. one session,
one coach-pack section, one framework). Tables are rendered as pipe-separated rows.
"""
import zipfile, re, json, sys, hashlib, os
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

DOCS = [
    # (path, docTitle, docType, ageGroup)
    ("attached_assets/0_Belconnen_Framework_Library_1784520404102.docx", "Framework Library", "framework", "All"),
    ("attached_assets/1_Belconnen_U11_Coach_Pack_1784520404103.docx", "U11 Coach Pack", "coach_pack", "U11"),
    ("attached_assets/2_Belconnen_U11_Session_Plans_1784520404103.docx", "U11 Session Plans", "session_plans", "U11"),
    ("attached_assets/3_Belconnen_U12_Coach_Pack_1784520404105.docx", "U12 Coach Pack", "coach_pack", "U12"),
    ("attached_assets/4_Belconnen_U12_Session_Plans_1784520404106.docx", "U12 Session Plans", "session_plans", "U12"),
    ("attached_assets/5_Belconnen_U13_Coach_Pack_1784520404107.docx", "U13 Coach Pack", "coach_pack", "U13"),
    ("attached_assets/6_Belconnen_U13_Session_Plans_1784520404108.docx", "U13 Session Plans", "session_plans", "U13"),
    ("attached_assets/7_Belconnen_U14_Coach_Pack_1784520404109.docx", "U14 Coach Pack", "coach_pack", "U14"),
    ("attached_assets/8_Belconnen_U14_Session_Plans_1784520404111.docx", "U14 Session Plans", "session_plans", "U14"),
    ("attached_assets/9_Belconnen_U15_Coach_Pack_1784520404112.docx", "U15 Coach Pack", "coach_pack", "U15"),
    ("attached_assets/0_Belconnen_U15_Session_Plans_1784520852544.docx", "U15 Session Plans", "session_plans", "U15"),
    ("attached_assets/1_Belconnen_U16+_Coach_Pack_1784520852545.docx", "U16+ Coach Pack", "coach_pack", "U16+"),
    ("attached_assets/2_Belconnen_U16+_Session_Plans_1784520852546.docx", "U16+ Session Plans", "session_plans", "U16+"),
    ("attached_assets/3_belconnen-player_devlopment_curriculum_v2026_03_1784520852548.docx", "Player Development Curriculum", "curriculum", "All"),
]

def para_text(p):
    parts = []
    for t in p.iter("{%s}t" % NS["w"]):
        parts.append(t.text or "")
    for _ in p.iter("{%s}br" % NS["w"]):
        pass
    return "".join(parts).strip()

def para_style(p):
    pPr = p.find("w:pPr", NS)
    if pPr is None: return None
    s = pPr.find("w:pStyle", NS)
    return s.get("{%s}val" % NS["w"]) if s is not None else None

def is_list(p):
    pPr = p.find("w:pPr", NS)
    return pPr is not None and pPr.find("w:numPr", NS) is not None

def table_text(tbl):
    rows = []
    for tr in tbl.findall("w:tr", NS):
        cells = []
        for tc in tr.findall("w:tc", NS):
            txt = " ".join(filter(None, (para_text(p) for p in tc.findall("w:p", NS))))
            cells.append(txt)
        rows.append(" | ".join(cells))
    return "\n".join(rows)

HEADING_RE = re.compile(r"^Heading(\d)$")

def parse_doc(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find("w:body", NS)
    # sections: list of {headingLevel, heading, lines[]}
    sections = []
    cur = {"level": 0, "heading": "", "lines": []}
    heading_stack = []  # (level, text)
    for el in body:
        tag = el.tag.split("}")[1]
        if tag == "p":
            style = para_style(el)
            txt = para_text(el)
            m = HEADING_RE.match(style or "")
            if (m or style == "Title") and txt:
                lvl = int(m.group(1)) if m else 0
                if cur["lines"] or cur["heading"]:
                    sections.append(cur)
                heading_stack = [(l, t) for (l, t) in heading_stack if l < lvl]
                heading_stack.append((lvl, txt))
                cur = {"level": lvl, "heading": txt,
                       "path": [t for (_, t) in heading_stack], "lines": []}
            elif txt:
                cur["lines"].append(("- " if is_list(el) else "") + txt)
        elif tag == "tbl":
            cur["lines"].append(table_text(el))
    if cur["lines"] or cur["heading"]:
        sections.append(cur)
    return sections

def main():
    out = []
    for path, title, dtype, age in DOCS:
        if not os.path.exists(path):
            print("MISSING:", path); sys.exit(1)
        secs = parse_doc(path)
        # merge tiny sections into parent-level flow: keep sections with content;
        # deepest-heading sections are the retrieval unit
        order = 0
        for s in secs:
            content = "\n".join(s["lines"]).strip()
            if not content and not s["heading"]:
                continue
            if not content:
                continue  # heading-only container (children carry content)
            heading_path = " > ".join(s.get("path", []) or [s["heading"]])
            out.append({
                "docTitle": title, "docType": dtype, "ageGroup": age,
                "heading": s["heading"] or title,
                "headingPath": heading_path,
                "content": content,
                "sortOrder": order,
            })
            order += 1
    # split any chunk over ~6000 chars into parts
    final = []
    for c in out:
        txt = c["content"]
        if len(txt) <= 6000:
            final.append(c); continue
        paras = txt.split("\n")
        buf, part = [], 1
        size = 0
        for p in paras:
            if size + len(p) > 5500 and buf:
                d = dict(c); d["content"] = "\n".join(buf); d["heading"] = f'{c["heading"]} (part {part})'
                final.append(d); part += 1; buf, size = [], 0
            buf.append(p); size += len(p) + 1
        if buf:
            d = dict(c); d["content"] = "\n".join(buf)
            if part > 1: d["heading"] = f'{c["heading"]} (part {part})'
            final.append(d)
    for i, c in enumerate(final):
        c["id"] = hashlib.sha1((c["docTitle"] + "|" + c["headingPath"] + "|" + c["content"]).encode()).hexdigest()[:16]
    with open("lib/db/src/data/curriculum.json", "w") as f:
        json.dump(final, f, ensure_ascii=False)
    from collections import Counter
    print(len(final), "chunks;", sum(len(c['content']) for c in final), "chars")
    print(Counter((c["docTitle"]) for c in final))
    lens = sorted(len(c["content"]) for c in final)
    print("min/median/max chunk chars:", lens[0], lens[len(lens)//2], lens[-1])

if __name__ == "__main__":
    main()
