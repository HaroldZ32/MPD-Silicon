// src/index.ts
import { dshSeamInject, DSH_SEAM_TOOLS } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";

// src/tool-xlsx.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// src/labels.ts
var LABELS = {
  "zh-CN": {
    chapterTitle: "寄存器",
    offsetLine: "地址偏移：",
    resetLine: "复位值：",
    detailHeaders: ["位域", "名称", "描述"],
    overviewHeaders: ["Offset", "Register", "31..0"],
    reservedDesc: "保留，必须保持复位值"
  },
  en: {
    chapterTitle: "Registers",
    offsetLine: "Offset: ",
    resetLine: "Reset value: ",
    detailHeaders: ["Bit field", "Name", "Description"],
    overviewHeaders: ["Offset", "Register", "31..0"],
    reservedDesc: "Reserved; keep the reset value"
  }
};
function labelsFor(lang) {
  return LABELS[lang];
}

// src/types.ts
class DocgenError extends Error {
  code;
  hint;
  constructor(code, message, hint) {
    super(message);
    this.name = "DocgenError";
    this.code = code;
    this.hint = hint;
  }
}
function isDocgenError(value) {
  return value instanceof DocgenError;
}

// src/registers.ts
var RESERVED_NAME = "RESERVED";
var ACCESS_CODES = [
  "rw",
  "ro",
  "wo",
  "w1",
  "w1c",
  "rc",
  "rs",
  "wrc",
  "wrs",
  "wc",
  "ws",
  "wsrc",
  "wcrs",
  "w1s",
  "w1t",
  "w0c",
  "w0s",
  "w0t",
  "w1src",
  "w1crs",
  "w0src",
  "w0crs",
  "woc",
  "wos",
  "wo1"
];
function isReservedName(name) {
  return name.trim().toUpperCase() === RESERVED_NAME;
}
function hexlen(width) {
  return Math.max(1, Math.ceil(width / 4));
}
function bitRangeText(field) {
  return field.hi === field.lo ? String(field.hi) : field.hi + ":" + field.lo;
}
function fieldLabel(field) {
  const width = field.hi - field.lo + 1;
  if (width === 32 || width === 1)
    return field.name;
  return field.name + "[" + field.hi + ":" + field.lo + "]";
}
function parseResetHex(raw) {
  const match = /0x([0-9A-Fa-f\s]+)/.exec(raw);
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", "cannot parse reset value " + JSON.stringify(raw), "write the reset value as 0x... (hex digits may be space-grouped)");
  }
  const digits = match[1].replace(/\s+/g, "").toUpperCase();
  if (digits.length === 0) {
    throw new DocgenError("DOCGEN_E_PARSE", "reset value has no hex digits: " + JSON.stringify(raw), "write the reset value as 0x...");
  }
  if (digits.length > 8) {
    throw new DocgenError("DOCGEN_E_PARSE", "reset value has " + digits.length + " hex digits (max 8): " + JSON.stringify(raw), "a register is at most 32 bits wide");
  }
  return { digits, value: parseInt(digits, 16) };
}
function normaliseResetValue(value, is32) {
  const digits = is32 ? 8 : 4;
  return "0x" + (value >>> 0).toString(16).toUpperCase().padStart(digits, "0");
}
function fieldResetValue(value, hi, lo) {
  const width = hi - lo + 1;
  const mask = width >= 32 ? 4294967295 : (1 << width) - 1;
  const extracted = (value >>> lo & mask) >>> 0;
  return width + "'h" + extracted.toString(16).toUpperCase().padStart(hexlen(width), "0");
}
function normaliseOffset(raw) {
  const match = /^\s*(?:0x)?([0-9A-Fa-f]+)h?\s*$/.exec(raw);
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", "cannot parse register offset " + JSON.stringify(raw), "write the offset as 0x... (or the overview form 000h)");
  }
  const digits = match[1].toUpperCase();
  return "0x" + (digits.length < 2 ? digits.padStart(2, "0") : digits);
}
function offsetNumber(raw) {
  const match = /^\s*(?:0x)?([0-9A-Fa-f]+)h?\s*$/.exec(raw);
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", "cannot parse register offset " + JSON.stringify(raw), "write the offset as 0x... (or the overview form 000h)");
  }
  return parseInt(match[1], 16);
}
function gapFillFields(fields, reservedDesc) {
  const covered = new Array(32).fill(false);
  for (const field of fields) {
    for (let bit = Math.max(0, field.lo);bit <= Math.min(31, field.hi); bit++)
      covered[bit] = true;
  }
  const synthesized = [];
  let lo = 0;
  while (lo <= 31) {
    if (covered[lo]) {
      lo++;
      continue;
    }
    let hi = lo;
    while (hi + 1 <= 31 && !covered[hi + 1])
      hi++;
    synthesized.push({ hi, lo, name: RESERVED_NAME, access: "", desc: reservedDesc, reserved: true });
    lo = hi + 1;
  }
  const merged = [...fields, ...synthesized].sort((a, b) => b.hi - a.hi);
  return mergeAdjacentReserved(merged, reservedDesc);
}
function mergeAdjacentReserved(fields, reservedDesc) {
  let result = [...fields].sort((a, b) => b.hi - a.hi);
  let changed = true;
  while (changed) {
    changed = false;
    const merged = [];
    let i = 0;
    while (i < result.length) {
      const current = result[i];
      const next = i + 1 < result.length ? result[i + 1] : undefined;
      const currentReserved = current.reserved || isReservedName(current.name);
      const nextReserved = next !== undefined && (next.reserved || isReservedName(next.name));
      if (next !== undefined && currentReserved && nextReserved && current.lo === next.hi + 1) {
        merged.push({ hi: current.hi, lo: next.lo, name: RESERVED_NAME, access: "", desc: reservedDesc, reserved: true });
        i += 2;
        changed = true;
        continue;
      }
      merged.push(current);
      i++;
    }
    result = merged;
  }
  return result;
}
function canonicaliseRegisters(registers, lang = "zh-CN") {
  const reservedDesc = labelsFor(lang).reservedDesc;
  const seenNames = new Set;
  return registers.map((register) => {
    const name = register.name.trim();
    if (name.length === 0) {
      throw new DocgenError("DOCGEN_E_PARSE", "register has an empty name", "write the heading as ### <title>(<REG_NAME>)");
    }
    if (seenNames.has(name)) {
      throw new DocgenError("DOCGEN_E_PARSE", "duplicate register name: " + name, "each register name must appear once in the register chapter");
    }
    seenNames.add(name);
    const offset = normaliseOffset(register.offset);
    const { digits, value } = parseResetHex(register.reset);
    const width = digits.length === 8 ? 32 : 16;
    if (width === 16 && value > 65535) {
      throw new DocgenError("DOCGEN_E_PARSE", "register " + name + ": reset value does not fit 16 bits", "use 8 hex digits for a 32-bit register");
    }
    const covered = new Array(32).fill(false);
    const fields = register.fields.map((raw) => {
      const hi = Number(raw.hi);
      const lo = Number(raw.lo);
      if (!Number.isInteger(hi) || !Number.isInteger(lo)) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": non-integer bit range " + raw.hi + ":" + raw.lo, "write the bit range as N or N:M");
      }
      if (hi < lo) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": bit range " + bitRangeText({ hi, lo }) + " has the high bit below the low bit", "write the range high:low");
      }
      if (lo < 0 || hi > 31) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": bit range " + bitRangeText({ hi, lo }) + " is outside [31:0]", "keep fields inside [31:0]");
      }
      for (let bit = lo;bit <= hi; bit++) {
        if (covered[bit]) {
          throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": bit range " + bitRangeText({ hi, lo }) + " overlaps another field", "field spans must not overlap");
        }
        covered[bit] = true;
      }
      const trimmedName = raw.name.trim();
      if (trimmedName.length === 0) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": field " + bitRangeText({ hi, lo }) + " has an empty name", "give every field a name (RESERVED for reserved bits)");
      }
      const reserved = raw.reserved || isReservedName(trimmedName);
      const access = reserved ? "" : raw.access.trim().toLowerCase();
      if (!reserved) {
        if (access.length === 0) {
          throw new DocgenError("DOCGEN_E_ACCESS", "register " + name + ": field " + trimmedName + " has no access code", "use one of the 25 access abbreviations (rw, ro, w1c, ...)");
        }
        if (!ACCESS_CODES.includes(access)) {
          throw new DocgenError("DOCGEN_E_ACCESS", "register " + name + ": unknown access code " + JSON.stringify(raw.access) + " on field " + trimmedName, "use one of: " + ACCESS_CODES.join(", "));
        }
      }
      const desc = reserved ? reservedDesc : raw.desc.replace(/<br\s*\/?>/gi, `
`).trim();
      return { hi, lo, name: trimmedName, access, desc, reserved };
    });
    const filled = gapFillFields(fields, reservedDesc);
    let union = 0;
    let previousLo = 32;
    for (const field of filled) {
      if (field.hi >= previousLo) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": canonical fields are not strictly descending at " + bitRangeText(field), "this is an internal canonicalisation defect");
      }
      previousLo = field.lo;
      const span = field.hi - field.lo + 1;
      union = (union | (span >= 32 ? 4294967295 : (1 << span) - 1 << field.lo >>> 0)) >>> 0;
    }
    if (union !== 4294967295) {
      throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": fields do not cover [31:0] after gap filling", "this is an internal canonicalisation defect");
    }
    return {
      name,
      title: register.title.trim(),
      offset,
      reset: normaliseResetValue(value, width === 32),
      width,
      fields: filled
    };
  });
}

// src/markdown.ts
var REGISTER_CHAPTER_TITLES = { "zh-CN": "寄存器", en: "Registers" };
var OVERVIEW_TITLES = ["寄存器总览", "Registers overview"];
var CANONICAL_HEADING = /^###\s+(.+?)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/;
var LEGACY_HEADING = /^###\s+寄存器\d+\s*（([^）]+)）\s*——\s*(.+?)\s*$/;
var OFFSET_LINE = /^\s*(?:偏移地址：|Offset:)\s*(0x[0-9A-Fa-f]+)/;
var RESET_LINE = /^\s*(?:复位值：|Reset value:)\s*(0x[0-9A-Fa-f\s]+)/;
var FIELD_TABLE_HEADER = /^\s*\|\s*(?:位域|Bits?)\s*\|/i;
var H2 = /^##\s+(.+?)\s*$/;
function splitRow(line) {
  let text = line.trim();
  if (text.startsWith("|"))
    text = text.slice(1);
  if (text.endsWith("|"))
    text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}
