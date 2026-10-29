// Refuse-first, path-addressed JSONC span rewriter for the silicon toolchain config.
//
// PORTED from @mpd-dsh/mpd packages/mpd-config-plugin/src/jsonc-edit.ts (both
// repositories are ours; this port is MIT — upstream licensing is recorded in
// LICENSE-NOTICES.md). The port keeps the reference module behaviour — a proven-span
// splice, DELETE sentinel, duplicate-last-wins, refuse-first on every ambiguity — and
// changes only the module name, the sentinel key and the comment vocabulary (the design
// references are the source lane t34; the target here is <workspace>/.mpd/silicon.jsonc
// or $DSH_HOME/silicon.jsonc).
//
// WHY THIS EXISTS: the toolchain tool must persist a pointed edit into a human-authored
// JSONC file WITHOUT destroying it. It locates the EXACT character span of one value and
// splices only that span, so every other byte — comments, key order, whitespace, quotes,
// trailing commas, line endings — stays byte-identical BY CONSTRUCTION.
//
// THE SINGLE MOST IMPORTANT RULE: the editor returns a RESULT, never a best effort. If it
// cannot prove the span it returns { ok:false, reason } and the caller leaves the file
// BYTE-UNTOUCHED. A config file destroyed by a tool edit is the worst outcome this
// feature can produce, so every ambiguity resolves to "do not write".
//
// This module performs NO I/O. The atomic write (sibling temp + rename, 0644) lives in
// ./config.ts.

// The string-aware scanner is shared with the loader so there is ONE JSONC grammar here.
import { stripJsonc } from "./jsonc"

/**
 * Named reasons a rewrite can be refused (each is surfaced loudly by the caller).
 *
 * The vocabulary is the design's own enumeration (§B.2/E1-E11, §10.2, §10.3), so a lane and
 * a reviewer can assert on a NAME rather than on prose.
 */
export type JsoncEditFailure =
  /** The document is not parseable as JSONC: no edit is attempted at all (E9). */
  | "unparsable"
  /**
   * The requested path walks through two identically-keyed objects: the target cannot be
   * proven, refuse byte-untouched (§B.2/E5, §10.3 `ambiguous-intermediate`).
   */
  | "ambiguous-intermediate"
  /**
   * Two members share the requested key in one object. NOT a refusal any more: the design
   * (§B.2/E5, D-11, §10.3, U6) requires editing the LAST occurrence, because that is the
   * one `JSON.parse` reads — editing the first would look successful and change nothing
   * observable. Kept in the union so a caller can name a duplicated-LEAF situation that
   * some other rule (e.g. a deletion that cannot leave a valid member set) must refuse.
   */
  | "duplicate-key"
  /** A path segment addresses a member of a scalar/array where an object is required. */
  | "unsupported-shape"
  /** The exact value span for the path could not be proven (E5/E6/§10.3). */
  | "span-not-proven"

/** The design's own names for these two shapes (§10.2): one spelling per concept. */
export type EditRefusal = JsoncEditFailure
/** The design's name for the result union (§10.2); an alias of this module's `JsoncEditResult`. */
export type EditResult = JsoncEditResult

/**
 * The deletion sentinel (§10.2): `surgicalEdit(raw, path, DELETE)` removes the member,
 * which is the same operation `surgicalDelete` exposes directly.
 */
export const DELETE = Symbol.for("mpd.silicon.jsonc.delete")

/** The proven span of a member's VALUE, as the design specifies it (§10.2). */
export interface ValueSpan {
  /** Offset of the value's first character in the raw document. */
  readonly start: number
  /** Offset one past the value's last character; the span is half-open, so slice(start, end) is it. */
  readonly end: number
  /** Whether a comma follows the value, which a caller replacing the span must account for. */
  readonly hasTrailingComma: boolean
  /** The document's dominant line ending, so an emitted replacement matches the file. */
  readonly eol: "\n" | "\r\n"
}

/** The document's own formatting facts (E3/E7), detected from the raw text and reused by every emitter. */
export interface JsoncStyle {
  /** The document's dominant line ending, used only when a NEW line is emitted (E7). */
  readonly eol: "\n" | "\r\n"
  /** Whether the document uses a trailing comma before the closing brace/bracket (E3). */
  readonly trailingComma: boolean
  /** Indentation unit detected from the document (defaults to two spaces). */
  readonly indent: string
}

