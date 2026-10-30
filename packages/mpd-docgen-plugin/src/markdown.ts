// Markdown → Manual: the input contract of plan §2.
//
// Two jobs live here:
//   1. the block tokenizer that feeds the docx body (heading/paragraph/list/fence/table);
//   2. the register-chapter extractor, which accepts BOTH heading forms the plan binds —
//      the canonical `### <标题>(<REG_NAME>)` and eCap's legacy
//      `### 寄存器N（NAME）——描述` — plus the offset/reset lines and the 4-column field
//      table in either language.
//
// `Manual.blocks` deliberately excludes the H1 (carried by `Manual.title`) and the whole
// register chapter (carried by `Manual.registers`): the docx lane renders those two from
// the model, not from re-parsed markdown.
//
// The `### 寄存器总览` table is a CROSS-CHECK only, never the source of truth (plan §2): a
// disagreement is recorded in `Manual.warnings` and the parse still succeeds. That is a
// hard requirement, not leniency — the shipped template's own example row is
// `|  000h| IP_REG0|...` while its per-register section says `偏移地址：0x00`, so a fatal
// comparison would reject the template the skill ships.
import { canonicaliseRegisters, isReservedName, normaliseOffset, offsetNumber } from "./registers.js"
import { DocgenError, type Block, type Field, type Lang, type Manual, type Register } from "./types.js"

/** H2 titles that open the register chapter, per language. */
const REGISTER_CHAPTER_TITLES: Readonly<Record<Lang, string>> = { "zh-CN": "寄存器", en: "Registers" }
/** H3 titles of the optional overview table; a cross-check only (plan §2). */
const OVERVIEW_TITLES: readonly string[] = ["寄存器总览", "Registers overview"]
/** Canonical register heading: `### 时间戳计数器(TSCTR)` (ASCII parentheses). */
const CANONICAL_HEADING = /^###\s+(.+?)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/
/** Legacy eCap register heading: `### 寄存器1（TSCTR）——时间戳计数器` (full-width parens, em dash). */
const LEGACY_HEADING = /^###\s+寄存器\d+\s*（([^）]+)）\s*——\s*(.+?)\s*$/
/** Offset line, either language: `偏移地址：0x00` / `Offset: 0x00`. */
const OFFSET_LINE = /^\s*(?:偏移地址：|Offset:)\s*(0x[0-9A-Fa-f]+)/
/** Reset line, either language; hex digits may be space-grouped. */
const RESET_LINE = /^\s*(?:复位值：|Reset value:)\s*(0x[0-9A-Fa-f\s]+)/
/** Field-table header, either language: `| 位域 | ... |` / `| Bits | ... |`. */
const FIELD_TABLE_HEADER = /^\s*\|\s*(?:位域|Bits?)\s*\|/i
/** Any H2, used to bound the register chapter. */
const H2 = /^##\s+(.+?)\s*$/

/** Split one markdown table row into trimmed cells, tolerating the outer pipes. */
function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith("|")) text = text.slice(1)
  if (text.endsWith("|")) text = text.slice(0, -1)
  return text.split("|").map((cell) => cell.trim())
}

/** True when a line is a markdown table separator row (`|---|:--:|`). */
function isTableSeparator(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

/** Parse a bit-range cell (`20`, `31:16`, also `[31:16]`) into numeric bounds. */
function parseBitRange(raw: string, context: string): { hi: number; lo: number } {
  const match = /^\[?(\d{1,2})(?::(\d{1,2}))?\]?$/.exec(raw.trim())
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", context + ": cannot parse bit range " + JSON.stringify(raw), "write the bit field as N or N:M")
  }
  const hi = parseInt(match[1], 10)
  const lo = match[2] === undefined ? hi : parseInt(match[2], 10)
  return { hi, lo }
}

/** Locate the register chapter: its H2 line index and the index of the next H2 (or EOF). */
function findRegisterChapter(lines: readonly string[]): { start: number; end: number } | null {
  const wanted = new Set([REGISTER_CHAPTER_TITLES["zh-CN"].toLowerCase(), REGISTER_CHAPTER_TITLES.en.toLowerCase()])
  for (let i = 0; i < lines.length; i++) {
    const match = H2.exec(lines[i])
    if (!match || !wanted.has(match[1].toLowerCase())) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (H2.exec(lines[j])) {
        end = j
        break
      }
    }
    return { start: i, end }
  }
  return null
}

/**
 * Numeric value of an overview offset cell.
 *
 * The shipped template writes its example offsets as `000h` while each register section
 * writes `0x00`; both spellings are normalised to a number (`0NNNh` -> `0xNN`), so equal
 * offsets compare equal whatever the form.
 */