function isTableSeparator(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}
function parseBitRange(raw, context) {
  const match = /^\[?(\d{1,2})(?::(\d{1,2}))?\]?$/.exec(raw.trim());
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", context + ": cannot parse bit range " + JSON.stringify(raw), "write the bit field as N or N:M");
  }
  const hi = parseInt(match[1], 10);
  const lo = match[2] === undefined ? hi : parseInt(match[2], 10);
  return { hi, lo };
}
function findRegisterChapter(lines) {
  const wanted = new Set([REGISTER_CHAPTER_TITLES["zh-CN"].toLowerCase(), REGISTER_CHAPTER_TITLES.en.toLowerCase()]);
  for (let i = 0;i < lines.length; i++) {
    const match = H2.exec(lines[i]);
    if (!match || !wanted.has(match[1].toLowerCase()))
      continue;
    let end = lines.length;
    for (let j = i + 1;j < lines.length; j++) {
      if (H2.exec(lines[j])) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return null;
}
function overviewOffsetValue(raw) {
  const text = raw.trim();
  const templateForm = /^0*([0-9A-Fa-f]+)h$/.exec(text);
  return offsetNumber(templateForm === null ? text : "0x" + templateForm[1]);
}
function offsetText(value) {
  return "0x" + value.toString(16).toUpperCase().padStart(2, "0");
}
function isOverviewPlaceholder(name, offset, parsed) {
  if (name.trim() === "")
    return true;
  if (/^IP_REG\d+$/i.test(name))
    return true;
  return offset === 0 && !parsed.has(name);
}
function parseOverview(lines) {
  const headingIndex = lines.findIndex((line) => {
    const match = /^###\s+(.+?)\s*$/.exec(line);
    return match !== null && OVERVIEW_TITLES.some((title) => title.toLowerCase() === match[1].toLowerCase());
  });
  if (headingIndex < 0)
    return null;
  const tableStart = lines.findIndex((line, index) => index > headingIndex && line.trimStart().startsWith("|"));
  if (tableStart < 0)
    return null;
  const overview = new Map;
  for (let i = tableStart;i < lines.length; i++) {
    const line = lines[i];
    if (!line.trimStart().startsWith("|"))
      break;
    const cells = splitRow(line);
    if (cells.length < 2)
      continue;
    const offset = cells[0];
    const name = cells[1];
    if (offset === "" || name === "" || /^reset value$/i.test(name))
      continue;
    if (!/^(?:0x)?[0-9A-Fa-f]+h?$/.test(offset))
      continue;
    overview.set(name, overviewOffsetValue(offset));
  }
  return overview;
}
function parseFieldTable(body, context) {
  const headerIndex = body.findIndex((line) => FIELD_TABLE_HEADER.test(line));
  if (headerIndex < 0) {
    throw new DocgenError("DOCGEN_E_PARSE", context + ": field table not found", "add a table whose header is | 位域 | 名称 | 读写属性 | 描述 | (en: | Bits | Name | Access | Description |)");
  }
  const fields = [];
  for (let i = headerIndex + 1;i < body.length; i++) {
    const line = body[i];
    if (/^###\s/.test(line))
      break;
    const trimmed = line.trim();
    if (trimmed === "") {
      if (fields.length > 0)
        break;
      continue;
    }
    if (!trimmed.startsWith("|"))
      break;
    if (isTableSeparator(line))
      continue;
    const cells = splitRow(line);
    if (cells.length < 4) {
      throw new DocgenError("DOCGEN_E_PARSE", context + ": field row needs 4 columns, got " + cells.length + ": " + JSON.stringify(line), "write | bits | name | access | description |");
    }
    const { hi, lo } = parseBitRange(cells[0], context);
    const name = cells[1].trim();
    const access = cells[2].trim();
    const desc = cells.slice(3).join("|").replace(/<br\s*\/?>/gi, `
`).trim();
    fields.push({ hi, lo, name, access, desc, reserved: isReservedName(name) });
  }
  return fields;
}
function parseRegisterChapter(lines, start, end, lang) {
  const overview = parseOverview(lines.slice(start, end));
  const chapter = lines.slice(start + 1, end);
  const headings = [];
  for (let i = 0;i < chapter.length; i++) {
    const line = chapter[i];
    const legacy = LEGACY_HEADING.exec(line);
    if (legacy) {
      headings.push({ index: i, name: legacy[1].trim(), title: legacy[2].trim() });
      continue;
    }
    const canonical = CANONICAL_HEADING.exec(line);
    if (canonical)
      headings.push({ index: i, name: canonical[2].trim(), title: canonical[1].trim() });
  }
  const registers = headings.map((heading, position) => {
    const bodyEnd = position + 1 < headings.length ? headings[position + 1].index : chapter.length;
    const body = chapter.slice(heading.index + 1, bodyEnd);
    const context = "register " + heading.name;
    let offset = "";
    let reset = "";
    for (const line of body) {
      if (offset === "") {
        const match = OFFSET_LINE.exec(line);
        if (match)
          offset = normaliseOffset(match[1]);
      }
      if (reset === "") {
        const match = RESET_LINE.exec(line);
        if (match)
          reset = match[1];
      }
    }
    if (offset === "") {
      throw new DocgenError("DOCGEN_E_PARSE", context + ": missing offset line", "add 偏移地址：0x.. (en: Offset: 0x..) under the register heading");
    }
    if (reset === "") {
      throw new DocgenError("DOCGEN_E_PARSE", context + ": missing reset value line", "add 复位值：0x.. (en: Reset value: 0x..) under the register heading");
    }
    return { name: heading.name, title: heading.title, offset, reset, width: 16, fields: parseFieldTable(body, context) };
  });
  const warnings = [];
  const parsed = new Map(registers.map((register) => [register.name, register]));
  if (overview !== null) {
    for (const register of registers) {
      const expected = overview.get(register.name);
      if (expected === undefined) {
        warnings.push("register " + register.name + " is missing from the overview table (chapter offset " + register.offset + ")");
        continue;
      }
      const actual = offsetNumber(register.offset);
      if (expected !== actual) {
        warnings.push("register " + register.name + ": overview offset " + offsetText(expected) + " disagrees with chapter offset " + register.offset);
      }
    }
    for (const [name, offset] of overview) {
      if (parsed.has(name) || isOverviewPlaceholder(name, offset, parsed))
        continue;
      warnings.push("overview register " + name + " has no register chapter (overview offset " + offsetText(offset) + ")");
    }
  }
  return { registers: canonicaliseRegisters(registers, lang), warnings };
}
function tokenizeBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)\s*([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const marker = fence[1];
      const closing = new RegExp("^\\s*" + marker + "\\s*$");
      const body = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length)
        i++;
      blocks.push({ kind: "fence", lang: fence[2] ?? "", text: body.join(`
`) });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push({ kind: "heading", level, text: heading[2].trim() });
      i++;
      continue;
    }
    if (line.trimStart().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const items = [];
      while (i < lines.length) {
        const match = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!match || /^\d/.test(match[1]) !== ordered)
          break;
        items.push(match[2].trim());
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph = [];
    while (i < lines.length) {
      const current = lines[i];
      if (current.trim() === "")
        break;
      if (/^(#{1,6})\s+/.test(current))
        break;
      if (/^\s*(```|~~~)/.test(current))
        break;
      if (current.trimStart().startsWith("|"))
        break;
      if (/^\s*([-*+]|\d+[.)])\s+/.test(current))
        break;
      paragraph.push(current.trim());
      i++;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(`
`) });
  }
  return blocks;
}
function parseManual(text, lang) {
  const lines = text.replace(/\r\n?/g, `
`).split(`
`);
  let title = "";
  let titleIndex = -1;
  for (let i = 0;i < lines.length; i++) {
    const match = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (match) {
      title = match[1];
      titleIndex = i;
      break;
    }
  }
  const chapter = findRegisterChapter(lines);
  const chapterResult = chapter === null ? { registers: [], warnings: [] } : parseRegisterChapter(lines, chapter.start, chapter.end, lang);
  const excluded = new Set;
  if (titleIndex >= 0)
    excluded.add(titleIndex);
  if (chapter !== null) {
    for (let i = chapter.start;i < chapter.end; i++)
      excluded.add(i);
  }
  const blocks = tokenizeBlocks(lines.filter((_, index) => !excluded.has(index)));
  return { title, blocks, registers: chapterResult.registers, warnings: chapterResult.warnings, lang };
}

// src/paths.ts
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { workspaceRootOf } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";
var DEFAULT_OUTPUT_DIR = "docs";
var tempSequence = 0;
function workspaceRoot(exec) {
  return resolve(workspaceRootOf(exec));
}
function resolveInputPath(path, exec) {
  return isAbsolute(path) ? resolve(path) : resolve(workspaceRoot(exec), path);
}
function resolveOutputPath(path, exec) {
  return resolveInputPath(path, exec);
}
function resolveOutputDir(dir, exec) {
  const chosen = dir !== undefined && dir.trim() !== "" ? dir : DEFAULT_OUTPUT_DIR;
  return resolveOutputPath(chosen, exec);
}
function regExcelFileName(ip) {
  return ip + "_regExcel_full.xlsx";
}
function docxFileName(ip, lang) {
  return ip + "_reg_user_manual." + lang + ".docx";
}
var IP_WORD = /[A-Za-z0-9][A-Za-z0-9._-]*/;
function sanitiseSlug(text) {
  return text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}
function ipSlug(title, override) {
  const explicit = sanitiseSlug((override ?? "").trim());
  if (explicit !== "")
    return explicit;
  const word = IP_WORD.exec(title ?? "");
  return word === null ? "ip" : sanitiseSlug(word[0]);
}
function atomicWriteFile(path, data, mode = 420) {
  const target = resolve(path);
  const temp = target + ".tmp-" + process.pid + "-" + tempSequence++;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temp, data, { mode });
    renameSync(temp, target);
    chmodSync(target, mode);
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch {}
    throw new DocgenError("DOCGEN_E_IO", "cannot write " + target + ": " + (error instanceof Error ? error.message : String(error)), "check that the output directory is writable and the target path is valid");
  }
  return target;
}

// src/xml.ts
var INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
function escapeXml(text) {
  return String(text).replace(INVALID_XML_CHARS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function escapeAttr(text) {
  return escapeXml(text);
}
function attrs(entries) {
  let out = "";
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined)
      continue;
    out += " " + key + '="' + escapeAttr(String(value)) + '"';
  }
  return out;
}
function xmlDeclaration() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}
function element(name, attributes = {}, content) {
  const open = "<" + name + attrs(attributes);
  if (content === undefined)
    return open + "/>";
  return open + ">" + content + "</" + name + ">";
}

// src/zip.ts
import { deflateRawSync, inflateRawSync } from "node:zlib";
var LOCAL_SIG = 67324752;
var CENTRAL_SIG = 33639248;
var EOCD_SIG = 101010256;
var VERSION = 20;
var FLAG_UTF8 = 2048;
var METHOD_DEFLATE = 8;
var METHOD_STORE = 0;
var DEFLATE_LEVEL = 9;
var DOS_TIME_1980 = 0;
var DOS_DATE_1980 = 33;
var CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0;n < 256; n++) {
    let c = n;
    for (let k = 0;k < 8; k++)
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data) {
  let crc = 4294967295;
  for (let i = 0;i < data.length; i++)
    crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function compareNames(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
function buildZip(entries) {
  const sorted = [...entries].sort((a, b) => compareNames(a.name, b.name));
  const seen = new Set;
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    if (entry.name.length === 0) {
      throw new DocgenError("DOCGEN_E_ZIP", "zip entry has an empty name", "every archive member needs a non-empty name");
    }
    if (seen.has(entry.name)) {
      throw new DocgenError("DOCGEN_E_ZIP", "duplicate zip entry name: " + entry.name, "archive member names must be unique");
    }
    seen.add(entry.name);
    const nameBytes = Buffer.from(entry.name, "utf8");
    if (nameBytes.length > 65535) {
      throw new DocgenError("DOCGEN_E_ZIP", "zip entry name is too long: " + entry.name, "keep entry names under 64 KiB");
    }
    const raw = Buffer.from(entry.data);
    const compressed = deflateRawSync(raw, { level: DEFLATE_LEVEL });
    const useDeflate = compressed.length < raw.length;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const payload = useDeflate ? compressed : raw;
    const crc = crc32(raw);
    if (offset > 4294967295 || raw.length > 4294967295) {
      throw new DocgenError("DOCGEN_E_ZIP", "archive exceeds the 4 GiB ZIP32 limit", "split the archive");
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME_1980, 10);
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME_1980, 12);
    central.writeUInt16LE(DOS_DATE_1980, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize > 4294967295) {
    throw new DocgenError("DOCGEN_E_ZIP", "archive exceeds the 4 GiB ZIP32 limit", "split the archive");
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, eocd]));
}
function findEocd(buf) {
  const lowest = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22;i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG)
      return i;
  }
  throw new DocgenError("DOCGEN_E_ZIP", "not a ZIP archive: no end-of-central-directory record", "the file is truncated or not a zip");
}
function readZip(data) {
  const buf = Buffer.from(data);
  if (buf.length < 22) {
    throw new DocgenError("DOCGEN_E_ZIP", "not a ZIP archive: shorter than an end-of-central-directory record", "the file is truncated or not a zip");
  }
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buf.length) {
    throw new DocgenError("DOCGEN_E_ZIP", "ZIP central directory lies outside the file", "the file is truncated");
  }
  const out = new Map;
  let p = centralOffset;
  for (let i = 0;i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new DocgenError("DOCGEN_E_ZIP", "ZIP central directory entry " + i + " is malformed", "the file is corrupted");
    }
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new DocgenError("DOCGEN_E_ZIP", 'ZIP local header for "' + name + '" is malformed', "the file is corrupted");
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buf.length) {
      throw new DocgenError("DOCGEN_E_ZIP", 'ZIP payload for "' + name + '" lies outside the file', "the file is truncated");
    }
    const payload = buf.subarray(dataStart, dataStart + compressedSize);
    let raw;
    if (method === METHOD_STORE)
      raw = Buffer.from(payload);
    else if (method === METHOD_DEFLATE) {
      try {
        raw = inflateRawSync(payload);
      } catch (error) {
        throw new DocgenError("DOCGEN_E_ZIP", 'cannot inflate zip entry "' + name + '": ' + (error instanceof Error ? error.message : String(error)), "the file is corrupted");
      }
    } else
      throw new DocgenError("DOCGEN_E_ZIP", "unsupported ZIP compression method " + method + ' for "' + name + '"', "use deflate or store");
    if (raw.length !== uncompressedSize) {
      throw new DocgenError("DOCGEN_E_ZIP", 'ZIP size mismatch for "' + name + '": expected ' + uncompressedSize + " bytes, got " + raw.length, "the file is corrupted");
    }
    if (crc32(raw) !== crc) {
      throw new DocgenError("DOCGEN_E_ZIP", 'ZIP CRC mismatch for "' + name + '"', "the file is corrupted");
    }
    out.set(name, new Uint8Array(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// src/xlsx.ts
var SHEET_NAME = "Sheet1";
var COLUMN_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
var HEADERS = [
  "register name",
  "field offset",
  "field name",
  "access type",
  "reset value",
  "description（中文描述，请填此列）",
  "skip field test",
  "remarks",
  `register structure = "1"
0 : whole register
1 : aggregated register`
];
var COLUMN_WIDTHS = [21.22, 19.78, 21, 18.44, 18.44, 37.11, 18.89, 22.78, 53.33];
var HEADER_ROW_HEIGHT = 43.2;
var DESCRIPTION_COLUMN = 5;
var STRUCTURE_COLUMN = 8;
var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/;
function hasCjk(text) {
  return CJK_RE.test(text);
}
function buildStyleTable() {
  const styles = [];
  for (const horizontal of ["left", "center"]) {
    for (const wrap of [false, true]) {
      for (const cjk of [false, true]) {
        styles.push({ bold: true, fill: "gray", wrap, horizontal, vertical: "center", cjk });
      }
    }
  }
  for (const wrap of [false, true]) {
    for (const cjk of [false, true])
      styles.push({ bold: true, fill: "yellow", wrap, cjk });
  }
  for (const wrap of [false, true]) {
    for (const cjk of [false, true])
      styles.push({ bold: false, fill: "none", wrap, cjk });
  }
  return styles;
}
var STYLE_TABLE = buildStyleTable();
function styleKey(style) {
  return [style.bold, style.fill, style.wrap, style.horizontal ?? "", style.vertical ?? "", style.cjk].join("|");
}
var STYLE_INDEX = new Map(STYLE_TABLE.map((style, index) => [styleKey(style), index + 1]));
function styleIndex(style) {
  const index = STYLE_INDEX.get(styleKey(style));
  if (index === undefined)
    throw new Error("xlsx style not registered: " + styleKey(style));
  return index;
}
function headerStyle(column, value) {
  return {
    bold: true,
    fill: "gray",
    wrap: column === DESCRIPTION_COLUMN,
    horizontal: column === STRUCTURE_COLUMN ? "center" : "left",
    vertical: "center",
    cjk: hasCjk(value)
  };
}
function registerStyle(column, value) {
  return { bold: true, fill: "yellow", wrap: column === DESCRIPTION_COLUMN, cjk: hasCjk(value ?? "") };
}
function fieldStyle(column, value) {
  return { bold: false, fill: "none", wrap: column === DESCRIPTION_COLUMN, cjk: hasCjk(value ?? "") };
}
function cellXml(reference, value, style) {
  const open = '<c r="' + reference + '" s="' + style + '"';
  if (value === null || value === "")
    return open + "/>";
  return open + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + "</t></is></c>";
}
function rowXml(rowNumber, values, styles, height) {
  const cells = [];
  for (let column = 0;column < COLUMN_LETTERS.length; column++) {
    cells.push(cellXml(COLUMN_LETTERS[column] + rowNumber, values[column] ?? null, styleIndex(styles[column])));
  }
  const heightAttribute = height === undefined ? "" : ' ht="' + String(height) + '" customHeight="1"';
  return '<row r="' + rowNumber + '"' + heightAttribute + ">" + cells.join("") + "</row>";
}
function colsXml() {
  const cols = COLUMN_WIDTHS.map((width, index) => {
    const column = index + 1;
    return '<col min="' + column + '" max="' + column + '" width="' + String(width) + '" customWidth="1"/>';
  });
  return "<cols>" + cols.join("") + "</cols>";
}
function worksheetXml(registers) {
  const rows = [
    rowXml(1, HEADERS, HEADERS.map((value, column) => headerStyle(column, value)), HEADER_ROW_HEIGHT)
  ];
  let rowNumber = 2;
  for (const register of registers) {
    const regValues = [register.name, register.offset, null, "Mixed", register.reset, register.title, null, null, null];
    rows.push(rowXml(rowNumber++, regValues, regValues.map((value, column) => registerStyle(column, value))));
    const reset = parseResetHex(register.reset).value;
    for (const field of register.fields) {
      const fieldValues = [
        null,
        "[" + bitRangeText(field) + "]",
        field.name,
        field.reserved ? null : field.access.toUpperCase(),
        fieldResetValue(reset, field.hi, field.lo),
        field.desc,
        null,
        null,
        null
      ];
      rows.push(rowXml(rowNumber++, fieldValues, fieldValues.map((value, column) => fieldStyle(column, value))));
    }
  }
  const lastRow = rowNumber - 1;
  return xmlDeclaration() + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + '<dimension ref="A1:I' + lastRow + '"/>' + '<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>' + '<sheetFormatPr defaultRowHeight="15"/>' + colsXml() + "<sheetData>" + rows.join("") + "</sheetData>" + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' + "</worksheet>";
}
function fontsXml() {
  return '<fonts count="4">' + '<font><name val="Calibri"/><sz val="11"/></font>' + '<font><name val="Calibri"/><b/><sz val="11"/></font>' + '<font><name val="宋体"/><charset val="134"/><sz val="11"/></font>' + '<font><name val="宋体"/><charset val="134"/><b/><sz val="11"/></font>' + "</fonts>";
}
function fillsXml() {
  return '<fills count="4">' + "<fill><patternFill/></fill>" + '<fill><patternFill patternType="gray125"/></fill>' + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor rgb="FFD9D9D9"/></patternFill></fill>' + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor rgb="FFFFFF00"/></patternFill></fill>' + "</fills>";
}
function bordersXml() {
  return '<borders count="2">' + "<border><left/><right/><top/><bottom/><diagonal/></border>" + '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>' + "</borders>";
}
function alignmentXml(style) {
  const attributes = [];
  if (style.horizontal !== undefined)
    attributes.push('horizontal="' + style.horizontal + '"');
  if (style.vertical !== undefined)
    attributes.push('vertical="' + style.vertical + '"');
  if (style.wrap)
    attributes.push('wrapText="1"');
  return attributes.length === 0 ? "" : "<alignment " + attributes.join(" ") + "/>";
}
function xfXml(style) {
  const fontId = style.cjk ? style.bold ? 3 : 2 : style.bold ? 1 : 0;
  const fillId = style.fill === "gray" ? 2 : style.fill === "yellow" ? 3 : 0;
  const alignment = alignmentXml(style);
  const base = 'numFmtId="0" fontId="' + fontId + '" fillId="' + fillId + '" borderId="1"';
  if (alignment === "")
    return "<xf " + base + ' xfId="0"/>';
  return "<xf " + base + ' applyAlignment="1" xfId="0">' + alignment + "</xf>";
}
function stylesXml() {
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', ...STYLE_TABLE.map(xfXml)];
  return xmlDeclaration() + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + '<numFmts count="0"/>' + fontsXml() + fillsXml() + bordersXml() + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' + '<cellXfs count="' + xfs.length + '">' + xfs.join("") + "</cellXfs>" + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' + '<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>' + "</styleSheet>";
}
function contentTypesXml() {
  return xmlDeclaration() + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' + '<Default Extension="xml" ContentType="application/xml"/>' + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' + "</Types>";
}
function rootRelsXml() {
  return xmlDeclaration() + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' + "</Relationships>";
}
function workbookRelsXml() {
  return xmlDeclaration() + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + "</Relationships>";
}
function workbookXml() {
  return xmlDeclaration() + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + '<bookViews><workbookView activeTab="0"/></bookViews>' + '<sheets><sheet name="' + SHEET_NAME + '" sheetId="1" r:id="rId1"/></sheets>' + "</workbook>";
}
function coreXml(ip) {
  const title = escapeXml(ip + " register workbook");
  const stamp = "1980-01-01T00:00:00Z";
  return xmlDeclaration() + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + "<dc:title>" + title + "</dc:title>" + "<dc:creator>mpd-docgen</dc:creator>" + "<cp:lastModifiedBy>mpd-docgen</cp:lastModifiedBy>" + '<dcterms:created xsi:type="dcterms:W3CDTF">' + stamp + "</dcterms:created>" + '<dcterms:modified xsi:type="dcterms:W3CDTF">' + stamp + "</dcterms:modified>" + "</cp:coreProperties>";
}
function appXml() {
  return xmlDeclaration() + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' + "<Application>mpd-docgen</Application>" + "<DocSecurity>0</DocSecurity>" + "<ScaleCrop>false</ScaleCrop>" + "<Company></Company>" + "<LinksUpToDate>false</LinksUpToDate>" + "<SharedDoc>false</SharedDoc>" + "<HyperlinksChanged>false</HyperlinksChanged>" + "<AppVersion>1.0</AppVersion>" + "</Properties>";
}
function utf8(text) {
  return new TextEncoder().encode(text);
}
function buildXlsx(registers, opts) {
  const entries = [
    { name: "[Content_Types].xml", data: utf8(contentTypesXml()) },
    { name: "_rels/.rels", data: utf8(rootRelsXml()) },
    { name: "docProps/app.xml", data: utf8(appXml()) },
    { name: "docProps/core.xml", data: utf8(coreXml(opts.ip)) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRelsXml()) },
    { name: "xl/styles.xml", data: utf8(stylesXml()) },
    { name: "xl/workbook.xml", data: utf8(workbookXml()) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(worksheetXml(registers)) }
  ];
  return buildZip(entries);
}

// src/tool-xlsx.ts
var TOOL_NAME = "mpd_docgen_register_xlsx";
function refusalOf(error) {
  if (isDocgenError(error)) {
    return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } };
  }
  return {
    ok: false,
    error: {
      code: "DOCGEN_E_INTERNAL",
      message: "unexpected internal error: " + String(error),
      hint: "check the plugin log or retry with a narrower request"
    }
  };
}
function requiredString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocgenError("DOCGEN_E_INPUT", 'missing or empty "' + key + '" argument for ' + TOOL_NAME, "pass " + key + " as a non-empty string");
  }
  return value;
}
function optionalString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "")
    return;
  return value;
}
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new DocgenError("DOCGEN_E_IO", "cannot read " + path + ": " + (error instanceof Error ? error.message : String(error)), "check that the input path exists and is readable");
  }
}
function executeXlsx(args, exec) {
  const inputPath = resolveInputPath(requiredString(args, "input"), exec);
  const manual = parseManual(readText(inputPath), "zh-CN");
  if (manual.registers.length === 0) {
    throw new DocgenError("DOCGEN_E_PARSE", "no registers parsed from " + inputPath, "add a `## 寄存器` chapter with `### title(NAME)` headings, 偏移地址/复位值 lines and a field table");
  }
  const slug = ipSlug(manual.title, optionalString(args, "ip"));
  const requestedOutput = optionalString(args, "output");
  const target = requestedOutput === undefined ? join(resolveOutputDir(undefined, exec), regExcelFileName(slug)) : resolveOutputPath(requestedOutput, exec);
  const bytes = buildXlsx(manual.registers, { ip: slug });
  const output = atomicWriteFile(target, bytes, 420);
  return {
    output,
    registers: manual.registers.length,
    fields: manual.registers.reduce((total, register) => total + register.fields.length, 0),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
function render(value) {
  const failure = value;
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME + " FAILED [" + failure.error.code + "]: " + failure.error.message + `
hint: ` + failure.error.hint }];
  }
  const result = value;
  return [{ type: "text", text: TOOL_NAME + ": " + result.registers + " registers, " + result.fields + " fields, " + result.bytes + ` bytes
file: ` + result.output + `
sha256: ` + result.sha256 }];
}
function registerXlsxToolDefinition() {
  return {
    name: TOOL_NAME,
    description: "Generate the register Excel workbook (<ip>_regExcel_full.xlsx) from a user-manual markdown file. Parses the register chapter, gap-fills every register over [31:0], and writes the 9-column eCap workbook layout. Returns the output path, register/field counts, byte length and sha256.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "manual path, relative to the workspace root (e.g. docs/user-manual.md)" },
        output: { type: "string", description: "output xlsx path (default: <workspace>/docs/<ip>_regExcel_full.xlsx)" },
        ip: { type: "string", description: "IP slug override for the output name (default: from the manual H1 title, else 'ip')" }
      },
      required: ["input"]
    },
    output: {
      schema: {
        type: "object",
        properties: {
          output: { type: "string" },
          registers: { type: "number" },
          fields: { type: "number" },
          bytes: { type: "number" },
          sha256: { type: "string" },
          ok: { type: "boolean" },
          error: { type: "object" }
        }
      },
      render: (_args, value) => render(value)
    },
    execute: async (args, exec) => {
      try {
        return executeXlsx(args ?? {}, exec);
      } catch (error) {
        return refusalOf(error);
      }
    }
  };
}

// src/tool-docx.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/docx.ts
var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
var R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
var REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
var OVERVIEW_GRID = [499, 1162, ...new Array(11).fill(208), ...new Array(21).fill(207)];
var BIT_GRID = [520, 520, ...new Array(14).fill(519)];
var DETAIL_GRID = [830, 1659, 5807];
var TEXT_WIDTH = 8296;
var FONT_BODY = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "宋体" };
var FONT_MONO = { ascii: "Courier New", hAnsi: "Courier New", eastAsia: "宋体" };
var ACCESS_MAP = {
  rw: "rw",
  ro: "r",
  wo: "w",
  w1c: "rc_w1",
  w0c: "rc_w0",
  rc: "rc_r",
  w1s: "rs",
  w1t: "t"
};
function mappedAccess(access) {
  return ACCESS_MAP[access.toLowerCase()] ?? access;
}
function rFontsXml(font) {
  return element("w:rFonts", { "w:ascii": font.ascii, "w:hAnsi": font.hAnsi, "w:eastAsia": font.eastAsia, "w:hint": "eastAsia" });
}
function runXml(text, options = {}) {
  const rPr = element("w:rPr", {}, rFontsXml(options.mono === true ? FONT_MONO : FONT_BODY) + (options.bold === true ? "<w:b/><w:bCs/>" : ""));
  return "<w:r>" + rPr + '<w:t xml:space="preserve">' + escapeXml(text) + "</w:t></w:r>";
}
function inlineRunsXml(text, base = {}) {
  let out = "";
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (part === "")
      continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold === null)
      out += runXml(part, base);
    else
      out += runXml(bold[1], { ...base, bold: true });
  }
  return out;
}
function textRunsXml(text, base = {}) {
  return text.split(`
`).map((line, index) => (index === 0 ? "" : "<w:br/>") + inlineRunsXml(line, base)).join("");
}
function paragraphXml(text, options = {}) {
  const pPr = (options.style === undefined ? "" : element("w:pStyle", { "w:val": options.style })) + element("w:rPr", {}, rFontsXml(options.mono === true ? FONT_MONO : FONT_BODY));
  return "<w:p>" + element("w:pPr", {}, pPr) + textRunsXml(text, { bold: options.bold, mono: options.mono }) + "</w:p>";
}
function cellXml2(options) {
  const tcPr = [element("w:tcW", { "w:w": options.width, "w:type": "dxa" })];
  if ((options.gridSpan ?? 1) > 1)
    tcPr.push(element("w:gridSpan", { "w:val": options.gridSpan }));
  if (options.vMerge !== undefined)
    tcPr.push(element("w:vMerge", options.vMerge === "restart" ? { "w:val": "restart" } : {}));
  if (options.fill !== undefined)
    tcPr.push(element("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": options.fill }));
  if (options.verticalText === true)
    tcPr.push(element("w:textDirection", { "w:val": "btLr" }));
  tcPr.push(element("w:vAlign", { "w:val": "center" }));
  const paragraphs = options.paragraphs ?? [options.text ?? ""];
  const content = paragraphs.map((text) => paragraphXml(text, { style: options.style ?? "RegOverview", bold: options.bold })).join("");
  return "<w:tc>" + element("w:tcPr", {}, tcPr.join("")) + content + "</w:tc>";
}
function rowXml2(cells, options = {}) {
  let trPr = "";
  if (options.height !== undefined)
    trPr += element("w:trHeight", { "w:hRule": "exact", "w:val": options.height });
  if (options.header === true)
    trPr += element("w:tblHeader", {});
  return "<w:tr>" + (trPr === "" ? "" : element("w:trPr", {}, trPr)) + cells.join("") + "</w:tr>";
}
function tableXml(grid, rows) {
  const tblPr = element("w:tblPr", {}, element("w:tblStyle", { "w:val": "RegTable" }) + element("w:tblW", { "w:w": "5000", "w:type": "pct" }) + element("w:tblLayout", { "w:type": "fixed" }) + element("w:tblLook", { "w:val": "04A0", "w:firstRow": "1", "w:lastRow": "0", "w:firstColumn": "1", "w:lastColumn": "0", "w:noHBand": "0", "w:noVBand": "1" }));
  const tblGrid = element("w:tblGrid", {}, grid.map((width) => element("w:gridCol", { "w:w": width })).join(""));
  return "<w:tbl>" + tblPr + tblGrid + rows.join("") + "</w:tbl>";
}
function clipFields(fields, hiEdge, loEdge) {
  const segments = [];
  for (const field of fields) {
    const hi = Math.min(field.hi, hiEdge);
    const lo = Math.max(field.lo, loEdge);
    if (hi >= lo)
      segments.push({ hi, lo, field });
  }
  return segments;
}
function bitSpanWidth(hi, lo) {
  const column = hi > 15 ? 31 - hi : 15 - hi;
  return BIT_GRID.slice(column, column + hi - lo + 1).reduce((total, width) => total + width, 0);
}
function overviewSpanWidth(hi, lo) {
  const column = 2 + (31 - hi);
  return OVERVIEW_GRID.slice(column, column + hi - lo + 1).reduce((total, width) => total + width, 0);
}
function overviewTableXml(registers, labels) {
  const bitColumns = OVERVIEW_GRID.slice(2).reduce((total, width) => total + width, 0);
  const header = rowXml2([
    cellXml2({ width: OVERVIEW_GRID[0], text: labels.overviewHeaders[0], style: "RegOverview", bold: true }),
    cellXml2({ width: OVERVIEW_GRID[1], text: labels.overviewHeaders[1], style: "RegOverview", bold: true }),
    cellXml2({ width: bitColumns, gridSpan: 32, text: labels.overviewHeaders[2], style: "RegOverview", bold: true })
  ], { height: 278, header: true });
  const rows = [header];
  for (const register of registers) {
    const reset = parseResetHex(register.reset).value;
    const nameCells = [
      cellXml2({ width: OVERVIEW_GRID[0], text: register.offset, style: "RegOverview", vMerge: "restart" }),
      cellXml2({ width: OVERVIEW_GRID[1], text: register.name, style: "RegOverview" })
    ];
    const resetCells = [
      cellXml2({ width: OVERVIEW_GRID[0], text: "", style: "RegOverview", vMerge: "continue" }),
      cellXml2({ width: OVERVIEW_GRID[1], text: "Reset value", style: "RegOverview" })
    ];
    for (const field of register.fields) {
      const width = field.hi - field.lo + 1;
      const tcW = overviewSpanWidth(field.hi, field.lo);
      if (field.reserved) {
        nameCells.push(cellXml2({ width: tcW, gridSpan: width, text: "RESERVED", style: "RegOverview", fill: "D9D9D9", vMerge: "restart", verticalText: true }));
        resetCells.push(cellXml2({ width: tcW, gridSpan: width, text: "", style: "RegOverview", vMerge: "continue" }));
      } else if (width === 1) {
        nameCells.push(cellXml2({ width: tcW, text: fieldLabel(field), style: "RegOverview", verticalText: true }));
        resetCells.push(cellXml2({ width: tcW, text: (reset >>> field.lo & 1) === 1 ? "1" : "0", style: "RegOverview" }));
      } else {
        nameCells.push(cellXml2({ width: tcW, gridSpan: width, text: fieldLabel(field), style: "RegOverview" }));
        for (let bit = field.hi;bit >= field.lo; bit--) {
          resetCells.push(cellXml2({ width: OVERVIEW_GRID[2 + (31 - bit)], text: (reset >>> bit & 1) === 1 ? "1" : "0", style: "RegOverview" }));
        }
      }
    }
    rows.push(rowXml2(nameCells, { height: 902 }), rowXml2(resetCells, { height: 278 }));
  }
  return tableXml(OVERVIEW_GRID, rows);
}
function bitSegmentRow(segments, kind) {
  const cells = segments.map((segment) => cellXml2({
    width: bitSpanWidth(segment.hi, segment.lo),
    gridSpan: segment.hi - segment.lo + 1,
    text: kind === "name" ? segment.field.name : segment.field.reserved ? "" : mappedAccess(segment.field.access),
    style: "RegBit"
  }));
  return rowXml2(cells, kind === "name" ? { height: 420 } : {});
}
function bitTableXml(register) {
  const numberRow = (edge) => rowXml2(Array.from({ length: 16 }, (_, index) => cellXml2({ width: BIT_GRID[index], text: String(edge - index), style: "RegBit" })));
  const upper = clipFields(register.fields, 31, 16);
  const lower = clipFields(register.fields, 15, 0);
  return tableXml(BIT_GRID, [
    numberRow(31),
    bitSegmentRow(upper, "name"),
    bitSegmentRow(upper, "access"),
    numberRow(15),
    bitSegmentRow(lower, "name"),
    bitSegmentRow(lower, "access")
  ]);
}
function detailTableXml(register, labels) {
  const header = rowXml2(labels.detailHeaders.map((text, index) => cellXml2({ width: DETAIL_GRID[index], text, style: "RegDetail", bold: true })));
  const rows = register.fields.map((field) => rowXml2([
    cellXml2({ width: DETAIL_GRID[0], text: bitRangeText(field), style: "RegDetail" }),
    cellXml2({ width: DETAIL_GRID[1], text: field.name, style: "RegDetail" }),
    cellXml2({ width: DETAIL_GRID[2], paragraphs: field.desc.split(`
`), style: "RegDetail" })
  ]));
  return tableXml(DETAIL_GRID, [header, ...rows]);
}
function chapterXml(register, labels, lang) {
  const title = lang === "zh-CN" ? register.title + "（" + register.name + "）" : register.title + " (" + register.name + ")";
  return [
    paragraphXml(title, { style: "Heading3" }),
    paragraphXml(labels.offsetLine + register.offset),
    paragraphXml(labels.resetLine + register.reset),
    bitTableXml(register),
    "<w:p/>",
    detailTableXml(register, labels),
    "<w:p/>"
  ];
}
function evenGrid(columns) {
  const base = Math.floor(TEXT_WIDTH / columns);
  const grid = new Array(columns).fill(base);
  grid[columns - 1] += TEXT_WIDTH - base * columns;
  return grid;
}
function genericTableXml(header, rows) {
  const columns = Math.max(1, header.length, ...rows.map((row) => row.length));
  const grid = evenGrid(columns);
  const cellsOf = (cells, headerRow) => rowXml2(Array.from({ length: columns }, (_, index) => cellXml2({ width: grid[index], text: cells[index] ?? "", style: "TableText", bold: headerRow })), headerRow ? { header: true } : {});
  return tableXml(grid, [cellsOf(header, true), ...rows.map((row) => cellsOf(row, false))]);
}
function blockXml(block) {
  switch (block.kind) {
    case "heading":
      return paragraphXml(block.text, { style: "Heading" + block.level });
    case "paragraph":
      return paragraphXml(block.text);
    case "list":
      return block.items.map((item, index) => paragraphXml((block.ordered ? index + 1 + ". " : "• ") + item, { style: "ListParagraph" })).join("");
    case "fence": {
      const lines = block.text === "" ? [""] : block.text.split(`
`);
      return lines.map((line) => paragraphXml(line, { style: "Code", mono: true })).join("");
    }
    case "table":
      return genericTableXml(block.header, block.rows);
    default: {
      const unreachable = block;
      return unreachable;
    }
  }
}
function sectPrXml() {
  return element("w:sectPr", {}, element("w:pgSz", { "w:w": 11906, "w:h": 16838 }) + element("w:pgMar", { "w:top": 1440, "w:right": 1800, "w:bottom": 1440, "w:left": 1800, "w:header": 851, "w:footer": 992, "w:gutter": 0 }) + element("w:cols", { "w:space": 425 }) + element("w:docGrid", { "w:type": "lines", "w:linePitch": 312 }));
}
function documentXml(manual, registers, lang) {
  const labels = labelsFor(lang);
  const body = [paragraphXml(manual.title, { style: "Heading1" })];
  for (const block of manual.blocks)
    body.push(blockXml(block));
  body.push(paragraphXml(labels.chapterTitle, { style: "Heading2" }));
  body.push(overviewTableXml(registers, labels));
  for (const register of registers)
    body.push(...chapterXml(register, labels, lang));
  body.push(sectPrXml());
  return xmlDeclaration() + '<w:document xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '"><w:body>' + body.join("") + "</w:body></w:document>";
}
function paragraphStyleXml(id, name, pPr, rPr, options = {}) {
  return element("w:style", { "w:type": "paragraph", "w:styleId": id, ...options.defaultStyle === true ? { "w:default": "1" } : {} }, element("w:name", { "w:val": name }) + (options.basedOn === undefined ? "" : element("w:basedOn", { "w:val": options.basedOn })) + (options.next === undefined ? "" : element("w:next", { "w:val": options.next })) + "<w:qFormat/>" + (pPr === "" ? "" : element("w:pPr", {}, pPr)) + (rPr === "" ? "" : element("w:rPr", {}, rPr)));
}
function headingStyleXml(level, size) {
  const pPr = "<w:keepNext/><w:keepLines/>" + element("w:spacing", { "w:before": level === 1 ? 240 : 180, "w:after": 120 }) + element("w:outlineLvl", { "w:val": level - 1 });
  const rPr = "<w:b/><w:bCs/>" + element("w:sz", { "w:val": size }) + element("w:szCs", { "w:val": size });
  return paragraphStyleXml("Heading" + level, "heading " + level, pPr, rPr, { basedOn: "Normal", next: "Normal" });
}
function stylesXml2() {
  const docDefaults = "<w:docDefaults><w:rPrDefault><w:rPr>" + rFontsXml(FONT_BODY) + element("w:sz", { "w:val": 21 }) + element("w:szCs", { "w:val": 21 }) + '<w:lang w:val="en-US" w:eastAsia="zh-CN"/>' + "</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>";
  const normal = paragraphStyleXml("Normal", "Normal", element("w:spacing", { "w:before": 120, "w:after": 120, "w:line": 300, "w:lineRule": "auto" }), rFontsXml(FONT_BODY) + element("w:sz", { "w:val": 21 }) + element("w:szCs", { "w:val": 21 }), { defaultStyle: true });
  const list = paragraphStyleXml("ListParagraph", "List Paragraph", element("w:spacing", { "w:before": 0, "w:after": 0 }) + element("w:ind", { "w:left": 720, "w:hanging": 360 }), "", { basedOn: "Normal", next: "Normal" });
  const code = paragraphStyleXml("Code", "Code Block", element("w:spacing", { "w:before": 0, "w:after": 0 }) + element("w:ind", { "w:left": 0 }), rFontsXml(FONT_MONO) + element("w:sz", { "w:val": 18 }) + element("w:szCs", { "w:val": 18 }), { basedOn: "Normal", next: "Normal" });
  const tableText = paragraphStyleXml("TableText", "Table Text", element("w:spacing", { "w:before": 0, "w:after": 0 }), element("w:sz", { "w:val": 18 }) + element("w:szCs", { "w:val": 18 }), { basedOn: "Normal", next: "Normal" });
  const regOverview = paragraphStyleXml("RegOverview", "Register Overview Cell", element("w:adjustRightInd", { "w:val": 0 }) + element("w:snapToGrid", { "w:val": 0 }) + element("w:spacing", { "w:before": 0, "w:after": 0 }) + element("w:jc", { "w:val": "center" }), element("w:sz", { "w:val": 12 }) + element("w:szCs", { "w:val": 12 }), { basedOn: "Normal", next: "Normal" });
  const regBit = paragraphStyleXml("RegBit", "Register Bit Cell", "", element("w:sz", { "w:val": 13 }) + element("w:szCs", { "w:val": 13 }), { basedOn: "RegOverview", next: "Normal" });
  const regDetail = paragraphStyleXml("RegDetail", "Register Detail Cell", element("w:spacing", { "w:before": 0, "w:after": 0 }), element("w:sz", { "w:val": 18 }) + element("w:szCs", { "w:val": 18 }), { basedOn: "Normal", next: "Normal" });
  const regTable = element("w:style", { "w:type": "table", "w:styleId": "RegTable" }, element("w:name", { "w:val": "Register Table" }) + "<w:qFormat/>" + element("w:tblPr", {}, element("w:tblBorders", {}, ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => element("w:" + side, { "w:val": "single", "w:sz": 4, "w:space": 0, "w:color": "auto" })).join("")) + element("w:tblLayout", { "w:type": "fixed" })));
  return xmlDeclaration() + '<w:styles xmlns:w="' + W_NS + '">' + docDefaults + normal + headingStyleXml(1, 32) + headingStyleXml(2, 30) + headingStyleXml(3, 28) + headingStyleXml(4, 24) + headingStyleXml(5, 22) + headingStyleXml(6, 21) + list + code + tableText + regOverview + regBit + regDetail + regTable + "</w:styles>";
}
function contentTypesXml2() {
  return xmlDeclaration() + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' + '<Default Extension="xml" ContentType="application/xml"/>' + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' + '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' + "</Types>";
}
function packageRelsXml() {
  return xmlDeclaration() + '<Relationships xmlns="' + REL_NS + '">' + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' + "</Relationships>";
}
function documentRelsXml() {
  return xmlDeclaration() + '<Relationships xmlns="' + REL_NS + '">' + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>' + "</Relationships>";
}
function coreXml2(title, ip, lang) {
  return xmlDeclaration() + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + "<dc:title>" + escapeXml(title) + "</dc:title>" + "<dc:subject>" + escapeXml(ip) + "</dc:subject>" + "<dc:creator>mpd-docgen</dc:creator>" + "<cp:lastModifiedBy>mpd-docgen</cp:lastModifiedBy>" + '<dcterms:created xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:created>' + '<dcterms:modified xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified>' + "<dc:language>" + lang + "</dc:language>" + "</cp:coreProperties>";
}
function appXml2() {
  return xmlDeclaration() + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' + "<Application>mpd-docgen</Application>" + "<DocSecurity>0</DocSecurity>" + "<ScaleCrop>false</ScaleCrop>" + "<Company></Company>" + "<LinksUpToDate>false</LinksUpToDate>" + "<SharedDoc>false</SharedDoc>" + "<HyperlinksChanged>false</HyperlinksChanged>" + "<AppVersion>1.0</AppVersion>" + "</Properties>";
}
function settingsXml() {
  return xmlDeclaration() + '<w:settings xmlns:w="' + W_NS + '">' + '<w:zoom w:percent="100"/>' + '<w:defaultTabStop w:val="420"/>' + '<w:characterSpacingControl w:val="compressPunctuation"/>' + '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' + "</w:settings>";
}
function fontTableXml() {
  return xmlDeclaration() + '<w:fonts xmlns:w="' + W_NS + '">' + '<w:font w:name="Calibri"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>' + '<w:font w:name="宋体"><w:charset w:val="86"/><w:family w:val="modern"/><w:pitch w:val="variable"/></w:font>' + '<w:font w:name="Courier New"><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>' + "</w:fonts>";
}
function utf82(text) {
  return new TextEncoder().encode(text);
}
function buildDocx(manual, registers, lang, opts) {
  const entries = [
    { name: "[Content_Types].xml", data: utf82(contentTypesXml2()) },
    { name: "_rels/.rels", data: utf82(packageRelsXml()) },
    { name: "docProps/app.xml", data: utf82(appXml2()) },
    { name: "docProps/core.xml", data: utf82(coreXml2(manual.title, opts.ip, lang)) },
    { name: "word/_rels/document.xml.rels", data: utf82(documentRelsXml()) },
    { name: "word/document.xml", data: utf82(documentXml(manual, registers, lang)) },
    { name: "word/fontTable.xml", data: utf82(fontTableXml()) },
    { name: "word/settings.xml", data: utf82(settingsXml()) },
    { name: "word/styles.xml", data: utf82(stylesXml2()) }
  ];
  return buildZip(entries);
}