/**
 * A note attached to a PROVEN edit: the write succeeded, and the caller must still report this
 * loudly (captain ruling on duplicate keys: nothing silent).
 */
export interface JsoncEditNote {
  /** The one note kind this layer raises: a duplicated key was edited rather than refused. */
  readonly reason: "duplicate-key"
  /** Human-readable sentence naming the key, its occurrence count and the action taken. */
  readonly detail: string
  /** 1-based source line of every occurrence, so a caller can name them without re-scanning. */
  readonly lines: readonly number[]
}

/**
 * The editor's only return shape: a proven edit with its new text and style, or a named refusal
 * whose reason the caller must surface. `ok:false` always means the file stays byte-untouched.
 */
export type JsoncEditResult =
  | { readonly ok: true; readonly text: string; readonly style: JsoncStyle; readonly changed: boolean; readonly notes?: readonly JsoncEditNote[] }
  | { readonly ok: false; readonly reason: JsoncEditFailure; readonly detail?: string; readonly lines?: readonly number[] }

/** One parsed member (object) or element (array), reduced to the spans an edit needs. */
interface Entry {
  /** Raw key text including quotes, as it appears in the source (objects only). */
  readonly keyRaw?: string
  /** Decoded key (E1: matched against decoded text, never raw bytes). */
  readonly key?: string
  /** [keyStart, keyEnd) of the key token, objects only. */
  readonly keyStart?: number
  /** Offset one past the key token; absent on array elements, which have no key. */
  readonly keyEnd?: number
  /** [valueStart, valueEnd) of the member/element value. */
  readonly valueStart: number
  /** Offset one past the value, so slice(valueStart, valueEnd) is the exact raw value text. */
  readonly valueEnd: number
}

/** A parsed object or array: its delimiter spans plus its direct members in document order. */
interface Container {
  /** Which delimiter pair opened this container; also decides how a missing member is created. */
  readonly kind: "object" | "array"
  /** [open, close) of the delimiters. */
  readonly open: number
  /** Offset of the closing brace or bracket character. */
  readonly close: number
  /** Direct members/elements in document order, which is the order duplicates resolve in (last wins). */
  readonly entries: readonly Entry[]
}

/** Whether ch is one of the four JSONC whitespace characters the trivia scanner skips. */
function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
}

/** Skip whitespace and `//` / `/* *​/` comments starting at `pos` (design §4.1 step 1). */
function skipTrivia(src: string, pos: number): number {
  /** Cursor into src, advanced past whitespace and comments until a real token starts. */
  let i = pos
  for (;;) {
    while (i < src.length && isWs(src[i])) i++
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i = Math.min(src.length, i + 2)
      continue
    }
    return i
  }
}

/**
 * Offset just past the comments that trail the token ending at `from`, on that token's own line.
 * A comment on a following line is NOT consumed: it belongs to the next line, not to this member.
 * Returns `from` when the next thing on the line is neither a `//` nor a `/* *​/` comment.
 */
function trailingCommentEnd(src: string, from: number): number {
  /** Cursor into src, advanced over same-line spaces/tabs and comments. */
  let i = from
  /** Offset just past the last comment consumed; `from` means "no trailing comment". */
  let end = from
  for (;;) {
    /** Probe cursor for the next candidate comment, leaving `i` on the last consumed end. */
    let probe = i
    while (probe < src.length && (src[probe] === " " || src[probe] === "\t")) probe++
    if (src[probe] === "/" && src[probe + 1] === "/") {
      while (probe < src.length && src[probe] !== "\n" && src[probe] !== "\r") probe++
      return probe
    }
    if (src[probe] === "/" && src[probe + 1] === "*") {
      probe += 2
      while (probe < src.length && !(src[probe] === "*" && src[probe + 1] === "/")) probe++
      probe = Math.min(src.length, probe + 2)
      end = probe
      i = probe
      continue
    }
    return end
  }
}

/** Scan one string token starting at `pos` (which must be the opening quote). */
function scanString(src: string, pos: number): number {
  /** Cursor into src, starting just after the opening quote. */
  let i = pos + 1
  while (i < src.length) {
    /** Current character, tested for the backslash escape and the closing quote. */
    const ch = src[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "\"") return i + 1
    i++
  }
  return src.length
}

