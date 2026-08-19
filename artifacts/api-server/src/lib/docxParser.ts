/**
 * Runtime DOCX parser — TypeScript port of scripts/parse_curriculum.py.
 *
 * Replicates the Python parser behaviour faithfully:
 *  - Reads ZIP central directory, inflates word/document.xml
 *  - Extracts paragraphs with heading styles, list markers, table rows
 *  - Splits sections at headings, merges heading-only containers
 *  - Splits large chunks at ~6000 chars (split at 5500-char boundaries)
 *  - Derives deterministic content-key IDs: sha1(docTitle|headingPath|content)[:16]
 *
 * Uses only Node built-ins (zlib.inflateRawSync, crypto.createHash).
 * No external npm packages required.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { XMLParser } from "./xmlLite";

// ── ZIP parsing ───────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  flags: number;
  method: number; // 0=store, 8=deflate
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number; // offset of local-file-header in buf
}

const MAX_ZIP_ENTRIES = 4_096;
const MAX_SINGLE_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 32 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

function readUint32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}
function readUint16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

/**
 * Minimal ZIP central-directory reader.
 * Returns a map of filename → ZipEntry.
 */
function parseZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // Find end-of-central-directory record (EOCD): signature 0x06054b50
  // Search from the end of the file (the comment may be 0..65535 bytes).
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  if (buf.length < 22) throw new Error("Not a valid ZIP file: file is too short");

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (readUint32LE(buf, i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Not a valid ZIP file: EOCD not found");

  const diskNumber = readUint16LE(buf, eocdOffset + 4);
  const centralDirectoryDisk = readUint16LE(buf, eocdOffset + 6);
  const diskEntries = readUint16LE(buf, eocdOffset + 8);
  const cdEntries = readUint16LE(buf, eocdOffset + 10);
  const cdSize = readUint32LE(buf, eocdOffset + 12);
  const cdOffset = readUint32LE(buf, eocdOffset + 16);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || diskEntries !== cdEntries
    || cdEntries === 0xffff
    || cdSize === 0xffffffff
    || cdOffset === 0xffffffff
  ) {
    throw new Error("Multi-disk and ZIP64 archives are not supported");
  }
  if (cdEntries > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP contains too many entries (maximum ${MAX_ZIP_ENTRIES})`);
  }
  if (cdOffset > eocdOffset || cdSize > eocdOffset - cdOffset) {
    throw new Error("ZIP central directory is outside the uploaded file");
  }

  const entries = new Map<string, ZipEntry>();
  let pos = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < cdEntries; i++) {
    if (pos + 46 > eocdOffset || readUint32LE(buf, pos) !== CD_SIG) {
      throw new Error("ZIP central directory is truncated or malformed");
    }
    const flags = readUint16LE(buf, pos + 8);
    const method = readUint16LE(buf, pos + 10);
    const compressedSize = readUint32LE(buf, pos + 20);
    const uncompressedSize = readUint32LE(buf, pos + 24);
    const nameLen = readUint16LE(buf, pos + 28);
    const extraLen = readUint16LE(buf, pos + 30);
    const commentLen = readUint16LE(buf, pos + 32);
    const startDisk = readUint16LE(buf, pos + 34);
    const localHeaderOffset = readUint32LE(buf, pos + 42);
    const entryEnd = pos + 46 + nameLen + extraLen + commentLen;
    if (entryEnd > eocdOffset) {
      throw new Error("ZIP central directory entry exceeds the uploaded file");
    }
    if (startDisk !== 0 || localHeaderOffset === 0xffffffff) {
      throw new Error("Multi-disk and ZIP64 archives are not supported");
    }
    if ((flags & 0x1) !== 0) {
      throw new Error("Encrypted DOCX archives are not supported");
    }
    if (uncompressedSize > MAX_SINGLE_ZIP_ENTRY_BYTES) {
      throw new Error(`ZIP entry exceeds the ${MAX_SINGLE_ZIP_ENTRY_BYTES / 1024 / 1024} MB decompressed limit`);
    }
    if (
      uncompressedSize > 1024 * 1024
      && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      throw new Error(`ZIP entry exceeds the ${MAX_COMPRESSION_RATIO}:1 compression-ratio limit`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(`ZIP exceeds the ${MAX_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024} MB total decompressed limit`);
    }
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    if (entries.has(name)) throw new Error(`ZIP contains duplicate entry "${name}"`);
    entries.set(name, {
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      dataOffset: localHeaderOffset,
    });
    pos = entryEnd;
  }
  if (pos !== cdOffset + cdSize) {
    throw new Error("ZIP central directory size does not match its entries");
  }
  return entries;
}

/**
 * Read and decompress a file from a ZIP buffer.
 */
function readZipEntry(
  buf: Buffer,
  entry: ZipEntry,
  maxOutputBytes = MAX_SINGLE_ZIP_ENTRY_BYTES,
): Buffer {
  // Local file header: signature(4) + version(2) + flag(2) + method(2) + modtime(4) + crc(4)
  // + compSize(4) + uncompSize(4) + nameLen(2) + extraLen(2) = 30 bytes
  const LFH_OFFSET = entry.dataOffset;
  if (LFH_OFFSET < 0 || LFH_OFFSET + 30 > buf.length) {
    throw new Error(`Local file header is outside the uploaded file for ${entry.name}`);
  }
  if (readUint32LE(buf, LFH_OFFSET) !== 0x04034b50) {
    throw new Error(`Invalid local file header for ${entry.name}`);
  }
  const localFlags = readUint16LE(buf, LFH_OFFSET + 6);
  const localMethod = readUint16LE(buf, LFH_OFFSET + 8);
  if ((localFlags & 0x1) !== 0 || localFlags !== entry.flags) {
    throw new Error(`Unsupported or inconsistent ZIP flags for ${entry.name}`);
  }
  if (localMethod !== entry.method) {
    throw new Error(`Inconsistent ZIP compression method for ${entry.name}`);
  }
  if (entry.uncompressedSize > maxOutputBytes) {
    throw new Error(`${entry.name} exceeds the ${maxOutputBytes / 1024 / 1024} MB decompressed limit`);
  }
  const nameLen = readUint16LE(buf, LFH_OFFSET + 26);
  const extraLen = readUint16LE(buf, LFH_OFFSET + 28);
  const dataStart = LFH_OFFSET + 30 + nameLen + extraLen;
  if (dataStart > buf.length || entry.compressedSize > buf.length - dataStart) {
    throw new Error(`Compressed data is outside the uploaded file for ${entry.name}`);
  }
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  let output: Buffer;
  if (entry.method === 0) {
    output = Buffer.from(compressed);
  } else if (entry.method === 8) {
    output = zlib.inflateRawSync(compressed, { maxOutputLength: maxOutputBytes });
  } else {
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
  }
  if (output.length !== entry.uncompressedSize) {
    throw new Error(`Decompressed size does not match ZIP metadata for ${entry.name}`);
  }
  if (output.length > maxOutputBytes) {
    throw new Error(`${entry.name} exceeds the ${maxOutputBytes / 1024 / 1024} MB decompressed limit`);
  }
  return output;
}

// ── XML parsing (word/document.xml) ──────────────────────────────────────────

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function getAttr(attrs: Record<string, string>, localName: string, ns: string): string | undefined {
  // Try {ns}localName, then w:localName
  return attrs[`{${ns}}${localName}`] ?? attrs[`w:${localName}`];
}

interface ParsedPara {
  style: string | null;
  isList: boolean;
  text: string;
}

interface ParsedTable {
  rows: string[][];
}

type DocElement =
  | { kind: "para"; data: ParsedPara }
  | { kind: "table"; data: ParsedTable };

/**
 * Parse word/document.xml XML into a flat list of paragraphs and tables.
 * Uses a hand-written SAX-style traversal for robustness.
 */
function parseDocumentXml(xml: string): DocElement[] {
  const elements: DocElement[] = [];

  // We'll use a simple recursive-descent XML parser
  const parser = new XMLParser(xml);
  const doc = parser.parse();

  function findAll(node: ReturnType<XMLParser["parse"]>, localName: string, ns: string): typeof node[] {
    const results: typeof node[] = [];
    function visit(n: typeof node) {
      if (n.localName === localName && (n.ns === ns || n.ns === "")) results.push(n);
      for (const child of n.children) visit(child);
    }
    visit(node);
    return results;
  }

  function findFirst(node: ReturnType<XMLParser["parse"]>, localName: string, ns: string): ReturnType<XMLParser["parse"]> | null {
    function visit(n: ReturnType<XMLParser["parse"]>): ReturnType<XMLParser["parse"]> | null {
      if (n.localName === localName && (n.ns === ns || n.ns === "")) return n;
      for (const child of n.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    return visit(node);
  }

  function paraText(pNode: ReturnType<XMLParser["parse"]>): string {
    const parts: string[] = [];
    const tNodes = findAll(pNode, "t", W_NS);
    for (const t of tNodes) {
      parts.push(t.text ?? "");
    }
    return parts.join("").trim();
  }

  function paraStyle(pNode: ReturnType<XMLParser["parse"]>): string | null {
    const pPr = findFirst(pNode, "pPr", W_NS);
    if (!pPr) return null;
    const pStyle = findFirst(pPr, "pStyle", W_NS);
    if (!pStyle) return null;
    return pStyle.attrs["w:val"] ?? pStyle.attrs[`{${W_NS}}val`] ?? null;
  }

  function isList(pNode: ReturnType<XMLParser["parse"]>): boolean {
    const pPr = findFirst(pNode, "pPr", W_NS);
    if (!pPr) return false;
    return findFirst(pPr, "numPr", W_NS) !== null;
  }

  function tableText(tblNode: ReturnType<XMLParser["parse"]>): ParsedTable {
    const rows: string[][] = [];
    const trNodes = tblNode.children.filter((c) => c.localName === "tr" && (c.ns === W_NS || c.ns === ""));
    for (const tr of trNodes) {
      const cells: string[] = [];
      const tcNodes = tr.children.filter((c) => c.localName === "tc" && (c.ns === W_NS || c.ns === ""));
      for (const tc of tcNodes) {
        const pNodes = tc.children.filter((c) => c.localName === "p" && (c.ns === W_NS || c.ns === ""));
        const cellText = pNodes.map((p) => paraText(p)).filter(Boolean).join(" ");
        cells.push(cellText);
      }
      rows.push(cells);
    }
    return { rows };
  }

  // Traverse direct body children
  const bodyNode = findFirst(doc, "body", W_NS);
  if (!bodyNode) throw new Error("word/document.xml: no w:body found");

  for (const child of bodyNode.children) {
    if (child.localName === "p" && (child.ns === W_NS || child.ns === "")) {
      elements.push({
        kind: "para",
        data: {
          style: paraStyle(child),
          isList: isList(child),
          text: paraText(child),
        },
      });
    } else if (child.localName === "tbl" && (child.ns === W_NS || child.ns === "")) {
      elements.push({ kind: "table", data: tableText(child) });
    }
  }

  return elements;
}

// ── Section assembly ──────────────────────────────────────────────────────────

interface Section {
  level: number;
  heading: string;
  path: string[];
  lines: string[];
}

const HEADING_RE = /^Heading(\d)$/;

function assembleSections(elements: DocElement[]): Section[] {
  const sections: Section[] = [];
  let cur: Section = { level: 0, heading: "", path: [], lines: [] };
  const headingStack: Array<[number, string]> = [];

  for (const el of elements) {
    if (el.kind === "table") {
      const rowTexts = el.data.rows.map((cells) => cells.join(" | ")).join("\n");
      if (rowTexts.trim()) cur.lines.push(rowTexts);
      continue;
    }
    const { style, isList: list, text } = el.data;
    const m = HEADING_RE.exec(style ?? "");
    if ((m || style === "Title") && text) {
      const lvl = m ? parseInt(m[1], 10) : 0;
      if (cur.lines.length > 0 || cur.heading) sections.push({ ...cur });
      // Pop heading stack to current level
      const newStack = headingStack.filter(([l]) => l < lvl);
      newStack.push([lvl, text]);
      headingStack.length = 0;
      headingStack.push(...newStack);
      cur = { level: lvl, heading: text, path: newStack.map(([, t]) => t), lines: [] };
    } else if (text) {
      cur.lines.push((list ? "- " : "") + text);
    }
  }
  if (cur.lines.length > 0 || cur.heading) sections.push({ ...cur });
  return sections;
}

// ── Chunk assembly ────────────────────────────────────────────────────────────

export interface ParsedChunk {
  docTitle: string;
  docType: string;
  ageGroup: string;
  heading: string;
  headingPath: string;
  content: string;
  sortOrder: number;
  id: string;
}

function makeChunkId(docTitle: string, headingPath: string, content: string): string {
  return crypto
    .createHash("sha1")
    .update(`${docTitle}|${headingPath}|${content}`)
    .digest("hex")
    .slice(0, 16);
}

function splitLargeChunk(base: ParsedChunk): ParsedChunk[] {
  if (base.content.length <= 6000) return [base];
  const paras = base.content.split("\n");
  const parts: ParsedChunk[] = [];
  let buf: string[] = [];
  let size = 0;
  let partNum = 1;

  for (const para of paras) {
    if (size + para.length > 5500 && buf.length > 0) {
      const content = buf.join("\n");
      const heading = `${base.heading} (part ${partNum})`;
      const headingPath = base.headingPath;
      parts.push({
        ...base,
        content,
        heading,
        id: makeChunkId(base.docTitle, headingPath, content),
      });
      partNum++;
      buf = [];
      size = 0;
    }
    buf.push(para);
    size += para.length + 1;
  }
  if (buf.length > 0) {
    const content = buf.join("\n");
    const heading = partNum > 1 ? `${base.heading} (part ${partNum})` : base.heading;
    parts.push({
      ...base,
      content,
      heading,
      id: makeChunkId(base.docTitle, base.headingPath, content),
    });
  }
  return parts;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DocxParseOptions {
  docTitle: string;
  docType: string;
  ageGroup: string;
}

const MAX_DOCX_BYTES = 15 * 1024 * 1024; // 15 MB decoded

/**
 * Validate DOCX bytes (must be a ZIP containing word/document.xml).
 * Returns a human-readable error string or null when valid.
 */
export function validateDocxBytes(buf: Buffer, filename: string): string | null {
  if (!filename.toLowerCase().endsWith(".docx")) {
    return "File must have a .docx extension";
  }
  if (buf.length > MAX_DOCX_BYTES) {
    return `Decoded file is ${(buf.length / 1024 / 1024).toFixed(1)} MB, maximum is 15 MB`;
  }
  // Quick ZIP magic check
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return "File is not a valid ZIP/DOCX (missing PK header)";
  }
  try {
    const entries = parseZipEntries(buf);
    const documentXml = entries.get("word/document.xml");
    if (!documentXml) {
      return "File is not a valid DOCX: word/document.xml not found inside ZIP";
    }
    // Validate the compressed stream under a hard output cap before parsing.
    readZipEntry(buf, documentXml, MAX_DOCUMENT_XML_BYTES);
  } catch (err) {
    return `File is not a valid DOCX ZIP: ${(err as Error).message}`;
  }
  return null;
}

/**
 * Parse DOCX bytes into curriculum chunks.
 * Throws if the file is invalid or produces no chunks.
 */
export function parseDocxBuffer(buf: Buffer, opts: DocxParseOptions): ParsedChunk[] {
  const entries = parseZipEntries(buf);
  const xmlEntry = entries.get("word/document.xml");
  if (!xmlEntry) throw new Error("word/document.xml not found");

  const xmlBuf = readZipEntry(buf, xmlEntry, MAX_DOCUMENT_XML_BYTES);
  const xmlStr = xmlBuf.toString("utf8");

  const elements = parseDocumentXml(xmlStr);
  const sections = assembleSections(elements);

  const rawChunks: ParsedChunk[] = [];
  let order = 0;
  for (const s of sections) {
    const content = s.lines.join("\n").trim();
    if (!content && !s.heading) continue;
    if (!content) continue; // heading-only container

    const headingPath = s.level === 0
      ? ""
      : s.path.length > 0
      ? s.path.join(" > ")
      : (s.heading || opts.docTitle);

    rawChunks.push({
      docTitle: opts.docTitle,
      docType: opts.docType,
      ageGroup: opts.ageGroup,
      heading: s.heading || opts.docTitle,
      headingPath,
      content,
      sortOrder: order++,
      id: makeChunkId(opts.docTitle, headingPath, content),
    });
  }

  // Split large chunks
  const finalChunks: ParsedChunk[] = [];
  for (const chunk of rawChunks) {
    finalChunks.push(...splitLargeChunk(chunk));
  }

  if (finalChunks.length === 0) {
    throw new Error("DOCX produced no content chunks — file appears to be empty");
  }
  return finalChunks;
}

/**
 * Parse a base64-encoded DOCX string.
 * Returns the chunks on success, or throws with a user-facing error.
 */
export function parseDocxBase64(
  base64: string,
  filename: string,
  opts: DocxParseOptions,
): ParsedChunk[] {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new Error("base64 decode failed — malformed upload data");
  }
  const validationError = validateDocxBytes(buf, filename);
  if (validationError) throw new Error(validationError);
  return parseDocxBuffer(buf, opts);
}
