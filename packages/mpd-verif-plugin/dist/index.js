// src/compile.ts
import { join as join4 } from "node:path";

// src/backends.ts
import { writeFileSync as writeFileSync3, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";

// src/env.ts
import { existsSync as existsSync2 } from "node:fs";
import { join as join2, resolve as resolve2 } from "node:path";
import { workspaceRootOf as workspaceRootOf2 } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";

// src/silicon/config.ts
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { workspaceRootOf } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";

// src/silicon/jsonc.ts
var RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function stripJsonc(src) {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"')
        inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== `
`)
        i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      for (;; ) {
        while (j < src.length && /\s/.test(src[j]))
          j++;
        if (src[j] === "/" && src[j + 1] === "/") {
          while (j < src.length && src[j] !== `
`)
            j++;
          continue;
        }
        if (src[j] === "/" && src[j + 1] === "*") {
          j += 2;
          while (j < src.length && !(src[j] === "*" && src[j + 1] === "/"))
            j++;
          j += 2;
          continue;
        }
        break;
      }
      if (src[j] === "}" || src[j] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
function parseJsonc(src) {
  return JSON.parse(stripJsonc(src));
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base, over) {
  const out = {};
  const bkeys = isPlainObject(base) ? Object.keys(base) : [];
  const okeys = isPlainObject(over) ? Object.keys(over) : [];
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key))
      continue;
    const bv = isPlainObject(base) ? base[key] : undefined;
    const ov = isPlainObject(over) ? over[key] : undefined;
    if (isPlainObject(bv) && isPlainObject(ov))
      out[key] = deepMerge(bv, ov);
    else if (isPlainObject(bv) && ov === undefined)
      out[key] = deepMerge(bv, {});
    else
      out[key] = ov !== undefined ? ov : bv;
  }
  return out;
}
function getPath(value, path) {
  let cur = value;
  for (const segment of path) {
    if (!isPlainObject(cur))
      return;
    if (!Object.prototype.hasOwnProperty.call(cur, segment))
      return;
    cur = cur[segment];
  }
  return cur;
}

// src/silicon/jsonc-edit.ts
var DELETE = Symbol.for("mpd.silicon.jsonc.delete");
function isWs(ch) {
  return ch === " " || ch === "\t" || ch === `
` || ch === "\r";
}
function skipTrivia(src, pos) {
  let i = pos;
  for (;; ) {
    while (i < src.length && isWs(src[i]))
      i++;
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== `
`)
        i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i = Math.min(src.length, i + 2);
      continue;
    }
    return i;
  }
}
function trailingCommentEnd(src, from) {
  let i = from;
  let end = from;
  for (;; ) {
    let probe = i;
    while (probe < src.length && (src[probe] === " " || src[probe] === "\t"))
      probe++;
    if (src[probe] === "/" && src[probe + 1] === "/") {
      while (probe < src.length && src[probe] !== `
` && src[probe] !== "\r")
        probe++;
      return probe;
    }
    if (src[probe] === "/" && src[probe + 1] === "*") {
      probe += 2;
      while (probe < src.length && !(src[probe] === "*" && src[probe + 1] === "/"))
        probe++;
      probe = Math.min(src.length, probe + 2);
      end = probe;
      i = probe;
      continue;
    }
    return end;
  }
}
function scanString(src, pos) {
  let i = pos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"')
      return i + 1;
    i++;
  }
  return src.length;
}
function scanValue(src, pos) {
  const start = pos;
  const ch = src[pos];
  if (ch === '"') {
    const end = scanString(src, pos);
    return { start, end };
  }
  let i = pos;
  while (i < src.length && !/[\s,}\]]/.test(src[i]))
    i++;
  return { start, end: i };
}
function parseContainer(src, open) {
  const kind = src[open] === "{" ? "object" : "array";
  const closeCh = kind === "object" ? "}" : "]";
  const entries = [];
  let i = skipTrivia(src, open + 1);
  let trailingComma = false;
  for (;; ) {
    if (i >= src.length)
      return;
    if (src[i] === closeCh) {
      return { kind, open, close: i, entries };
    }
    if (kind === "array") {
      let end;
      if (src[i] === "{" || src[i] === "[") {
        const nested = parseContainer(src, i);
        if (nested === undefined)
          return;
        end = nested.close + 1;
      } else {
        end = scanValue(src, i).end;
      }
      entries.push({ valueStart: i, valueEnd: end });
      i = skipTrivia(src, end);
      if (src[i] === ",") {
        i = skipTrivia(src, i + 1);
        trailingComma = src[i] === closeCh;
        continue;
      }
      if (src[i] === closeCh)
        continue;
      return;
    }
    if (src[i] !== '"')
      return;
    const keyStart = i;
    const keyEnd = scanString(src, i);
    const keyRaw = src.slice(keyStart, keyEnd);
    let key;
    try {
      key = JSON.parse(keyRaw);
    } catch {
      return;
    }
    i = skipTrivia(src, keyEnd);
    if (src[i] !== ":")
      return;
    i = skipTrivia(src, i + 1);
    if (i >= src.length)
      return;
    let end;
    if (src[i] === "{" || src[i] === "[") {
      const nested = parseContainer(src, i);
      if (nested === undefined)
        return;
      end = nested.close + 1;
    } else if (src[i] === '"') {
      end = scanString(src, i);
    } else {
      end = scanValue(src, i).end;
    }
    entries.push({ keyRaw, key, keyStart, keyEnd, valueStart: i, valueEnd: end });
    i = skipTrivia(src, end);
    if (src[i] === ",") {
      i = skipTrivia(src, i + 1);
      if (src[i] === closeCh)
        trailingComma = true;
      continue;
    }
    if (src[i] === closeCh)
      continue;
    return;
  }
}
function detectStyle(raw) {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const indentMatch = raw.match(/\n([ \t]+)(?=")/);
  return {
    eol: crlf > lf ? `\r
` : `
`,
    trailingComma: /,\s*[}\]]/.test(raw.replace(/"(?:[^"\\]|\\.)*"/g, '""')),
    indent: indentMatch === null ? "  " : indentMatch[1]
  };
}
var stripJsoncText = stripJsonc;
function indentFor(src, open, style) {
  let depth = 0;
  let inString = false;
  for (let i = 0;i < open; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\")
        i++;
      else if (ch === '"')
        inString = false;
      continue;
    }
    if (ch === '"')
      inString = true;
    else if (ch === "{" || ch === "[")
      depth++;
    else if (ch === "}" || ch === "]")
      depth--;
  }
  return style.indent.repeat(Math.max(depth, 0));
}
function lineAt(src, offset) {
  let line = 1;
  for (let i = 0;i < offset && i < src.length; i++)
    if (src[i] === `
`)
      line++;
  return line;
}
function locate(src, root, path, allowMaterialise, parentOnly = false) {
  let container = root;
  for (let index = 0;index < path.length; index++) {
    const segment = path[index];
    const last = index === path.length - 1;
    if (container.kind === "array") {
      const at = Number(segment);
      if (!Number.isInteger(at) || at < 0 || at >= container.entries.length) {
        if (last)
          return { container, ok: true };
        if (allowMaterialise)
          return { container, missingFrom: index, ok: true };
        return { ok: false, reason: "span-not-proven", detail: `array index ${segment} out of range` };
      }
      const entry = container.entries[at];
      if (last)
        return { container, ...parentOnly ? {} : { entry }, ok: true };
      const nested = parseContainer(src, entry.valueStart);
      if (nested === undefined)
        return { ok: false, reason: "unsupported-shape", detail: "array element is not a container" };
      container = nested;
      continue;
    }
    const matches = container.entries.filter((e) => e.key === segment);
    if (matches.length === 0) {
      if (last)
        return { container, ok: true };
      if (allowMaterialise)
        return { container, missingFrom: index, ok: true };
      return { ok: false, reason: "span-not-proven", detail: `missing intermediate "${segment}"` };
    }
    if (matches.length > 1) {
      const lines = matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)).join(", ");
      if (!last) {
        return { ok: false, reason: "ambiguous-intermediate", detail: `key "${segment}" appears ${matches.length} times (lines ${lines})` };
      }
      const chosen = matches[matches.length - 1];
      const duplicate = { lines: matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)) };
      return { container, entry: chosen, ok: true, ...duplicate };
    }
    const entry = matches[0];
    if (last)
      return { container, ...parentOnly ? {} : { entry }, ok: true };
    const nested = parseContainer(src, entry.valueStart);
    if (nested === undefined) {
      return { ok: false, reason: "unsupported-shape", detail: `"${segment}" is not an object` };
    }
    container = nested;
  }
  return { container, ok: true };
}
function surgicalEdit(raw, path, value, options = {}) {
  if (value === DELETE)
    return surgicalDelete(raw, path);
  const style = detectStyle(raw);
  let parsed;
  try {
    parsed = JSON.parse(stripJsoncText(raw));
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error?.message ?? error) };
  }
  let serialised;
  try {
    serialised = JSON.stringify(value, null, 2);
  } catch {
    return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" };
  }
  if (serialised === undefined)
    return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" };
  const open = skipTrivia(raw, 0);
  const root = parseContainer(raw, open);
  if (root === undefined)
    return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" };
  const found = locate(raw, root, path, options.insert === true);
  if (found.ok !== true)
    return found;
  if (found.entry !== undefined) {
    const existing = raw.slice(found.entry.valueStart, found.entry.valueEnd);
    if (existing === serialised)
      return { ok: true, text: raw, style, changed: false };
    const note = duplicateNote(found.lines, path, "updated");
    return {
      ok: true,
      text: raw.slice(0, found.entry.valueStart) + serialised + raw.slice(found.entry.valueEnd),
      style,
      changed: true,
      ...note === undefined ? {} : { notes: [note] }
    };
  }
  if (options.insert !== true)
    return { ok: false, reason: "span-not-proven", detail: path.join(".") };
  const eol = style.eol;
  const missingFrom = found.missingFrom ?? path.length - 1;
  const leafKey = path[missingFrom];
  const rest = path.slice(missingFrom + 1);
  let subtree = value;
  for (let i = rest.length - 1;i >= 0; i--) {
    const segment = rest[i];
    subtree = /^\d+$/.test(segment) ? [subtree] : { [segment]: subtree };
  }
  const serialisedSubtree = JSON.stringify(subtree, null, 2);
  const container = found.container;
  if (container.kind === "object") {
    const indent = indentFor(raw, container.open, style);
    const inner = indent + style.indent;
    const memberText = `${JSON.stringify(leafKey)}: ${serialisedSubtree.split(`
`).join(eol + inner)}`;
    const entries = container.entries;
    if (entries.length === 0) {
      const interior = raw.slice(container.open + 1, container.close);
      if (interior.trim().length > 0) {
        return { ok: true, text: raw.slice(0, container.open + 1) + eol + inner + memberText + raw.slice(container.open + 1), style, changed: true };
      }
      const text = raw.slice(0, container.open + 1) + eol + inner + memberText + eol + indent + raw.slice(container.close);
      return { ok: true, text, style, changed: true };
    }
    const lastEntry = entries[entries.length - 1];
    const afterLast = skipTrivia(raw, lastEntry.valueEnd);
    const hasComma = raw[afterLast] === ",";
    const anchor = hasComma ? afterLast + 1 : lastEntry.valueEnd;
    const commentEnd = trailingCommentEnd(raw, anchor);
    const insertAt = commentEnd > anchor ? commentEnd : anchor;
    const comma = hasComma ? "" : ",";
    const tail = hasComma && style.trailingComma ? "," : "";
    return {
      ok: true,
      text: raw.slice(0, anchor) + comma + raw.slice(anchor, insertAt) + eol + inner + memberText + tail + raw.slice(insertAt),
      style,
      changed: true
    };
  }
  const indent = indentFor(raw, container.open, style);
  const inner = indent + style.indent;
  const entries = container.entries;
  const item = serialisedSubtree.split(`
`).join(eol + inner);
  if (entries.length === 0) {
    const interior = raw.slice(container.open + 1, container.close);
    if (interior.trim().length > 0) {
      return { ok: true, text: raw.slice(0, container.open + 1) + eol + inner + item + raw.slice(container.open + 1), style, changed: true };
    }
    const text = raw.slice(0, container.open + 1) + eol + inner + item + eol + indent + raw.slice(container.close);
    return { ok: true, text, style, changed: true };
  }
  const lastEntry = entries[entries.length - 1];
  const afterLast = skipTrivia(raw, lastEntry.valueEnd);
  if (raw[afterLast] === ",") {
    const insertAt = afterLast + 1;
    const tail = style.trailingComma ? "," : "";
    return { ok: true, text: raw.slice(0, insertAt) + eol + inner + item + tail + raw.slice(insertAt), style, changed: true };
  }
  return { ok: true, text: raw.slice(0, lastEntry.valueEnd) + "," + eol + inner + item + raw.slice(lastEntry.valueEnd), style, changed: true };
}
function surgicalDelete(raw, path) {
  const style = detectStyle(raw);
  try {
    JSON.parse(stripJsoncText(raw));
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error?.message ?? error) };
  }
  const open = skipTrivia(raw, 0);
  const root = parseContainer(raw, open);
  if (root === undefined)
    return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" };
  const all = locateAllLeaves(raw, root, path);
  if (all.ok !== true)
    return all;
  const spans = all.entries.map((entry) => {
    const start = entry.keyStart ?? entry.valueStart;
    const end = entry.valueEnd;
    let from = start;
    let to = end;
    const tail = raw.slice(end);
    const commaAfter = /^\s*,/.exec(tail);
    if (commaAfter !== null) {
      to = end + commaAfter[0].length;
    } else {
      const head = raw.slice(0, start);
      const commaBefore = /,\s*$/.exec(head);
      if (commaBefore !== null)
        from = start - commaBefore[0].length;
    }
    return { from, to };
  }).sort((a, b) => b.from - a.from);
  let text = raw;
  for (const span of spans)
    text = text.slice(0, span.from) + text.slice(span.to);
  const note = duplicateNote(all.lines, path, "removed");
  let reparsed;
  try {
    reparsed = JSON.parse(stripJsoncText(text));
  } catch (error) {
    return { ok: false, reason: "unsupported-shape", detail: `deletion would leave invalid JSONC: ${String(error?.message ?? error)}` };
  }
  return { ok: true, text, style, changed: true, ...note === undefined ? {} : { notes: [note] } };
}
function duplicateNote(lines, path, action) {
  if (lines === undefined || lines.length < 2)
    return;
  return {
    reason: "duplicate-key",
    lines: [...lines],
    detail: `key "${path.join(".")}" appears ${lines.length} times at lines ${lines.join(", ")}; ${action === "updated" ? "the last occurrence is the effective value and was updated" : "every occurrence was removed, so the key is unset at runtime too"}`
  };
}
function locateAllLeaves(src, root, path) {
  if (path.length === 0)
    return { ok: false, reason: "span-not-proven", detail: "the document root has no leaf span" };
  const parent = locate(src, root, path, false, true);
  if (parent.ok !== true)
    return parent;
  const last = path[path.length - 1];
  const entries = parent.container.kind === "array" ? parent.container.entries.filter((_entry, index) => String(index) === last) : parent.container.entries.filter((entry) => entry.key === last);
  if (entries.length === 0)
    return { ok: false, reason: "span-not-proven", detail: path.join(".") };
  const allProven = entries.every((entry) => entry.valueStart <= entry.valueEnd);
  if (!allProven)
    return { ok: false, reason: "span-not-proven", detail: path.join(".") };
  return { ok: true, entries, lines: entries.map((entry) => lineAt(src, entry.keyStart ?? entry.valueStart)) };
}

// src/errors.ts
class VerifError extends Error {
  code;
  hint;
  constructor(code, message, hint) {
    super(message);
    this.name = "VerifError";
    this.code = code;
    this.hint = hint;
  }
}
function refusal(code, message, hint) {
  return { ok: false, error: { code, message, hint: hint || "see the message" } };
}
function refusalOf(e) {
  if (e instanceof VerifError)
    return { ok: false, error: { code: e.code, message: e.message, hint: e.hint } };
  return refusal("VERIF_E_RUN", "unexpected internal error: " + String(e), "check the plugin log or retry with a narrower request");
}