/** Scan one scalar token (string, number, true, false, null) starting at `pos`. */
function scanValue(src: string, pos: number): { start: number; end: number } {
  /** Offset of the scalar's first character, returned unchanged as the span start. */
  const start = pos
  /** First character of the token, selecting the string branch or the bare-literal scan. */
  const ch = src[pos]
  if (ch === "\"") {
    /** Offset one past the closing quote, as returned by the string scanner. */
    const end = scanString(src, pos)
    return { start, end }
  }
  // number / true / false / null
  let i = pos
  while (i < src.length && !/[\s,}\]]/.test(src[i])) i++
  return { start, end: i }
}

/** Parse one container beginning at `open` (already known to be `{` or `[`). */
function parseContainer(src: string, open: number): Container | undefined {
  /** Container kind, decided by the opening delimiter the caller already located. */
  const kind: Container["kind"] = src[open] === "{" ? "object" : "array"
  /** The delimiter that ends this container: a brace for objects, a bracket for arrays. */
  const closeCh = kind === "object" ? "}" : "]"
  /** Members/elements accumulated in document order, each carrying its own value span. */
  const entries: Entry[] = []
  /** Cursor into src, moved past each member and its separating trivia. */
  let i = skipTrivia(src, open + 1)
  /** Set when a comma is followed by this container's closing delimiter (E3). */
  let trailingComma = false
  for (;;) {
    if (i >= src.length) return undefined
    if (src[i] === closeCh) {
      void trailingComma
      return { kind, open, close: i, entries }
    }
    if (kind === "array") {
      /** Offset one past this element's value, from the nested container or the scalar scanner. */
      let end: number
      if (src[i] === "{" || src[i] === "[") {
        /** The element's own container, when the element is an object or array. */
        const nested = parseContainer(src, i)
        if (nested === undefined) return undefined
        end = nested.close + 1
      } else {
        end = scanValue(src, i).end
      }
      entries.push({ valueStart: i, valueEnd: end })
      i = skipTrivia(src, end)
      if (src[i] === ",") {
        i = skipTrivia(src, i + 1)
        trailingComma = src[i] === closeCh
        continue
      }
      if (src[i] === closeCh) continue
      return undefined
    }
    // object member: key then colon then value
    if (src[i] !== "\"") return undefined
    /** Offset of the key's opening quote. */
    const keyStart = i
    /** Offset one past the key's closing quote. */
    const keyEnd = scanString(src, i)
    /** The key token exactly as written, quotes included, kept for span arithmetic. */
    const keyRaw = src.slice(keyStart, keyEnd)
    /** The key decoded through JSON.parse, which is what a path segment matches (E1). */
    let key: string
    try {
      key = JSON.parse(keyRaw) as string
    } catch {
      return undefined
    }
    i = skipTrivia(src, keyEnd)
    if (src[i] !== ":") return undefined
    i = skipTrivia(src, i + 1)
    if (i >= src.length) return undefined
    /** Offset one past this member's value. */
    let end: number
    if (src[i] === "{" || src[i] === "[") {
      /** The member's own container, when its value is an object or array. */
      const nested = parseContainer(src, i)
      if (nested === undefined) return undefined
      end = nested.close + 1
    } else if (src[i] === "\"") {
      end = scanString(src, i)
    } else {
      end = scanValue(src, i).end
    }
    entries.push({ keyRaw, key, keyStart, keyEnd, valueStart: i, valueEnd: end })
    i = skipTrivia(src, end)
    if (src[i] === ",") {
      i = skipTrivia(src, i + 1)
      if (src[i] === closeCh) trailingComma = true
      continue
    }
    if (src[i] === closeCh) continue
    return undefined
  }
}

/** Detect the document style (E3, E7) from the raw text. */
export function detectStyle(raw: string): JsoncStyle {
  /** Count of CRLF line endings in the raw text. */
  const crlf = (raw.match(/\r\n/g) ?? []).length
  /** Count of bare LF line endings, excluding those that are the tail of a CRLF pair. */
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length
  /** The first indentation run that precedes a quoted key, or null when the file has none. */
  const indentMatch = raw.match(/\n([ \t]+)(?=")/)
  return {
    eol: crlf > lf ? "\r\n" : "\n",
    trailingComma: /,\s*[}\]]/.test(raw.replace(/"(?:[^"\\]|\\.)*"/g, '""')),
    indent: indentMatch === null ? "  " : indentMatch[1],
  }
}