// src/tool-docx.ts
var TOOL_NAME2 = "mpd_docgen_user_manual_docx";
function refusalOf2(error) {
  if (isDocgenError(error)) {
    return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } };
  }
  return {
    ok: false,
    error: {
      code: "DOCGEN_E_INTERNAL",
      message: "unexpected internal error: " + String(error),
      hint: "check the plugin log or retry with a narrower request"
    }
  };
}
function requiredString2(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocgenError("DOCGEN_E_INPUT", 'missing or empty "' + key + '" argument for ' + TOOL_NAME2, "pass " + key + " as a non-empty string");
  }
  return value;
}
function optionalString2(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "")
    return;
  return value;
}
function requiredLang(args) {
  const value = requiredString2(args, "lang");
  if (value !== "zh-CN" && value !== "en") {
    throw new DocgenError("DOCGEN_E_INPUT", 'unsupported lang "' + value + '" for ' + TOOL_NAME2, 'pass lang as "zh-CN" or "en"');
  }
  return value;
}
function readText2(path) {
  try {
    return readFileSync2(path, "utf8");
  } catch (error) {
    throw new DocgenError("DOCGEN_E_IO", "cannot read " + path + ": " + (error instanceof Error ? error.message : String(error)), "check that the input path exists and is readable");
  }
}
function countTables(manual) {
  const bodyTables = manual.blocks.filter((block) => block.kind === "table").length;
  return 1 + manual.registers.length * 2 + bodyTables;
}
function countHeadings(manual) {
  const bodyHeadings = manual.blocks.filter((block) => block.kind === "heading").length;
  return 1 + bodyHeadings + 1 + manual.registers.length;
}
function executeDocx(args, exec) {
  const inputPath = resolveInputPath(requiredString2(args, "input"), exec);
  const lang = requiredLang(args);
  const manual = parseManual(readText2(inputPath), lang);
  if (manual.registers.length === 0) {
    throw new DocgenError("DOCGEN_E_PARSE", "no registers parsed from " + inputPath, "add a `## 寄存器` (en: `## Registers`) chapter with `### title(NAME)` headings, 偏移地址/复位值 (Offset/Reset value) lines and a field table");
  }
  const slug = ipSlug(manual.title, optionalString2(args, "ip"));
  const requestedOutput = optionalString2(args, "output");
  const target = requestedOutput === undefined ? join2(resolveOutputDir(undefined, exec), docxFileName(slug, lang)) : resolveOutputPath(requestedOutput, exec);
  const bytes = buildDocx(manual, manual.registers, lang, { ip: slug });
  const output = atomicWriteFile(target, bytes, 420);
  return {
    output,
    lang,
    registers: manual.registers.length,
    tables: countTables(manual),
    headings: countHeadings(manual),
    bytes: bytes.length,
    sha256: createHash2("sha256").update(bytes).digest("hex")
  };
}
function render2(value) {
  const failure = value;
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME2 + " FAILED [" + failure.error.code + "]: " + failure.error.message + `
hint: ` + failure.error.hint }];
  }
  const result = value;
  return [
    {
      type: "text",
      text: TOOL_NAME2 + " (" + result.lang + "): " + result.registers + " registers, " + result.tables + " tables, " + result.headings + " headings, " + result.bytes + ` bytes
file: ` + result.output + `
sha256: ` + result.sha256
    }
  ];
}
function userManualDocxToolDefinition() {
  return {
    name: TOOL_NAME2,
    description: "Generate one language version of the user-manual docx (<ip>_reg_user_manual.<lang>.docx) from a user-manual markdown file. Renders the generic body plus the eCap-layout register chapter (overview table, per-register bit table and detail table). Returns the output path, language, register/table/heading counts, byte length and sha256.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "manual path, relative to the workspace root (e.g. docs/user-manual.md)" },
        lang: { type: "string", enum: ["zh-CN", "en"], description: "manual language; selects labels and heading text" },
        output: { type: "string", description: "output docx path (default: <workspace>/docs/<ip>_reg_user_manual.<lang>.docx)" },
        ip: { type: "string", description: "IP slug override for the output name (default: from the manual H1 title, else 'ip')" }
      },
      required: ["input", "lang"]
    },
    output: {
      schema: {
        type: "object",
        properties: {
          output: { type: "string" },
          lang: { type: "string" },
          registers: { type: "number" },
          tables: { type: "number" },
          headings: { type: "number" },
          bytes: { type: "number" },
          sha256: { type: "string" },
          ok: { type: "boolean" },
          error: { type: "object" }
        }
      },
      render: (_args, value) => render2(value)
    },
    execute: async (args, exec) => {
      try {
        return executeDocx(args ?? {}, exec);
      } catch (error) {
        return refusalOf2(error);
      }
    }
  };
}