// src/silicon/config.ts
function explicitScope(scope) {
  if (scope === undefined || scope.length === 0)
    return;
  if (scope === "user" || scope === "workspace")
    return scope;
  throw new VerifError("VERIF_E_CONFIG", "unknown scope '" + scope + "'", "use scope=user or scope=workspace");
}
var SILICON_LEAVES = [
  { path: ["ossCadSuite", "home"], type: "string", isPath: true, description: "oss-cad-suite install root (bin/ is inferred)" },
  { path: ["ossCadSuite", "bin"], type: "string", isPath: true, description: "oss-cad-suite bin dir or a single executable" },
  { path: ["verible", "home"], type: "string", isPath: true, description: "verible install root" },
  { path: ["verible", "bin"], type: "string", isPath: true, description: "verible bin dir or a single executable" },
  { path: ["slangServer", "bin"], type: "string", isPath: true, description: "slang-server bin dir or a single executable (SystemVerilog LSP)" },
  { path: ["librelane", "appimage"], type: "string", isPath: true, description: "librelane AppImage path" },
  { path: ["librelane", "mode"], type: "enum", values: ["auto", "appimage", "devshell", "binary"], description: "librelane execution mode" },
  { path: ["librelane", "appimageExtract"], type: "boolean", description: "extract the AppImage instead of mounting it" },
  { path: ["librelane", "bin"], type: "string", isPath: true, description: "librelane executable or bin dir" },
  { path: ["librelane", "home"], type: "string", isPath: true, description: "librelane install root" }
];
function dshHome() {
  const env = (process.env.DSH_HOME ?? "").trim();
  return env.length > 0 ? resolve(env) : join(homedir(), ".dsh");
}
function expandHome(p) {
  if (p === "~")
    return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\"))
    return join(homedir(), p.slice(2));
  return p;
}
function userConfigPath() {
  const override = (process.env.MPD_SILICON_CONFIG ?? "").trim();
  return override.length > 0 ? resolve(expandHome(override)) : join(dshHome(), "silicon.jsonc");
}
function workspaceConfigPath(exec) {
  return join(workspaceRootOf(exec), ".mpd", "silicon.jsonc");
}
function siliconPaths(exec) {
  return { dshHome: dshHome(), workspaceRoot: workspaceRootOf(exec), userFile: userConfigPath(), workspaceFile: workspaceConfigPath(exec) };
}
function readSiliconLayer(path) {
  if (!existsSync(path))
    return { path, exists: false, raw: null, value: {}, parseError: null };
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { path, exists: true, raw: null, value: {}, parseError: "unreadable: " + String(e?.message ?? e) };
  }
  if (raw.trim().length === 0)
    return { path, exists: true, raw, value: {}, parseError: null };
  try {
    const parsed = parseJsonc(raw);
    if (!isPlainObject(parsed))
      return { path, exists: true, raw, value: {}, parseError: "the document root is not a JSON object" };
    return { path, exists: true, raw, value: parsed, parseError: null };
  } catch (e) {
    return { path, exists: true, raw, value: {}, parseError: String(e?.message ?? e) };
  }
}
function isKnownPrefix(prefix) {
  return SILICON_LEAVES.some((leaf) => prefix.every((segment, i) => leaf.path[i] === segment));
}
function isExactLeaf(path) {
  return SILICON_LEAVES.some((leaf) => leaf.path.length === path.length && leaf.path.every((segment, i) => segment === path[i]));
}
function leafPaths(value, prefix = []) {
  if (!isPlainObject(value))
    return prefix.length > 0 ? [[...prefix]] : [];
  const keys = Object.keys(value).filter((k) => !RESERVED_KEYS.has(k));
  if (keys.length === 0)
    return prefix.length > 0 ? [[...prefix]] : [];
  const out = [];
  for (const key of keys)
    out.push(...leafPaths(value[key], [...prefix, key]));
  return out;
}
function collectUnknown(value, prefix = []) {
  if (!isPlainObject(value))
    return [];
  const out = [];
  for (const key of Object.keys(value)) {
    if (RESERVED_KEYS.has(key))
      continue;
    const path = [...prefix, key];
    if (!isKnownPrefix(path))
      out.push(path.join("."));
    else if (!isExactLeaf(path))
      out.push(...collectUnknown(value[key], path));
  }
  return out;
}
function kindOf(v) {
  if (Array.isArray(v))
    return "array";
  if (v === null)
    return "null";
  return typeof v;
}
function invalidLeaf(leaf, value) {
  const key = leaf.path.join(".");
  if (value === undefined)
    return null;
  if (leaf.type === "boolean")
    return typeof value === "boolean" ? null : { key, expected: "boolean", actual: kindOf(value) };
  if (leaf.type === "enum") {
    if (typeof value !== "string")
      return { key, expected: leaf.values?.join("|") ?? "string", actual: kindOf(value) };
    return leaf.values?.includes(value) ? null : { key, expected: leaf.values?.join("|") ?? "string", actual: JSON.stringify(value) };
  }
  return typeof value === "string" ? null : { key, expected: "string", actual: kindOf(value) };
}
function loadSiliconConfig(exec) {
  const user = readSiliconLayer(userConfigPath());
  const workspace = readSiliconLayer(workspaceConfigPath(exec));
  const config = deepMerge(user.value, workspace.value);
  const parseErrors = [];
  if (user.parseError)
    parseErrors.push({ file: "user", path: user.path, error: user.parseError });
  if (workspace.parseError)
    parseErrors.push({ file: "workspace", path: workspace.path, error: workspace.parseError });
  const invalidKeys = [];
  const reportedGroups = new Set;
  for (const leaf of SILICON_LEAVES) {
    const groupPath = leaf.path.slice(0, -1);
    const group = leaf.path.length > 1 ? getPath(config, groupPath) : config;
    if (groupPath.length > 0 && group !== undefined && !isPlainObject(group)) {
      const key = groupPath.join(".");
      if (!reportedGroups.has(key)) {
        reportedGroups.add(key);
        invalidKeys.push({ key, expected: "object", actual: kindOf(group) });
      }
      continue;
    }
    const bad = invalidLeaf(leaf, getPath(config, leaf.path));
    if (bad)
      invalidKeys.push(bad);
  }
  return { config, user, workspace, parseErrors, unknownKeys: collectUnknown(config), invalidKeys };
}
function sourceLayerOf(loaded, path) {
  if (getPath(loaded.workspace.value, path) !== undefined)
    return "workspace";
  if (getPath(loaded.user.value, path) !== undefined)
    return "user";
  return null;
}
function targetScope(loaded, path, explicit) {
  if (explicit === "user" || explicit === "workspace")
    return explicit;
  return sourceLayerOf(loaded, path) ?? "user";
}
function siliconTemplate() {
  return [
    "// Silicon toolchain configuration (JSONC).",
    "// User layer: $DSH_HOME/silicon.jsonc — project layer: <workspace>/.mpd/silicon.jsonc.",
    "// Project values override user values; a key absent from both layers falls through.",
    "//",
    "// oss-cad-suite provides iverilog, verilator and verilator_coverage.",
    '// ossCadSuite: { home: "/opt/oss-cad-suite" }',
    "//",
    "// verible provides verible-verilog-lint / verible-verilog-format.",
    '// verible: { bin: "/opt/verible/bin" }',
    "//",
    "// slang-server provides the SystemVerilog LSP used for .sv/.svh.",
    '// slangServer: { bin: "/opt/slang-server" }',
    "//",
    "// librelane is the standalone flow driver (its own tool lane).",
    '// librelane: { mode: "auto", appimage: "~/librelane.AppImage" }',
    "{}",
    ""
  ].join(`
`);
}
function atomicWriteSiliconFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const sibling = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  writeFileSync(sibling, text, { mode: 420 });
  renameSync(sibling, path);
  chmodSync(path, 420);
}
function validateSiliconValue(leaf, value) {
  const key = leaf.path.join(".");
  if (leaf.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new VerifError("VERIF_E_CONFIG", `'${key}' expects a boolean, got ${kindOf(value)}`, "pass value=true or value=false");
    }
    return value;
  }
  if (leaf.type === "enum") {
    if (typeof value !== "string" || !(leaf.values ?? []).includes(value)) {
      throw new VerifError("VERIF_E_CONFIG", `'${key}' expects one of ${(leaf.values ?? []).join("|")}, got ${JSON.stringify(value)}`, `pass value=<${(leaf.values ?? []).join("|")}>`);
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new VerifError("VERIF_E_CONFIG", `'${key}' expects a string, got ${kindOf(value)}`, "pass value as a JSON string");
  }
  const expanded = expandHome(value.trim());
  if (expanded.length === 0)
    throw new VerifError("VERIF_E_CONFIG", `'${key}' rejects an empty value`, "pass a non-empty path");
  return expanded;
}
function parseKeyPath(key) {
  const segments = key.split(".").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0)
    throw new VerifError("VERIF_E_CONFIG", "key is required", "pass key like ossCadSuite.bin");
  return segments;
}
function leafForPath(path) {
  const leaf = SILICON_LEAVES.find((candidate) => candidate.path.length === path.length && candidate.path.every((segment, i) => segment === path[i]));
  if (leaf)
    return leaf;
  const known = SILICON_LEAVES.map((candidate) => candidate.path.join(".")).join(", ");
  throw new VerifError("VERIF_E_UNSUPPORTED", `unknown toolchain key '${path.join(".")}'`, `known keys: ${known}`);
}
function describePath(p) {
  if (p === null || p.length === 0 || !existsSync(p))
    return { exists: false, kind: "missing", executable: false };
  try {
    const st = statSync(p);
    if (st.isDirectory())
      return { exists: true, kind: "directory", executable: false };
    let executable = false;
    try {
      accessSync(p, constants.X_OK);
      executable = true;
    } catch {
      executable = false;
    }
    return { exists: true, kind: "file", executable };
  } catch {
    return { exists: false, kind: "missing", executable: false };
  }
}
function binCandidates(raw, names) {
  if (typeof raw !== "string" || raw.trim().length === 0)
    return [];
  const expanded = expandHome(raw.trim());
  const info = describePath(expanded);
  if (info.kind === "directory")
    return names.map((name) => join(expanded, name));
  if (info.kind === "file")
    return names.includes(basename(expanded)) ? [expanded] : [];
  return names.map((name) => join(expanded, name));
}
function configBinCandidates(name, config) {
  if (!config)
    return [];
  const suite = isPlainObject(config.ossCadSuite) ? config.ossCadSuite : undefined;
  if (!suite)
    return [];
  const out = [];
  if (typeof suite.bin === "string")
    out.push(...binCandidates(suite.bin, [name]));
  if (typeof suite.home === "string")
    out.push(...binCandidates(join(expandHome(suite.home), "bin"), [name]));
  return out;
}
function findOnPath(name) {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0)
      continue;
    const candidate = join(dir, name);
    if (existsSync(candidate))
      return candidate;
  }
  return null;
}
function probeVersion(binary, args, timeoutMs = 1500) {
  try {
    const r = spawnSync(binary, [...args], { timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (r.error || r.status !== 0 || typeof r.stdout !== "string")
      return null;
    const line = r.stdout.split(`
`).map((l) => l.trim()).find((l) => l.length > 0);
    return line === undefined ? null : line.slice(0, 200);
  } catch {
    return null;
  }
}
function setConfigValue(args, exec) {
  const loaded = loadSiliconConfig(exec);
  const path = parseKeyPath(args.key);
  const leaf = leafForPath(path);
  const scope = targetScope(loaded, path, explicitScope(args.scope));
  const value = validateSiliconValue(leaf, args.value);
  let finalValue = value;
  if (leaf.isPath && typeof value === "string" && !isAbsolute(value)) {
    if (scope === "user") {
      throw new VerifError("VERIF_E_CONFIG", `user-scope '${leaf.path.join(".")}' requires an absolute path, got '${value}'`, "pass an absolute path (a leading ~ is expanded) — relative paths are only accepted for workspace scope");
    }
    finalValue = resolve(workspaceRootOf(exec), value);
  }
  const file = scope === "workspace" ? workspaceConfigPath(exec) : userConfigPath();
  const layer = scope === "workspace" ? loaded.workspace : loaded.user;
  if (layer.exists && layer.parseError) {
    throw new VerifError("VERIF_E_CONFIG", `${file} is not parseable JSONC: ${layer.parseError}`, "fix the file by hand (or pass scope=user) — the tool refuses to clobber a broken document");
  }
  const base = layer.raw !== null && layer.raw.trim().length > 0 ? layer.raw : siliconTemplate();
  const result = surgicalEdit(base, path, finalValue, { insert: true });
  if (result.ok !== true) {
    throw new VerifError("VERIF_E_CONFIG", `refused to edit ${file}: ${result.reason}${result.detail ? " (" + result.detail + ")" : ""}`, "the document is ambiguous or malformed; edit it by hand or run action=init with force");
  }
  const old = getPath(loaded.config, path) ?? null;
  if (result.changed)
    atomicWriteSiliconFile(file, result.text);
  return {
    ok: true,
    action: "set",
    scope,
    file,
    key: path.join("."),
    old,
    new: finalValue,
    changed: result.changed,
    created: !layer.exists,
    notes: result.notes === undefined ? [] : [...result.notes]
  };
}
function unsetConfigValue(args, exec) {
  const loaded = loadSiliconConfig(exec);
  const path = parseKeyPath(args.key);
  leafForPath(path);
  const scope = targetScope(loaded, path, explicitScope(args.scope));
  const file = scope === "workspace" ? workspaceConfigPath(exec) : userConfigPath();
  const layer = scope === "workspace" ? loaded.workspace : loaded.user;
  const old = getPath(loaded.config, path) ?? null;
  if (!layer.exists || getPath(layer.value, path) === undefined) {
    return { ok: true, action: "unset", scope, file, key: path.join("."), old, new: null, changed: false, notes: [] };
  }
  if (layer.parseError) {
    throw new VerifError("VERIF_E_CONFIG", `${file} is not parseable JSONC: ${layer.parseError}`, "fix the file by hand — the tool refuses to clobber a broken document");
  }
  const result = surgicalDelete(layer.raw ?? "", path);
  if (result.ok !== true) {
    throw new VerifError("VERIF_E_CONFIG", `refused to edit ${file}: ${result.reason}${result.detail ? " (" + result.detail + ")" : ""}`, "the document is ambiguous or malformed; edit it by hand");
  }
  if (result.changed)
    atomicWriteSiliconFile(file, result.text);
  return {
    ok: true,
    action: "unset",
    scope,
    file,
    key: path.join("."),
    old,
    new: null,
    changed: result.changed,
    notes: result.notes === undefined ? [] : [...result.notes]
  };
}
function initConfigFile(args, exec) {
  const scope = explicitScope(args.scope) ?? "user";
  const file = scope === "workspace" ? workspaceConfigPath(exec) : userConfigPath();
  if (existsSync(file) && args.force !== true) {
    throw new VerifError("VERIF_E_CONFIG", `${file} already exists`, "pass force=true to overwrite it, or use action=set to edit it surgically");
  }
  const text = siliconTemplate();
  atomicWriteSiliconFile(file, text);
  return { ok: true, action: "init", scope, file, created: true, text };
}
var VERSION_ARGS = {
  iverilog: ["-V"],
  verilator: ["--version"],
  verilator_coverage: ["--version"]
};
function resolveToolForShow(name, config, envVar) {
  if (envVar !== null) {
    const envVal = (process.env[envVar] ?? "").trim();
    if (envVal.length > 0)
      return { binary: resolve(expandHome(envVal)), source: "env" };
  }
  for (const candidate of configBinCandidates(name, config)) {
    if (existsSync(candidate))
      return { binary: candidate, source: "config" };
  }
  const onPath = findOnPath(name);
  return onPath === null ? null : { binary: onPath, source: "path" };
}
var TOOLCHAIN_BACKENDS = [
  { name: "iverilog", envVar: "MPD_DSH_VERIF_IVERILOG" },
  { name: "verilator", envVar: "MPD_DSH_VERIF_VERILATOR" },
  { name: "verilator_coverage", envVar: "MPD_DSH_VERIF_VERILATOR_COVERAGE" }
];
function showConfig(exec, key) {
  const loaded = loadSiliconConfig(exec);
  const p = siliconPaths(exec);
  const sources = {};
  for (const path of leafPaths(loaded.config)) {
    const source = sourceLayerOf(loaded, path);
    if (source !== null)
      sources[path.join(".")] = source;
  }
  const paths = [];
  for (const leaf of SILICON_LEAVES) {
    if (leaf.isPath !== true)
      continue;
    const rawValue = getPath(loaded.config, leaf.path);
    if (typeof rawValue !== "string" || rawValue.trim().length === 0)
      continue;
    const expanded = expandHome(rawValue.trim());
    const info = describePath(expanded);
    paths.push({ key: leaf.path.join("."), raw: rawValue, path: expanded, exists: info.exists, kind: info.kind, executable: info.executable });
  }
  const backends = TOOLCHAIN_BACKENDS.map(({ name, envVar }) => {
    const resolved = resolveToolForShow(name, loaded.config, envVar);
    if (resolved === null)
      return { name, binary: null, source: null, exists: false, executable: false, version: null };
    const info = describePath(resolved.binary);
    const version = info.kind === "file" ? probeVersion(resolved.binary, VERSION_ARGS[name] ?? ["--version"]) : null;
    return { name, binary: resolved.binary, source: resolved.source, exists: info.exists, executable: info.executable, version };
  });
  let focused = null;
  if (key !== undefined && key.trim().length > 0) {
    const path = parseKeyPath(key);
    focused = { key: path.join("."), value: getPath(loaded.config, path) ?? null, source: sourceLayerOf(loaded, path) };
  }
  return {
    ok: true,
    action: "show",
    dshHome: p.dshHome,
    workspaceRoot: p.workspaceRoot,
    userFile: { path: loaded.user.path, exists: loaded.user.exists, parseError: loaded.user.parseError },
    workspaceFile: { path: loaded.workspace.path, exists: loaded.workspace.exists, parseError: loaded.workspace.parseError },
    config: loaded.config,
    sources,
    unknownKeys: loaded.unknownKeys,
    invalidKeys: loaded.invalidKeys,
    parseErrors: loaded.parseErrors,
    paths,
    backends,
    key: focused
  };
}
function appImages() {
  const home = homedir();
  try {
    return readdirSync(home).filter((f) => f.toLowerCase().endsWith(".appimage")).map((f) => join(home, f)).sort();
  } catch {
    return [];
  }
}
function librelaneSitePackages() {
  const libRoot = join(homedir(), ".local", "lib");
  const out = [];
  try {
    for (const entry of readdirSync(libRoot)) {
      if (!entry.startsWith("python"))
        continue;
      const candidate = join(libRoot, entry, "site-packages", "librelane");
      if (existsSync(candidate))
        out.push(candidate);
    }
  } catch {}
  return out;
}
function detectToolchains() {
  const home = homedir();
  const envKeys = [
    "MPD_SILICON_CONFIG",
    "OSS_CAD_SUITE",
    "OSS_CAD_SUITE_HOME",
    "VERIBLE_HOME",
    "VERIBLE_BIN",
    "LIBRELANE_HOME",
    "LIBRELANE_BIN",
    "MPD_DSH_VERIF_IVERILOG",
    "MPD_DSH_VERIF_VERILATOR",
    "MPD_DSH_VERIF_VERILATOR_COVERAGE"
  ];
  const env = {};
  for (const key of envKeys)
    env[key] = (process.env[key] ?? "").trim().length > 0 ? process.env[key] : null;
  const pathHits = [];
  for (const name of ["iverilog", "verilator", "verilator_coverage", "verible-verilog-lint", "verible-verilog-format"]) {
    if (pathHits.some((hit) => hit.name === name))
      continue;
    const binary = findOnPath(name);
    if (binary !== null)
      pathHits.push({ name, binary });
  }
  const suiteRoots = ["/opt/oss-cad-suite", join(home, "oss-cad-suite"), join(home, ".local", "oss-cad-suite")];
  const veribleRoots = ["/opt/verible", join(home, "verible"), join(home, ".local", "verible")];
  const librelaneRoots = [join(home, "librelane")];
  const scanned = [
    ...suiteRoots.map((path) => ({ path, group: "ossCadSuite" })),
    ...veribleRoots.map((path) => ({ path, group: "verible" })),
    ...librelaneRoots.map((path) => ({ path, group: "librelane" })),
    { path: join(home, ".local", "bin"), group: "path" }
  ];
  const roots = scanned.map(({ path }) => {
    const info = describePath(path);
    return { path, exists: info.exists, kind: info.kind };
  });
  const suggestions = [];
  const suggest = (key, value, evidence) => {
    if (!suggestions.some((s) => s.key === key && s.value === value))
      suggestions.push({ key, value, evidence });
  };
  for (const path of suiteRoots) {
    if (existsSync(join(path, "bin", "iverilog")) || existsSync(join(path, "bin", "verilator"))) {
      suggest("ossCadSuite.home", path, `found ${join(path, "bin")} with iverilog/verilator`);
    }
  }
  for (const path of veribleRoots) {
    if (existsSync(join(path, "bin", "verible-verilog-lint")))
      suggest("verible.home", path, `found ${join(path, "bin", "verible-verilog-lint")}`);
  }
  const binDir = join(home, ".local", "bin");
  if (existsSync(join(binDir, "verible-verilog-lint")) || existsSync(join(binDir, "iverilog"))) {
    suggest("verible.bin", binDir, `found toolchain binaries in ${binDir}`);
  }
  for (const image of appImages()) {
    const base = basename(image).toLowerCase();
    if (base.includes("librelane"))
      suggest("librelane.appimage", image, "AppImage in the home directory");
  }
  for (const path of librelaneRoots) {
    if (existsSync(path))
      suggest("librelane.home", path, "librelane checkout in the home directory");
  }
  for (const path of librelaneSitePackages())
    suggest("librelane.home", path, "librelane Python package on this machine");
  for (const hit of pathHits) {
    if (hit.name === "iverilog" || hit.name === "verilator")
      suggest("ossCadSuite.bin", dirname(hit.binary), `PATH resolves ${hit.name} to ${hit.binary}`);
    if (hit.name.startsWith("verible"))
      suggest("verible.bin", dirname(hit.binary), `PATH resolves ${hit.name} to ${hit.binary}`);
  }
  return {
    ok: true,
    action: "detect",
    suggestions,
    env,
    pathHits,
    roots,
    note: "suggestions only — nothing was written; accept one with action=set"
  };
}

// src/env.ts
var BACKEND_IDS = ["iverilog", "verilator", "vcs"];
var BACKEND_BIN = {
  iverilog: "iverilog",
  verilator: "verilator",
  vcs: "vcs"
};
var BACKEND_ENV = {
  iverilog: "MPD_DSH_VERIF_IVERILOG",
  verilator: "MPD_DSH_VERIF_VERILATOR",
  vcs: "MPD_DSH_VERIF_VCS"
};
function workspaceRoot(exec) {
  return resolve2(workspaceRootOf2(exec));
}
function venvPath(override, exec) {
  return resolve2(override || process.env.MPD_DSH_VERIF_VENV || join2(workspaceRoot(exec), ".venv-rtl"));
}
function workDir(exec) {
  return resolve2(process.env.MPD_DSH_VERIF_WORK || join2(workspaceRoot(exec), ".mpd", "verif"));
}
function paths(overrideVenv, exec) {
  return { workspace: workspaceRoot(exec), venv: venvPath(overrideVenv, exec), work: workDir(exec) };
}
function resolveBackendBinary(backend, config) {
  const envVal = process.env[BACKEND_ENV[backend]];
  if (envVal && envVal.trim().length > 0)
    return { binary: resolve2(envVal.trim()), source: "env" };
  if (backend !== "vcs" && config) {
    for (const candidate of configBinCandidates(BACKEND_BIN[backend], config)) {
      if (existsSync2(candidate))
        return { binary: candidate, source: "config" };
    }
  }
  const onPath = findOnPath(BACKEND_BIN[backend]);
  if (onPath !== null)
    return { binary: onPath, source: "path" };
  return null;
}
function runStamp(d = new Date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}
function dateSeedBase(now = new Date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return Number(`${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`);
}

// src/run.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
var DEFAULT_TIMEOUT_MS = 600000;
var MAX_BUFFER = 32 * 1024 * 1024;
function run(binary, args, opts = {}) {
  const env = opts.env ? { ...process.env, ...opts.env } : { ...process.env };
  if (opts.unsetEnv !== undefined)
    for (const key of opts.unsetEnv)
      delete env[key];
  const res = spawnSync2(binary, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER
  });
  const stderr = (res.stderr ?? "").trim();
  const stdout = (res.stdout ?? "").trim();
  const spawnError = res.error && !res.error.code ? String(res.error) : res.error ? res.error.code ?? String(res.error) : null;
  return {
    status: res.status,
    signal: res.signal ?? null,
    timedOut: Boolean(res.error && res.error.code === "ETIMEDOUT"),
    spawnError,
    stdout,
    stderr,
    combined: [stdout, stderr].filter((s) => s.length > 0).join(`
`)
  };
}
function writeLog(logPath, content) {
  if (logPath) {
    mkdirSync2(dirname2(logPath), { recursive: true });
    writeFileSync2(logPath, content + `
`);
  }
  return logPath;
}

// src/backends.ts
var LICENSE_ENV = {
  iverilog: [],
  verilator: [],
  vcs: ["VCS_HOME", "LM_LICENSE_FILE", "SNPSLMD_LICENSE_FILE"]
};
function versionProbeArgs(backend) {
  switch (backend) {
    case "iverilog":
      return ["-V"];
    case "verilator":
      return ["--version"];
    case "vcs":
      return ["-ID"];
  }
}
function probeBackend(backend, config) {
  const r = resolveBackendBinary(backend, config);
  if (!r) {
    return { backend, binary: null, source: null, present: false, version: null, licenseHint: absentHintLines(backend) };
  }
  const vr = run(r.binary, versionProbeArgs(backend), { timeoutMs: 20000 });
  const version = vr.timedOut ? null : firstVersionLine(vr.combined) ?? (vr.status === 0 ? "unknown" : null);
  const licenseHint = backend === "vcs" ? LICENSE_ENV.vcs.map((k) => `${k}=${process.env[k] ? "set" : "missing"}`) : null;
  return { backend, binary: r.binary, source: r.source, present: vr.spawnError === null, version, licenseHint };
}
function absentHintLines(backend) {
  switch (backend) {
    case "iverilog":
      return ["iverilog not found — install Icarus Verilog (e.g. apt install iverilog or oss-cad-suite) or set MPD_DSH_VERIF_IVERILOG"];
    case "verilator":
      return ["verilator not found — install Verilator (e.g. apt install verilator or oss-cad-suite) or set MPD_DSH_VERIF_VERILATOR"];
    case "vcs":
      return ["vcs not found — set MPD_DSH_VERIF_VCS, or add $VCS_HOME/bin to PATH; license vars: VCS_HOME, LM_LICENSE_FILE, SNPSLMD_LICENSE_FILE"];
  }
}
function firstVersionLine(combined) {
  for (const l of combined.split(`
`)) {
    const t = l.trim();
    if (t.length === 0)
      continue;
    return t.slice(0, 200);
  }
  return null;
}
function requireBackend(backend, extraHint, config) {
  const r = resolveBackendBinary(backend, config);
  if (!r) {
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${backend}' is not resolvable (env override, silicon config or PATH)`, [absentHintLines(backend)[0] ?? "", extraHint].filter(Boolean).join(" "));
  }
  return r.binary;
}
function normalizeDefines(defs) {
  if (!defs)
    return {};
  if (Array.isArray(defs)) {
    const out = {};
    for (const d of defs) {
      const eq = d.indexOf("=");
      if (eq >= 0)
        out[d.slice(0, eq).trim()] = d.slice(eq + 1).trim();
      else
        out[d.trim()] = 1;
    }
    return out;
  }
  return defs;
}
function incArgs(includes) {
  return (includes ?? []).map((i) => "-I" + i);
}
function defineArgsForIvorTool(defs) {
  return Object.entries(defs).map(([k, v]) => v === 1 ? "-D" + k : `-D${k}=${v}`);
}
function writeVcsFilelist(path, sources, includes, defs) {
  mkdirSync3(dirname3(path), { recursive: true });
  const defines = normalizeDefines(defs);
  const lines = [
    ...(includes ?? []).map((i) => `+incdir+${i}`),
    ...Object.entries(defines).map(([k, v]) => v === 1 ? `+define+${k}` : `+define+${k}=${v}`),
    ...sources
  ];
  writeFileSync3(path, lines.join(`
`) + `
`);
  return path;
}
function lintPlan(backend, src, logRoot, stamp, config) {
  const binary = resolveBackendBinary(backend, config)?.binary ?? BACKEND_BIN[backend];
  const defs = normalizeDefines(src.defines);
  switch (backend) {
    case "iverilog": {
      const args = ["-g2012", "-tnull", "-Wall"];
      if (src.top)
        args.push("-s", src.top);
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, logPath: join3(logRoot, `lint-iverilog-${stamp}.log`) };
    }
    case "verilator": {
      const args = ["--lint-only", "-Wall"];
      if (src.top)
        args.push("--top-module", src.top);
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, logPath: join3(logRoot, `lint-verilator-${stamp}.log`) };
    }
    case "vcs": {
      const filelist = join3(logRoot, `vcs-filelist-${stamp}.f`);
      writeVcsFilelist(filelist, src.sources, src.includes, defs);
      const args = ["-lca", "-sverilog", "+lint=all", "-f", filelist];
      if (src.top)
        args.push("-top", src.top);
      const logPath = join3(logRoot, `lint-vcs-${stamp}.log`);
      args.push("-l", logPath);
      return { backend, binary, args, logPath, filelistPath: filelist };
    }
  }
}
function compilePlan(backend, src, workRoot, stamp, config) {
  const binary = resolveBackendBinary(backend, config)?.binary ?? BACKEND_BIN[backend];
  const defs = normalizeDefines(src.defines);
  const outDir = join3(workRoot, "build", stamp);
  mkdirSync3(outDir, { recursive: true });
  switch (backend) {
    case "iverilog": {
      const out = join3(outDir, "simv_iverilog");
      const args = ["-g2012", "-o", out];
      if (src.top)
        args.push("-s", src.top);
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, outBinary: out, logPath: join3(outDir, "compile.log") };
    }
    case "verilator": {
      const out = join3(outDir, "Vsim");
      const args = ["--binary"];
      if (src.top)
        args.push("--top-module", src.top);
      args.push("-o", out, ...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, outBinary: out, logPath: join3(outDir, "compile.log") };
    }
    case "vcs": {
      const filelist = join3(outDir, "filelist.f");
      writeVcsFilelist(filelist, src.sources, src.includes, defs);
      const out = join3(outDir, "simv");
      const logPath = join3(outDir, "vcs_compile.log");
      const args = ["-sverilog", "+v2k", "-f", filelist, "-o", out];
      if (src.top)
        args.push("-top", src.top);
      args.push("-l", logPath);
      return { backend, binary, args, outBinary: out, logPath, filelistPath: filelist };
    }
  }
}
function parseDiagnostics(backend, text) {
  const out = [];
  if (backend === "iverilog") {
    const re = /^(\S+?\.[a-zA-Z]+):(\d+):(?:\s*(error|warning))?:?\s*(.*)$/gm;
    for (const m of text.matchAll(re)) {
      const raw = m[4] ?? "";
      let severity = m[3] === "warning" ? "warning" : raw.toLowerCase().startsWith("syntax error") ? "error" : "error";
      if (!m[3] && raw.toLowerCase().startsWith("warning"))
        severity = "warning";
      out.push({ file: m[1], line: Number(m[2]), severity, code: raw.toLowerCase().startsWith("syntax error") ? "SYNTAX" : "IVL", message: raw.slice(0, 400) });
    }
  } else if (backend === "verilator") {
    const re = /%?(Error|Warning)(?:-([A-Za-z0-9_]+))?:?\s*(\S+?\.[a-zA-Z]+):(\d+):\d*:\s*(.*)$/gm;
    for (const m of text.matchAll(re)) {
      out.push({ file: m[3], line: Number(m[4]), severity: m[1] === "Error" ? "error" : "warning", code: m[2] ?? m[1], message: m[5]?.slice(0, 400) ?? "" });
    }
  } else {
    const warns = [...text.matchAll(/^(Error|Warning)-\[([^\]]+)\]\s*$/gm)];
    const locs = [...text.matchAll(/"([^"]+)"\s*,\s*(\d+)[:.]\s*(.*)$/gm)];
    let w = 0;
    for (const l of locs) {
      const wm = warns[w] ?? null;
      out.push({ file: l[1], line: Number(l[2]), severity: wm && wm[1] === "Warning" ? "warning" : "error", code: wm ? wm[2] : "VCS", message: (l[3] ?? "").slice(0, 400) });
      if (wm)
        w++;
    }
  }
  return out.slice(0, 500);
}
function probeAll(config) {
  return BACKEND_IDS.map((b) => probeBackend(b, config));
}
function runPlan(plan, timeoutMs) {
  return run(plan.binary, plan.args, { timeoutMs });
}