/** Alias kept so the ported call sites read unchanged; the scanner lives in ./jsonc. */
export const stripJsoncText = stripJsonc

/** The depth-based indentation for a member inside a container opened at `open`. */
function indentFor(src: string, open: number, style: JsoncStyle): string {
  /** Nesting depth at the container's opening delimiter, counted over src before it. */
  let depth = 0
  /** Whether the pre-scan cursor sits inside a string, so braces there do not count. */
  let inString = false
  for (let i = 0; i < open; i++) {
    /** Current character of the pre-scan, inspected for strings, braces and brackets. */
    const ch = src[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") inString = true
    else if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") depth--
  }
  return style.indent.repeat(Math.max(depth, 0))
}

/** 1-based line number of a character offset (for the duplicate-key diagnostic). */
export function lineAt(src: string, offset: number): number {
  /** 1-based line counter; every LF strictly before offset increments it. */
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++
  return line
}

/** Locate the container that owns `path`, returning the parent container and the last matching entry. */
function locate(
  src: string,
  root: Container,
  path: readonly string[],
  allowMaterialise: boolean,
  parentOnly: boolean = false,
): { container: Container; entry?: Entry; missingFrom?: number; lines?: readonly number[]; ok: true } | { ok: false; reason: JsoncEditFailure; detail?: string; lines?: readonly number[] } {
  /** The container the walk has resolved so far, starting at the document root. */
  let container = root
  for (let index = 0; index < path.length; index++) {
    /** The path segment being resolved: a decoded key, or a decimal index for an array. */
    const segment = path[index]
    /** Whether this segment is the final one, i.e. addresses the value rather than a subtree. */
    const last = index === path.length - 1
    if (container.kind === "array") {
      /** The segment read as an array index, valid only when it is a non-negative integer in range. */
      const at = Number(segment)
      if (!Number.isInteger(at) || at < 0 || at >= container.entries.length) {
        if (last) return { container, ok: true }
        if (allowMaterialise) return { container, missingFrom: index, ok: true }
        return { ok: false, reason: "span-not-proven", detail: `array index ${segment} out of range` }
      }
      /** The element the final segment addresses, when the index was in range. */
      const entry = container.entries[at]
      if (last) return { container, ...(parentOnly ? {} : { entry }), ok: true }
      /** The intermediate element's own container, resolved before descending into it. */
      const nested = parseContainer(src, entry.valueStart)
      if (nested === undefined) return { ok: false, reason: "unsupported-shape", detail: "array element is not a container" }
      container = nested
      continue
    }
    /** Every member carrying this key, in document order; duplicates are resolved last-wins. */
    const matches = container.entries.filter((e) => e.key === segment)
    if (matches.length === 0) {
      if (last) return { container, ok: true }
      if (allowMaterialise) return { container, missingFrom: index, ok: true }
      return { ok: false, reason: "span-not-proven", detail: `missing intermediate "${segment}"` }
    }
    if (matches.length > 1) {
      /** 1-based line of every occurrence, so an ambiguous-intermediate refusal names them all. */
      const lines = matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)).join(", ")
      if (!last) {
        // A duplicated INTERMEDIATE is the one duplicate case that cannot be resolved
        // honestly: two objects with the same key on the path, and no way to know which
        // subtree the caller meant (§B.2/E5, §10.3). Byte-untouched refusal.
        return { ok: false, reason: "ambiguous-intermediate", detail: `key "${segment}" appears ${matches.length} times (lines ${lines})` }
      }
      // A duplicated LEAF is editable: `JSON.parse` is last-wins, so the LAST occurrence is
      // the member the runtime actually reads (E5/D-11/U6). `matches` is in document order. The
      // duplicate is REPORTED (captain ruling: nothing silent) with every occurrence's line.
      const chosen = matches[matches.length - 1]
      /** The duplicate report attached to a proven edit: every occurrence's line (captain ruling). */
      const duplicate = { lines: matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)) }
      return { container, entry: chosen, ok: true, ...duplicate }
    }
    /** The single member carrying this key, used as the resolved entry. */
    const entry = matches[0]
    if (last) return { container, ...(parentOnly ? {} : { entry }), ok: true }
    /** The intermediate member's own container, resolved before descending into it. */
    const nested = parseContainer(src, entry.valueStart)
    if (nested === undefined) {
      return { ok: false, reason: "unsupported-shape", detail: `"${segment}" is not an object` }
    }
    container = nested
  }
  return { container, ok: true }
}