// src/tool-run.ts
import { createHash as createHash3 } from "node:crypto";
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/consistency.ts
function spanText(hi, lo) {
  return "[" + (hi === lo ? String(hi) : hi + ":" + lo) + "]";
}
function offsetValue(offset) {
  const text = offset.trim();
  if (/^0x[0-9A-Fa-f]+$/.test(text))
    return parseInt(text.slice(2), 16);
  if (/^[0-9A-Fa-f]+h$/i.test(text))
    return parseInt(text.slice(0, -1), 16);
  if (/^[0-9]+$/.test(text))
    return parseInt(text, 10);
  if (/^[0-9A-Fa-f]+$/.test(text))
    return parseInt(text, 16);
  return null;
}
function compareRegister(a, b, position, differences) {
  const label = a.name === b.name ? position + " (" + a.name + ")" : position;
  if (a.name !== b.name) {
    differences.push(label + ' name differs: a="' + a.name + '", b="' + b.name + '"');
  }
  const aOffset = offsetValue(a.offset);
  const bOffset = offsetValue(b.offset);
  if (aOffset === null || bOffset === null) {
    if (a.offset !== b.offset)
      differences.push(label + " offset differs: a=" + a.offset + ", b=" + b.offset);
  } else if (aOffset !== bOffset) {
    differences.push(label + " offset differs: a=" + a.offset + ", b=" + b.offset);
  }
  if (a.width !== b.width)
    differences.push(label + " width differs: a=" + a.width + ", b=" + b.width);
  if (a.fields.length !== b.fields.length) {
    differences.push(label + " field count differs: a has " + a.fields.length + ", b has " + b.fields.length);
  }
  const shared = Math.min(a.fields.length, b.fields.length);
  for (let i = 0;i < shared; i++) {
    const left = a.fields[i];
    const right = b.fields[i];
    const field = label + " field " + (i + 1);
    if (left.hi !== right.hi || left.lo !== right.lo) {
      differences.push(field + " span differs: a=" + spanText(left.hi, left.lo) + ", b=" + spanText(right.hi, right.lo));
    }
    if (left.reserved !== right.reserved) {
      differences.push(field + " reserved differs: a=" + left.reserved + ", b=" + right.reserved);
    }
  }
}
function compareSkeletons(a, b) {
  const differences = [];
  if (a.length !== b.length) {
    differences.push("register count differs: a has " + a.length + ", b has " + b.length);
  }
  const shared = Math.min(a.length, b.length);
  for (let i = 0;i < shared; i++) {
    compareRegister(a[i], b[i], "register " + (i + 1), differences);
  }
  return differences;
}