function overviewOffsetValue(raw: string): number {
  const text = raw.trim()
  const templateForm = /^0*([0-9A-Fa-f]+)h$/.exec(text)
  return offsetNumber(templateForm === null ? text : "0x" + templateForm[1])
}

/**
 * Render an offset for a warning message: `0x` + uppercase hex, at least two digits, so
 * `0x08` reads the same as the manual's own spelling.
 */
function offsetText(value: number): string {
  return "0x" + value.toString(16).toUpperCase().padStart(2, "0")
}

/**
 * True when an overview row is the shipped template's PLACEHOLDER rather than a register.
 *
 * Three forms count: an empty name cell (the `| |Reset Value|…` row), the template's
 * example name `IP_REG0`, and an all-zero offset with no per-register counterpart (the
 * template's `000h` example slot). Skipped rows produce no warning — a placeholder is not
 * a disagreement.
 */
function isOverviewPlaceholder(name: string, offset: number, parsed: ReadonlyMap<string, Register>): boolean {
  if (name.trim() === "") return true
  if (/^IP_REG\d+$/i.test(name)) return true
  return offset === 0 && !parsed.has(name)
}

/** Parse the optional overview table into name → numeric offset (cross-check only). */
function parseOverview(lines: readonly string[]): Map<string, number> | null {
  const headingIndex = lines.findIndex((line) => {
    const match = /^###\s+(.+?)\s*$/.exec(line)
    return match !== null && OVERVIEW_TITLES.some((title) => title.toLowerCase() === match[1].toLowerCase())
  })
  if (headingIndex < 0) return null
  const tableStart = lines.findIndex((line, index) => index > headingIndex && line.trimStart().startsWith("|"))
  if (tableStart < 0) return null

  const overview = new Map<string, number>()
  for (let i = tableStart; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trimStart().startsWith("|")) break
    const cells = splitRow(line)
    if (cells.length < 2) continue
    const offset = cells[0]
    const name = cells[1]
    // Skip the header row, the separator row and the per-register `Reset Value` row.
    if (offset === "" || name === "" || /^reset value$/i.test(name)) continue
    if (!/^(?:0x)?[0-9A-Fa-f]+h?$/.test(offset)) continue
    overview.set(name, overviewOffsetValue(offset))
  }
  return overview
}