/** Caller knobs for surgicalEdit; an absent `insert` keeps the design's refuse-first default. */
export interface JsoncEditOptions {
  /** Insert a missing path (E6) instead of refusing with `span-not-proven`. */
  readonly insert?: boolean
}

/**
 * Prove the exact span of one member's VALUE (design §10.2). Pure: no filesystem, no text
 * change. A caller that wants the design's explicit two-step shape can locate first and
 * only then edit; the editor itself uses the same scanner, so the two can never disagree.
 * @param raw - the document text.
 * @param path - the decoded key path (arrays address elements by index).
 * @returns the proven span, or the named refusal.
 */
export function locateValueSpan(raw: string, path: readonly string[]): ValueSpan | { reason: JsoncEditFailure; detail?: string } {
  /** Parse verdict for the raw text, checked before any span arithmetic so a broken file is never edited. */
  const parsed = readJsonc(raw)
  if (parsed.ok !== true) return { reason: "unparsable", detail: parsed.detail }
  /** The document's formatting facts, reused for the returned span's line ending and comma flag. */
  const style = detectStyle(raw)
  /** The document's top-level container, found by skipping leading trivia. */
  const root = parseContainer(raw, skipTrivia(raw, 0))
  if (root === undefined) return { reason: "unsupported-shape", detail: "the document root is not an object or array" }
  if (path.length === 0) return { start: root.open, end: root.close + 1, hasTrailingComma: style.trailingComma, eol: style.eol }
  /** The walk's verdict: the resolved container and entry, or the named refusal to propagate. */
  const found = locate(raw, root, path, false)
  if (found.ok !== true) return { reason: found.reason, detail: found.detail }
  if (found.entry === undefined) return { reason: "span-not-proven", detail: path.join(".") }
  /** The proven member, required here because an empty path returns before this point. */
  const entry = found.entry
  /** The character right after the value, tested for a comma that belongs to a FOLLOWING token. */
  const tail = raw.slice(entry.valueEnd, entry.valueEnd + 1)
  // A trailing comma is a FOLLOWING token, not part of the span: report it explicitly.
  const after = skipTrivia(raw, entry.valueEnd)
  return { start: entry.valueStart, end: entry.valueEnd, hasTrailingComma: raw.slice(after, after + 1) === "," || tail === ",", eol: style.eol }
}

/**
 * Replace (or insert) the value at `path`, splicing only its span.
 * @param raw - the file's exact bytes as a string.
 * @param path - decoded key path; numeric segments index arrays (E4).
 * @param value - the JSON-serialisable value to write.
 * @param options - `insert` allows creating a missing path (E6).
 * @returns a result; `ok:false` means the caller must leave the file untouched.
 */
