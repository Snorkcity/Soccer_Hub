/**
 * Minimal XML parser sufficient for word/document.xml parsing.
 * Uses regex-based tokenisation — good enough for well-formed OOXML.
 * Returns a tree of XmlNode with namespace-qualified tag names.
 */

export interface XmlNode {
  ns: string;
  localName: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

const TAG_RE = /<(\/?)([^>\s/]+)([^>]*?)(\/?)>/g;
const ATTR_RE = /([^\s=]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

/** Resolve namespace prefix → URI from attrs map. */
function nsMap(attrs: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  m.set("", ""); // default namespace
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "xmlns") m.set("", v);
    else if (k.startsWith("xmlns:")) m.set(k.slice(6), v);
  }
  return m;
}

function resolveNs(qname: string, nsmap: Map<string, string>): { ns: string; localName: string } {
  const colon = qname.indexOf(":");
  if (colon < 0) return { ns: nsmap.get("") ?? "", localName: qname };
  const prefix = qname.slice(0, colon);
  return { ns: nsmap.get(prefix) ?? prefix, localName: qname.slice(colon + 1) };
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, token: string) => {
      if (token[0] === "#") {
        const hex = token[1]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      return {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
      }[token.toLowerCase()] ?? entity;
    },
  );
}

export class XMLParser {
  private xml: string;

  constructor(xml: string) {
    this.xml = xml;
  }

  parse(): XmlNode {
    const root: XmlNode = { ns: "", localName: "#root", attrs: {}, text: "", children: [] };
    const stack: Array<{ node: XmlNode; nsmap: Map<string, string> }> = [
      { node: root, nsmap: new Map([["", ""]]) },
    ];

    let lastIndex = 0;
    TAG_RE.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(this.xml)) !== null) {
      const textBefore = this.xml.slice(lastIndex, m.index);
      lastIndex = TAG_RE.lastIndex;

      const isClose = m[1] === "/";
      const qname = m[2];
      const attrStr = m[3];
      const selfClose = m[4] === "/";

      const top = stack[stack.length - 1];

      if (textBefore && (top.node.localName === "t" || textBefore.trim())) {
        const decoded = decodeXmlText(textBefore);
        // Word preserves meaningful leading/trailing spaces inside w:t runs
        // (often marked xml:space="preserve"). Paragraph assembly concatenates
        // those runs exactly, matching ElementTree's node.text behaviour.
        if (top.node.localName === "t") {
          top.node.text += decoded;
        } else {
          top.node.text = (top.node.text + decoded.replace(/\s+/g, " ")).trim();
        }
      }

      if (isClose) {
        stack.pop();
        continue;
      }

      const attrs = parseAttrs(attrStr);
      // Inherit parent ns map, then extend with new declarations
      const parentNsmap = top.nsmap;
      const newNsDecls = new Map<string, string>();
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "xmlns") newNsDecls.set("", v);
        else if (k.startsWith("xmlns:")) newNsDecls.set(k.slice(6), v);
      }
      const childNsmap = new Map([...parentNsmap, ...newNsDecls]);

      const { ns, localName } = resolveNs(qname, childNsmap);
      const node: XmlNode = { ns, localName, attrs, text: "", children: [] };
      top.node.children.push(node);

      if (!selfClose) {
        stack.push({ node, nsmap: childNsmap });
      }
    }

    // Return the first real child (the document element), or root
    return root.children[0] ?? root;
  }
}