// src/compile.ts
function verifCompile(a, exec, config) {
  if (!a.sources || a.sources.length === 0) {
    throw new VerifError("VERIF_E_COMPILE", "no sources given", "pass sources[] (at least one .v/.sv file)");
  }
  const stamp = runStamp();
  const logRoot = join4(workDir(exec), "logs");
  const defines = a.defines ? Array.isArray(a.defines) ? normalizeDefines(a.defines) : a.defines : undefined;
  const src = { sources: a.sources, top: a.top, includes: a.includes, defines };
  const target = a.target === "compile" ? "compile" : "lint";
  requireBackend(a.backend, "install it, pin MPD_DSH_VERIF_" + a.backend.toUpperCase() + ", or set ossCadSuite.bin via mpd_verif_toolchain", config);
  const plan = target === "lint" ? lintPlan(a.backend, src, logRoot, stamp, config) : compilePlan(a.backend, src, workDir(exec), stamp, config);
  const r = runPlan(plan, (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000);
  writeLog(plan.logPath, r.combined);
  if (r.timedOut) {
    throw new VerifError("VERIF_E_TIMEOUT", `${target} '${a.backend}' timed out`, "increase timeoutSec, narrow the source set, or check the tool installation");
  }
  if (r.spawnError) {
    throw new VerifError("VERIF_E_NO_BACKEND", `${target} '${a.backend}' could not be executed: ${r.spawnError}`, "install the tool or set MPD_DSH_VERIF_" + a.backend.toUpperCase());
  }
  const diagnostics = parseDiagnostics(a.backend, r.combined);
  const ok = r.status === 0;
  return {
    ok,
    target,
    backend: a.backend,
    binary: plan.binary,
    args: plan.args,
    exitCode: r.status,
    timedOut: r.timedOut,
    diagnostics,
    logPath: plan.logPath,
    ...plan.filelistPath === undefined ? {} : { filelistPath: plan.filelistPath },
    ...plan.outBinary === undefined ? {} : { outBinary: plan.outBinary },
    logLines: r.combined.split(`
`).filter((l) => l.trim().length > 0).slice(-50),
    ...ok ? {} : {
      error: {
        code: "VERIF_E_COMPILE",
        message: `${target} failed (exit ${r.status}, ${diagnostics.length} diagnostic(s) parsed)`,
        hint: `read the log at ${plan.logPath}; fix the first error and rerun`
      }
    }
  };
}

// src/coverage.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync4 } from "node:fs";
import { join as join6 } from "node:path";

// src/eda-tools.ts
import { existsSync as existsSync3, readdirSync as readdirSync2 } from "node:fs";
import { join as join5 } from "node:path";
function resolveEdaTool(name) {
  const envKey = name === "urg" ? "MPD_DSH_VERIF_URG" : "MPD_DSH_VERIF_FSDBREPORT";
  const envVal = process.env[envKey];
  if (envVal && envVal.trim().length > 0)
    return { binary: envVal.trim(), source: "env:" + envKey };
  const homes = ["VCS_HOME", "VERDI_HOME", "NOVAS_HOME"];
  for (const h of homes) {
    const root = process.env[h];
    if (!root)
      continue;
    const f = join5(root, "bin", name);
    if (existsSync3(f))
      return { binary: f, source: h };
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0)
      continue;
    const f = join5(dir, name);
    if (existsSync3(f))
      return { binary: f, source: "path" };
  }
  return null;
}
var FSDBREPORT_HINT = "install/point fsdbreport: MPD_DSH_VERIF_FSDBREPORT=<path>, or export VCS_HOME/VERDI_HOME/NOVAS_HOME so <home>/bin/fsdbreport resolves";
var URG_HINT = "install/point urg: MPD_DSH_VERIF_URG=<path>, or export VCS_HOME so <VCS_HOME>/bin/urg resolves";
function urgMergeArgv(covDirs, reportDir, format) {
  const argv = ["urg"];
  for (const d of covDirs)
    argv.push("-dir", d);
  argv.push("-report", reportDir);
  if (format)
    argv.push("-format", format);
  return argv;
}
function runFsdbreport(binary, fsdbPath, timeoutMs) {
  return run(binary, [fsdbPath], { timeoutMs });
}
function collectCovDirs(root, max = 50) {
  const roots = [];
  const fallback = [];
  const walk = (dir) => {
    if (roots.length >= max)
      return;
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory())
        continue;
      const p = join5(dir, e.name);
      if (/^(cov|coverage)$/.test(e.name)) {
        roots.push(p);
        continue;
      }
      if (e.name.startsWith("work_") || e.name.startsWith("sim_vdb")) {
        fallback.push(p);
      }
      walk(p);
    }
  };
  walk(root);
  return (roots.length > 0 ? roots : fallback).slice(0, max);
}
function collectDatFiles(root, max = 100) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync3(dir) || out.length >= max)
      return;
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join5(dir, e.name);
      if (e.isDirectory())
        walk(p);
      else if (e.name.endsWith(".dat") && !e.name.endsWith("__verFiles.dat"))
        out.push(p);
    }
  };
  walk(root);
  return out.slice(0, max);
}

// src/coverage.ts
var VERILATOR_COVERAGE_HINT = "verilator_coverage not found — it ships with Verilator (oss-cad-suite on PATH or MPD_DSH_VERIF_VERILATOR_COVERAGE)";
function resolveVerilatorCoverage(config) {
  const envVal = process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE;
  if (envVal && envVal.trim().length > 0)
    return { binary: envVal.trim(), source: "env:MPD_DSH_VERIF_VERILATOR_COVERAGE" };
  for (const candidate of configBinCandidates("verilator_coverage", config)) {
    if (existsSync4(candidate))
      return { binary: candidate, source: "config" };
  }
  const onPath = findOnPath("verilator_coverage");
  if (onPath !== null)
    return { binary: onPath, source: "path" };
  throw new VerifError("VERIF_E_NO_BACKEND", "verilator_coverage not resolvable", VERILATOR_COVERAGE_HINT);
}
function verifCoverage(a, exec, config) {
  const scanRoot = a.dir ?? workDir(exec);
  const reportDir = a.reportDir ?? join6(workDir(exec), "cov_report");
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
  mkdirSync4(reportDir, { recursive: true });
  const action = a.action === "report" ? "report" : "merge";
  if (a.backend === "iverilog") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "iverilog has no native code coverage", "use the verilator lane (mpd_verif_sim coverage:true adds --coverage) or the VCS/urg lane; icarus coverage is deliberately refused");
  }
  if (a.backend === "vcs") {
    const urg = resolveEdaTool("urg");
    if (!urg)
      throw new VerifError("VERIF_E_NO_BACKEND", "urg not resolvable", URG_HINT);
    const covDirs = collectCovDirs(scanRoot);
    if (covDirs.length === 0) {
      throw new VerifError("VERIF_E_RUN", "no coverage data dirs under " + scanRoot, "enable coverage on the UVM lane (coverage:true on compile/run/regress writes -cm_dir payloads) then re-run coverage");
    }
    const argv = urgMergeArgv(covDirs, reportDir, "both");
    const logPath = join6(reportDir, "urg.log");
    const r = run(urg.binary, argv.slice(1), { timeoutMs });
    writeLog(logPath, r.combined);
    return {
      ok: r.status === 0,
      backend: "vcs",
      action,
      binary: urg.binary,
      args: argv,
      exitCode: r.status,
      datFiles: [],
      covDirs,
      reportDir,
      logPath,
      messages: r.status === 0 ? [`urg merged ${covDirs.length} coverage dir(s) into ${reportDir}`] : [],
      ...r.status === 0 ? {} : { error: { code: "VERIF_E_ENV", message: "urg merge failed", hint: `read ${logPath}; verify the license environment` } }
    };
  }
  const tool = resolveVerilatorCoverage(config);
  const dats = collectDatFiles(scanRoot);
  const logPath = join6(reportDir, "verilator_coverage.log");
  if (a.action === "report") {
    const merged = a.mergedDat ?? join6(reportDir, "merged.dat");
    if (!existsSync4(merged)) {
      throw new VerifError("VERIF_E_RUN", "no merged coverage dataset at " + merged, "run mpd_verif_coverage with action=merge first (verilator), or pass mergedDat");
    }
    const argv = [tool.binary, "--annotate", reportDir, "--annotate-all", merged];
    const r = run(argv[0], argv.slice(1), { timeoutMs });
    writeLog(logPath, r.combined);
    return {
      ok: r.status === 0,
      backend: "verilator",
      action,
      binary: tool.binary,
      args: argv,
      exitCode: r.status,
      datFiles: dats,
      covDirs: [],
      mergedDat: merged,
      reportDir,
      logPath,
      messages: r.status === 0 ? [`annotated coverage report under ${reportDir}`] : [],
      ...r.status === 0 ? {} : { error: { code: "VERIF_E_RUN", message: "verilator_coverage annotate failed", hint: `read ${logPath}; annotate needs the merged dataset` } }
    };
  }
  if (dats.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no Verilator coverage .dat files under " + scanRoot, "run mpd_verif_sim with coverage:true (COMPILE_ARGS += --coverage) on the verilator lane, then re-run coverage");
  }
  const mergeDat = join6(reportDir, "merged.dat");
  const argv = [tool.binary, "--write", mergeDat, ...dats];
  const r = run(argv[0], argv.slice(1), { timeoutMs });
  writeLog(logPath, r.combined);
  return {
    ok: r.status === 0,
    backend: "verilator",
    action,
    binary: tool.binary,
    args: argv,
    exitCode: r.status,
    datFiles: dats,
    covDirs: [],
    mergedDat: mergeDat,
    reportDir,
    logPath,
    messages: r.status === 0 ? [`merged ${dats.length} coverage file(s) into ${mergeDat}`] : [],
    ...r.status === 0 ? {} : { error: { code: "VERIF_E_RUN", message: "verilator_coverage merge failed", hint: `read ${logPath}` } }
  };
}