export function surgicalEdit(raw: string, path: readonly string[], value: unknown, options: JsoncEditOptions = {}): JsoncEditResult {
  // The deletion sentinel is handled BEFORE any serialisation: a Symbol is not JSON, so the
  // value path would otherwise refuse `unsupported-shape` on a legitimate delete (§10.2).
  if (value === DELETE) return surgicalDelete(raw, path)
  /** The document's formatting facts, detected before serialisation so the result always carries them. */
  const style = detectStyle(raw)
  /** Parse probe: assigned to prove the document parses; never read afterwards (refuse-first, E9). */
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsoncText(raw))
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String((error as Error)?.message ?? error) }
  }
  /** The replacement text, serialised before any splice so an unserialisable value refuses first. */
  let serialised: string
  try {
    serialised = JSON.stringify(value, null, 2)
  } catch {
    return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" }
  }
  if (serialised === undefined) return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" }

  /** Offset of the document's first token, i.e. the root's opening delimiter. */
  const open = skipTrivia(raw, 0)
  /** The document's top-level container, or undefined when the scanner cannot tokenise it. */
  const root = parseContainer(raw, open)
  if (root === undefined) return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" }

  /** The walk's verdict; `options.insert` decides whether a missing path is created or refused. */
  const found = locate(raw, root, path, options.insert === true)
  if (found.ok !== true) return found
  if (found.entry !== undefined) {
    /** The member's current raw value text, compared with the serialised value for idempotence (U11). */
    const existing = raw.slice(found.entry.valueStart, found.entry.valueEnd)
    // Idempotence: an identical edit is a byte-level no-op (§9.1 U11).
    if (existing === serialised) return { ok: true, text: raw, style, changed: false }
    /** The loud duplicate-key note for an updated path, undefined when the key is unique. */
    const note = duplicateNote(found.lines, path, "updated")
    return {
      ok: true,
      text: raw.slice(0, found.entry.valueStart) + serialised + raw.slice(found.entry.valueEnd),
      style,
      changed: true,
      ...(note === undefined ? {} : { notes: [note] }),
    }
  }

  if (options.insert !== true) return { ok: false, reason: "span-not-proven", detail: path.join(".") }
  /** The line ending every emitted line uses, taken from the document's dominant style. */
  const eol = style.eol
  /** Index of the deepest path segment to create, defaulting to the leaf itself. */
  const missingFrom = found.missingFrom ?? path.length - 1
  /** The key of the member being created, spliced into the receiving container. */
  const leafKey = path[missingFrom]
  /** Segments BELOW the leaf key, wrapped outermost-first into the new subtree (empty for a leaf insert). */
  const rest = path.slice(missingFrom + 1)
  // Build the subtree for a missing intermediate chain; a leaf insert has rest === [].
  let subtree: unknown = value
  for (let i = rest.length - 1; i >= 0; i--) {
    /** The segment being wrapped, one nesting level per iteration. */
    const segment = rest[i]
    subtree = /^\d+$/.test(segment) ? [subtree] : { [segment]: subtree }
  }
  /** The value plus any materialised intermediate objects, as pretty-printed JSON text. */
  const serialisedSubtree = JSON.stringify(subtree, null, 2)
  /** The container that receives the new member. */
  const container = found.container

  if (container.kind === "object") {
    /** Indentation of the receiving container's own line. */
    const indent = indentFor(raw, container.open, style)
    /** Indentation of a member inside the container: one unit deeper than indent. */
    const inner = indent + style.indent
    /** The new member rendered as `"key": value`, its inner lines re-indented to the document's EOL. */
    const memberText = `${JSON.stringify(leafKey)}: ${serialisedSubtree.split("\n").join(eol + inner)}`
    /** The container's existing members, still needed to find where the new one is spliced. */
    const entries = container.entries
    if (entries.length === 0) {
      /** The container interior as written; a comment left inside it must survive (PORT DELTA). */
      const interior = raw.slice(container.open + 1, container.close)
      if (interior.trim().length > 0) {
        // PORT DELTA vs the reference: its empty-container branch re-emits the interior
        // and therefore drops a comment inside an otherwise-empty container. Splicing the
        // member in BEFORE the interior keeps every existing byte (comment preservation).
        return { ok: true, text: raw.slice(0, container.open + 1) + eol + inner + memberText + raw.slice(container.open + 1), style, changed: true }
      }
      /** The new document for the empty-object case: the member inserted between the braces. */
      const text = raw.slice(0, container.open + 1) + eol + inner + memberText + eol + indent + raw.slice(container.close)
      return { ok: true, text, style, changed: true }
    }
    /** The container's final member, whose value end is the splice anchor. */
    const lastEntry = entries[entries.length - 1]
    /** Offset of the first token after the last member, tested for a separating comma. */
    const afterLast = skipTrivia(raw, lastEntry.valueEnd)
    /** Whether the file already separates the last member with a comma. */
    const hasComma = raw[afterLast] === ","
    // A comment on the last member's own line BELONGS to that member: splice the new member in
    // after it, so the comma (existing or inserted) stays before the comment and the comment
    // never migrates onto the new sibling.
    /** Offset just past the separating comma, or the last value's end when there is no comma. */
    const anchor = hasComma ? afterLast + 1 : lastEntry.valueEnd
    /** Offset just past a same-line trailing comment, or `anchor` when the member has none. */
    const commentEnd = trailingCommentEnd(raw, anchor)
    /** Where the new member is spliced: after the trailing comment when there is one. */
    const insertAt = commentEnd > anchor ? commentEnd : anchor
    /** The comma to prepend when the file does not already separate the last member. */
    const comma = hasComma ? "" : ","
    /** A trailing comma to carry, matching the document's style, or the empty string. */
    const tail = hasComma && style.trailingComma ? "," : ""
    return {
      ok: true,
      text: raw.slice(0, anchor) + comma + raw.slice(anchor, insertAt) + eol + inner + memberText + tail + raw.slice(insertAt),
      style,
      changed: true,
    }
  }

  // array insert: append before the closing bracket, matching the comma style
  const indent = indentFor(raw, container.open, style)
  /** Indentation of an element inside the array: one unit deeper than the bracket's own line. */
  const inner = indent + style.indent
  /** The array's existing elements, still needed to find where the new one is spliced. */
  const entries = container.entries
  /** The new element's text, its inner lines re-indented to the document's EOL. */
  const item = serialisedSubtree.split("\n").join(eol + inner)
  if (entries.length === 0) {
    /** The array interior as written; a comment left inside it must survive (PORT DELTA). */
    const interior = raw.slice(container.open + 1, container.close)
    if (interior.trim().length > 0) {
      // PORT DELTA vs the reference: splice BEFORE the interior so its comment survives.
      return { ok: true, text: raw.slice(0, container.open + 1) + eol + inner + item + raw.slice(container.open + 1), style, changed: true }
    }
    /** The new document for the empty-array case: the element inserted between the brackets. */
    const text = raw.slice(0, container.open + 1) + eol + inner + item + eol + indent + raw.slice(container.close)
    return { ok: true, text, style, changed: true }
  }
  /** The array's final element, whose value end is the splice anchor. */
  const lastEntry = entries[entries.length - 1]
  /** Offset of the first token after the last element, tested for a separating comma. */
  const afterLast = skipTrivia(raw, lastEntry.valueEnd)
  if (raw[afterLast] === ",") {
    /** Offset just past the separating comma, i.e. where the new element is spliced in. */
    const insertAt = afterLast + 1
    /** A trailing comma to carry, matching the document's style, or the empty string. */
    const tail = style.trailingComma ? "," : ""
    return { ok: true, text: raw.slice(0, insertAt) + eol + inner + item + tail + raw.slice(insertAt), style, changed: true }
  }
  return { ok: true, text: raw.slice(0, lastEntry.valueEnd) + "," + eol + inner + item + raw.slice(lastEntry.valueEnd), style, changed: true }
}