/** Parse the field table of one register body (first table whose header is 位域/Bits). */
function parseFieldTable(body: readonly string[], context: string): Field[] {
  const headerIndex = body.findIndex((line) => FIELD_TABLE_HEADER.test(line))
  if (headerIndex < 0) {
    throw new DocgenError("DOCGEN_E_PARSE", context + ": field table not found", "add a table whose header is | 位域 | 名称 | 读写属性 | 描述 | (en: | Bits | Name | Access | Description |)")
  }
  const fields: Field[] = []
  for (let i = headerIndex + 1; i < body.length; i++) {
    const line = body[i]
    if (/^###\s/.test(line)) break
    const trimmed = line.trim()
    if (trimmed === "") {
      // A blank line after the table ends it; before the first row it is tolerated.
      if (fields.length > 0) break
      continue
    }
    if (!trimmed.startsWith("|")) break
    if (isTableSeparator(line)) continue
    const cells = splitRow(line)
    if (cells.length < 4) {
      throw new DocgenError("DOCGEN_E_PARSE", context + ": field row needs 4 columns, got " + cells.length + ": " + JSON.stringify(line), "write | bits | name | access | description |")
    }
    const { hi, lo } = parseBitRange(cells[0], context)
    const name = cells[1].trim()
    const access = cells[2].trim()
    // A description may legitimately contain a pipe; rejoin everything past the access.
    const desc = cells.slice(3).join("|").replace(/<br\s*\/?>/gi, "\n").trim()
    fields.push({ hi, lo, name, access, desc, reserved: isReservedName(name) })
  }
  return fields
}

/**
 * Parse one register chapter into canonical registers plus cross-check warnings.
 *
 * Field/offset/reset defects stay FATAL (DOCGEN_E_PARSE / DOCGEN_E_FIELDS /
 * DOCGEN_E_ACCESS); only overview disagreements are demoted to warnings.
 */
function parseRegisterChapter(lines: readonly string[], start: number, end: number, lang: Lang): { registers: Register[]; warnings: string[] } {
  const overview = parseOverview(lines.slice(start, end))
  const chapter = lines.slice(start + 1, end)

  const headings: { index: number; name: string; title: string }[] = []
  for (let i = 0; i < chapter.length; i++) {
    const line = chapter[i]
    const legacy = LEGACY_HEADING.exec(line)
    if (legacy) {
      headings.push({ index: i, name: legacy[1].trim(), title: legacy[2].trim() })
      continue
    }
    const canonical = CANONICAL_HEADING.exec(line)
    if (canonical) headings.push({ index: i, name: canonical[2].trim(), title: canonical[1].trim() })
  }

  const registers: Register[] = headings.map((heading, position) => {
    const bodyEnd = position + 1 < headings.length ? headings[position + 1].index : chapter.length
    const body = chapter.slice(heading.index + 1, bodyEnd)
    const context = "register " + heading.name

    let offset = ""
    let reset = ""
    for (const line of body) {
      if (offset === "") {
        const match = OFFSET_LINE.exec(line)
        if (match) offset = normaliseOffset(match[1])
      }
      if (reset === "") {
        const match = RESET_LINE.exec(line)
        if (match) reset = match[1]
      }
    }
    if (offset === "") {
      throw new DocgenError("DOCGEN_E_PARSE", context + ": missing offset line", "add 偏移地址：0x.. (en: Offset: 0x..) under the register heading")
    }
    if (reset === "") {
      throw new DocgenError("DOCGEN_E_PARSE", context + ": missing reset value line", "add 复位值：0x.. (en: Reset value: 0x..) under the register heading")
    }

    return { name: heading.name, title: heading.title, offset, reset, width: 16, fields: parseFieldTable(body, context) }
  })

  // The overview is a cross-check; a disagreement is reported and never rejects the parse.
  const warnings: string[] = []
  const parsed = new Map(registers.map((register) => [register.name, register]))
  if (overview !== null) {
    for (const register of registers) {
      const expected = overview.get(register.name)
      if (expected === undefined) {
        warnings.push("register " + register.name + " is missing from the overview table (chapter offset " + register.offset + ")")
        continue
      }
      const actual = offsetNumber(register.offset)
      if (expected !== actual) {
        warnings.push("register " + register.name + ": overview offset " + offsetText(expected) + " disagrees with chapter offset " + register.offset)
      }
    }
    for (const [name, offset] of overview) {
      if (parsed.has(name) || isOverviewPlaceholder(name, offset, parsed)) continue
      warnings.push("overview register " + name + " has no register chapter (overview offset " + offsetText(offset) + ")")
    }
  }

  return { registers: canonicaliseRegisters(registers, lang), warnings }
}

/** Tokenize the non-register body into docx blocks (headings, paragraphs, lists, fences, tables). */
function tokenizeBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === "") {
      i++
      continue
    }

    const fence = /^\s*(```|~~~)\s*([^\s`]*)\s*$/.exec(line)
    if (fence) {
      const marker = fence[1]
      const closing = new RegExp("^\\s*" + marker + "\\s*$")
      const body: string[] = []
      i++
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      blocks.push({ kind: "fence", lang: fence[2] ?? "", text: body.join("\n") })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ kind: "heading", level, text: heading[2].trim() })
      i++
      continue
    }

    if (line.trimStart().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ kind: "table", header, rows })
      continue
    }

    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (listItem) {
      const ordered = /^\d/.test(listItem[1])
      const items: string[] = []
      while (i < lines.length) {
        const match = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!match || /^\d/.test(match[1]) !== ordered) break
        items.push(match[2].trim())
        i++
      }
      blocks.push({ kind: "list", ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length) {
      const current = lines[i]
      if (current.trim() === "") break
      if (/^(#{1,6})\s+/.test(current)) break
      if (/^\s*(```|~~~)/.test(current)) break
      if (current.trimStart().startsWith("|")) break
      if (/^\s*([-*+]|\d+[.)])\s+/.test(current)) break
      paragraph.push(current.trim())
      i++
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") })
  }
  return blocks
}

/**
 * Parse a user manual into the canonical model.
 *
 * @param text - markdown source (zh-CN or en).
 * @param lang - the manual's language; selects the canonical RESERVED description.
 * @returns the H1 title, the generic body blocks, the canonical registers and the
 *   non-fatal overview warnings (empty when the manual is clean or has no overview).
 */
export function parseManual(text: string, lang: Lang): Manual {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")

  let title = ""
  let titleIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const match = /^#\s+(.+?)\s*$/.exec(lines[i])
    if (match) {
      title = match[1]
      titleIndex = i
      break
    }
  }

  const chapter = findRegisterChapter(lines)
  const chapterResult = chapter === null ? { registers: [], warnings: [] } : parseRegisterChapter(lines, chapter.start, chapter.end, lang)

  const excluded = new Set<number>()
  if (titleIndex >= 0) excluded.add(titleIndex)
  if (chapter !== null) {
    for (let i = chapter.start; i < chapter.end; i++) excluded.add(i)
  }
  const blocks = tokenizeBlocks(lines.filter((_, index) => !excluded.has(index)))

  return { title, blocks, registers: chapterResult.registers, warnings: chapterResult.warnings, lang }
}