// src/venv.ts
import { existsSync as existsSync5 } from "node:fs";
import { join as join7 } from "node:path";
function venvPython(v) {
  return join7(v, "bin", "python");
}
function venvPip(v) {
  return join7(v, "bin", "pip");
}
var SETUP_COMMAND = `python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"`;
function venvRefusal(v, cocotbVersion) {
  if (!existsSync5(venvPython(v))) {
    return {
      ok: false,
      error: {
        code: "VERIF_E_NO_VENV",
        message: `cocotb venv missing at ${v} (iron rule: project-local venv required, system python is never used)`,
        hint: `run: ${SETUP_COMMAND} — or call mpd_verif_venv with action "create", or set MPD_DSH_VERIF_VENV to an existing project venv`
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "VERIF_E_COCOTB_ABSENT",
      message: `venv exists at ${v} but 'import cocotb' failed${cocotbVersion ? " (cocotb " + cocotbVersion + ")" : ""}`,
      hint: `install inside the venv only: ${v}/bin/pip install "cocotb>=2.0" (never --user, never system pip)`
    }
  };
}
function venvStatus(override, exec) {
  const v = venvPath(override, exec);
  const py = venvPython(v);
  const envOverride = process.env.MPD_DSH_VERIF_VENV ?? null;
  if (!existsSync5(py)) {
    return {
      ok: false,
      verdict: "missing",
      venv: v,
      python: py,
      pythonVersion: null,
      cocotbVersion: null,
      message: `venv missing at ${v} — run: ${SETUP_COMMAND} or mpd_verif_venv(action:"create")`,
      envOverride
    };
  }
  const pv = run(py, ["--version"], { timeoutMs: 30000 });
  const pythonVersion = pv.spawnError === null ? (pv.combined.split(`
`)[0] ?? "").trim().slice(0, 120) : null;
  const cv = run(py, ["-c", 'import cocotb, json; print(json.dumps({"v": cocotb.__version__, "ok": True}))'], { timeoutMs: 60000 });
  let cocotbVersion = null;
  if (cv.spawnError === null && cv.status === 0) {
    try {
      const parsed = JSON.parse(cv.combined.split(`
`).find((l) => l.trim().startsWith("{")) ?? "{}");
      cocotbVersion = parsed.v ?? null;
    } catch {
      cocotbVersion = null;
    }
  }
  const verdict = cocotbVersion ? "ok" : pythonVersion ? "setup-required" : "missing";
  return {
    ok: cocotbVersion !== null,
    verdict,
    venv: v,
    python: py,
    pythonVersion,
    cocotbVersion,
    envOverride,
    message: cocotbVersion ? `venv ready: python ${pythonVersion ?? "?"} with cocotb ${cocotbVersion}` : `venv incomplete: ${SETUP_COMMAND}`
  };
}
function venvCreate(override, _configureTimeoutMs = 600000, exec) {
  const v = venvPath(override, exec);
  const steps = [];
  const python3 = process.env.MPD_DSH_VERIF_PYTHON3_CMD ?? "python3";
  const r1 = run(python3, ["-m", "venv", v], { timeoutMs: 120000 });
  steps.push({ step: "venv", args: ["-m", "venv", v], status: r1.status, log: r1.combined });
  if (r1.status !== 0 || !existsSync5(venvPython(v))) {
    return {
      ok: false,
      venv: v,
      steps,
      message: `venv bootstrap via '${python3} -m venv ${v}' failed (status ${r1.status}): ${tailOf(r1.combined)} — hint: install python3-venv/ensurepip (Debian: apt install python3-venv) and rerun mpd_verif_venv(action:"create")`
    };
  }
  const pip = venvPip(v);
  if (!existsSync5(pip)) {
    return { ok: false, venv: v, steps, message: `venv created at ${v} but ${pip} is missing (ensurepip unavailable?) — hint: recreate with 'python3 -m venv ${v}' after installing python3-venv` };
  }
  const r2 = run(pip, ["install", "cocotb>=2.0"], { timeoutMs: _configureTimeoutMs });
  steps.push({ step: "pip-install-cocotb", args: ["install", "cocotb>=2.0"], status: r2.status, log: r2.combined });
  if (r2.status !== 0) {
    return { ok: false, venv: v, steps, message: `pip install inside ${v} failed (status ${r2.status}): ${tailOf(r2.combined)} — rerun mpd_verif_venv(action:"create") or check network/proxy` };
  }
  const st = venvStatus(override, exec);
  return { ok: st.ok, venv: v, steps, message: `venv ready at ${v} — cocotb ${st.cocotbVersion ?? "unknown"}` };
}
function tailOf(s, n = 400) {
  const t = s.trim();
  return t.length <= n ? t : "..." + t.slice(t.length - n);
}
function requireCocotbVenv(override, exec) {
  const st = venvStatus(override, exec);
  if (!st.ok) {
    const r = venvRefusal(st.venv, st.cocotbVersion);
    throw new VerifError(r.error.code, r.error.message, r.error.hint);
  }
  return { venv: st.venv, cocotbVersion: st.cocotbVersion ?? "unknown" };
}

// src/sim.ts
import { chmodSync as chmodSync2, existsSync as existsSync6, mkdirSync as mkdirSync5, readdirSync as readdirSync3, readFileSync as readFileSync2, statSync as statSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute2, join as join9 } from "node:path";

// src/wave.ts
import { join as join8 } from "node:path";
var WAVE_MCP_PREPARE = "mcp__wave_mcp__prepare_session";
var TRACEWEAVE_GET_PATHS = "mcp__traceweave__get_sim_paths";
var WAVE_MCP_INSTALL_HINT = "install wave-mcp with pipx or any Python (NO venv required — pipx install wave-mcp, or pip install wave-mcp), then wire the dsh-mcp-client row (command: wave-mcp/<bin>, serverName: wave_mcp) or set MPD_DSH_WAVE_MCP_BIN";
var TRACEWEAVE_INSTALL_HINT = "install traceweave-mcp with pipx or any Python (NO venv required; pipx keeps each tool isolated if the MCP SDK versions ever conflict), export VERDI_HOME/NOVAS_HOME/VCS_HOME + license vars, then wire the dsh-mcp-client row (serverName: traceweave) or set MPD_DSH_TRACEWEAVE_BIN";
async function runWaveHooks(tools, req) {
  const out = [];
  const lane = req.lane ?? inferLane(req);
  if (lane === "vcs") {
    out.push(await traceweaveHook(tools, req));
    return out;
  }
  if (!req.wavefile) {
    out.push({ status: "unavailable", server: "wave_mcp", tool: WAVE_MCP_PREPARE, message: "no waveform file produced by the run (waves on?) — nothing to hand to wave-mcp" });
    return out;
  }
  out.push(await waveMcpHook(tools, req));
  return out;
}
function inferLane(req) {
  if (req.wavefile?.fmt === "fsdb")
    return "vcs";
  return "oss";
}
async function waveMcpHook(tools, req) {
  const tool = WAVE_MCP_PREPARE;
  if (!hasTool(tools, tool)) {
    return { status: "unavailable", server: "wave_mcp", tool, message: "wave-mcp MCP tool is not wired in this session — " + WAVE_MCP_INSTALL_HINT };
  }
  const args = {
    out_dir: req.sessionDir,
    wave_path: req.wavefile.file,
    top: req.top,
    mode: "speed"
  };
  const res = await invokeTool(tools, tool, args);
  if (res.error !== undefined)
    return { status: "failed", server: "wave_mcp", tool, message: `wave-mcp call failed: ${String(res.error)} — sessions degrade to manual inspection; ${WAVE_MCP_INSTALL_HINT}` };
  if (res.value === undefined)
    return { status: "failed", server: "wave_mcp", tool, message: "wave-mcp returned no structured value; check the MCP row config" };
  return { status: "ok", server: "wave_mcp", tool, message: "wave-mcp session opened for " + req.wavefile.file, session: safeObject(res.value) };
}
async function traceweaveHook(tools, req) {
  const tool = TRACEWEAVE_GET_PATHS;
  if (!hasTool(tools, tool)) {
    return { status: "unavailable", server: "traceweave", tool, message: "TraceWeave MCP tool is not wired in this session — " + TRACEWEAVE_INSTALL_HINT };
  }
  const args = { verif_root: req.verifRoot ?? req.caseDir };
  if (req.caseName)
    args.case_name = req.caseName;
  if (req.simLog)
    args.sim_log = req.simLog;
  if (req.wavefile)
    args.wave_file = req.wavefile.file;
  const res = await invokeTool(tools, tool, args);
  if (res.error !== undefined)
    return { status: "failed", server: "traceweave", tool, message: `TraceWeave call failed: ${String(res.error)}; ${TRACEWEAVE_INSTALL_HINT}` };
  if (res.value === undefined)
    return { status: "failed", server: "traceweave", tool, message: "TraceWeave returned no structured value; check the MCP row config" };
  return { status: "ok", server: "traceweave", tool, message: "TraceWeave path discovery completed", session: safeObject(res.value) };
}
function hasTool(tools, name) {
  try {
    return typeof tools.get === "function" && tools.get(name) !== undefined;
  } catch {
    return false;
  }
}
async function invokeTool(tools, name, args) {
  if (typeof tools.execute !== "function")
    return { error: "tool runtime has no execute()" };
  let signal;
  try {
    signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(120000) : new AbortController().signal;
  } catch {
    signal = new AbortController().signal;
  }
  try {
    const r = await tools.execute({ name, arguments: args, callId: "mpd-verif-wave-" + Date.now(), signal });
    if (r && typeof r === "object" && "isError" in r && r.isError === true) {
      return { error: r.error ?? "tool error" };
    }
    return { value: r?.value };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
function safeObject(v) {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v;
  return { summary: String(v) };
}
function waveSessionDir(caseDir) {
  const override = process.env.MPD_DSH_WAVE_MCP_SESSION;
  if (override && override.trim().length > 0)
    return override;
  const dshHome = process.env.DSH_HOME;
  if (dshHome && dshHome.trim().length > 0)
    return join8(dshHome, "wave-mcp");
  return join8(caseDir, "wave-mcp");
}

// src/sim.ts
function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
function writeIcarusShimDir(caseDir, iverilogBinary, vvpBinary) {
  if (!existsSync6(vvpBinary))
    return null;
  let text = "";
  try {
    text = readFileSync2(vvpBinary, "utf8");
  } catch {
    return null;
  }
  if (!text.includes("PYTHONHOME") || !/^\s*exec\s/m.test(text))
    return null;
  const top = dirname4(dirname4(vvpBinary));
  const loader = join9(top, "lib", "ld-linux-x86-64.so.2");
  const inner = join9(top, "libexec", "vvp");
  if (!existsSync6(loader) || !existsSync6(inner))
    return null;
  const shimDir = join9(caseDir, "toolshim");
  mkdirSync5(shimDir, { recursive: true });
  const iverilogShim = join9(shimDir, "iverilog");
  const vvpShim = join9(shimDir, "vvp");
  writeFileSync4(iverilogShim, `#!/bin/sh
exec ` + shellQuote(iverilogBinary) + ` "$@"
`);
  writeFileSync4(vvpShim, `#!/bin/sh
` + `# oss-cad-suite's vvp wrapper exports PYTHONHOME; run the real binary without it.
` + "exec env -u PYTHONHOME " + shellQuote(loader) + ' --inhibit-cache --inhibit-rpath "" --library-path ' + shellQuote(join9(top, "lib")) + " " + shellQuote(inner) + ` "$@"
`);
  chmodSync2(iverilogShim, 493);
  chmodSync2(vvpShim, 493);
  return shimDir;
}
function buildSimMakefile(a) {
  const lines = [
    "# Generated by mpd_verif_sim (cocotb Makefile flow). Regenerated on every run — do not edit.",
    ""
  ];
  lines.push("SIM := " + (a.backend === "iverilog" ? "icarus" : "verilator"), "TOPLEVEL_LANG := verilog", "COCOTB_TOPLEVEL := " + a.top);
  if (a.backend === "iverilog" && a.icarusBinDir !== undefined)
    lines.push("ICARUS_BIN_DIR := " + a.icarusBinDir);
  lines.push("VERILOG_SOURCES =" + (a.sources.length > 0 ? " \\" : ""));
  for (const f of a.sources)
    lines.push("    " + f + (f !== a.sources[a.sources.length - 1] ? " \\" : ""));
  if (a.includes.length > 0) {
    lines.push("VERILOG_INCLUDE_DIRS =" + (a.includes.length > 0 ? " \\" : ""));
    for (const d of a.includes)
      lines.push("    " + d + (d !== a.includes[a.includes.length - 1] ? " \\" : ""));
  }
  for (const [k, v] of Object.entries(a.defines))
    lines.push("COMPILE_ARGS += +define+" + k + (v === 1 ? "" : "=" + v));
  if (a.backend === "verilator") {
    if (a.coverage)
      lines.push("COMPILE_ARGS += --coverage");
    if (a.waves) {
      lines.push(a.traceFst === false ? `COMPILE_ARGS += --trace --trace-structs
SIM_ARGS += --trace
` : "COMPILE_ARGS += --trace-fst --trace-structs");
    }
  } else {
    lines.push("COMPILE_ARGS += -g2012");
    if (a.waves)
      lines.push("WAVES := 1  # icarus FST via -fst + dump module");
  }
  lines.push("", "include $(shell cocotb-config --makefiles)/Makefile.sim", "");
  return lines.join(`
`);
}
function parseResultsXml(xml) {
  const cases = [];
  let tests = null;
  let failures = null;
  let errors = null;
  let skipped = null;
  for (const sm of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const attrs = sm[1] ?? "";
    const num = (k) => {
      const m = attrs.match(new RegExp(k + '="(\\d+)"'));
      return m ? Number(m[1]) : null;
    };
    tests ??= num("tests");
    failures ??= num("failures");
    errors ??= num("errors");
    skipped ??= num("skipped");
  }
  const caseRe = /<testcase\b([^>]*?)\/?>/g;
  const openTags = [];
  for (const m of xml.matchAll(caseRe)) {
    openTags.push({ index: m.index, end: m.index + m[0].length, attrs: m[1] ?? "" });
  }
  for (let i = 0;i < openTags.length; i++) {
    const tag = openTags[i];
    const nextIdx = i + 1 < openTags.length ? openTags[i + 1].index : xml.indexOf("</testsuite>", tag.end);
    const body = nextIdx >= 0 ? xml.slice(tag.end, nextIdx) : "";
    const get = (k) => {
      const m = tag.attrs.match(new RegExp(k + '="([^"]*)"'));
      return m ? m[1] : null;
    };
    const timeMs = Number(get("time") ?? "0") * 1000;
    const failFull = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/);
    const errFull = body.match(/<error\b[^>]*>([\s\S]*?)<\/error>/);
    const failSelf = body.match(/<failure\b([^>]*)\/>/);
    const errSelf = body.match(/<error\b([^>]*)\/>/);
    const selfMsg = (tagBody, tagName) => {
      const g = (k) => {
        const m = tagBody.match(new RegExp(k + '="([^"]*)"'));
        return m ? m[1] : null;
      };
      const msg = g("error_msg") ?? g("message");
      const type = g("error_type") ?? g("type");
      if (msg && type)
        return `${type}: ${msg}`;
      return msg ?? type ?? `${tagName} (no message)`;
    };
    const fail = failFull ?? failSelf;
    const err = errFull ?? errSelf;
    const skip = body.includes("<skipped");
    const status = skip ? "skip" : err ? "error" : fail ? "fail" : "pass";
    const fm = fail ? fail[1] && fail[1].includes("=") ? selfMsg(fail[1], "failure") : (fail[1] ?? "").trim() || null : err ? err[1] && err[1].includes("=") ? selfMsg(err[1], "error") : (err[1] ?? "").trim() || null : null;
    cases.push({ name: get("name") ?? "?", status, timeMs, failureMsg: fm ? fm.slice(0, 500) : null });
  }
  return { cases, summary: { tests, failures, errors, skipped } };
}
function collectWaves(caseDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync3(dir, { withFileTypes: true })) {
      const p = join9(dir, e.name);
      if (e.isDirectory())
        walk(p);
      else if (/\.(fst|vcd|fsdb)$/i.test(e.name) && statSync2(p).size > 0) {
        out.push({ file: p, fmt: e.name.toLowerCase().endsWith(".fst") ? "fst" : e.name.toLowerCase().endsWith(".fsdb") ? "fsdb" : "vcd" });
      }
    }
  };
  walk(caseDir);
  return out.slice(0, 50);
}
async function verifSim(a, deps = {}, exec, config) {
  if (a.backend === "vcs") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "mpd_verif_sim is the cocotb lane (iverilog|verilator); vcs is handled by mpd_verif_uvm", "call mpd_verif_uvm for the VCS/UVM flow");
  }
  if (!a.sources || a.sources.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no sources given", "pass sources[] (RTL files) for the simulation");
  }
  const gate = requireCocotbVenv(undefined, exec);
  const probe = probeBackend(a.backend, config);
  if (!probe.present) {
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${a.backend}' not found on this machine`, `install it or set MPD_DSH_VERIF_${a.backend.toUpperCase()} to the tool path`);
  }
  const backend = a.backend;
  const waves = a.waves ?? true;
  const stamp = runStamp();
  const caseDir = join9(workDir(exec), "sim", `${a.top}-${stamp}`);
  mkdirSync5(caseDir, { recursive: true });
  const resultsXml = join9(caseDir, "results.xml");
  const resolvedBackend = resolveBackendBinary(backend, config ?? undefined);
  const icarusShimDir = backend === "iverilog" && resolvedBackend !== null ? writeIcarusShimDir(caseDir, resolvedBackend.binary, join9(dirname4(resolvedBackend.binary), "vvp")) : null;
  const tbModules = a.tbModules && a.tbModules.length > 0 ? a.tbModules : [a.top + "_tb"];
  const tbPathDirs = resolveTbPathDirs(tbModules, a.sources, workspaceRoot(exec));
  const makePy = buildSimMakefile({
    backend,
    top: a.top,
    sources: a.sources.map((s) => isAbsolute2(s) ? s : join9(workspaceRoot(exec), s)),
    includes: (a.includes ?? []).map((i) => isAbsolute2(i) ? i : join9(workspaceRoot(exec), i)),
    defines: normalizeDefines(a.defines),
    waves,
    traceFst: a.traceFst,
    coverage: a.coverage,
    icarusBinDir: icarusShimDir ?? undefined
  });
  const makefilePath = join9(caseDir, "Makefile");
  writeFileSync4(makefilePath, makePy);
  const simLog = join9(caseDir, "sim.log");
  const venvBin = join9(gate.venv, "bin");
  const makePathParts = [venvBin];
  if (resolvedBackend !== null) {
    const toolDir = dirname4(resolvedBackend.binary);
    if (toolDir !== venvBin)
      makePathParts.push(toolDir);
  }
  if (typeof process.env.PATH === "string" && process.env.PATH.length > 0)
    makePathParts.push(process.env.PATH);
  const makeEnv = {
    PATH: makePathParts.join(":"),
    COCOTB_RESULTS_FILE: resultsXml,
    COCOTB_TEST_MODULES: tbModules.join(","),
    COCOTB_TOPLEVEL: a.top,
    PYTHONPATH: tbPathDirs.join(":"),
    ...a.testFilter ? { COCOTB_TESTCASE: a.testFilter } : {},
    ...a.seed !== undefined ? { COCOTB_RANDOM_SEED: String(a.seed) } : {}
  };
  const r = run("make", ["-f", makefilePath, "sim"], { cwd: caseDir, env: makeEnv, unsetEnv: ["PYTHONHOME"], timeoutMs: (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000 });
  writeLog(simLog, "== argv: make -f " + makefilePath + " sim (PATH=" + makeEnv.PATH + `)
` + r.combined + `
EXIT: ` + String(r.status));
  if (r.timedOut) {
    throw new VerifError("VERIF_E_TIMEOUT", `simulation of '${a.top}' timed out`, `increase timeoutSec or narrow the test set; log: ${simLog}`);
  }
  if (r.spawnError) {
    throw new VerifError("VERIF_E_RUN", `make failed to start: ${r.spawnError}`, `ensure make is installed and the venv is healthy (mpd_verif_venv action:"status") — venv at ${gate.venv}`);
  }
  const xmlText = existsSync6(resultsXml) ? readFileSync2(resultsXml, "utf8") : null;
  if (!xmlText) {
    throw new VerifError("VERIF_E_RUN", `sim exited (status ${r.status}) but no results.xml was produced by cocotb`, `read ${simLog}; typically a build-stage failure, or a TB import error in ${tbModules.join(", ")} (place the <tb>.py next to an RTL source, in the workspace root, or add it via PYTHONPATH)`);
  }
  const parsed = parseResultsXml(xmlText);
  const failed = parsed.cases.filter((c) => c.status !== "pass").length;
  const ok = r.status === 0 && failed === 0;
  const wavs = collectWaves(caseDir);
  const waveHooks = a.waveHook === false ? [] : await runWaveHooksSafe(deps.tools, wavs, a.top, caseDir);
  return {
    ok,
    backend,
    top: a.top,
    venv: gate.venv,
    cocotbVersion: gate.cocotbVersion,
    seed: a.seed !== undefined ? String(a.seed) : null,
    cases: parsed.cases,
    resultsXml,
    simLog,
    makefilePath,
    caseDir,
    wavesfiles: wavs,
    waveHooks,
    exitCode: r.status,
    ...ok ? {} : {
      error: {
        code: "VERIF_E_RUN",
        message: `simulation failed: ${parsed.cases.filter((c) => c.status !== "pass").length} of ${parsed.cases.length} case(s) not passing (exit ${r.status})`,
        hint: `read ${simLog} and the failure blocks in result.cases; fix the TB/DUT and rerun`
      }
    }
  };
}
function resolveTbPathDirs(tbModules, sources, wsRoot) {
  const dirs = new Set([wsRoot]);
  const candidates = new Set([wsRoot, join9(wsRoot, "tb")]);
  for (const src of sources) {
    const base = dirname4(isAbsolute2(src) ? src : join9(wsRoot, src));
    candidates.add(base);
    candidates.add(join9(base, "tb"));
  }
  for (const tb of tbModules) {
    const flat = tb.split(".")[0];
    for (const d of candidates) {
      if (existsSync6(join9(d, flat + ".py"))) {
        dirs.add(d);
        break;
      }
    }
  }
  return [...dirs];
}
async function runWaveHooksSafe(tools, waves, top, caseDir) {
  try {
    return await runWaveHooks(tools ?? {}, { wavefile: waves[0] ?? null, top, sessionDir: waveSessionDir(caseDir), caseDir });
  } catch (e) {
    return [{ status: "failed", server: "wave_mcp", tool: null, message: "wave hook error: " + String(e) }];
  }
}