// src/tool-run.ts
var TOOL_NAME3 = "mpd_docgen_run";
var EN_MANUAL_NOTE = "manualEn was not provided: the rtl-ip-flow spec stage requires an English twin (docs/user-manual.en.md); only the zh-CN docx was generated";
function refusalOf3(error) {
  if (isDocgenError(error)) {
    return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } };
  }
  return {
    ok: false,
    error: {
      code: "DOCGEN_E_INTERNAL",
      message: "unexpected internal error: " + String(error),
      hint: "check the plugin log or retry with a narrower request"
    }
  };
}
function requiredString3(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocgenError("DOCGEN_E_INPUT", 'missing or empty "' + key + '" argument for ' + TOOL_NAME3, "pass " + key + " as a non-empty string");
  }
  return value;
}
function optionalString3(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "")
    return;
  return value;
}
function readText3(path) {
  try {
    return readFileSync3(path, "utf8");
  } catch (error) {
    throw new DocgenError("DOCGEN_E_IO", "cannot read " + path + ": " + (error instanceof Error ? error.message : String(error)), "check that the input path exists and is readable");
  }
}
function loadManual(path, lang) {
  const manual = parseManual(readText3(path), lang);
  if (manual.registers.length === 0) {
    throw new DocgenError("DOCGEN_E_PARSE", "no registers parsed from " + path, "add a `## 寄存器` (en: `## Registers`) chapter with `### title(NAME)` headings, 偏移地址/复位值 (Offset/Reset value) lines and a field table");
  }
  return manual;
}
function dedupe(warnings) {
  const seen = new Set;
  const unique = [];
  for (const warning of warnings) {
    if (seen.has(warning))
      continue;
    seen.add(warning);
    unique.push(warning);
  }
  return unique;
}
function buildArtifacts(zh, en, enPath, slug, zhPath) {
  if (en !== undefined) {
    const differences = compareSkeletons(zh.registers, en.registers);
    if (differences.length > 0) {
      throw new DocgenError("DOCGEN_E_LANG_MISMATCH", "zh/en register skeletons differ (zh: " + zhPath + ", en: " + enPath + `):
- ` + differences.join(`
- `), "make the en manual declare the same register names, offsets, widths and field spans as the zh manual; only titles and descriptions may differ");
    }
  }
  const artifacts = [
    { name: regExcelFileName(slug), bytes: buildXlsx(zh.registers, { ip: slug }) },
    { name: docxFileName(slug, "zh-CN"), lang: "zh-CN", bytes: buildDocx(zh, zh.registers, "zh-CN", { ip: slug }) }
  ];
  if (en !== undefined) {
    artifacts.push({ name: docxFileName(slug, "en"), lang: "en", bytes: buildDocx(en, en.registers, "en", { ip: slug }) });
  }
  return artifacts;
}
function executeRun(args, exec) {
  const zhPath = resolveInputPath(requiredString3(args, "manual"), exec);
  const zh = loadManual(zhPath, "zh-CN");
  const enArg = optionalString3(args, "manualEn");
  const enPath = enArg === undefined ? undefined : resolveInputPath(enArg, exec);
  const en = enPath === undefined ? undefined : loadManual(enPath, "en");
  const slug = ipSlug(zh.title, optionalString3(args, "ip"));
  const outputDir = resolveOutputDir(optionalString3(args, "outputDir"), exec);
  const artifacts = buildArtifacts(zh, en, enPath, slug, zhPath);
  const files = artifacts.map((artifact) => {
    const path = atomicWriteFile(join3(outputDir, artifact.name), artifact.bytes, 420);
    const file = {
      path,
      bytes: artifact.bytes.length,
      sha256: createHash3("sha256").update(artifact.bytes).digest("hex")
    };
    return artifact.lang === undefined ? file : { ...file, lang: artifact.lang };
  });
  const warnings = dedupe([...zh.warnings, ...en?.warnings ?? []]);
  if (en === undefined)
    warnings.push(EN_MANUAL_NOTE);
  return {
    ok: true,
    files,
    registers: zh.registers.length,
    fields: zh.registers.reduce((total, register) => total + register.fields.length, 0),
    warnings
  };
}
function render3(value) {
  const failure = value;
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME3 + " FAILED [" + failure.error.code + "]: " + failure.error.message + `
hint: ` + failure.error.hint }];
  }
  const result = value;
  const lines = [
    TOOL_NAME3 + ": " + result.registers + " registers, " + result.fields + " fields, " + result.files.length + " files",
    ...result.files.map((file) => "  " + file.path + " (" + file.bytes + " bytes, sha256 " + file.sha256 + ")")
  ];
  if (result.warnings.length > 0)
    lines.push("warnings: " + result.warnings.join("; "));
  return [{ type: "text", text: lines.join(`
`) }];
}
function docgenRunToolDefinition() {
  return {
    name: TOOL_NAME3,
    description: "Generate all spec-stage artifacts in one call: <ip>_regExcel_full.xlsx, <ip>_reg_user_manual.zh-CN.docx and (when manualEn is given) <ip>_reg_user_manual.en.docx. Parses the zh manual (and the en twin when given), refuses a zh/en register-skeleton mismatch (DOCGEN_E_LANG_MISMATCH) before writing anything, and reports every written file with its byte length and sha256. Without manualEn it still succeeds and reports why the English twin is required.",
    parameters: {
      type: "object",
      properties: {
        manual: { type: "string", description: "zh-CN manual path, relative to the workspace root (default artifact source)" },
        manualEn: { type: "string", description: "optional en manual path; when given, its docx is generated too" },
        outputDir: { type: "string", description: "output directory (default: <workspace>/docs)" },
        ip: { type: "string", description: "IP slug override shared by every output name (default: from the manual H1 title, else 'ip')" }
      },
      required: ["manual"]
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                lang: { type: "string" },
                bytes: { type: "number" },
                sha256: { type: "string" }
              }
            }
          },
          registers: { type: "number" },
          fields: { type: "number" },
          warnings: { type: "array", items: { type: "string" } },
          error: { type: "object" }
        }
      },
      render: (_args, value) => render3(value)
    },
    execute: async (args, exec) => {
      try {
        return executeRun(args ?? {}, exec);
      } catch (error) {
        return refusalOf3(error);
      }
    }
  };
}