/**
 * Delete the value at `path` (E3/E4 span arithmetic): the member's key, its value
 * and exactly one adjacent comma, leaving valid JSONC.
 * @param raw - the file's exact bytes as a string.
 * @param path - decoded key path.
 * @returns a result; `ok:false` means the caller must leave the file untouched.
 */
export function surgicalDelete(raw: string, path: readonly string[]): JsoncEditResult {
  /** The document's formatting facts, carried on the successful result. */
  const style = detectStyle(raw)
  try {
    JSON.parse(stripJsoncText(raw))
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String((error as Error)?.message ?? error) }
  }
  /** Offset of the document's first token, i.e. the root's opening delimiter. */
  const open = skipTrivia(raw, 0)
  /** The document's top-level container, or undefined when the scanner cannot tokenise it. */
  const root = parseContainer(raw, open)
  if (root === undefined) return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" }
  // CAPTAIN'S DELTA vs the design: an UNSET removes EVERY occurrence of that exact path. Removing
  // only the last one would leave an earlier occurrence effective — the key would read as unset in
  // the UI while still being set at runtime (a silent lie). If ANY occurrence's span cannot be
  // proven, the whole edit is refused and the file stays byte-untouched.
  const all = locateAllLeaves(raw, root, path)
  if (all.ok !== true) return all
  /** One from/to removal span per matched entry, sorted descending so splicing cannot shift a pending span. */
  const spans = all.entries
    .map((entry) => {
      /** Offset where the member begins: its key when it has one, else its value. */
      const start = entry.keyStart ?? entry.valueStart
      /** Offset one past the member's value, i.e. the span end before comma removal. */
      const end = entry.valueEnd
      // Remove one adjacent comma: the one AFTER the member when another member follows,
      // otherwise the one BEFORE it.
      let from = start
      /** Span end, widened past a following comma when that comma is removed with the member. */
      let to = end
      /** The raw text from the member's value end onwards, searched for that comma. */
      const tail = raw.slice(end)
      /** The following comma and any leading trivia, when the member is not the last one. */
      const commaAfter = /^\s*,/.exec(tail)
      if (commaAfter !== null) {
        to = end + commaAfter[0].length
      } else {
        /** The raw text before the member, searched for the comma separating it from its predecessor. */
        const head = raw.slice(0, start)
        /** The preceding comma and its trailing trivia, used when no comma follows the member. */
        const commaBefore = /,\s*$/.exec(head)
        if (commaBefore !== null) from = start - commaBefore[0].length
      }
      return { from, to }
    })
    .sort((a, b) => b.from - a.from)
  /** The document being rewritten, one removal span at a time (descending, so offsets stay valid). */
  let text = raw
  for (const span of spans) text = text.slice(0, span.from) + text.slice(span.to)
  /** The loud duplicate-key note for a removed path, undefined when the key was unique. */
  const note = duplicateNote(all.lines, path, "removed")
  /** Re-parse probe: a deletion that would leave invalid JSONC is refused before it is returned. */
  let reparsed: unknown
  try {
    reparsed = JSON.parse(stripJsoncText(text))
  } catch (error) {
    // A deletion that would leave invalid JSONC is refused (refuse-first).
    return { ok: false, reason: "unsupported-shape", detail: `deletion would leave invalid JSONC: ${String((error as Error)?.message ?? error)}` }
  }
  void reparsed
  return { ok: true, text, style, changed: true, ...(note === undefined ? {} : { notes: [note] }) }
}