// src/uvm.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync6, readdirSync as readdirSync4, readFileSync as readFileSync3, rmSync, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join10 } from "node:path";
var LAYOUT_DIRS = ["rtl", "script", "tb", "top", "test", "work"];
var LAYOUT_REQUIRED_FILES = ["tb_api_primitives.svh"];
var LAYOUT_MANDATORY_TESTS = ["sanity_test", "reg_access_test"];
var MAX_COMPILE_ATTEMPTS = 3;
var DEFAULT_VERBOSITY = "UVM_MEDIUM";
function layoutCheck(ipRoot) {
  const errors = [];
  if (!existsSync7(ipRoot)) {
    return { ok: false, errors: [`missing ip root: <ip> (${ipRoot})`], tests: [] };
  }
  for (const d of LAYOUT_DIRS) {
    if (!existsSync7(join10(ipRoot, d)))
      errors.push(`missing dir: ${d}/`);
  }
  for (const f of LAYOUT_REQUIRED_FILES) {
    if (!existsSync7(join10(ipRoot, "tb", f)) && !findFile(ipRoot, f))
      errors.push(`missing shared BFM source of truth: ${f} (expected under <ip>/tb/)`);
  }
  const testDir = join10(ipRoot, "test");
  const tests = [];
  if (existsSync7(testDir)) {
    for (const e of readdirSync4(testDir)) {
      if (e.endsWith("_test.sv"))
        tests.push(e.slice(0, -3));
    }
  }
  if (tests.length === 0)
    errors.push("no *_test.sv cases found in test/ (naming contract: <case>_test.sv)");
  for (const t of LAYOUT_MANDATORY_TESTS) {
    if (!tests.includes(t))
      errors.push(`mandatory test missing: ${t}_test.sv (sanity_test + reg_access_test are required by the UVM contract)`);
  }
  return { ok: errors.length === 0, errors, tests };
}
function findFile(dir, name) {
  for (const e of readdirSync4(dir, { withFileTypes: true })) {
    const p = join10(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".")) {
      if (findFile(p, name))
        return true;
    } else if (e.name === name)
      return true;
  }
  return false;
}
function defaultUvmSeed() {
  const base = Number(String(Date.now()).slice(0, 10));
  return base % 1e6;
}
function resolveVcsBinary() {
  const probe = probeBackend("vcs");
  if (!probe.present || !probe.binary) {
    throw new VerifError("VERIF_E_NO_BACKEND", "vcs is not resolvable on this machine", "set MPD_DSH_VERIF_VCS or add $VCS_HOME/bin to PATH; license vars: VCS_HOME, LM_LICENSE_FILE, SNPSLMD_LICENSE_FILE");
  }
  return probe.binary;
}
function envGate(needs, reason) {
  const missing = needs.filter((k) => !process.env[k] || process.env[k].trim().length === 0);
  if (missing.length > 0) {
    throw new VerifError("VERIF_E_ENV", `${reason} requires: ${needs.join(", ")} — missing: ${missing.join(", ")}`, "export the listed variables in the launching shell (VERDI_HOME/NOVAS_HOME/VCS_HOME + license vars), then retry");
  }
}
function resolveFilelist(args, ipRoot) {
  if (args.filelist && existsSync7(args.filelist))
    return args.filelist;
  const auto = join10(ipRoot, "script", "filelist.f");
  if (existsSync7(auto))
    return auto;
  throw new VerifError("VERIF_E_TEMPLATE", `no filelist: neither the filelist argument nor <ip>/script/filelist.f exists`, `create ${auto} (rtl files + tb_api_primitives.svh + testbench sources) or pass filelist=<path>`);
}
function compileArgs(vcs, args, ipRoot, wdir) {
  const uvmVer = args.uvmVer ?? "1.2";
  const filelist = resolveFilelist(args, ipRoot);
  const covDir = args.coverage ? join10(wdir, "cov", "compile") : null;
  const withDebug = args.action === "wave" || args.action === "regress" && args.coverage;
  const argv = [vcs, "-sverilog", "+v2k", "-ntb_opts", `uvm-${uvmVer}`];
  if (withDebug || args.action === "wave")
    argv.push("-debug_access+all");
  if (args.action === "wave")
    argv.push("-kdb");
  if (covDir)
    argv.push("-cm", "line+cond+tgl", "-cm_dir", covDir);
  for (const i of args.includes ?? [])
    argv.push("+incdir+" + i);
  for (const d of args.defines ?? [])
    argv.push("+define+" + d);
  argv.push("-f", filelist, "-l", join10(wdir, "vcs_compile.log"), "-o", join10(wdir, "simv"));
  return { args: argv, logPath: join10(wdir, "vcs_compile.log"), simv: join10(wdir, "simv"), covDir };
}
function runArgs(simv, args, test, caseDir, covDir) {
  const argv = [simv, "+UVM_TESTNAME=" + test, "+UVM_VERBOSITY=" + (args.verbosity ?? DEFAULT_VERBOSITY)];
  if (args.seed !== undefined)
    argv.push("+ntb_random_seed=" + String(args.seed));
  if (covDir)
    argv.push("-cm", "line+cond+tgl", "-cm_dir", covDir);
  argv.push("-l", join10(caseDir, "run.log"));
  return argv;
}
function countUvmErrors(logText) {
  const m = logText.match(/UVM_ERROR\s*:\s*(\d+)/);
  return m ? Number(m[1]) : logText.includes("UVM_ERROR") ? 1 : 0;
}
function runFsdbreportHooks(wavesfiles, reportDir) {
  const out = [];
  const tool = resolveEdaTool("fsdbreport");
  for (const w of wavesfiles.filter((f) => f.fmt === "fsdb")) {
    if (!tool) {
      out.push({ status: "unavailable", binary: null, args: [], exitCode: null, logPath: "", message: "fsdbreport not wired — " + FSDBREPORT_HINT });
      continue;
    }
    const logPath = join10(reportDir, "fsdbreport.log");
    const r = runFsdbreport(tool.binary, w.file, 120000);
    writeLog(logPath, r.combined);
    out.push(r.status === 0 ? { status: "ok", binary: tool.binary, args: [w.file], exitCode: r.status, logPath, message: "FSDB report clean for " + w.file } : { status: "failed", binary: tool.binary, args: [w.file], exitCode: r.status, logPath, message: "fsdbreport flagged issues in " + w.file + (r.combined ? ": " + r.combined.slice(0, 200) : "") });
  }
  return out;
}
function runCase(vcs, args, simv, test, caseDir, covBase, timeoutMs) {
  mkdirSync6(caseDir, { recursive: true });
  const seed = args.seed !== undefined ? String(args.seed) : String(defaultUvmSeed());
  const covDir = covBase ? join10(covBase, `work_${test}_`) : null;
  const argv = runArgs(simv, { ...args, seed }, test, caseDir, covDir);
  const logPath = join10(caseDir, "run.log");
  const r = run(argv[0], argv.slice(1), { cwd: caseDir, timeoutMs });
  if (r.combined.trim().length > 0)
    writeLog(logPath, r.combined);
  const logText = existsSync7(logPath) ? readFileSync3(logPath, "utf8") : "";
  const uvmErrors = countUvmErrors(logText.trim().length > 0 ? logText : r.combined);
  const waves = collectWaves(caseDir);
  return {
    test,
    seed,
    status: r.status === 0 && uvmErrors === 0 ? "pass" : "fail",
    exitCode: r.status,
    logPath,
    uvmErrors,
    wavefile: waves[0] ? { file: waves[0].file, fmt: waves[0].fmt } : null
  };
}
function readCompileState(wdir) {
  const p = join10(wdir, "compile-state.json");
  try {
    return { ...{ attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false }, ...JSON.parse(readFileSync3(p, "utf8")) };
  } catch {
    return { attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false };
  }
}
function writeCompileState(wdir, s) {
  try {
    writeFileSync5(join10(wdir, "compile-state.json"), JSON.stringify(s));
  } catch {}
}
async function verifUvm(a, tools, exec) {
  const vcs = resolveVcsBinary();
  if (a.action === "wave")
    envGate(["VERDI_HOME", "NOVAS_HOME"].filter((k) => k && k.length > 0), "wave dumping (fsdb)");
  const ipRoot = a.top;
  const wdir = join10(ipRoot, "work");
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
  if (a.action === "clean") {
    try {
      rmSync(wdir, { recursive: true, force: true });
    } catch {}
    return { ok: true, action: "clean", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2", args: ["rm", "-rf", wdir], exitCode: 0, logPath: "", simv: join10(wdir, "simv"), root: ipRoot, cases: [], wavesfiles: [], waveHooks: [], attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: [] };
  }
  const layout = a.action === "merge-cov" ? { ok: true, errors: [], tests: [] } : layoutCheck(ipRoot);
  if (!layout.ok) {
    throw new VerifError("VERIF_E_TEMPLATE", "UVM template layout contract violated under " + ipRoot, "expected tree <ip>/{rtl,script,tb,top,test,work/}, tb/tb_api_primitives.svh, test/<case>_test.sv with mandatory sanity_test + reg_access_test — missing: " + layout.errors.join("; "));
  }
  if (a.uvmVer && a.uvmVer !== "1.2" && a.uvmVer !== "1.1") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "unsupported UVM version " + a.uvmVer, "UVM contract targets uvmVer 1.2 (1.1 accepted for legacy benches)");
  }
  mkdirSync6(wdir, { recursive: true });
  const stamp = runStamp();
  if (a.action === "compile") {
    const plan = compileArgs(vcs, a, ipRoot, wdir);
    const r = run(plan.args[0], plan.args.slice(1), { timeoutMs });
    writeLog(plan.logPath, r.combined);
    const state = readCompileState(wdir);
    if (r.status !== 0) {
      state.attempts += 1;
      state.unresolved = state.attempts >= state.maxAttempts;
      writeCompileState(wdir, state);
      if (state.unresolved)
        writeLog(join10(wdir, "unresolved.md"), `# unresolved compile issues (attempts exhausted)

` + r.combined.slice(-8000));
      return {
        ok: false,
        action: "compile",
        backend: "vcs",
        binary: vcs,
        verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
        uvmVer: a.uvmVer ?? "1.2",
        args: plan.args,
        exitCode: r.status,
        logPath: plan.logPath,
        simv: plan.simv,
        root: ipRoot,
        cases: [],
        wavesfiles: [],
        waveHooks: [],
        attempts: state.attempts,
        maxAttempts: state.maxAttempts,
        unresolved: state.unresolved,
        layoutErrors: layout.errors,
        error: { code: "VERIF_E_COMPILE", message: `vcs compile failed (exit ${r.status}); attempt ${state.attempts}/${state.maxAttempts}`, hint: state.unresolved ? `attempt cap reached — fix issues recorded in ${join10(wdir, "unresolved.md")}, then rerun` : `read ${plan.logPath}, fix the first error, then re-run compile (attempts are tracked)` }
      };
    }
    writeCompileState(wdir, { attempts: 0, maxAttempts: state.maxAttempts, unresolved: false });
    return {
      ok: true,
      action: "compile",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: plan.args,
      exitCode: r.status,
      logPath: plan.logPath,
      simv: plan.simv,
      root: ipRoot,
      cases: [],
      wavesfiles: [],
      waveHooks: [],
      attempts: 0,
      maxAttempts: state.maxAttempts,
      unresolved: false,
      layoutErrors: layout.errors
    };
  }
  const simvExists = existsSync7(join10(wdir, "simv"));
  if (!simvExists && a.action !== "regress" && a.action !== "merge-cov") {
    throw new VerifError("VERIF_E_RUN", `no compiled simv under ${wdir}; run action:"compile" first`, "call mpd_verif_uvm with action compile, then retry");
  }
  const simv = join10(wdir, "simv");
  if (a.action === "run") {
    const test = a.test ?? "sanity_test";
    if (!layout.tests.includes(test) && !test.endsWith("_test")) {
      throw new VerifError("VERIF_E_TEMPLATE", `test '${test}' is not listed in test/ (*_test.sv contract)`, "pass test=<case> matching a *_test.sv file, or scaffold it under test/");
    }
    const caseDir = join10(wdir, `work_${test}_`);
    const c = runCase(vcs, a, simv, test, caseDir, a.coverage ? join10(wdir, "cov") : null, timeoutMs);
    const wavesfiles = collectWaves(caseDir);
    const waveHooks = a.waveHook === false ? [] : await safeHooks(tools, { wavefile: wavesfiles[0] ?? null, top: test, sessionDir: waveSessionDir(caseDir), caseDir, simLog: c.logPath, verifRoot: ipRoot, caseName: test, lane: "vcs" });
    return {
      ok: c.status === "pass",
      action: "run",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: runArgs(simv, a, test, caseDir, null),
      exitCode: c.exitCode,
      logPath: c.logPath,
      simv,
      root: ipRoot,
      cases: [c],
      wavesfiles,
      waveHooks,
      fsdbReports: runFsdbreportHooks(wavesfiles, caseDir),
      attempts: 0,
      maxAttempts: MAX_COMPILE_ATTEMPTS,
      unresolved: false,
      layoutErrors: layout.errors,
      ...c.status === "pass" ? {} : { error: { code: "VERIF_E_RUN", message: `UV M test '${test}' failed (uvm_errors=${c.uvmErrors ?? "?"})`, hint: `read ${c.logPath}; wave via wave-mcp/TraceWeave if wired` } }
    };
  }
  if (a.action === "wave") {
    const test = a.test ?? "sanity_test";
    const caseDir = join10(wdir, `work_${test}_wave`);
    const c = runCase(vcs, a, simv, test, caseDir, null, timeoutMs);
    const wavesfiles = collectWaves(caseDir);
    const waveHooks = a.waveHook === false ? [] : await safeHooks(tools, { wavefile: wavesfiles[0] ?? null, top: test, sessionDir: waveSessionDir(caseDir), caseDir, simLog: c.logPath, verifRoot: ipRoot, caseName: test, lane: "vcs" });
    return {
      ok: c.status === "pass",
      action: "wave",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: runArgs(simv, a, test, caseDir, null),
      exitCode: c.exitCode,
      logPath: c.logPath,
      simv,
      root: ipRoot,
      cases: [c],
      wavesfiles,
      waveHooks,
      fsdbReports: runFsdbreportHooks(wavesfiles, caseDir),
      attempts: 0,
      maxAttempts: MAX_COMPILE_ATTEMPTS,
      unresolved: false,
      layoutErrors: layout.errors,
      ...wavesfiles.length === 0 ? { error: { code: "VERIF_E_RUN", message: "wave run produced no fsdb/vcd", hint: "dump $fsdbDumpfile inside the TB (FSDB contract) and retry wave" } } : {}
    };
  }
  if (a.action === "regress") {
    const covSeed = a.coverage ? join10(wdir, "cov") : null;
    const cases = [];
    const simvNow = existsSync7(simv) ? simv : (() => {
      const plan = compileArgs(vcs, a, ipRoot, wdir);
      const rc = run(plan.args[0], plan.args.slice(1), { timeoutMs });
      writeLog(plan.logPath, rc.combined);
      if (rc.status !== 0)
        throw new VerifError("VERIF_E_COMPILE", `regress pre-compile failed (exit ${rc.status})`, `read ${plan.logPath} and rerun`);
      return plan.simv;
    })();
    for (const t of layout.tests) {
      const caseDir = join10(wdir, `work_${t}_`, stamp);
      cases.push(runCase(vcs, a, simvNow, t, caseDir, covSeed, timeoutMs));
    }
    const ok = cases.every((c) => c.status === "pass");
    const wavesfiles = cases.map((c) => c.wavefile).filter((w) => Boolean(w));
    const regHooks = [];
    if (a.waveHook !== false) {
      for (const c of cases) {
        if (!c.wavefile || regHooks.length >= 10)
          continue;
        regHooks.push(...await safeHooks(tools, { wavefile: { file: c.wavefile.file, fmt: c.wavefile.fmt }, top: c.test, sessionDir: waveSessionDir(wdir), caseDir: wdir, simLog: c.logPath, verifRoot: ipRoot, caseName: c.test, lane: "vcs" }));
      }
    }
    return {
      ok,
      action: "regress",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: [],
      exitCode: ok ? 0 : 1,
      logPath: join10(wdir, `regress-${stamp}.md`),
      simv: simvNow,
      root: ipRoot,
      cases,
      wavesfiles,
      waveHooks: regHooks,
      fsdbReports: runFsdbreportHooks(wavesfiles, wdir),
      attempts: 0,
      maxAttempts: MAX_COMPILE_ATTEMPTS,
      unresolved: false,
      layoutErrors: layout.errors,
      ...ok ? {} : { error: { code: "VERIF_E_RUN", message: `${cases.filter((c) => c.status !== "pass").length} of ${cases.length} UVM case(s) failed`, hint: "read the per-case run logs under work/work_<case>_/" } }
    };
  }
  const covRoot = join10(wdir, "cov");
  if (!existsSync7(covRoot)) {
    throw new VerifError("VERIF_E_RUN", "no coverage data: " + covRoot, "run compile/regress with coverage:true before merging");
  }
  const urg = process.env.MPD_DSH_VERIF_URG ?? join10(process.env.VCS_HOME ?? "/usr", "bin", "urg");
  const dirs = readdirSync4(covRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join10(covRoot, e.name));
  if (dirs.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no coverage directory content under " + covRoot, "enable coverage on compile/run and re-run the regression");
  }
  const reportDir = join10(wdir, "cov_report");
  const argv = [urg, ...dirs.flatMap((d) => ["-dir", d]), "-report", reportDir, "-format", "both"];
  const r = run(argv[0], argv.slice(1), { timeoutMs });
  return {
    ok: r.status === 0,
    action: "merge-cov",
    backend: "vcs",
    binary: vcs,
    verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
    uvmVer: a.uvmVer ?? "1.2",
    args: argv,
    exitCode: r.status,
    logPath: join10(wdir, "urg.log"),
    simv,
    root: ipRoot,
    cases: [],
    wavesfiles: [],
    waveHooks: [],
    attempts: 0,
    maxAttempts: MAX_COMPILE_ATTEMPTS,
    unresolved: false,
    layoutErrors: layout.errors,
    covReport: reportDir,
    ...r.status === 0 ? {} : { error: { code: "VERIF_E_ENV", message: "urg merge failed", hint: "ensure urg is available (VCS_HOME/bin or MPD_DSH_VERIF_URG)" } }
  };
}
async function safeHooks(tools, req) {
  try {
    return await runWaveHooks(tools ?? {}, req);
  } catch (e) {
    return [{ status: "failed", server: "traceweave", tool: null, message: "wave hook error: " + String(e) }];
  }
}