// src/tool-verify.ts
import { readFileSync as readFileSync4 } from "node:fs";
var TOOL_NAME4 = "mpd_docgen_verify";
var COLUMN_LETTERS2 = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
var HEADERS2 = [
  "register name",
  "field offset",
  "field name",
  "access type",
  "reset value",
  "description（中文描述，请填此列）",
  "skip field test",
  "remarks",
  `register structure = "1"
0 : whole register
1 : aggregated register`
];
var COLUMN_WIDTHS2 = [21.22, 19.78, 21, 18.44, 18.44, 37.11, 18.89, 22.78, 53.33];
var HEADER_ROW_HEIGHT2 = 43.2;
var DOCX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "word/_rels/document.xml.rels",
  "word/document.xml",
  "word/fontTable.xml",
  "word/settings.xml",
  "word/styles.xml"
];
var XLSX_IDS = ["V1", "V2", "V3", "V4", "V5"];
var PLACEHOLDERS = ["<寄存器名>", "<REG_NAME>", "<IP名称>"];
var RESERVED_FILL = "D9D9D9";
var REGISTER_RESET = /^0x(?:[0-9A-F]{4}|[0-9A-F]{8})$/;
var FIELD_RESET = /^\d+'h[0-9A-F]+$/;
var FIELD_OFFSET = /^\[(\d{1,2})(?::(\d{1,2}))?\]$/;
var DETAIL_GRID2 = [830, 1659, 5807];
var LABELS2 = {
  "zh-CN": { chapterTitle: "寄存器", offsetPrefix: "地址偏移：", resetPrefix: "复位值：", detailHeaders: ["位域", "名称", "描述"] },
  en: { chapterTitle: "Registers", offsetPrefix: "Offset: ", resetPrefix: "Reset value: ", detailHeaders: ["Bit field", "Name", "Description"] }
};
function refusalOf4(error) {
  if (isDocgenError(error)) {
    return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } };
  }
  return {
    ok: false,
    error: {
      code: "DOCGEN_E_INTERNAL",
      message: "unexpected internal error: " + String(error),
      hint: "check the plugin log or retry with a narrower request"
    }
  };
}
function optionalString4(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "")
    return;
  return value;
}
function messageOf(error) {
  if (error instanceof DocgenError)
    return error.code + ": " + error.message;
  if (error instanceof Error)
    return error.message;
  return String(error);
}
function decodeEntities(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function partText(parts, name) {
  const data = parts.get(name);
  if (data === undefined)
    throw new Error("missing part: " + name);
  return new TextDecoder().decode(data);
}
function spanMask(hi, lo) {
  const width = hi - lo + 1;
  return width >= 32 ? 4294967295 : (2 ** width - 1) * 2 ** lo;
}
function parseSpan(text) {
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(text.trim());
  if (match === null)
    return null;
  const hi = Number(match[1]);
  const lo = match[2] === undefined ? hi : Number(match[2]);
  if (hi > 31 || lo > hi)
    return null;
  return { hi, lo };
}
function assertSpanList(spans, context) {
  if (spans.length === 0)
    throw new Error(context + ": no field spans");
  let union = 0;
  let previousLo = 32;
  for (const span of spans) {
    if (span.hi >= previousLo)
      throw new Error(context + ": spans are not strictly descending at [" + span.hi + ":" + span.lo + "]");
    previousLo = span.lo;
    union = (union | spanMask(span.hi, span.lo)) >>> 0;
  }
  if (union !== 4294967295) {
    throw new Error(context + ": spans do not cover [31:0] (union 0x" + union.toString(16).toUpperCase().padStart(8, "0") + ")");
  }
}
function parseSheet(xml) {
  const rows = new Map;
  const heights = new Map;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const attributes = rowMatch[1];
    const rowNumber = Number(/\br="(\d+)"/.exec(attributes)?.[1] ?? "0");
    const height = /\bht="([^"]+)"/.exec(attributes)?.[1];
    if (height !== undefined)
      heights.set(rowNumber, Number(height));
    const cells = new Map;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = /\br="([A-Z]+)\d+"/.exec(cellMatch[1])?.[1] ?? "";
      const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(cellMatch[2] ?? "");
      cells.set(column, {
        value: inline === null ? "" : decodeEntities(inline[1]),
        style: Number(/\bs="(\d+)"/.exec(cellMatch[1])?.[1] ?? "0")
      });
    }
    rows.set(rowNumber, cells);
  }
  const widths = new Map;
  for (const colMatch of xml.matchAll(/<col\b([^>]*)\/>/g)) {
    const min = /\bmin="(\d+)"/.exec(colMatch[1])?.[1];
    const width = /\bwidth="([^"]+)"/.exec(colMatch[1])?.[1];
    if (min !== undefined && width !== undefined)
      widths.set(COLUMN_LETTERS2[Number(min) - 1] ?? "", Number(width));
  }
  return { rows, heights, widths, dimension: /<dimension ref="([^"]+)"\/>/.exec(xml)?.[1] ?? "" };
}
function parseStyles(xml) {
  const fontsBlock = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml)?.[1] ?? "";
  const fonts = [...fontsBlock.matchAll(/<font>([\s\S]*?)<\/font>/g)].map((match) => {
    const body = match[1];
    const charset = /<charset val="(\d+)"\/>/.exec(body);
    return {
      bold: /<b\/>/.test(body),
      size: Number(/<sz val="([^"]+)"\/>/.exec(body)?.[1] ?? "0"),
      name: /<name val="([^"]+)"\/>/.exec(body)?.[1] ?? "",
      charset: charset === null ? null : Number(charset[1])
    };
  });
  const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml)?.[1] ?? "";
  const fills = [...fillsBlock.matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((match) => /patternType="solid"/.test(match[1]) ? /<fgColor rgb="([^"]+)"\/>/.exec(match[1])?.[1] ?? null : null);
  const bordersBlock = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(xml)?.[1] ?? "";
  const borders = [...bordersBlock.matchAll(/<border>([\s\S]*?)<\/border>/g)].map((match) => ({
    thin: ["left", "right", "top", "bottom"].every((edge) => new RegExp("<" + edge + ' style="thin"').test(match[1]))
  }));
  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  const xfs = [...xfsBlock.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => ({
    fontId: Number(/\bfontId="(\d+)"/.exec(match[1])?.[1] ?? "0"),
    fillId: Number(/\bfillId="(\d+)"/.exec(match[1])?.[1] ?? "0"),
    borderId: Number(/\bborderId="(\d+)"/.exec(match[1])?.[1] ?? "0")
  }));
  return { fonts, fills, borders, xfs };
}
function modelOf(sheet) {
  const rowNumbers = [...sheet.rows.keys()].sort((a, b) => a - b);
  const registerRows = [];
  const fieldsOf = new Map;
  const unclassified = [];
  let current = null;
  for (const rowNumber of rowNumbers) {
    if (rowNumber === 1)
      continue;
    const row = sheet.rows.get(rowNumber);
    if (row === undefined)
      continue;
    const marker = row.get("D")?.value ?? "";
    const offset = row.get("B")?.value ?? "";
    if (marker === "Mixed") {
      current = rowNumber;
      registerRows.push(rowNumber);
      fieldsOf.set(rowNumber, []);
    } else if (FIELD_OFFSET.test(offset)) {
      if (current === null)
        unclassified.push(rowNumber);
      else
        fieldsOf.get(current)?.push(rowNumber);
    } else {
      unclassified.push(rowNumber);
    }
  }
  return { rowNumbers, registerRows, fieldsOf, unclassified };
}
function cellAt(sheet, rowNumber, column) {
  return sheet.rows.get(rowNumber)?.get(column) ?? { value: "", style: 0 };
}
function resolveStyle(styles, cell) {
  const xf = styles.xfs[cell.style];
  if (xf === undefined)
    throw new Error("cell style index " + cell.style + " has no cellXfs entry");
  const font = styles.fonts[xf.fontId];
  if (font === undefined)
    throw new Error("font id " + xf.fontId + " has no <font> entry");
  const border = styles.borders[xf.borderId];
  if (border === undefined)
    throw new Error("border id " + xf.borderId + " has no <border> entry");
  return { font, fill: styles.fills[xf.fillId] ?? null, borderThin: border.thin };
}
function paragraphText(fragment) {
  let text = "";
  for (const match of fragment.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    text += decodeEntities(match[1]);
  return text;
}
function parseCell(fragment) {
  const properties = /<w:tcPr>([\s\S]*?)<\/w:tcPr>/.exec(fragment)?.[1] ?? "";
  const texts = [];
  for (const match of fragment.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g))
    texts.push(paragraphText(match[1] ?? ""));
  return {
    span: Number(/<w:gridSpan w:val="(\d+)"\/>/.exec(properties)?.[1] ?? "1"),
    width: Number(/<w:tcW w:w="(\d+)" w:type="dxa"\/>/.exec(properties)?.[1] ?? "0"),
    texts,
    fill: /<w:shd [^>]*w:fill="([^"]+)"\/>/.exec(properties)?.[1] ?? null,
    vertical: /<w:textDirection w:val="btLr"\/>/.test(properties),
    vMerge: /<w:vMerge w:val="restart"\/>/.test(properties) ? "restart" : /<w:vMerge\/>/.test(properties) ? "continue" : null
  };
}
function parseRow(fragment) {
  const cells = [];
  for (const match of fragment.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g))
    cells.push(parseCell(match[1]));
  const height = /<w:trHeight w:hRule="exact" w:val="(\d+)"\/>/.exec(fragment);
  return { height: height === null ? null : Number(height[1]), cells };
}
function parseTable(fragment) {
  const gridBlock = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(fragment)?.[1] ?? "";
  const grid = [];
  for (const match of gridBlock.matchAll(/<w:gridCol w:w="(\d+)"\/>/g))
    grid.push(Number(match[1]));
  const rows = [];
  for (const match of fragment.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g))
    rows.push(parseRow(match[1]));
  return { kind: "table", grid, rows };
}
function parseDocument(xml) {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? "";
  const elements = [];
  for (const match of body.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const fragment = match[0];
    if (fragment.startsWith("<w:tbl"))
      elements.push(parseTable(fragment));
    else {
      const style = /<w:pStyle w:val="([^"]+)"\/>/.exec(fragment)?.[1];
      elements.push({ kind: "paragraph", text: paragraphText(fragment), style: style ?? null });
    }
  }
  return elements;
}
function registerNameOf(text) {
  const zh = /（([A-Za-z_][A-Za-z0-9_]*)）\s*$/.exec(text);
  if (zh !== null)
    return zh[1];
  const en = /\(([A-Za-z_][A-Za-z0-9_]*)\)\s*$/.exec(text);
  return en === null ? null : en[1];
}
function cellText(cell) {
  return cell === undefined ? "" : cell.texts[0] ?? "";
}
function modelOfDocx(elements, lang) {
  const labels = LABELS2[lang];
  const heading2 = elements.map((element, index) => ({ element, index })).filter(({ element }) => element.kind === "paragraph" && element.style === "Heading2");
  const chapterEntry = heading2.find(({ element }) => element.kind === "paragraph" && element.text === labels.chapterTitle);
  if (chapterEntry === undefined)
    throw new Error('no Heading 2 "' + labels.chapterTitle + '" chapter');
  if (chapterEntry.index !== (heading2[heading2.length - 1]?.index ?? -1)) {
    throw new Error('the "' + labels.chapterTitle + '" chapter is not the last Heading 2');
  }
  let overview = null;
  const chapters = [];
  let index = chapterEntry.index + 1;
  while (index < elements.length) {
    const element = elements[index];
    if (element.kind !== "paragraph" || element.style !== "Heading3") {
      if (overview === null && element.kind === "table")
        overview = element;
      index++;
      continue;
    }
    const name = registerNameOf(element.text);
    if (name === null)
      throw new Error('register H3 "' + element.text + '" has no (NAME) identifier');
    const offset = elements[index + 1];
    const reset = elements[index + 2];
    const bitTable = elements[index + 3];
    const spacer = elements[index + 4];
    const detailTable = elements[index + 5];
    if (offset === undefined || offset.kind !== "paragraph" || !offset.text.startsWith(labels.offsetPrefix)) {
      throw new Error("register " + name + ": missing `" + labels.offsetPrefix + "0x..` line after its H3");
    }
    if (reset === undefined || reset.kind !== "paragraph" || !reset.text.startsWith(labels.resetPrefix)) {
      throw new Error("register " + name + ": missing `" + labels.resetPrefix + "0x..` line");
    }
    if (bitTable === undefined || bitTable.kind !== "table")
      throw new Error("register " + name + ": missing its bit table");
    if (spacer === undefined || spacer.kind !== "paragraph")
      throw new Error("register " + name + ": missing the paragraph after its bit table");
    if (detailTable === undefined || detailTable.kind !== "table")
      throw new Error("register " + name + ": missing its detail table");
    chapters.push({
      name,
      title: element.text,
      offset: offset.text.slice(labels.offsetPrefix.length),
      reset: reset.text.slice(labels.resetPrefix.length),
      bitTable,
      detailTable
    });
    index += 6;
  }
  if (chapters.length === 0)
    throw new Error('the "' + labels.chapterTitle + '" chapter has no register H3 blocks');
  const names = new Set;
  for (const chapter of chapters) {
    if (names.has(chapter.name))
      throw new Error("duplicate register chapter: " + chapter.name);
    names.add(chapter.name);
  }
  return { elements, chapterIndex: chapterEntry.index, overview, chapters };
}
function checkV1(sheet, parts) {
  const workbook = partText(parts, "xl/workbook.xml");
  const sheetName = /<sheet name="([^"]+)"/.exec(workbook)?.[1];
  if (sheetName !== "Sheet1")
    throw new Error("sheet name is " + JSON.stringify(sheetName ?? null) + ', expected "Sheet1"');
  const header = sheet.rows.get(1);
  if (header === undefined)
    throw new Error("the sheet has no header row");
  const problems = [];
  for (let column = 0;column < HEADERS2.length; column++) {
    const actual = header.get(COLUMN_LETTERS2[column])?.value ?? "";
    if (actual !== HEADERS2[column]) {
      problems.push(COLUMN_LETTERS2[column] + "1 = " + JSON.stringify(actual) + ", expected " + JSON.stringify(HEADERS2[column]));
    }
  }
  if (problems.length > 0)
    throw new Error("header row differs: " + problems.join("; "));
  return 'sheet "Sheet1" with all 9 header texts';
}
function checkV2(sheet, model) {
  if (model.unclassified.length > 0)
    throw new Error("rows are neither Reg nor field rows: " + model.unclassified.join(", "));
  const expectedLast = model.rowNumbers.length === 0 ? 0 : model.rowNumbers[model.rowNumbers.length - 1];
  for (let index = 0;index < model.rowNumbers.length; index++) {
    if (model.rowNumbers[index] !== index + 1)
      throw new Error("row numbers are not contiguous at row " + model.rowNumbers[index]);
  }
  const fieldCount = model.registerRows.reduce((total, row) => total + (model.fieldsOf.get(row)?.length ?? 0), 0);
  if (model.rowNumbers.length !== 1 + model.registerRows.length + fieldCount) {
    throw new Error("row model is 1 + " + model.registerRows.length + " + " + fieldCount + ", but the sheet has " + model.rowNumbers.length + " rows");
  }
  for (const rowNumber of model.rowNumbers) {
    const columns = [...sheet.rows.get(rowNumber)?.keys() ?? []].sort().join("");
    if (columns !== COLUMN_LETTERS2.join(""))
      throw new Error("row " + rowNumber + " does not carry exactly A..I (" + columns + ")");
  }
  if (sheet.dimension !== "A1:I" + expectedLast)
    throw new Error("dimension is " + JSON.stringify(sheet.dimension) + ", expected A1:I" + expectedLast);
  return "1 header + " + model.registerRows.length + " Reg + " + fieldCount + " field rows, 9 columns each";
}
function checkV3(sheet, model, styles) {
  if (model.registerRows.length === 0)
    throw new Error("no Reg row (`access type = Mixed`) found");
  for (const rowNumber of model.registerRows) {
    const cell = cellAt(sheet, rowNumber, "A");
    const style = resolveStyle(styles, cell);
    if (cell.value.trim() === "")
      throw new Error("Reg row " + rowNumber + " has an empty register name");
    if (!style.font.bold)
      throw new Error("Reg row " + rowNumber + " (" + cell.value + ") is not bold");
    if (style.fill !== "FFFFFF00")
      throw new Error("Reg row " + rowNumber + " (" + cell.value + ") fill is " + JSON.stringify(style.fill) + ", expected FFFFFF00");
    if (cellAt(sheet, rowNumber, "D").value !== "Mixed")
      throw new Error("Reg row " + rowNumber + " access cell is not the literal Mixed");
    if ((model.fieldsOf.get(rowNumber)?.length ?? 0) === 0)
      throw new Error("Reg row " + rowNumber + " (" + cell.value + ") has no field rows");
  }
  return model.registerRows.length + " Reg rows bold + FFFFFF00 + Mixed";
}
function checkV4(sheet, model) {
  let fieldTotal = 0;
  let reservedTotal = 0;
  for (const registerRow of model.registerRows) {
    const registerName = cellAt(sheet, registerRow, "A").value;
    const reset = cellAt(sheet, registerRow, "E").value;
    if (!REGISTER_RESET.test(reset))
      throw new Error("register " + registerName + ": reset value " + JSON.stringify(reset) + " is not 0x + 4/8 uppercase hex");
    const rows = model.fieldsOf.get(registerRow) ?? [];
    const spans = [];
    for (const rowNumber of rows) {
      const offset = cellAt(sheet, rowNumber, "B").value;
      const match = FIELD_OFFSET.exec(offset);
      if (match === null)
        throw new Error("register " + registerName + ": field offset " + JSON.stringify(offset) + " is not [hi:lo] or [N]");
      const hi = Number(match[1]);
      const lo = match[2] === undefined ? hi : Number(match[2]);
      if (hi > 31 || lo > hi)
        throw new Error("register " + registerName + ": field offset " + offset + " is outside [31:0]");
      spans.push({ hi, lo });
      const name = cellAt(sheet, rowNumber, "C").value;
      const fieldReset = cellAt(sheet, rowNumber, "E").value;
      if (!FIELD_RESET.test(fieldReset))
        throw new Error("register " + registerName + ": field " + name + " reset " + JSON.stringify(fieldReset) + " is not {width}'h{HEX}");
      if (name === "RESERVED") {
        reservedTotal++;
        const access = cellAt(sheet, rowNumber, "D").value;
        if (access !== "")
          throw new Error("register " + registerName + ": RESERVED span " + offset + " carries access " + JSON.stringify(access));
        const description = cellAt(sheet, rowNumber, "F").value;
        if (description !== "保留，必须保持复位值") {
          throw new Error("register " + registerName + ": RESERVED span " + offset + " description is " + JSON.stringify(description));
        }
      }
    }
    assertSpanList(spans, "register " + registerName);
    fieldTotal += rows.length;
  }
  return fieldTotal + " field rows descending and covering [31:0], " + reservedTotal + " RESERVED rows canonical";
}
function checkV5(sheet, styles) {
  for (let column = 0;column < COLUMN_LETTERS2.length; column++) {
    const width = sheet.widths.get(COLUMN_LETTERS2[column]);
    if (width !== COLUMN_WIDTHS2[column]) {
      throw new Error("column " + COLUMN_LETTERS2[column] + " width is " + JSON.stringify(width ?? null) + ", expected " + COLUMN_WIDTHS2[column]);
    }
  }
  if (sheet.heights.get(1) !== HEADER_ROW_HEIGHT2)
    throw new Error("header row height is " + JSON.stringify(sheet.heights.get(1) ?? null) + ", expected 43.2");
  for (const [rowNumber, cells] of sheet.rows) {
    for (const [column, cell] of cells) {
      const style = resolveStyle(styles, cell);
      if (!style.borderThin)
        throw new Error("cell " + column + rowNumber + " does not carry a thin border");
    }
  }
  for (const font of styles.fonts) {
    if (font.size !== 11)
      throw new Error("font " + font.name + " has size " + font.size + ", expected 11");
  }
  if (!styles.fonts.some((font) => font.name === "Calibri"))
    throw new Error("no Calibri font in styles.xml");
  if (!styles.fonts.some((font) => font.name === "宋体" && font.charset === 134))
    throw new Error("no 宋体 font with charset 134 in styles.xml");
  if (!styles.fonts.some((font) => font.name === "宋体" && font.bold))
    throw new Error("no bold 宋体 font (CJK Reg-row headers)");
  if (!styles.fills.includes("FFD9D9D9"))
    throw new Error("no FFD9D9D9 header fill in styles.xml");
  if (!styles.fills.includes("FFFFFF00"))
    throw new Error("no FFFFFF00 Reg-row fill in styles.xml");
  return "9 widths, 43.2 header height, thin borders on every cell, size 11 + Calibri/宋体(134)";
}
function checkV6(parts) {
  const missing = DOCX_PARTS.filter((name) => !parts.has(name));
  if (missing.length > 0)
    throw new Error("missing parts: " + missing.join(", "));
  const xml = partText(parts, "word/document.xml");
  if (!xml.startsWith("<?xml"))
    throw new Error("document.xml has no XML declaration");
  if (!/<w:document\b/.test(xml))
    throw new Error("document.xml has no <w:document> root");
  if (!/<w:body>/.test(xml))
    throw new Error("document.xml has no <w:body>");
  for (const tag of ["w:document", "w:body", "w:tbl", "w:tr", "w:tc", "w:p"]) {
    const open = (xml.match(new RegExp("<" + tag + "(?=[\\s/>])", "g")) ?? []).length;
    const close = (xml.match(new RegExp("</" + tag + ">", "g")) ?? []).length;
    const selfClosing = (xml.match(new RegExp("<" + tag + "\\b[^>]*/>", "g")) ?? []).length;
    if (open !== close + selfClosing)
      throw new Error("unbalanced <" + tag + ">: " + open + " open, " + close + " close, " + selfClosing + " self-closing");
  }
  const sectPr = (xml.match(/<w:sectPr\b/g) ?? []).length;
  if (sectPr !== 1)
    throw new Error("expected exactly one <w:sectPr>, found " + sectPr);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1]?.trimEnd() ?? "";
  if (!body.endsWith("</w:sectPr>"))
    throw new Error("the last body element is not <w:sectPr>");
  return DOCX_PARTS.length + " required parts, balanced tags, one trailing sectPr";
}
function checkV7(model) {
  for (const chapter of model.chapters) {
    if (!/^0x[0-9A-Fa-f]+$/.test(chapter.offset)) {
      throw new Error("register " + chapter.name + ": offset line " + JSON.stringify(chapter.offset) + " is not 0x..");
    }
    if (!/^0x[0-9A-Fa-f\s]+$/.test(chapter.reset)) {
      throw new Error("register " + chapter.name + ": reset line " + JSON.stringify(chapter.reset) + " is not 0x..");
    }
  }
  return model.chapters.length + " H3 register chapters below the H2, each with offset/reset lines";
}
function checkV8(model) {
  const overview = model.overview;
  if (overview === null)
    throw new Error("no overview table between the register H2 and the first H3");
  const header = overview.rows[0];
  if (header === undefined)
    throw new Error("the overview table has no header row");
  const headerTexts = header.cells.map((cell) => cellText(cell));
  if (headerTexts.length !== 3 || headerTexts[0] !== "Offset" || headerTexts[1] !== "Register" || headerTexts[2] !== "31..0") {
    throw new Error("overview header is " + JSON.stringify(headerTexts) + ', expected ["Offset","Register","31..0"]');
  }
  if (header.cells[2].span !== 32)
    throw new Error("the 31..0 header cell spans " + header.cells[2].span + ", expected 32");
  if (header.height !== 278)
    throw new Error("overview header row height is " + JSON.stringify(header.height) + ", expected 278");
  if (overview.rows.length !== 1 + 2 * model.chapters.length) {
    throw new Error("overview has " + (overview.rows.length - 1) + " data rows for " + model.chapters.length + " registers");
  }
  let reserved = 0;
  for (let index = 0;index < model.chapters.length; index++) {
    const chapter = model.chapters[index];
    const nameRow = overview.rows[1 + 2 * index];
    const resetRow = overview.rows[2 + 2 * index];
    if (nameRow === undefined || resetRow === undefined)
      throw new Error("overview rows for register " + chapter.name + " are missing");
    if (nameRow.height !== 902)
      throw new Error("register " + chapter.name + " name-row height is " + JSON.stringify(nameRow.height) + ", expected 902");
    if (resetRow.height !== 278)
      throw new Error("register " + chapter.name + " reset-row height is " + JSON.stringify(resetRow.height) + ", expected 278");
    if (cellText(nameRow.cells[0]) !== chapter.offset) {
      throw new Error("register " + chapter.name + ": overview offset " + JSON.stringify(cellText(nameRow.cells[0])) + " disagrees with its chapter " + JSON.stringify(chapter.offset));
    }
    if (cellText(resetRow.cells[1]) !== "Reset value")
      throw new Error("register " + chapter.name + ': reset-row label is not "Reset value"');
    const bitCells = nameRow.cells.slice(2);
    const spanSum = bitCells.reduce((total, cell) => total + cell.span, 0);
    if (spanSum !== 32)
      throw new Error("register " + chapter.name + ": overview field cells span " + spanSum + " bits, expected 32");
    if (resetRow.cells.slice(2).reduce((total, cell) => total + cell.span, 0) !== 32) {
      throw new Error("register " + chapter.name + ": reset-row cells do not cover 32 bits");
    }
    for (const cell of bitCells) {
      if (cellText(cell) !== "RESERVED")
        continue;
      reserved++;
      if (cell.fill !== RESERVED_FILL)
        throw new Error("register " + chapter.name + ": RESERVED band fill is " + JSON.stringify(cell.fill) + ", expected " + RESERVED_FILL);
    }
    for (const cell of resetRow.cells.slice(2)) {
      const bit = cellText(cell);
      if (bit !== "" && bit !== "0" && bit !== "1")
        throw new Error("register " + chapter.name + ": reset bit cell is " + JSON.stringify(bit));
    }
  }
  return model.chapters.length + " registers × 2 rows (902/278), " + reserved + " gray RESERVED bands, header + gridSpan checked";
}
function checkV9(model, lang) {
  const labels = LABELS2[lang];
  let fieldTotal = 0;
  for (const chapter of model.chapters) {
    const table = chapter.bitTable;
    if (table.grid.length !== 16)
      throw new Error("register " + chapter.name + ": bit table grid has " + table.grid.length + " columns, expected 16");
    if (table.rows.length !== 6)
      throw new Error("register " + chapter.name + ": bit table has " + table.rows.length + " rows, expected 6");
    if (table.rows[0].cells.length !== 16 || table.rows[3].cells.length !== 16) {
      throw new Error("register " + chapter.name + ": the bit-number rows are not 16 cells wide");
    }
    if (cellText(table.rows[0].cells[0]) !== "31" || cellText(table.rows[0].cells[15]) !== "16") {
      throw new Error("register " + chapter.name + ": the upper bit-number row is not 31..16");
    }
    if (cellText(table.rows[3].cells[0]) !== "15" || cellText(table.rows[3].cells[15]) !== "0") {
      throw new Error("register " + chapter.name + ": the lower bit-number row is not 15..0");
    }
    if (table.rows[1].height !== 420 || table.rows[4].height !== 420) {
      throw new Error("register " + chapter.name + ": field-name row height is not 420");
    }
    const detail = chapter.detailTable;
    if (detail.grid.length !== DETAIL_GRID2.length || detail.grid.some((width, index) => width !== DETAIL_GRID2[index])) {
      throw new Error("register " + chapter.name + ": detail grid is " + JSON.stringify(detail.grid) + ", expected " + JSON.stringify(DETAIL_GRID2));
    }
    const header = detail.rows[0];
    if (header === undefined)
      throw new Error("register " + chapter.name + ": detail table has no header row");
    const headerTexts = header.cells.map((cell) => cellText(cell));
    if (headerTexts.length !== 3 || headerTexts.some((text, index) => text !== labels.detailHeaders[index])) {
      throw new Error("register " + chapter.name + ": detail header is " + JSON.stringify(headerTexts));
    }
    const spans = [];
    for (const row of detail.rows.slice(1)) {
      const range = parseSpan(cellText(row.cells[0]));
      if (range === null)
        throw new Error("register " + chapter.name + ": detail bit field " + JSON.stringify(cellText(row.cells[0])) + " is not a bit range");
      if (cellText(row.cells[1]).trim() === "")
        throw new Error("register " + chapter.name + ": detail row " + cellText(row.cells[0]) + " has no field name");
      spans.push(range);
    }
    assertSpanList(spans, "register " + chapter.name + " detail");
    fieldTotal += spans.length;
  }
  return model.chapters.length + " registers: 6×16 bit tables (trHeight 420) and 830/1659/5807 detail tables, " + fieldTotal + " fields";
}
function skeletonOf(model) {
  return model.chapters.map((chapter) => ({
    name: chapter.name,
    offset: chapter.offset,
    reset: chapter.reset,
    fields: chapter.detailTable.rows.slice(1).map((row) => ({ range: cellText(row.cells[0]), name: cellText(row.cells[1]) }))
  }));
}
function chapterOffset(chapter, lang) {
  try {
    return offsetNumber(chapter.offset.replace(/\s+/g, ""));
  } catch {
    throw new Error("register " + chapter.name + " offset is not a hex literal in " + lang + ": " + JSON.stringify(chapter.offset));
  }
}
function chapterWidth(chapter, lang) {
  try {
    return parseResetHex(chapter.reset).digits.length === 8 ? 32 : 16;
  } catch {
    throw new Error("register " + chapter.name + " reset value has no derivable width in " + lang + ": " + JSON.stringify(chapter.reset));
  }
}
function checkV11(zh, en) {
  if (zh.length !== en.length)
    throw new Error("register count differs: zh " + zh.length + ", en " + en.length);
  let fieldTotal = 0;
  for (let index = 0;index < zh.length; index++) {
    const left = zh[index];
    const right = en[index];
    if (left.name !== right.name)
      throw new Error("register " + (index + 1) + " identifier differs: zh " + left.name + ", en " + right.name);
    const zhOffset = chapterOffset(left, "zh-CN");
    const enOffset = chapterOffset(right, "en");
    if (zhOffset !== enOffset) {
      throw new Error("register " + left.name + " offset differs: zh " + left.offset + " (" + zhOffset + "), en " + right.offset + " (" + enOffset + ")");
    }
    const zhWidth = chapterWidth(left, "zh-CN");
    const enWidth = chapterWidth(right, "en");
    if (zhWidth !== enWidth)
      throw new Error("register " + left.name + " width differs: zh " + zhWidth + ", en " + enWidth);
    if (left.fields.length !== right.fields.length) {
      throw new Error("register " + left.name + " field count differs: zh " + left.fields.length + ", en " + right.fields.length);
    }
    for (let field = 0;field < left.fields.length; field++) {
      const a = left.fields[field];
      const b = right.fields[field];
      if (a.range !== b.range || a.name !== b.name) {
        throw new Error("register " + left.name + " field " + (field + 1) + " differs: zh (" + a.range + ", " + a.name + "), en (" + b.range + ", " + b.name + ")");
      }
    }
    fieldTotal += left.fields.length;
  }
  return zh.length + " registers and " + fieldTotal + " fields agree between zh and en (identifiers, offsets, widths, spans)";
}
function checkV12(texts, paths) {
  const found = [];
  for (let index = 0;index < texts.length; index++) {
    for (const placeholder of PLACEHOLDERS) {
      if (texts[index].includes(placeholder))
        found.push(paths[index] + ": " + placeholder);
    }
  }
  if (found.length > 0)
    throw new Error("placeholder text found: " + found.join("; "));
  return "no template placeholder in " + texts.length + " artifact(s)";
}
function loadArtifact(argument, exec) {
  const path = resolveInputPath(argument, exec);
  return { path, parts: readZip(new Uint8Array(readFileSync4(path))) };
}
function loadDocx(argument, lang, exec) {
  try {
    const artifact = loadArtifact(argument, exec);
    const xml = partText(artifact.parts, "word/document.xml");
    return { ok: true, docx: { path: artifact.path, lang, parts: artifact.parts, model: modelOfDocx(parseDocument(xml), lang) } };
  } catch (error) {
    const path = resolveInputPath(argument, exec);
    return { ok: false, path, reason: messageOf(error) };
  }
}
function record(checks, id, body) {
  try {
    checks.push({ id, ok: true, detail: body() });
  } catch (error) {
    checks.push({ id, ok: false, detail: messageOf(error) });
  }
}
function failAll(checks, ids, reason) {
  for (const id of ids)
    checks.push({ id, ok: false, detail: reason });
}
function executeVerify(args, exec) {
  const xlsxArg = optionalString4(args, "xlsx");
  const zhArg = optionalString4(args, "docxZh");
  const enArg = optionalString4(args, "docxEn");
  if (xlsxArg === undefined && zhArg === undefined && enArg === undefined) {
    throw new DocgenError("DOCGEN_E_INPUT", "no artifact to verify for " + TOOL_NAME4, "pass at least one of xlsx, docxZh, docxEn (paths relative to the workspace root)");
  }
  const checks = [];
  let xlsxArtifact = null;
  let xlsxReason = "";
  if (xlsxArg !== undefined) {
    try {
      xlsxArtifact = loadArtifact(xlsxArg, exec);
    } catch (error) {
      xlsxReason = messageOf(error);
    }
    if (xlsxArtifact === null) {
      failAll(checks, XLSX_IDS, xlsxReason);
    } else {
      const artifact = xlsxArtifact;
      let sheet = null;
      let styles = null;
      try {
        sheet = parseSheet(partText(artifact.parts, "xl/worksheets/sheet1.xml"));
        styles = parseStyles(partText(artifact.parts, "xl/styles.xml"));
      } catch (error) {
        failAll(checks, XLSX_IDS, messageOf(error));
      }
      if (sheet !== null && styles !== null) {
        const parsedSheet = sheet;
        const parsedStyles = styles;
        const model = modelOf(parsedSheet);
        record(checks, "V1", () => checkV1(parsedSheet, artifact.parts));
        record(checks, "V2", () => checkV2(parsedSheet, model));
        record(checks, "V3", () => checkV3(parsedSheet, model, parsedStyles));
        record(checks, "V4", () => checkV4(parsedSheet, model));
        record(checks, "V5", () => checkV5(parsedSheet, parsedStyles));
      }
    }
  }
  const docxLoads = [];
  if (zhArg !== undefined)
    docxLoads.push(loadDocx(zhArg, "zh-CN", exec));
  if (enArg !== undefined)
    docxLoads.push(loadDocx(enArg, "en", exec));
  if (docxLoads.length > 0) {
    const failures = docxLoads.filter((load) => !load.ok);
    const loaded = [];
    for (const load of docxLoads)
      if (load.ok)
        loaded.push(load.docx);
    const runDocx = (id, body) => {
      if (failures.length > 0) {
        const reasons = failures.map((load) => load.ok ? "" : load.path + ": " + load.reason);
        checks.push({ id, ok: false, detail: reasons.join("; ") });
        return;
      }
      record(checks, id, () => loaded.map((docx) => docx.lang + ": " + body(docx)).join("; "));
    };
    runDocx("V6", (docx) => checkV6(docx.parts));
    runDocx("V7", (docx) => checkV7(docx.model));
    runDocx("V8", (docx) => checkV8(docx.model));
    runDocx("V9", (docx) => checkV9(docx.model, docx.lang));
    if (zhArg !== undefined && enArg !== undefined) {
      const zhLoad = docxLoads[0];
      const enLoad = docxLoads[1];
      if (zhLoad.ok && enLoad.ok) {
        const zhDocx = zhLoad.docx;
        const enDocx = enLoad.docx;
        record(checks, "V11", () => checkV11(skeletonOf(zhDocx.model), skeletonOf(enDocx.model)));
      } else {
        const reasons = docxLoads.filter((load) => !load.ok).map((load) => load.ok ? "" : load.path + ": " + load.reason);
        checks.push({ id: "V11", ok: false, detail: reasons.join("; ") });
      }
    }
  }
  const placeholderTexts = [];
  const placeholderPaths = [];
  const placeholderFailures = [];
  if (xlsxArg !== undefined) {
    if (xlsxArtifact === null)
      placeholderFailures.push(xlsxReason);
    else {
      try {
        placeholderTexts.push(decodeEntities(partText(xlsxArtifact.parts, "xl/worksheets/sheet1.xml")) + `
` + decodeEntities(partText(xlsxArtifact.parts, "xl/workbook.xml")));
        placeholderPaths.push(xlsxArtifact.path);
      } catch (error) {
        placeholderFailures.push(messageOf(error));
      }
    }
  }
  for (const load of docxLoads) {
    if (!load.ok) {
      placeholderFailures.push(load.path + ": " + load.reason);
      continue;
    }
    try {
      placeholderTexts.push(decodeEntities(partText(load.docx.parts, "word/document.xml")) + `
` + decodeEntities(partText(load.docx.parts, "docProps/core.xml")));
      placeholderPaths.push(load.docx.path);
    } catch (error) {
      placeholderFailures.push(messageOf(error));
    }
  }
  if (placeholderFailures.length > 0) {
    checks.push({ id: "V12", ok: false, detail: placeholderFailures.join("; ") });
  } else {
    record(checks, "V12", () => checkV12(placeholderTexts, placeholderPaths));
  }
  return { ok: checks.every((check) => check.ok), checks, failed: checks.filter((check) => !check.ok).map((check) => check.id) };
}
function render4(value) {
  const failure = value;
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME4 + " FAILED [" + failure.error.code + "]: " + failure.error.message + `
hint: ` + failure.error.hint }];
  }
  const result = value;
  const lines = [TOOL_NAME4 + ": " + (result.ok ? "PASS" : "FAIL") + ", " + result.checks.length + " checks"];
  for (const check of result.checks)
    lines.push("  " + (check.ok ? "ok  " : "FAIL") + " " + check.id + " — " + check.detail);
  if (result.failed.length > 0)
    lines.push("failed: " + result.failed.join(", "));
  return [{ type: "text", text: lines.join(`
`) }];
}
function docgenVerifyToolDefinition() {
  return {
    name: TOOL_NAME4,
    description: "Gate oracle for the generated artifacts: reads only the produced xlsx/docx files and asserts V1-V5 (sheet name and 9 headers, row model, Reg-row style, field spans/RESERVED/reset formats, borders/widths/fonts), V6-V9 (9 parts + trailing sectPr, register H2 + H3 chapters, overview table, bit/detail tables), V11 (zh/en skeleton equality derived from the two documents) and V12 (no template placeholders). A missing or corrupt file fails its checks with the reason instead of throwing; ok is true only when every requested check passed.",
    parameters: {
      type: "object",
      properties: {
        xlsx: { type: "string", description: "xlsx path to verify, relative to the workspace root" },
        docxZh: { type: "string", description: "zh-CN docx path to verify, relative to the workspace root" },
        docxEn: { type: "string", description: "en docx path to verify, relative to the workspace root" }
      }
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          checks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                ok: { type: "boolean" },
                detail: { type: "string" }
              }
            }
          },
          failed: { type: "array", items: { type: "string" } },
          error: { type: "object" }
        }
      },
      render: (_args, value) => render4(value)
    },
    execute: async (args, exec) => {
      try {
        return executeVerify(args ?? {}, exec);
      } catch (error) {
        return refusalOf4(error);
      }
    }
  };
}

// src/index.ts
var name = "mpd-docgen";
var inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"];
function apply(ctx) {
  const dsh = ctx.mpdDsh;
  const definitions = [
    registerXlsxToolDefinition(),
    userManualDocxToolDefinition(),
    docgenRunToolDefinition(),
    docgenVerifyToolDefinition()
  ];
  for (const definition of definitions)
    dsh.registerTool(definition);
}
export {
  apply,
  inject,
  name
};