/** The loud note a PROVEN duplicate-key edit must carry (captain ruling: nothing silent). */
function duplicateNote(lines: readonly number[] | undefined, path: readonly string[], action: "updated" | "removed"): JsoncEditNote | undefined {
  if (lines === undefined || lines.length < 2) return undefined
  return {
    reason: "duplicate-key",
    lines: [...lines],
    detail: `key "${path.join(".")}" appears ${lines.length} times at lines ${lines.join(", ")}; ${action === "updated" ? "the last occurrence is the effective value and was updated" : "every occurrence was removed, so the key is unset at runtime too"}`,
  }
}

/**
 * EVERY entry for a leaf path inside the object its parent resolves to (document order). Used by
 * the delete path, where removing just the last occurrence would leave an earlier one effective —
 * the key would read as unset in the UI while still being set at runtime (captain's ruling).
 */
function locateAllLeaves(
  src: string,
  root: Container,
  path: readonly string[],
): { entries: readonly Entry[]; lines: readonly number[]; ok: true } | { ok: false; reason: JsoncEditFailure; detail?: string } {
  if (path.length === 0) return { ok: false, reason: "span-not-proven", detail: "the document root has no leaf span" }
  /** The parent container resolved without its entry; the cast is needed because the walk's union cannot prove entry absent. */
  const parent = locate(src, root, path, false, true) as unknown as { container: Container; ok: true } | { ok: false; reason: JsoncEditFailure; detail?: string }
  if (parent.ok !== true) return parent
  /** The final path segment, matched against keys or stringified array indices. */
  const last = path[path.length - 1]
  /** EVERY entry carrying the leaf key, in document order (the delete path removes them all). */
  const entries = parent.container.kind === "array"
    ? parent.container.entries.filter((_entry, index) => String(index) === last)
    : parent.container.entries.filter((entry) => entry.key === last)
  if (entries.length === 0) return { ok: false, reason: "span-not-proven", detail: path.join(".") }
  /** Whether every matched entry carries an ordered span; an unprovable one refuses the whole delete. */
  const allProven = entries.every((entry) => entry.valueStart <= entry.valueEnd)
  if (!allProven) return { ok: false, reason: "span-not-proven", detail: path.join(".") }
  return { ok: true, entries, lines: entries.map((entry) => lineAt(src, entry.keyStart ?? entry.valueStart)) }
}

/** Read a value out of a JSONC document (used for the file-derived base and diffs). */
export function readJsonc(raw: string): { ok: true; value: unknown } | { ok: false; reason: "unparsable"; detail?: string } {
  try {
    return { ok: true, value: JSON.parse(stripJsoncText(raw)) }
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String((error as Error)?.message ?? error) }
  }
}