// src/regress.ts
import { mkdirSync as mkdirSync7, writeFileSync as writeFileSync6, existsSync as existsSync8, readdirSync as readdirSync5 } from "node:fs";
import { join as join11 } from "node:path";
function expandCases(args, exec) {
  if (args.cases && args.cases.length > 0)
    return { kind: "explicit", names: args.cases };
  if (args.glob) {
    const root = workspaceRoot(exec);
    return { kind: "explicit", names: globFiles(root, args.glob) };
  }
  return { kind: "explicit", names: ["all"] };
}
function globFiles(root, pattern) {
  const out = [];
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  const walk = (dir) => {
    if (!existsSync8(dir))
      return;
    for (const e of readdirSync5(dir, { withFileTypes: true })) {
      const p = join11(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith("."))
          walk(p);
        continue;
      }
      const rel = p.slice(root.length + 1);
      if (re.test(rel))
        out.push(rel);
    }
  };
  walk(root);
  return out.slice(0, 100);
}
function createRegressDir(exec) {
  const regressDir = join11(workDir(exec), "regress", runStamp());
  mkdirSync7(regressDir, { recursive: true });
  return regressDir;
}
async function verifRegress(args, tools, exec, config) {
  const backend = args.backend;
  if (!["iverilog", "verilator", "vcs"].includes(backend) || backend === "") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "unsupported regression backend: " + String(backend), "use iverilog | verilator (cocotb lane) or vcs (UVM lane)");
  }
  const seedBase = args.seedBase ?? dateSeedBase();
  if (backend === "vcs") {
    const top = args.sim?.top;
    if (!top)
      throw new VerifError("VERIF_E_RUN", "vcs regression needs sim.top (the <ip> root for the UVM layout)", "pass sim.top=<ip-root>");
    const probe = probeBackend("vcs", config);
    if (!probe.present)
      throw new VerifError("VERIF_E_NO_BACKEND", "vcs not resolvable", "set MPD_DSH_VERIF_VCS or add $VCS_HOME/bin to PATH");
    const uvmRes = await verifUvm({
      action: "regress",
      top,
      coverage: true,
      test: undefined,
      timeoutSec: args.timeoutSec,
      waveHook: args.waveHook !== false
    }, tools);
    const cases = uvmRes.cases.map((c) => ({ backend: "vcs", test: c.test, seed: c.seed, status: c.status === "pass" ? "pass" : "fail", timeMs: 0, wave: c.wavefile ?? null, failureMsg: null }));
    const rep = buildReport("vcs", cases, seedBase);
    const regressDir = createRegressDir(exec);
    const resultsJson = join11(regressDir, "results.json");
    writeFileSync6(resultsJson, JSON.stringify({ backend, seedBase, total: cases.length, passed: cases.filter((c) => c.status === "pass").length, failed: cases.filter((c) => c.status === "fail").length, skipped: 0, cases }, null, 2));
    const reportPath = join11(regressDir, "results.md");
    writeFileSync6(reportPath, rep);
    return {
      ok: uvmRes.ok,
      backend,
      total: cases.length,
      passed: cases.filter((c) => c.status === "pass").length,
      failed: cases.filter((c) => c.status === "fail").length,
      skipped: 0,
      seedBase,
      cases,
      resultsJson,
      reportMarkdown: rep,
      reportPath,
      waveHooks: uvmRes.waveHooks,
      ...uvmRes.ok ? {} : { error: uvmRes.error }
    };
  }
  const gate = requireCocotbVenv(undefined, exec);
  const probe = probeBackend(backend, config);
  if (!probe.present)
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${backend}' not found`, `install it or set MPD_DSH_VERIF_${backend.toUpperCase()}`);
  const expanded = expandCases(args);
  if (expanded.names.length === 0)
    throw new VerifError("VERIF_E_RUN", "no regression cases matched", "pass cases[] or a glob that matches tb modules");
  if (!args.sim?.top)
    throw new VerifError("VERIF_E_RUN", "regression needs sim.top (hdl_toplevel)", "pass sim.top=<toplevel-module>");
  if (!args.sim?.sources || args.sim.sources.length === 0)
    throw new VerifError("VERIF_E_RUN", "regression needs sim.sources", "pass sim.sources=[RTL files]");
  const regressDir = createRegressDir(exec);
  const cases = [];
  const waveHooks = [];
  let stop = false;
  const maxFailures = args.maxFailures ?? 0;
  for (let idx = 0;idx < expanded.names.length && !stop; idx++) {
    const name = expanded.names[idx];
    const seed = String(seedBase + idx);
    try {
      const r = await verifSim({
        backend,
        top: args.sim.top,
        tbModules: args.sim.tbModules,
        sources: args.sim.sources,
        includes: args.sim.includes,
        defines: args.sim.defines,
        testFilter: name === "all" ? undefined : name,
        seed,
        waves: args.sim.waves ?? true,
        traceFst: args.sim.traceFst ?? true,
        coverage: args.sim.coverage ?? false,
        timeoutSec: args.timeoutSec,
        waveHook: false
      }, {}, exec, config);
      const status = r.ok && r.cases.length > 0 && r.cases.every((c) => c.status === "pass") ? "pass" : "fail";
      const wave = r.wavesfiles[0] ? { file: r.wavesfiles[0].file, fmt: r.wavesfiles[0].fmt } : null;
      cases.push({ backend, test: name, seed, status, timeMs: r.cases.reduce((s2, c) => s2 + c.timeMs, 0), wave, failureMsg: r.error?.message ?? null });
      if (args.waveHook !== false && wave) {
        waveHooks.push(...await runWaveHooks(tools ?? {}, { wavefile: { file: wave.file, fmt: wave.fmt }, top: args.sim.top, sessionDir: waveSessionDir(join11(workDir(exec), "sim")), caseDir: r.caseDir, lane: "oss" }));
      }
    } catch (e) {
      const re = refusalOfLike(e);
      cases.push({ backend, test: name, seed, status: "fail", timeMs: 0, wave: null, failureMsg: re.message });
      waveHooks.push({ status: "failed", server: "wave_mcp", tool: null, message: re.message });
    }
    const failed = cases.filter((c) => c.status === "fail").length;
    if (maxFailures > 0 && failed >= maxFailures)
      stop = true;
    if (args.stopOnError && failed > 0)
      stop = true;
  }
  const passed = cases.filter((c) => c.status === "pass").length;
  const failedN = cases.filter((c) => c.status === "fail").length;
  const skipped = cases.filter((c) => c.status === "skip").length;
  const rep = buildReport(backend, cases, seedBase);
  const resultsJson = join11(regressDir, "results.json");
  writeFileSync6(resultsJson, JSON.stringify({ backend, seedBase, total: cases.length, passed, failed: failedN, skipped, cases: cases.map(({ wave, ...rest }) => rest) }, null, 2));
  const reportPath = join11(regressDir, "results.md");
  writeFileSync6(reportPath, rep);
  return {
    ok: failedN === 0 && cases.length > 0,
    backend,
    total: cases.length,
    passed,
    failed: failedN,
    skipped,
    seedBase,
    cases,
    resultsJson,
    reportMarkdown: rep,
    reportPath,
    waveHooks,
    ...failedN === 0 ? {} : { error: { code: "VERIF_E_RUN", message: `${failedN} of ${cases.length} regression case(s) failed`, hint: `read ${reportPath} and the per-case logs under ${regressDir}/../sim` } }
  };
}
function refusalOfLike(e) {
  if (e instanceof VerifError)
    return { code: e.code, message: e.message, hint: e.hint };
  return { code: "VERIF_E_RUN", message: String(e), hint: "inspect the per-case log" };
}
function buildReport(backend, cases, seedBase) {
  const lines = [
    `# RTL regression report (${backend})`,
    "",
    `- seedBase: ${seedBase}`,
    `- cases: ${cases.length}, passed: ${cases.filter((c) => c.status === "pass").length}, failed: ${cases.filter((c) => c.status === "fail").length}, skipped: ${cases.filter((c) => c.status === "skip").length}`,
    "",
    "| case | seed | status | time(ms) | wave | notes |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const c of cases) {
    lines.push(`| ${c.test} | ${c.seed} | ${c.status} | ${Math.round(c.timeMs)} | ${c.wave ? c.wave.fmt : "-"} | ${esc(c.failureMsg ?? "")} |`);
  }
  return lines.join(`
`) + `
`;
}
function esc(s) {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}

// src/silicon/tool.ts
import { existsSync as existsSync9 } from "node:fs";
var ACTIONS = ["show", "set", "unset", "init", "path", "detect"];
function normalizeAction(value) {
  const action = String(value ?? "show");
  return ACTIONS.includes(action) ? action : "show";
}
function pathInfo(exec) {
  const p = siliconPaths(exec);
  return {
    ok: true,
    action: "path",
    dshHome: p.dshHome,
    workspaceRoot: p.workspaceRoot,
    userFile: { path: p.userFile, exists: existsSync9(p.userFile) },
    workspaceFile: { path: p.workspaceFile, exists: existsSync9(p.workspaceFile) }
  };
}
function dispatch(args, exec) {
  const action = normalizeAction(args.action);
  switch (action) {
    case "show":
      return showConfig(exec, typeof args.key === "string" && args.key.trim().length > 0 ? args.key : undefined);
    case "set": {
      if (typeof args.key !== "string" || args.key.trim().length === 0) {
        throw new VerifError("VERIF_E_CONFIG", "action=set needs a key", "pass key like ossCadSuite.bin or librelane.mode");
      }
      if (args.value === undefined) {
        throw new VerifError("VERIF_E_CONFIG", "action=set needs a value", "pass value (string / boolean) matching the key's schema type");
      }
      return setConfigValue({ key: args.key, value: args.value, scope: typeof args.scope === "string" ? args.scope : undefined }, exec);
    }
    case "unset": {
      if (typeof args.key !== "string" || args.key.trim().length === 0) {
        throw new VerifError("VERIF_E_CONFIG", "action=unset needs a key", "pass key like ossCadSuite.bin");
      }
      return unsetConfigValue({ key: args.key, scope: typeof args.scope === "string" ? args.scope : undefined }, exec);
    }
    case "init":
      return initConfigFile({ scope: typeof args.scope === "string" ? args.scope : undefined, force: args.force === true }, exec);
    case "path":
      return pathInfo(exec);
    case "detect":
      return detectToolchains();
  }
}
function render(value) {
  const v = value;
  if (v && v.error) {
    return [{ type: "text", text: `mpd_verif_toolchain FAILED: ${v.error.message}
hint: ${v.error.hint}` }];
  }
  switch (v?.action) {
    case "set":
      return [{ type: "text", text: `mpd_verif_toolchain set ${v.scope}:${v.key} = ${JSON.stringify(v.new)} (old ${JSON.stringify(v.old)}, ${v.changed ? "written" : "unchanged"})
file: ${v.file}${(v.notes ?? []).length > 0 ? `
notes: ` + v.notes.map((n) => n.detail).join("; ") : ""}` }];
    case "unset":
      return [{ type: "text", text: `mpd_verif_toolchain unset ${v.scope}:${v.key} (old ${JSON.stringify(v.old)}, ${v.changed ? "removed" : "not set"})
file: ${v.file}` }];
    case "init":
      return [{ type: "text", text: `mpd_verif_toolchain init: template ${v.created ? "written" : "unchanged"} (${v.scope})
file: ${v.file}` }];
    case "path":
      return [{ type: "text", text: `mpd_verif_toolchain paths
user: ${v.userFile.path} (${v.userFile.exists ? "exists" : "missing"})
project: ${v.workspaceFile.path} (${v.workspaceFile.exists ? "exists" : "missing"})
DSH_HOME: ${v.dshHome}
workspace: ${v.workspaceRoot}` }];
    case "detect": {
      const suggestions = (v.suggestions ?? []).map((s) => `  ${s.key} = ${s.value}  (${s.evidence})`).join(`
`);
      return [{ type: "text", text: `mpd_verif_toolchain detect — ${(v.suggestions ?? []).length} suggestion(s)
${suggestions || "  none found"}${v.note ? `
` + v.note : ""}` }];
    }
    case "show": {
      const user = v.userFile;
      const project = v.workspaceFile;
      const files = `user: ${user.path} (${user.exists ? "exists" : "missing"}${user.parseError ? ", parse error" : ""})
project: ${project.path} (${project.exists ? "exists" : "missing"}${project.parseError ? ", parse error" : ""})`;
      const backends = (v.backends ?? []).map((b) => `  ${b.name}: ${b.binary ?? "unresolved"}${b.source ? " [" + b.source + "]" : ""}${b.version ? " — " + b.version : ""}`).join(`
`);
      const paths = (v.paths ?? []).map((p) => `  ${p.key}: ${p.path} (${p.kind}${p.executable ? ", executable" : ""})`).join(`
`);
      const focused = v.key ? `
key ${v.key.key} = ${JSON.stringify(v.key.value)} [${v.key.source ?? "unset"}]` : "";
      const problems = [
        ...(v.parseErrors ?? []).map((e) => `parse error (${e.file}): ${e.error}`),
        ...(v.unknownKeys ?? []).map((k) => `unknown key: ${k}`),
        ...(v.invalidKeys ?? []).map((i) => `invalid ${i.key}: expected ${i.expected}, got ${i.actual}`)
      ];
      return [{ type: "text", text: `mpd_verif_toolchain show${focused}
${files}
resolved backends:
${backends || "  (none)"}${paths ? `
configured paths:
` + paths : ""}${problems.length > 0 ? `
problems:
  ` + problems.join(`
  `) : ""}` }];
    }
    default:
      return [{ type: "text", text: `mpd_verif_toolchain: ${JSON.stringify(v)}` }];
  }
}
function toolchainToolDefinition() {
  return {
    name: "mpd_verif_toolchain",
    description: "Inspect and edit the silicon toolchain config (oss-cad-suite / verible / librelane). Layers: user $DSH_HOME/silicon.jsonc, project <workspace>/.mpd/silicon.jsonc (project wins; env MPD_DSH_VERIF_* still wins at run time, PATH last). action=show (optional key) reports the effective config, per-key source layer, resolved binaries with existence/executable/version and both file paths; action=set (key, value, scope?) writes ONE key with a comment-preserving surgical edit; action=unset removes it; action=init writes a commented template (force to overwrite); action=path lists the two files; action=detect probes env/PATH/common roots and returns suggestions only (never writes). Call this when the user says where oss-cad-suite, verible or librelane live.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS], description: "show (default) | set | unset | init | path | detect" },
        key: { type: "string", description: "dot path for show/set/unset: ossCadSuite.bin | ossCadSuite.home | verible.bin | verible.home | librelane.appimage | librelane.mode | librelane.appimageExtract | librelane.bin | librelane.home" },
        value: { description: "value for action=set (string for paths, boolean for librelane.appimageExtract, 'auto'|'appimage'|'devshell'|'binary' for librelane.mode)" },
        scope: { type: "string", enum: ["user", "workspace"], description: "target layer; default = the layer that already defines the key, else user" },
        force: { type: "boolean", description: "action=init: overwrite an existing file" }
      }
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          action: { type: "string" },
          file: { type: "string" },
          key: {},
          config: { type: "object" },
          backends: { type: "array" },
          suggestions: { type: "array" },
          error: { type: "object" }
        }
      },
      render: (_a, v) => render(v)
    },
    execute: async (args, exec) => {
      try {
        return dispatch(args ?? {}, exec);
      } catch (e) {
        return refusalOf(e);
      }
    }
  };
}

// src/silicon/librelane.ts
import { accessSync as accessSync2, constants as constants2, existsSync as existsSync10 } from "node:fs";
import { basename as basename2, dirname as dirname5, isAbsolute as isAbsolute3, join as join12, relative, resolve as resolve3, sep } from "node:path";
import { workspaceRootOf as workspaceRootOf3 } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";
var DEFAULT_RUN_TIMEOUT_MS = 3600000;
var STATUS_TIMEOUT_MS = 60000;
var TAIL_LINES = 40;
var CONFIG_HINT = "set librelane.bin (or librelane.home) for a binary, or librelane.appimage for an AppImage/devshell, via mpd_verif_toolchain action=set; env MPD_SILICON_LIBRELANE / MPD_SILICON_LIBRELANE_APPIMAGE also work";
function textOf(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function configuredModeOf(value) {
  return value === "binary" || value === "appimage" || value === "devshell" ? value : "auto";
}
function firstExisting(candidates) {
  return candidates.find((candidate) => existsSync10(candidate)) ?? null;
}
function unresolved(mode, configuredMode, reason) {
  return { mode, configuredMode, path: null, source: null, reason, exists: false, executable: false, devshellFromFilename: false };
}
function binaryResolution(path, source, configuredMode, reason) {
  const info = describePath(path);
  return { mode: "binary", configuredMode, path, source, reason, exists: info.exists, executable: info.executable, devshellFromFilename: false };
}
function binSettingCandidates(raw, label) {
  const expanded = resolve3(expandHome(raw));
  const info = describePath(expanded);
  if (info.kind === "file")
    return { candidates: [expanded], reason: label + " is a file" };
  if (info.kind === "directory")
    return { candidates: [join12(expanded, "librelane")], reason: label + " is a directory → <dir>/librelane" };
  return { candidates: [join12(expanded, "librelane")], reason: label + " does not exist; treating it as a bin directory → <dir>/librelane" };
}
function homeCandidates(raw) {
  const home = resolve3(expandHome(raw));
  return [join12(home, "librelane"), join12(home, "bin", "librelane"), join12(home, ".venv", "bin", "librelane")];
}
function configBinaryResolution(cfgBin, cfgHome, configuredMode) {
  if (cfgBin !== null) {
    const setting = binSettingCandidates(cfgBin, "librelane.bin");
    const chosen = firstExisting(setting.candidates) ?? setting.candidates[0];
    return binaryResolution(chosen, "config", configuredMode, setting.reason);
  }
  if (cfgHome !== null) {
    const candidates = homeCandidates(cfgHome);
    const chosen = firstExisting(candidates) ?? candidates[0];
    return binaryResolution(chosen, "config", configuredMode, "librelane.home → " + chosen);
  }
  return null;
}
function envBinaryResolution(raw, configuredMode) {
  const setting = binSettingCandidates(raw, "MPD_SILICON_LIBRELANE");
  const chosen = firstExisting(setting.candidates) ?? setting.candidates[0];
  return binaryResolution(chosen, "env", configuredMode, setting.reason);
}
function appimageResolution(path, source, configuredMode, trigger) {
  const info = describePath(path);
  const devshellName = basename2(path).toLowerCase().includes("devshell");
  const mode = configuredMode === "auto" ? devshellName ? "devshell" : "appimage" : configuredMode;
  const filenameNote = configuredMode === "auto" ? devshellName ? "; filename contains 'devshell' → devshell" : "; filename has no 'devshell' → appimage" : "";
  return {
    mode,
    configuredMode,
    path,
    source,
    reason: trigger + filenameNote,
    exists: info.exists,
    executable: info.executable,
    devshellFromFilename: configuredMode === "auto" && devshellName
  };
}
function resolveLibreLane(config, env = process.env) {
  const ll = config?.librelane;
  const cfgAppimage = textOf(ll?.appimage);
  const cfgBin = textOf(ll?.bin);
  const cfgHome = textOf(ll?.home);
  const configuredMode = configuredModeOf(ll?.mode);
  const envBinary = textOf(env.MPD_SILICON_LIBRELANE);
  const envAppimage = textOf(env.MPD_SILICON_LIBRELANE_APPIMAGE);
  if (configuredMode === "appimage" || configuredMode === "devshell") {
    const image = cfgAppimage ?? envAppimage;
    if (image === null) {
      return unresolved(configuredMode, configuredMode, "librelane.mode=" + configuredMode + " but neither librelane.appimage nor MPD_SILICON_LIBRELANE_APPIMAGE is set");
    }
    const source = cfgAppimage !== null ? "config" : "env";
    const label = source === "config" ? "librelane.appimage" : "MPD_SILICON_LIBRELANE_APPIMAGE";
    return appimageResolution(resolve3(expandHome(image)), source, configuredMode, "librelane.mode=" + configuredMode + " → " + label);
  }
  if (configuredMode === "binary") {
    const fromConfig = configBinaryResolution(cfgBin, cfgHome, configuredMode);
    if (fromConfig !== null)
      return fromConfig;
    if (envBinary !== null)
      return envBinaryResolution(envBinary, configuredMode);
    const onPath = findOnPath("librelane");
    if (onPath !== null)
      return binaryResolution(onPath, "path", configuredMode, "librelane.mode=binary; found 'librelane' on PATH");
    return unresolved("binary", configuredMode, "librelane.mode=binary but librelane.bin, librelane.home, MPD_SILICON_LIBRELANE and PATH did not resolve");
  }
  if (cfgAppimage !== null)
    return appimageResolution(resolve3(expandHome(cfgAppimage)), "config", "auto", "librelane.appimage configured");
  const fromConfig = configBinaryResolution(cfgBin, cfgHome, "auto");
  if (fromConfig !== null)
    return fromConfig;
  if (envAppimage !== null)
    return appimageResolution(resolve3(expandHome(envAppimage)), "env", "auto", "MPD_SILICON_LIBRELANE_APPIMAGE env fallback");
  if (envBinary !== null)
    return envBinaryResolution(envBinary, "auto");
  const onPath = findOnPath("librelane");
  if (onPath !== null)
    return binaryResolution(onPath, "path", "auto", "no AppImage/bin/home configured; found 'librelane' on PATH");
  return unresolved("binary", "auto", "no librelane configured (librelane.appimage/bin/home, env) and none found on PATH");
}
function hasFuseAccess() {
  try {
    accessSync2("/dev/fuse", constants2.R_OK | constants2.W_OK);
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function decideAppimageExtract(configured, hasFuse) {
  if (configured === true)
    return { extract: true, reason: "librelane.appimageExtract=true" };
  if (configured === false)
    return { extract: false, reason: "librelane.appimageExtract=false" };
  if (hasFuse)
    return { extract: false, reason: "auto: /dev/fuse is accessible, so mount the AppImage" };
  return { extract: true, reason: "auto: /dev/fuse is not accessible, so set APPIMAGE_EXTRACT_AND_RUN=1" };
}
function posixSingleQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
function commandPreview(command) {
  return command.map(posixSingleQuote).join(" ");
}
function buildLibreLaneCommand(target, args) {
  if (target.path === null) {
    throw new VerifError("VERIF_E_NO_BACKEND", "cannot build a librelane command without a resolved path", CONFIG_HINT);
  }
  if (target.mode === "devshell") {
    return [target.path, "librelane", ...args];
  }
  return [target.path, ...args];
}
function parseLibreLaneVersion(output) {
  const match = /LibreLane\s+v([^\s]+)/.exec(output);
  return match?.[1] ?? null;
}
function statusCommand(resolution) {
  if (resolution.path === null)
    return [];
  if (resolution.mode === "devshell")
    return [resolution.path, "librelane", "--version"];
  return [resolution.path, "--version"];
}
function binDirOf(value) {
  const raw = textOf(value);
  if (raw === null)
    return null;
  const path = resolve3(expandHome(raw));
  const info = describePath(path);
  if (info.kind === "directory")
    return path;
  if (info.kind === "file")
    return dirname5(path);
  return null;
}
function homeBinDirOf(value) {
  const raw = textOf(value);
  if (raw === null)
    return null;
  const path = join12(resolve3(expandHome(raw)), "bin");
  return describePath(path).kind === "directory" ? path : null;
}
function toolchainBinDirs(config) {
  const dirs = [];
  const suite = config?.ossCadSuite;
  const suiteBin = binDirOf(suite?.bin) ?? homeBinDirOf(suite?.home);
  if (suiteBin !== null)
    dirs.push(suiteBin);
  const verible = config?.verible;
  const veribleBin = binDirOf(verible?.bin) ?? homeBinDirOf(verible?.home);
  if (veribleBin !== null)
    dirs.push(veribleBin);
  return dirs;
}
function childEnvOverrides(config, mode, extract) {
  const dirs = toolchainBinDirs(config);
  const base = process.env.PATH ?? "";
  const path = dirs.length === 0 ? base : dirs.join(":") + (base.length > 0 ? ":" + base : "");
  const env = { PATH: path };
  if (extract && mode !== "binary")
    env.APPIMAGE_EXTRACT_AND_RUN = "1";
  return env;
}
function resolveCwd(raw, workspaceRoot) {
  const value = textOf(raw) ?? workspaceRoot;
  const resolved = isAbsolute3(value) ? resolve3(value) : resolve3(workspaceRoot, value);
  const rel = relative(workspaceRoot, resolved);
  if (rel.length > 0 && (rel === ".." || rel.startsWith(".." + sep) || isAbsolute3(rel))) {
    throw new VerifError("VERIF_E_CONFIG", "cwd '" + resolved + "' is outside the workspace '" + workspaceRoot + "'", "pass a cwd inside the workspace; relative paths resolve against the workspace root");
  }
  return resolved;
}
function timeoutValue(raw) {
  if (raw === undefined || raw === null)
    return DEFAULT_RUN_TIMEOUT_MS;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new VerifError("VERIF_E_CONFIG", "timeoutMs must be a positive number", "omit it for the " + DEFAULT_RUN_TIMEOUT_MS + " ms default");
  }
  return Math.floor(raw);
}
function tailLines(text) {
  if (text.length === 0)
    return [];
  const lines = text.split(`
`);
  return lines.slice(Math.max(0, lines.length - TAIL_LINES));
}
function logStamp(now = new Date) {
  return now.toISOString().replace(/[:.]/g, "-");
}
function logSlug(args) {
  const raw = args.join("-").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return raw.length > 0 ? raw : "run";
}
function buildLog(command, cwd, resolution, env, result, durationMs) {
  const envLines = Object.entries(env).map(([key, value]) => "  " + key + "=" + value);
  return [
    "# mpd_verif_librelane run",
    "timestamp: " + new Date().toISOString(),
    "mode: " + resolution.mode + " (" + resolution.reason + ")",
    "command: " + JSON.stringify(command),
    "cwd: " + cwd,
    "env overrides:",
    ...envLines,
    "exitCode: " + String(result.status),
    "signal: " + (result.signal ?? "none"),
    "timedOut: " + String(result.timedOut),
    "spawnError: " + (result.spawnError ?? "none"),
    "durationMs: " + String(durationMs),
    "--- stdout ---",
    result.stdout,
    "--- stderr ---",
    result.stderr,
    ""
  ].join(`
`);
}
function librelaneStatus(exec) {
  const loaded = loadSiliconConfig(exec);
  const resolution = resolveLibreLane(loaded.config);
  if (resolution.path === null) {
    throw new VerifError("VERIF_E_NO_BACKEND", "librelane was not found: " + resolution.reason, CONFIG_HINT);
  }
  const cfgAppimage = textOf(loaded.config.librelane?.appimage);
  const decided = resolution.mode === "binary" ? { extract: null, reason: "not applicable: binary mode" } : decideAppimageExtract(loaded.config.librelane?.appimageExtract, hasFuseAccess());
  const command = statusCommand(resolution);
  let version = null;
  if (resolution.exists && resolution.executable) {
    const env = childEnvOverrides(loaded.config, resolution.mode, decided.extract === true);
    const [binary, ...rest] = command;
    const probe = run(binary, rest, { cwd: resolve3(workspaceRootOf3(exec)), timeoutMs: STATUS_TIMEOUT_MS, env });
    version = parseLibreLaneVersion([probe.stdout, probe.stderr].filter((part) => part.length > 0).join(`
`));
  }
  const hints = [];
  if (resolution.mode === "devshell")
    hints.push("devshell mode selected; set librelane.mode to override");
  if (resolution.mode === "binary" && cfgAppimage === null)
    hints.push("no AppImage configured; using the librelane binary");
  if (!resolution.exists)
    hints.push("resolved " + resolution.mode + " path does not exist: " + resolution.path);
  else if (!resolution.executable)
    hints.push("resolved " + resolution.mode + " path is not executable: " + resolution.path);
  if (version === null && resolution.exists && resolution.executable)
    hints.push("could not parse 'LibreLane v<version>' from the --version output");
  return {
    ok: true,
    action: "status",
    mode: resolution.mode,
    configuredMode: resolution.configuredMode,
    path: resolution.path,
    source: resolution.source,
    reason: resolution.reason,
    exists: resolution.exists,
    executable: resolution.executable,
    appimageExtract: decided.extract,
    extractReason: decided.reason,
    command,
    commandPreview: commandPreview(command),
    version,
    hints
  };
}
function librelaneRun(raw, exec) {
  const rawArgs = raw.args;
  if (!Array.isArray(rawArgs) || rawArgs.length === 0) {
    throw new VerifError("VERIF_E_CONFIG", "action=run needs a non-empty args array", 'pass args like ["--smoke-test"] or ["config.yaml"]');
  }
  const args = [];
  for (const value of rawArgs) {
    if (typeof value !== "string") {
      throw new VerifError("VERIF_E_CONFIG", "every element of args must be a string", 'pass the LibreLane argv exactly as strings, e.g. ["--smoke-test"]');
    }
    args.push(value);
  }
  const timeoutMs = timeoutValue(raw.timeoutMs);
  const workspaceRoot = resolve3(workspaceRootOf3(exec));
  const cwd = resolveCwd(raw.cwd, workspaceRoot);
  const loaded = loadSiliconConfig(exec);
  const resolution = resolveLibreLane(loaded.config);
  if (resolution.path === null) {
    throw new VerifError("VERIF_E_NO_BACKEND", "librelane was not found: " + resolution.reason, CONFIG_HINT);
  }
  if (!resolution.exists || !resolution.executable) {
    throw new VerifError("VERIF_E_NO_BACKEND", "resolved " + resolution.mode + " path is not usable: " + resolution.path, "make the path exist and be executable (chmod +x), or fix librelane.bin/home/appimage via mpd_verif_toolchain action=set");
  }
  const command = buildLibreLaneCommand(resolution, args);
  const decided = resolution.mode === "binary" ? { extract: false } : decideAppimageExtract(loaded.config.librelane?.appimageExtract, hasFuseAccess());
  const env = childEnvOverrides(loaded.config, resolution.mode, decided.extract);
  const started = Date.now();
  const [binary, ...rest] = command;
  const result = run(binary, rest, { cwd, timeoutMs, env });
  const durationMs = Date.now() - started;
  const logPath = join12(workspaceRoot, ".mpd", "librelane", logStamp() + "-" + logSlug(args) + ".log");
  writeLog(logPath, buildLog(command, cwd, resolution, env, result, durationMs));
  return {
    ok: result.status === 0 && !result.timedOut && result.spawnError === null,
    action: "run",
    mode: resolution.mode,
    command,
    commandPreview: commandPreview(command),
    cwd,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    duration: durationMs,
    logPath,
    stdoutTail: tailLines(result.stdout),
    stderrTail: tailLines(result.stderr),
    spawnError: result.spawnError
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fieldString(value, key) {
  const field = value[key];
  return typeof field === "string" ? field : "";
}
function fieldStrings(value, key) {
  const field = value[key];
  return Array.isArray(field) ? field.filter((item) => typeof item === "string") : [];
}
function textBlock(text) {
  return [{ type: "text", text }];
}
function render2(value) {
  if (!isRecord(value))
    return textBlock("mpd_verif_librelane: " + JSON.stringify(value));
  const error = isRecord(value.error) ? value.error : null;
  if (error !== null)
    return textBlock("mpd_verif_librelane FAILED: " + fieldString(error, "message") + `
hint: ` + fieldString(error, "hint"));
  switch (value.action) {
    case "status": {
      const hints = fieldStrings(value, "hints");
      const extract = value.appimageExtract === null ? "n/a" : String(value.appimageExtract) + " (" + fieldString(value, "extractReason") + ")";
      const version = fieldString(value, "version");
      const lines = [
        "mpd_verif_librelane status — mode " + fieldString(value, "mode") + " [" + (fieldString(value, "source") || "unresolved") + "]",
        "path: " + (fieldString(value, "path") || "(none)") + " (" + (value.exists === true ? "exists" : "missing") + (value.executable === true ? ", executable" : "") + ")",
        "version: " + (version.length > 0 ? "LibreLane v" + version : "unknown"),
        "extract: " + extract,
        "command: " + fieldString(value, "commandPreview"),
        hints.length > 0 ? `hints:
  ` + hints.join(`
  `) : ""
      ];
      return textBlock(lines.filter((line) => line.length > 0).join(`
`));
    }
    case "run": {
      const stdoutTail = fieldStrings(value, "stdoutTail");
      const stderrTail = fieldStrings(value, "stderrTail");
      return textBlock([
        "mpd_verif_librelane run — " + fieldString(value, "mode") + (value.ok === true ? " ok" : " exit " + String(value.exitCode ?? "?")) + " (" + String(value.duration ?? "?") + " ms)",
        "cwd: " + fieldString(value, "cwd"),
        "command: " + fieldString(value, "commandPreview"),
        "log: " + fieldString(value, "logPath"),
        "stdout tail:",
        stdoutTail.length > 0 ? stdoutTail.join(`
`) : "  (empty)",
        "stderr tail:",
        stderrTail.length > 0 ? stderrTail.join(`
`) : "  (empty)"
      ].join(`
`));
    }
    default:
      return textBlock("mpd_verif_librelane: " + JSON.stringify(value));
  }
}
function librelaneToolDefinition() {
  return {
    name: "mpd_verif_librelane",
    description: "Resolve and run LibreLane (open-source RTL-to-GDS flow). Resolution: config librelane.mode (auto|binary|appimage|devshell), then librelane.bin/home or librelane.appimage, then env MPD_SILICON_LIBRELANE / MPD_SILICON_LIBRELANE_APPIMAGE, then PATH. action=status reports the resolved mode/path/source/reason, existence/executable bit, the AppImage extract setting (librelane.appimageExtract, auto = ON when /dev/fuse is not accessible) and the exact --version command preview plus hints; action=run executes args as argv (no shell for binary/AppImage) in a workspace-confined cwd, prepends the configured oss-cad-suite/verible bins to PATH, sets APPIMAGE_EXTRACT_AND_RUN=1 when extraction applies, enforces a timeout (default 3600000 ms) and always writes a log under <workspace>/.mpd/librelane/. Devshell mode prepends 'librelane' to the arguments and executes [appimage, librelane, ...args] directly: the image's devshell wrapper execs its command, so there is no shell and no --run.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "run"], description: "status (default) resolves and probes --version; run executes the LibreLane argv" },
        args: { type: "array", items: { type: "string" }, description: 'run: LibreLane argv (required, non-empty), e.g. ["--smoke-test"] or ["config.yaml"]' },
        cwd: { type: "string", description: "run: workspace-relative (or inside-workspace absolute) working directory; defaults to the workspace root. Outside the workspace is refused" },
        timeoutMs: { type: "number", description: "run: command timeout in ms (default 3600000)" }
      }
    },
    output: {
      schema: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
          action: { type: "string", enum: ["status", "run"], description: "absent on a structured refusal" },
          mode: { type: "string", enum: ["binary", "appimage", "devshell"] },
          configuredMode: { type: "string", enum: ["auto", "binary", "appimage", "devshell"] },
          path: { type: "string", description: "status: the resolved path; status refuses instead of returning a null path" },
          source: { oneOf: [{ type: "string", enum: ["config", "env", "path"] }, { type: "null" }], description: "resolution tier; null when nothing resolved" },
          reason: { type: "string" },
          exists: { type: "boolean" },
          executable: { type: "boolean" },
          appimageExtract: { oneOf: [{ type: "boolean" }, { type: "null" }], description: "AppImage extraction switch; null means NOT APPLICABLE (binary mode), never a fabricated false" },
          extractReason: { type: "string" },
          command: { type: "array", items: { type: "string" } },
          commandPreview: { type: "string" },
          version: { oneOf: [{ type: "string" }, { type: "null" }], description: "probed LibreLane version; null when the probe was skipped (missing/non-executable path) or its output had no 'LibreLane v<version>'" },
          hints: { type: "array", items: { type: "string" } },
          cwd: { type: "string", description: "run: absolute working directory (workspace-confined)" },
          exitCode: { oneOf: [{ type: "number" }, { type: "null" }], description: "run: exit code; null when a signal or the timeout ended the child" },
          signal: { oneOf: [{ type: "string" }, { type: "null" }], description: "run: terminating signal, when one ended the child" },
          timedOut: { type: "boolean", description: "run: the timeout killed the direct child" },
          duration: { type: "number", description: "command duration in milliseconds" },
          logPath: { type: "string" },
          stdoutTail: { type: "array", items: { type: "string" } },
          stderrTail: { type: "array", items: { type: "string" } },
          spawnError: { oneOf: [{ type: "string" }, { type: "null" }], description: "run: spawn-level failure code (e.g. ENOENT), null when the child spawned" },
          error: { type: "object", required: ["code", "message", "hint"], properties: { code: { type: "string" }, message: { type: "string" }, hint: { type: "string" } }, description: "structured refusal" }
        }
      },
      render: (_a, v) => render2(v)
    },
    execute: async (raw, exec) => {
      try {
        const args = raw ?? {};
        switch (args.action) {
          case "run":
            return librelaneRun(args, exec);
          case "status":
          default:
            return librelaneStatus(exec);
        }
      } catch (e) {
        return refusalOf(e);
      }
    }
  };
}

// src/index.ts
import { dshSeamInject, DSH_SEAM_TOOLS } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";
var name = "mpd-verif";
var inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"];
function textBlock2(text) {
  return [{ type: "text", text }];
}
var scalar = (desc) => ({ type: "string", description: desc });
function apply(ctx) {
  const dsh = ctx.mpdDsh;
  dsh.registerTool({
    name: "mpd_verif_venv",
    description: "Manage the project-local cocotb venv (iron rule: default <workspace>/.venv-rtl or MPD_DSH_VERIF_VENV). action=status reports {ok, verdict, cocotbVersion}; action=create bootstraps via 'python3 -m venv' and installs cocotb>=2.0 with the venv's own pip (system python/pip are NEVER used).",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["status", "create", "info"], description: "status (default) | create the venv + install cocotb | info about resolved paths/env" }, path: { type: "string", description: "optional venv path override" } }
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, verdict: { type: "string" }, venv: { type: "string" }, something: {} } },
      render: (_a, v) => textBlock2("mpd_verif_venv: " + v.message + (v.error ? `
ERROR(` + v.error.code + "): " + v.error.hint : ""))
    },
    execute: async (args, exec) => {
      try {
        const action = (args?.action ?? "status") === "create" ? "create" : (args?.action ?? "status") === "info" ? "info" : "status";
        if (action === "info") {
          const p = paths(args?.path ? String(args.path) : undefined, exec);
          const envKeys = Object.fromEntries(BACKEND_IDS.map((b) => ["MPD_DSH_VERIF_" + b.toUpperCase(), process.env["MPD_DSH_VERIF_" + b.toUpperCase()] ?? null]));
          return {
            ok: true,
            action: "info",
            workspace: p.workspace,
            venv: p.venv,
            work: p.work,
            message: `verif env: workspace ${p.workspace}; venv ${p.venv}; work ${p.work}`,
            env: { ...envKeys, MPD_DSH_VERIF_VENV: process.env.MPD_DSH_VERIF_VENV ?? null, MPD_DSH_VERIF_WORK: process.env.MPD_DSH_VERIF_WORK ?? null }
          };
        }
        if (action === "create") {
          const res = venvCreate(args?.path ? String(args.path) : undefined, undefined, exec);
          return { ...res, action: "create" };
        }
        const st = venvStatus(args?.path ? String(args.path) : undefined, exec);
        return { ...st, action: "status" };
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_backends",
    description: "Probe RTL backend availability: for iverilog|verilator|vcs (or all) resolves the effective binary via MPD_DSH_VERIF_* env, then the silicon toolchain config (ossCadSuite.bin / ossCadSuite.home/bin, iverilog+verilator only), then PATH; reports presence/version, the resolution source (env|config|path) and the exact binary path, plus (vcs) license env hints.",
    parameters: {
      type: "object",
      properties: { backend: { type: "string", enum: [...BACKEND_IDS, "all"], description: "backend id or 'all' (default)" } }
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backends: { type: "array" } } },
      render: (_a, v) => textBlock2("mpd_verif_backends: " + (v.backends ?? []).map((b) => `${b.backend}=${b.present ? "present(" + (b.version ?? "?") + ")" : "absent"} @${b.binary ?? "-"}`).join("; ") + (v.note ? `
` + v.note : ""))
    },
    execute: async (args, exec) => {
      try {
        const want = String(args?.backend ?? "all");
        const all = probeAll(loadSiliconConfig(exec).config);
        const list = want === "all" ? all : all.filter((p) => p.backend === want);
        const missing = list.filter((b) => !b.present).map((b) => b.backend);
        return {
          ok: list.some((b) => b.present),
          backends: list,
          note: missing.length > 0 ? `missing: ${missing.join(", ")} — install, pin MPD_DSH_VERIF_<BACKEND>, or set ossCadSuite.bin via mpd_verif_toolchain` : "all requested backends present"
        };
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_compile",
    description: "Compile RTL to a sim binary with one backend: iverilog (-g2012 -o simv_iverilog) | verilator (--binary) | vcs (-sverilog +v2k -f filelist -o simv). iverilog/verilator resolve via MPD_DSH_VERIF_* env, then the silicon toolchain config (ossCadSuite), then PATH. Returns structured diagnostics {file,line,severity,code,message} parsed from the log on failure (VERIF_E_COMPILE).",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "backend to use" },
        sources: { type: "array", items: { type: "string" }, description: "RTL source files" },
        top: scalar("top module (optional)"),
        includes: { type: "array", items: { type: "string" }, description: "include dirs" },
        defines: { description: "macro defines: object {MACRO: value} or array ['MACRO', 'MACRO=value']" },
        timeoutSec: { type: "number" }
      },
      required: ["backend", "sources"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, diagnostics: { type: "array" }, something: {} } },
      render: (_a, v) => textBlock2(v.ok ? `mpd_verif_compile OK — ${v.backend} → ${v.outBinary ?? "binary"}
log: ${v.logPath}` : `mpd_verif_compile FAILED (${v.backend}, exit ${v.exitCode}) — ${(v.diagnostics ?? []).length} diagnostics
log: ${v.logPath}
first errors:
` + (v.diagnostics ?? []).slice(0, 8).map((d) => `  ${d.file}:${d.line ?? "?"} [${d.severity}] ${d.message}`).join(`
`))
    },
    execute: async (args, exec) => {
      try {
        return verifCompile({
          backend: String(args?.backend),
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          top: args?.top ? String(args.top) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          target: "compile",
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined
        }, exec, loadSiliconConfig(exec).config);
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_lint",
    description: "Lint RTL with one backend (auto-resolved via env, the silicon toolchain config, then PATH): iverilog -g2012 -tnull -Wall | verilator --lint-only -Wall | vcs -lca -sverilog +lint=all -f <filelist>. Returns structured diagnostics {file,line,severity,code,message} parsed from the log (VERIF_E_COMPILE on failure).",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "backend to use" },
        sources: { type: "array", items: { type: "string" }, description: "RTL source files" },
        top: scalar("top module (optional)"),
        includes: { type: "array", items: { type: "string" }, description: "include dirs" },
        defines: { description: "macro defines: object {MACRO: value} or array ['MACRO', 'MACRO=value']" },
        timeoutSec: { type: "number" }
      },
      required: ["backend", "sources"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, diagnostics: { type: "array" }, something: {} } },
      render: (_a, v) => textBlock2(v.ok ? `mpd_verif_lint OK (${v.backend}) — log: ${v.logPath}` : `mpd_verif_lint FAILED (${v.backend}, exit ${v.exitCode}) — ${(v.diagnostics ?? []).length} diagnostics
log: ${v.logPath}
first errors:
` + (v.diagnostics ?? []).slice(0, 8).map((d) => `  ${d.file}:${d.line ?? "?"} [${d.severity}] ${d.message}`).join(`
`))
    },
    execute: async (args, exec) => {
      try {
        return verifCompile({
          backend: String(args?.backend),
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          top: args?.top ? String(args.top) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          target: "lint",
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined
        }, exec, loadSiliconConfig(exec).config);
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_coverage",
    description: "Merge/report code coverage across lanes (owner DP-4): verilator — merge Verilator coverage .dat files (verilator_coverage --write merged.dat) or annotate a report (--annotate-all <dir> <merged.dat>); vcs — urg merge+report over per-case -cm_dir payloads (urg -dir ... -report ...); iverilog regions refused (VERIF_E_UNSUPPORTED, no native coverage). Binaries resolve via MPD_DSH_VERIF_* / the silicon toolchain config (verilator_coverage via ossCadSuite) / VCS_HOME / VERDI_HOME / NOVAS_HOME / PATH.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "coverage lane" },
        action: { type: "string", enum: ["merge", "report"], description: "merge datasets into <reportDir>/merged.dat (default) or annotate a report (verilator)" },
        dir: scalar("scan root for coverage payloads (default <work>/.mpd/verif)"),
        reportDir: scalar("report directory (default <work>/.mpd/verif/cov_report)"),
        mergedDat: scalar("existing merged dataset path (action=report)"),
        timeoutSec: { type: "number" }
      },
      required: ["backend"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, reportDir: { type: "string" }, something: {} } },
      render: (_a, v) => textBlock2(v.error ? `mpd_verif_coverage FAILED: ${v.error.message}
hint: ${v.error.hint}` : `mpd_verif_coverage OK (${v.backend}) — ${(v.messages ?? []).join("; ") || "done"}
report: ${v.reportDir ?? "-"}`)
    },
    execute: async (args, exec) => {
      try {
        return verifCoverage({
          backend: String(args?.backend),
          action: String(args?.action ?? "merge"),
          dir: args?.dir ? String(args.dir) : undefined,
          reportDir: args?.reportDir ? String(args.reportDir) : undefined,
          mergedDat: args?.mergedDat ? String(args.mergedDat) : undefined,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined
        }, exec, loadSiliconConfig(exec).config);
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_sim",
    description: "Run a cocotb simulation on iverilog or verilator. IRON RULE: refuses (VERIF_E_NO_VENV) unless the project venv exists AND cocotb imports inside it — the refusal carries the exact setup command; every run uses <venv>/bin/python runner.py. Generates a cocotb.runner script, executes it, parses results.xml into per-case statuses, collects waves (.fst/.vcd), and optionally hands the waveform to the wired wave-mcp MCP tool.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["iverilog", "verilator", "vcs"], description: "backend (vcs refused: use mpd_verif_uvm)" },
        top: scalar("hdl_toplevel module"),
        tbModules: { type: "array", items: { type: "string" }, description: "python test modules (default: [top + '_tb'])" },
        sources: { type: "array", items: { type: "string" }, description: "RTL sources" },
        includes: { type: "array", items: { type: "string" } },
        defines: { description: "macro defines (object or array of MACRO[=value])" },
        testFilter: scalar("cocotb testcase filter (optional)"),
        seed: { description: "seed (number or string)" },
        waves: { type: "boolean", description: "dump waves (default true)" },
        traceFst: { type: "boolean", description: "verilator: use +--trace-fst for FST (owner DP-6 default; needs liblz4 headers; false → VCD)" },
        coverage: { type: "boolean", description: "verilator lane: compile with --coverage (payload for mpd_verif_coverage)" },
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean", description: "hand the wave to wave-mcp if wired (default true)" }
      },
      required: ["backend", "top", "sources"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, cases: { type: "array" } } },
      render: (_a, v) => {
        if (v.error)
          return textBlock2(`mpd_verif_sim FAILED: ${v.error.message}
hint: ${v.error.hint}`);
        const cases = v.cases ?? [];
        const body = cases.map((c) => `  ${c.status.toUpperCase()} ${c.name} (${Math.round(c.timeMs)}ms)${c.failureMsg ? " — " + c.failureMsg.slice(0, 200) : ""}`).join(`
`);
        const waves = (v.wavesfiles ?? []).map((w) => `  ${w.file} (${w.fmt})`).join(`
`);
        const hook = (v.waveHooks ?? []).map((h) => `  [${h.status}] ${h.server}: ${h.message.slice(0, 160)}`).join(`
`);
        return textBlock2(`mpd_verif_sim ${v.ok ? "PASS" : "FAIL"} (${v.backend}, ${v.top}, seed ${v.seed ?? "auto"}) — ${cases.length} case(s)
${body}${waves ? `
waves:
` + waves : ""}${hook ? `
wave hooks:
` + hook : ""}
log: ${v.simLog}`);
      }
    },
    execute: async (args, exec) => {
      try {
        return await verifSim({
          backend: String(args?.backend),
          top: String(args?.top ?? ""),
          tbModules: Array.isArray(args?.tbModules) ? args.tbModules.map(String) : undefined,
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          testFilter: args?.testFilter ? String(args.testFilter) : undefined,
          seed: args?.seed ?? undefined,
          waves: args?.waves ?? true,
          traceFst: args?.traceFst ?? true,
          coverage: args?.coverage ?? false,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
          waveHook: args?.waveHook ?? true
        }, { tools: dsh.toolRuntime() }, exec, loadSiliconConfig(exec).config);
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_uvm",
    description: "UVM methodology lane FOR VCS ONLY (owner decision; cocotb owns the open-source backends). Orchestrates a user-scaffolded UVM tree (<ip>/{rtl,script,tb,top,test,work}) — the plugin ships no template content, it validates the layout contract (tb_api_primitives.svh shared BFM, *_test.sv naming, mandatory sanity_test + reg_access_test) and drives the makefile-style contract: uvm-1.2, seed control, per-case work dirs, coverage -cm line+cond+tgl with urg merge, capped compile-fix attempts with unresolved.md. Methodology grounded in gen-tb-skill (structure) + raysalemi/uvmprimer (patterns) — no code reused from either.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["compile", "run", "regress", "wave", "merge-cov", "clean"], description: "lane action" },
        top: scalar("<ip> project root holding the UVM tree"),
        filelist: scalar("explicit filelist (default <ip>/script/filelist.f)"),
        includes: { type: "array", items: { type: "string" } },
        defines: { type: "array", items: { type: "string" } },
        test: scalar("test case name (default sanity_test)"),
        uvmVer: scalar("UVM version (default 1.2)"),
        seed: { description: "seed (default: date-derived)" },
        coverage: { type: "boolean", description: "enable -cm line+cond+tgl" },
        waveFmt: { type: "string", enum: ["fsdb", "vcd"] },
        verbosity: scalar("UVM verbosity (default UVM_MEDIUM)"),
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean", description: "hand logs/waves to TraceWeave if wired (default true)" }
      },
      required: ["action", "top"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, action: { type: "string" }, cases: { type: "array" }, something: {} } },
      render: (_a, v) => {
        if (v.error)
          return textBlock2(`mpd_verif_uvm ${v.action} FAILED: ${v.error.message}
hint: ${v.error.hint}`);
        const cases = (v.cases ?? []).map((c) => `  ${c.test}: ${c.status} (seed ${c.seed}, uvm_errors=${c.uvmErrors ?? "-"})`).join(`
`);
        const cov = v.covReport ? `
coverage report: ${v.covReport}` : "";
        const fsdb = (v.fsdbReports ?? []).map((h) => `  [${h.status}] fsdbreport: ${h.message.slice(0, 120)}`).join(`
`);
        const attempt = v.action === "compile" ? ` (attempt ${v.attempts}/${v.maxAttempts}${v.unresolved ? ", UNRESOLVED see work/unresolved.md" : ""})` : "";
        return textBlock2(`mpd_verif_uvm ${v.action} ${v.ok ? "OK" : "FAILED"}${attempt}
${cases}${fsdb ? `
fsdb reports:
` + fsdb : ""}${cov}${v.logPath ? `
log: ` + v.logPath : ""}`);
      }
    },
    execute: async (args, exec) => {
      try {
        return await verifUvm({
          action: String(args?.action ?? "compile"),
          top: String(args?.top ?? ""),
          filelist: args?.filelist ? String(args.filelist) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: Array.isArray(args?.defines) ? args.defines.map(String) : undefined,
          test: args?.test ? String(args.test) : undefined,
          uvmVer: args?.uvmVer ? String(args.uvmVer) : "1.2",
          seed: args?.seed ?? undefined,
          coverage: args?.coverage ?? false,
          waveFmt: args?.waveFmt === "vcd" ? "vcd" : "fsdb",
          verbosity: args?.verbosity ? String(args.verbosity) : undefined,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
          waveHook: args?.waveHook ?? true
        }, dsh.toolRuntime(), exec);
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_verif_regress",
    description: "Run a regression across cases on one backend: cocotb lane (iverilog|verilator, per-case seed = seedBase+idx, results aggregated from results.xml) or the UVM lane (vcs, per-case work dirs). Writes <work>/regress/<stamp>/results.json + results.md report; waves can be handed to wave-mcp/TraceWeave when wired.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "regression backend" },
        cases: { type: "array", items: { type: "string" }, description: "case names (cocotb testcase filters; default: ['all']); vcs lane discovers test/*_test.sv" },
        glob: scalar("tb-file glob alternative to cases[]"),
        seedBase: { type: "number", description: "seed base (default: date-based)" },
        maxFailures: { type: "number", description: "stop after N failures (0 = unlimited)" },
        stopOnError: { type: "boolean" },
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean" },
        sim: {
          type: "object",
          properties: {
            top: scalar("hdl_toplevel (cocotb lane) or <ip> root (vcs lane)"),
            sources: { type: "array", items: { type: "string" } },
            tbModules: { type: "array", items: { type: "string" } },
            includes: { type: "array", items: { type: "string" } },
            defines: { description: "macro defines" },
            waves: { type: "boolean", description: "dump waves per case (default true)" },
            traceFst: { type: "boolean", description: "verilator: +--trace-fst FST (default true; false → VCD)" },
            coverage: { type: "boolean", description: "verilator: compile with --coverage" }
          },
          description: "shared sim plan"
        }
      },
      required: ["backend"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, total: { type: "number" }, passed: { type: "number" }, failed: { type: "number" }, reportMarkdown: { type: "string" } } },
      render: (_a, v) => textBlock2(v.error ? `mpd_verif_regress FAILED: ${v.error.message}
hint: ${v.error.hint}` : `mpd_verif_regress (${v.backend}): ${v.passed}/${v.total} passed, ${v.failed} failed, ${v.skipped} skipped (seedBase ${v.seedBase})
report: ${v.reportPath}
` + (v.cases ?? []).map((c) => `  ${c.test} [${c.status}] seed ${c.seed}${c.wave ? " wave:" + c.wave.fmt : ""}`).join(`
`))
    },
    execute: async (args, exec) => {
      try {
        return await verifRegress({
          backend: String(args?.backend),
          cases: Array.isArray(args?.cases) ? args.cases.map(String) : undefined,
          glob: args?.glob ? String(args.glob) : undefined,
          seedBase: typeof args?.seedBase === "number" ? args.seedBase : undefined,
          maxFailures: typeof args?.maxFailures === "number" ? args.maxFailures : undefined,
          stopOnError: args?.stopOnError ?? false,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
          waveHook: args?.waveHook ?? true,
          sim: args?.sim && typeof args.sim === "object" ? {
            top: args.sim.top ? String(args.sim.top) : undefined,
            sources: Array.isArray(args.sim.sources) ? args.sim.sources.map(String) : undefined,
            tbModules: Array.isArray(args.sim.tbModules) ? args.sim.tbModules.map(String) : undefined,
            includes: Array.isArray(args.sim.includes) ? args.sim.includes.map(String) : undefined,
            defines: args.sim.defines ?? undefined,
            waves: args.sim.waves ?? true,
            traceFst: args.sim.traceFst ?? true,
            coverage: args.sim.coverage ?? false
          } : undefined
        }, dsh.toolRuntime(), exec, loadSiliconConfig(exec).config);
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  dsh.registerTool(toolchainToolDefinition());
  dsh.registerTool(librelaneToolDefinition());
  try {
    dsh.registerPromptSection({
      name: "silicon-toolchain",
      order: 30,
      text: "Silicon toolchain paths are configurable: user layer $DSH_HOME/silicon.jsonc, project layer <workspace>/.mpd/silicon.jsonc (project wins). When the user states where oss-cad-suite, verible or librelane live, call mpd_verif_toolchain (action=detect to probe, action=set to persist; show reports the effective config and resolved binaries). Run LibreLane with mpd_verif_librelane (action=status resolves binary/AppImage/devshell and previews the command; action=run executes inside the workspace and logs to .mpd/librelane/). MPD_DSH_VERIF_* env still wins at run time; PATH is the last tier."
    });
  } catch {}
}
export {
  apply,
  inject,
  name,
  probeAll,
  venvCreate,
  venvPath,
  venvStatus,
  verifCompile,
  verifCoverage,
  verifRegress,
  verifSim,
  verifUvm,
  workDir,
  workspaceRoot
};
