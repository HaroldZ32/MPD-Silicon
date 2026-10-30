// The WordprocessingML writer: a deterministic, from-scratch port of the eCap docx layout.
//
// Ported line references (/home/haroldzhao/eCap/tools/xlsx2docx.py):
//   - overview name row trHeight 902 / reset row trHeight 278, 2 rows per register,
//     label `NAME` for width 1|32 else `NAME[hi:lsb]`, RESERVED as a gray D9D9D9 band
//     with vMerge + btLr, single-bit fields btLr:           480-531, 240-254, 400-405
//   - bit table 6 rows x 16 columns, field-name row trHeight 420 exact, per-field
//     gridSpan + tcW = clipped grid sum:                    535-576, 408-419, 264-272
//   - chapter order H3 -> offset line -> reset line -> bit table -> empty paragraph ->
//     detail table -> empty paragraph:                      596-612
//   - detail table grid 830/1659/5807, one paragraph per description line: 578-592
//   - access mapping (8 pairs; unmapped codes verbatim, plan §4): docs/acctypematch.md
//   - trailing body-level sectPr:                           660-666
//
// The geometry is reproduced with our own styles and direct formatting (plan §4); no
// template asset and no third-party OOXML library is used. Every part is a pure function of
// (manual, registers, lang, ip): there is no clock, no random id and no map iteration, and
// buildZip pins the archive order/timestamp, so two builds are byte-identical (plan §4/§7).
import { labelsFor, type LabelSet } from "./labels.js"
import { bitRangeText, fieldLabel, parseResetHex } from "./registers.js"
import type { Block, Field, Lang, Manual, Register } from "./types.js"
import { element, escapeXml, xmlDeclaration } from "./xml.js"
import { buildZip, type ZipEntry } from "./zip.js"

/** WordprocessingML main namespace. */
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
/** Relationships namespace used by the `r:` prefix the document root declares. */
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
/** Package relationships namespace. */
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

/**
 * Overview table grid, copied from the eCap docx: offset column, register-name column and
 * one column per bit (34 grid columns, 8296 twips total).
 */
const OVERVIEW_GRID: readonly number[] = [499, 1162, ...new Array(11).fill(208), ...new Array(21).fill(207)]
/** Bit-table grid: 16 columns, 8306 twips (xlsx2docx.py:563 / template tblGrid). */
const BIT_GRID: readonly number[] = [520, 520, ...new Array(14).fill(519)]
/** Detail-table grid: 830/1659/5807 twips (xlsx2docx.py:578-592, checker C3). */
const DETAIL_GRID: readonly number[] = [830, 1659, 5807]
/** Text width used by generic markdown tables (the detail grid sums to the same 8296). */
const TEXT_WIDTH = 8296

/** Body font: Calibri for ASCII, 宋体 for East Asian text, `hint="eastAsia"` on every run. */
const FONT_BODY = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "宋体" } as const
/** Code font: monospace ASCII, 宋体 for East Asian text. */
const FONT_MONO = { ascii: "Courier New", hAnsi: "Courier New", eastAsia: "宋体" } as const

/**
 * eCap's eight access pairs (docs/acctypematch.md): Excel code -> Word code. The canonical
 * model stores access codes lower-cased, so the keys are lower-case; a code outside this
 * table is emitted verbatim (plan §4) rather than refused.
 */
const ACCESS_MAP: Readonly<Record<string, string>> = {
  rw: "rw",
  ro: "r",
  wo: "w",
  w1c: "rc_w1",
  w0c: "rc_w0",
  rc: "rc_r",
  w1s: "rs",
  w1t: "t",
}

/** The mapped access text for one field (`RESERVED` is handled by the caller). */
function mappedAccess(access: string): string {
  return ACCESS_MAP[access.toLowerCase()] ?? access
}

/** `rFonts` for one font family with the plan's mandatory `hint="eastAsia"`. */
function rFontsXml(font: typeof FONT_BODY | typeof FONT_MONO): string {
  return element("w:rFonts", { "w:ascii": font.ascii, "w:hAnsi": font.hAnsi, "w:eastAsia": font.eastAsia, "w:hint": "eastAsia" })
}

/** One run; `xml:space="preserve"` keeps code-block indentation and list spacing. */
function runXml(text: string, options: { bold?: boolean; mono?: boolean } = {}): string {
  const rPr = element("w:rPr", {}, rFontsXml(options.mono === true ? FONT_MONO : FONT_BODY) + (options.bold === true ? "<w:b/><w:bCs/>" : ""))
  return "<w:r>" + rPr + '<w:t xml:space="preserve">' + escapeXml(text) + "</w:t></w:r>"
}

/** Split paragraph text on `**bold**` spans so inline emphasis becomes real bold runs. */
function inlineRunsXml(text: string, base: { bold?: boolean; mono?: boolean } = {}): string {
  let out = ""
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (part === "") continue
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    if (bold === null) out += runXml(part, base)
    else out += runXml(bold[1], { ...base, bold: true })
  }
  return out
}

/** Paragraph text with markdown soft/hard line breaks rendered as `w:br`. */
function textRunsXml(text: string, base: { bold?: boolean; mono?: boolean } = {}): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? "" : "<w:br/>") + inlineRunsXml(line, base))
    .join("")
}

/** One paragraph with an optional paragraph style. */
function paragraphXml(text: string, options: { style?: string; bold?: boolean; mono?: boolean } = {}): string {
  const pPr =
    (options.style === undefined ? "" : element("w:pStyle", { "w:val": options.style })) +
    element("w:rPr", {}, rFontsXml(options.mono === true ? FONT_MONO : FONT_BODY))
  return "<w:p>" + element("w:pPr", {}, pPr) + textRunsXml(text, { bold: options.bold, mono: options.mono }) + "</w:p>"
}

/** One table cell; `paragraphs` carries the detail table's multi-line description. */
interface CellOptions {
  /** Cell width in twips. */
  readonly width: number
  /** Number of grid columns the cell covers (omitted for 1). */
  readonly gridSpan?: number
  /** Vertical merge role: `restart` on the overview name row, `continue` on the reset row. */
  readonly vMerge?: "restart" | "continue"
  /** Background fill, e.g. `D9D9D9` for the RESERVED band. */
  readonly fill?: string
  /** Vertical (`btLr`) text for RESERVED and single-bit overview cells. */
  readonly verticalText?: boolean
  /** Paragraph style of the cell paragraphs. */
  readonly style?: string
  /** Bold runs (table headers). */
  readonly bold?: boolean
  /** Cell text, used when `paragraphs` is absent. */
  readonly text?: string
  /** One paragraph per entry; absent means a single paragraph holding `text`. */
  readonly paragraphs?: readonly string[]
}

/** One table cell, in schema order: tcW, gridSpan, vMerge, shd, textDirection, vAlign. */
function cellXml(options: CellOptions): string {
  const tcPr: string[] = [element("w:tcW", { "w:w": options.width, "w:type": "dxa" })]
  if ((options.gridSpan ?? 1) > 1) tcPr.push(element("w:gridSpan", { "w:val": options.gridSpan }))
  if (options.vMerge !== undefined) tcPr.push(element("w:vMerge", options.vMerge === "restart" ? { "w:val": "restart" } : {}))
  if (options.fill !== undefined) tcPr.push(element("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": options.fill }))
  if (options.verticalText === true) tcPr.push(element("w:textDirection", { "w:val": "btLr" }))
  tcPr.push(element("w:vAlign", { "w:val": "center" }))
  const paragraphs = options.paragraphs ?? [options.text ?? ""]
  const content = paragraphs.map((text) => paragraphXml(text, { style: options.style ?? "RegOverview", bold: options.bold })).join("")
  return "<w:tc>" + element("w:tcPr", {}, tcPr.join("")) + content + "</w:tc>"
}

/** One table row with an optional exact height and header repeat. */
function rowXml(cells: readonly string[], options: { height?: number; header?: boolean } = {}): string {
  let trPr = ""
  if (options.height !== undefined) trPr += element("w:trHeight", { "w:hRule": "exact", "w:val": options.height })
  if (options.header === true) trPr += element("w:tblHeader", {})
  return "<w:tr>" + (trPr === "" ? "" : element("w:trPr", {}, trPr)) + cells.join("") + "</w:tr>"
}

/** One fixed-layout, 100%-width table with an explicit grid. */
function tableXml(grid: readonly number[], rows: readonly string[]): string {
  const tblPr = element(
    "w:tblPr",
    {},
    element("w:tblStyle", { "w:val": "RegTable" }) +
      element("w:tblW", { "w:w": "5000", "w:type": "pct" }) +
      element("w:tblLayout", { "w:type": "fixed" }) +
      element("w:tblLook", { "w:val": "04A0", "w:firstRow": "1", "w:lastRow": "0", "w:firstColumn": "1", "w:lastColumn": "0", "w:noHBand": "0", "w:noVBand": "1" }),
  )
  const tblGrid = element("w:tblGrid", {}, grid.map((width) => element("w:gridCol", { "w:w": width })).join(""))
  return "<w:tbl>" + tblPr + tblGrid + rows.join("") + "</w:tbl>"
}

/** One field clipped to a bit half (xlsx2docx.py:408-419). */
interface Segment {
  readonly hi: number
  readonly lo: number
  readonly field: Field
}

/** Clip fields to `[loEdge..hiEdge]`, preserving xlsx order (xlsx2docx.py:408-419). */
function clipFields(fields: readonly Field[], hiEdge: number, loEdge: number): Segment[] {
  const segments: Segment[] = []
  for (const field of fields) {
    const hi = Math.min(field.hi, hiEdge)
    const lo = Math.max(field.lo, loEdge)
    if (hi >= lo) segments.push({ hi, lo, field })
  }
  return segments
}

/** Width in twips of a bit span inside a 16-column half (xlsx2docx.py:264-272). */
function bitSpanWidth(hi: number, lo: number): number {
  const column = hi > 15 ? 31 - hi : 15 - hi
  return BIT_GRID.slice(column, column + hi - lo + 1).reduce((total, width) => total + width, 0)
}

/** Width in twips of a bit span in the overview grid (two leading columns, bit 31 first). */
function overviewSpanWidth(hi: number, lo: number): number {
  const column = 2 + (31 - hi)
  return OVERVIEW_GRID.slice(column, column + hi - lo + 1).reduce((total, width) => total + width, 0)
}

/** The overview table: header plus exactly two rows per register (plan §4 / xlsx2docx.py:480-531). */
function overviewTableXml(registers: readonly Register[], labels: LabelSet): string {
  const bitColumns = OVERVIEW_GRID.slice(2).reduce((total, width) => total + width, 0)
  const header = rowXml(
    [
      cellXml({ width: OVERVIEW_GRID[0], text: labels.overviewHeaders[0], style: "RegOverview", bold: true }),
      cellXml({ width: OVERVIEW_GRID[1], text: labels.overviewHeaders[1], style: "RegOverview", bold: true }),
      cellXml({ width: bitColumns, gridSpan: 32, text: labels.overviewHeaders[2], style: "RegOverview", bold: true }),
    ],
    { height: 278, header: true },
  )

  const rows: string[] = [header]
  for (const register of registers) {
    const reset = parseResetHex(register.reset).value
    const nameCells: string[] = [
      cellXml({ width: OVERVIEW_GRID[0], text: register.offset, style: "RegOverview", vMerge: "restart" }),
      cellXml({ width: OVERVIEW_GRID[1], text: register.name, style: "RegOverview" }),
    ]
    const resetCells: string[] = [
      cellXml({ width: OVERVIEW_GRID[0], text: "", style: "RegOverview", vMerge: "continue" }),
      cellXml({ width: OVERVIEW_GRID[1], text: "Reset value", style: "RegOverview" }),
    ]
    for (const field of register.fields) {
      const width = field.hi - field.lo + 1
      const tcW = overviewSpanWidth(field.hi, field.lo)
      if (field.reserved) {
        nameCells.push(cellXml({ width: tcW, gridSpan: width, text: "RESERVED", style: "RegOverview", fill: "D9D9D9", vMerge: "restart", verticalText: true }))
        resetCells.push(cellXml({ width: tcW, gridSpan: width, text: "", style: "RegOverview", vMerge: "continue" }))
      } else if (width === 1) {
        nameCells.push(cellXml({ width: tcW, text: fieldLabel(field), style: "RegOverview", verticalText: true }))
        resetCells.push(cellXml({ width: tcW, text: ((reset >>> field.lo) & 1) === 1 ? "1" : "0", style: "RegOverview" }))
      } else {
        nameCells.push(cellXml({ width: tcW, gridSpan: width, text: fieldLabel(field), style: "RegOverview" }))
        for (let bit = field.hi; bit >= field.lo; bit--) {
          resetCells.push(cellXml({ width: OVERVIEW_GRID[2 + (31 - bit)], text: ((reset >>> bit) & 1) === 1 ? "1" : "0", style: "RegOverview" }))
        }
      }
    }
    rows.push(rowXml(nameCells, { height: 902 }), rowXml(resetCells, { height: 278 }))
  }
  return tableXml(OVERVIEW_GRID, rows)
}

/** Field-name and access cells of one bit-table half. */
function bitSegmentRow(segments: readonly Segment[], kind: "name" | "access"): string {
  const cells = segments.map((segment) =>
    cellXml({
      width: bitSpanWidth(segment.hi, segment.lo),
      gridSpan: segment.hi - segment.lo + 1,
      text: kind === "name" ? segment.field.name : segment.field.reserved ? "" : mappedAccess(segment.field.access),
      style: "RegBit",
    }),
  )
  return rowXml(cells, kind === "name" ? { height: 420 } : {})
}

/** The 6-row x 16-column bit table (xlsx2docx.py:535-576). */
function bitTableXml(register: Register): string {
  const numberRow = (edge: number): string =>
    rowXml(Array.from({ length: 16 }, (_, index) => cellXml({ width: BIT_GRID[index], text: String(edge - index), style: "RegBit" })))
  const upper = clipFields(register.fields, 31, 16)
  const lower = clipFields(register.fields, 15, 0)
  return tableXml(BIT_GRID, [
    numberRow(31),
    bitSegmentRow(upper, "name"),
    bitSegmentRow(upper, "access"),
    numberRow(15),
    bitSegmentRow(lower, "name"),
    bitSegmentRow(lower, "access"),
  ])
}

/** The detail table: header plus one row per field, descriptions split per line (xlsx2docx.py:578-592). */
function detailTableXml(register: Register, labels: LabelSet): string {
  const header = rowXml(labels.detailHeaders.map((text, index) => cellXml({ width: DETAIL_GRID[index], text, style: "RegDetail", bold: true })))
  const rows = register.fields.map((field) =>
    rowXml([
      cellXml({ width: DETAIL_GRID[0], text: bitRangeText(field), style: "RegDetail" }),
      cellXml({ width: DETAIL_GRID[1], text: field.name, style: "RegDetail" }),
      cellXml({ width: DETAIL_GRID[2], paragraphs: field.desc.split("\n"), style: "RegDetail" }),
    ]),
  )
  return tableXml(DETAIL_GRID, [header, ...rows])
}

/** One register chapter: H3, offset line, reset line, bit table, empty p, detail table, empty p. */
function chapterXml(register: Register, labels: LabelSet, lang: Lang): readonly string[] {
  const title = lang === "zh-CN" ? register.title + "（" + register.name + "）" : register.title + " (" + register.name + ")"
  return [
    paragraphXml(title, { style: "Heading3" }),
    paragraphXml(labels.offsetLine + register.offset),
    paragraphXml(labels.resetLine + register.reset),
    bitTableXml(register),
    "<w:p/>",
    detailTableXml(register, labels),
    "<w:p/>",
  ]
}

/** Evenly divide the text width across a generic table's columns. */
function evenGrid(columns: number): number[] {
  const base = Math.floor(TEXT_WIDTH / columns)
  const grid = new Array<number>(columns).fill(base)
  grid[columns - 1] += TEXT_WIDTH - base * columns
  return grid
}

/** A markdown table as a real Word table with a bold header row. */
function genericTableXml(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const columns = Math.max(1, header.length, ...rows.map((row) => row.length))
  const grid = evenGrid(columns)
  const cellsOf = (cells: readonly string[], headerRow: boolean): string =>
    rowXml(
      Array.from({ length: columns }, (_, index) => cellXml({ width: grid[index], text: cells[index] ?? "", style: "TableText", bold: headerRow })),
      headerRow ? { header: true } : {},
    )
  return tableXml(grid, [cellsOf(header, true), ...rows.map((row) => cellsOf(row, false))])
}

/** Render one markdown block of the manual body. */
function blockXml(block: Block): string {
  switch (block.kind) {
    case "heading":
      return paragraphXml(block.text, { style: "Heading" + block.level })
    case "paragraph":
      return paragraphXml(block.text)
    case "list":
      return block.items
        .map((item, index) => paragraphXml((block.ordered ? index + 1 + ". " : "• ") + item, { style: "ListParagraph" }))
        .join("")
    case "fence": {
      const lines = block.text === "" ? [""] : block.text.split("\n")
      return lines.map((line) => paragraphXml(line, { style: "Code", mono: true })).join("")
    }
    case "table":
      return genericTableXml(block.header, block.rows)
    default: {
      const unreachable: never = block
      return unreachable
    }
  }
}

/** The last body element, exactly one A4-portrait section (plan §4 / xlsx2docx.py:660-666). */
function sectPrXml(): string {
  return element(
    "w:sectPr",
    {},
    element("w:pgSz", { "w:w": 11906, "w:h": 16838 }) +
      element("w:pgMar", { "w:top": 1440, "w:right": 1800, "w:bottom": 1440, "w:left": 1800, "w:header": 851, "w:footer": 992, "w:gutter": 0 }) +
      element("w:cols", { "w:space": 425 }) +
      element("w:docGrid", { "w:type": "lines", "w:linePitch": 312 }),
  )
}

/** The document body: H1, the generic blocks, then the register chapter last (plan §4). */
function documentXml(manual: Manual, registers: readonly Register[], lang: Lang): string {
  const labels = labelsFor(lang)
  const body: string[] = [paragraphXml(manual.title, { style: "Heading1" })]
  for (const block of manual.blocks) body.push(blockXml(block))
  body.push(paragraphXml(labels.chapterTitle, { style: "Heading2" }))
  body.push(overviewTableXml(registers, labels))
  for (const register of registers) body.push(...chapterXml(register, labels, lang))
  body.push(sectPrXml())
  return xmlDeclaration() + '<w:document xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '"><w:body>' + body.join("") + "</w:body></w:document>"
}

/** One paragraph-style definition. */
function paragraphStyleXml(
  id: string,
  name: string,
  pPr: string,
  rPr: string,
  options: { basedOn?: string; next?: string; defaultStyle?: boolean } = {},
): string {
  return element(
    "w:style",
    { "w:type": "paragraph", "w:styleId": id, ...(options.defaultStyle === true ? { "w:default": "1" } : {}) },
    element("w:name", { "w:val": name }) +
      (options.basedOn === undefined ? "" : element("w:basedOn", { "w:val": options.basedOn })) +
      (options.next === undefined ? "" : element("w:next", { "w:val": options.next })) +
      "<w:qFormat/>" +
      (pPr === "" ? "" : element("w:pPr", {}, pPr)) +
      (rPr === "" ? "" : element("w:rPr", {}, rPr)),
  )
}

/** A heading style: bold, keep-with-next, outline level, size in half-points. */
function headingStyleXml(level: 1 | 2 | 3 | 4 | 5 | 6, size: number): string {
  const pPr =
    "<w:keepNext/><w:keepLines/>" +
    element("w:spacing", { "w:before": level === 1 ? 240 : 180, "w:after": 120 }) +
    element("w:outlineLvl", { "w:val": level - 1 })
  const rPr = "<w:b/><w:bCs/>" + element("w:sz", { "w:val": size }) + element("w:szCs", { "w:val": size })
  return paragraphStyleXml("Heading" + level, "heading " + level, pPr, rPr, { basedOn: "Normal", next: "Normal" })
}

/** styles.xml: self-defined styles whose geometry matches the eCap table styles (plan §4). */
function stylesXml(): string {
  const docDefaults =
    "<w:docDefaults><w:rPrDefault><w:rPr>" +
    rFontsXml(FONT_BODY) +
    element("w:sz", { "w:val": 21 }) +
    element("w:szCs", { "w:val": 21 }) +
    '<w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
    "</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>"

  const normal = paragraphStyleXml(
    "Normal",
    "Normal",
    element("w:spacing", { "w:before": 120, "w:after": 120, "w:line": 300, "w:lineRule": "auto" }),
    rFontsXml(FONT_BODY) + element("w:sz", { "w:val": 21 }) + element("w:szCs", { "w:val": 21 }),
    { defaultStyle: true },
  )
  const list = paragraphStyleXml(
    "ListParagraph",
    "List Paragraph",
    element("w:spacing", { "w:before": 0, "w:after": 0 }) + element("w:ind", { "w:left": 720, "w:hanging": 360 }),
    "",
    { basedOn: "Normal", next: "Normal" },
  )
  const code = paragraphStyleXml(
    "Code",
    "Code Block",
    element("w:spacing", { "w:before": 0, "w:after": 0 }) + element("w:ind", { "w:left": 0 }),
    rFontsXml(FONT_MONO) + element("w:sz", { "w:val": 18 }) + element("w:szCs", { "w:val": 18 }),
    { basedOn: "Normal", next: "Normal" },
  )
  const tableText = paragraphStyleXml(
    "TableText",
    "Table Text",
    element("w:spacing", { "w:before": 0, "w:after": 0 }),
    element("w:sz", { "w:val": 18 }) + element("w:szCs", { "w:val": 18 }),
    { basedOn: "Normal", next: "Normal" },
  )
  // eCap's overview cell style (a6): no spacing, centred, 6pt.
  const regOverview = paragraphStyleXml(
    "RegOverview",
    "Register Overview Cell",
    element("w:adjustRightInd", { "w:val": 0 }) +
      element("w:snapToGrid", { "w:val": 0 }) +
      element("w:spacing", { "w:before": 0, "w:after": 0 }) +
      element("w:jc", { "w:val": "center" }),
    element("w:sz", { "w:val": 12 }) + element("w:szCs", { "w:val": 12 }),
    { basedOn: "Normal", next: "Normal" },
  )
  // eCap's bit-table cell style (a8): based on a6, 6.5pt.
  const regBit = paragraphStyleXml(
    "RegBit",
    "Register Bit Cell",
    "",
    element("w:sz", { "w:val": 13 }) + element("w:szCs", { "w:val": 13 }),
    { basedOn: "RegOverview", next: "Normal" },
  )
  // eCap's detail-table cell style (aa): no spacing, 9pt.
  const regDetail = paragraphStyleXml(
    "RegDetail",
    "Register Detail Cell",
    element("w:spacing", { "w:before": 0, "w:after": 0 }),
    element("w:sz", { "w:val": 18 }) + element("w:szCs", { "w:val": 18 }),
    { basedOn: "Normal", next: "Normal" },
  )
  const regTable = element(
    "w:style",
    { "w:type": "table", "w:styleId": "RegTable" },
    element("w:name", { "w:val": "Register Table" }) +
      "<w:qFormat/>" +
      element(
        "w:tblPr",
        {},
        element(
          "w:tblBorders",
          {},
          ["top", "left", "bottom", "right", "insideH", "insideV"]
            .map((side) => element("w:" + side, { "w:val": "single", "w:sz": 4, "w:space": 0, "w:color": "auto" }))
            .join(""),
        ) + element("w:tblLayout", { "w:type": "fixed" }),
      ),
  )

  return (
    xmlDeclaration() +
    '<w:styles xmlns:w="' + W_NS + '">' +
    docDefaults +
    normal +
    headingStyleXml(1, 32) +
    headingStyleXml(2, 30) +
    headingStyleXml(3, 28) +
    headingStyleXml(4, 24) +
    headingStyleXml(5, 22) +
    headingStyleXml(6, 21) +
    list +
    code +
    tableText +
    regOverview +
    regBit +
    regDetail +
    regTable +
    "</w:styles>"
  )
}

/** `[Content_Types].xml` for the nine parts this writer emits. */
function contentTypesXml(): string {
  return (
    xmlDeclaration() +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>"
  )
}

/** Package relationships: main document, core properties, extended properties. */
function packageRelsXml(): string {
  return (
    xmlDeclaration() +
    '<Relationships xmlns="' + REL_NS + '">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>"
  )
}

/** Main-document relationships: styles, settings, font table. */
function documentRelsXml(): string {
  return (
    xmlDeclaration() +
    '<Relationships xmlns="' + REL_NS + '">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>' +
    "</Relationships>"
  )
}

/** Core properties; the title is the manual H1 and the timestamp is the fixed epoch. */
function coreXml(title: string, ip: string, lang: Lang): string {
  return (
    xmlDeclaration() +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>" + escapeXml(title) + "</dc:title>" +
    "<dc:subject>" + escapeXml(ip) + "</dc:subject>" +
    "<dc:creator>mpd-docgen</dc:creator>" +
    "<cp:lastModifiedBy>mpd-docgen</cp:lastModifiedBy>" +
    '<dcterms:created xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified>' +
    "<dc:language>" + lang + "</dc:language>" +
    "</cp:coreProperties>"
  )
}

/** Minimal extended properties; fixed values only (deterministic). */
function appXml(): string {
  return (
    xmlDeclaration() +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    "<Application>mpd-docgen</Application>" +
    "<DocSecurity>0</DocSecurity>" +
    "<ScaleCrop>false</ScaleCrop>" +
    "<Company></Company>" +
    "<LinksUpToDate>false</LinksUpToDate>" +
    "<SharedDoc>false</SharedDoc>" +
    "<HyperlinksChanged>false</HyperlinksChanged>" +
    "<AppVersion>1.0</AppVersion>" +
    "</Properties>"
  )
}

/** Minimal word settings: 100% zoom, a default tab stop, Word 2013 compatibility. */
function settingsXml(): string {
  return (
    xmlDeclaration() +
    "<w:settings xmlns:w=\"" + W_NS + "\">" +
    '<w:zoom w:percent="100"/>' +
    '<w:defaultTabStop w:val="420"/>' +
    '<w:characterSpacingControl w:val="compressPunctuation"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    "</w:settings>"
  )
}

/** Font table for the three fonts the writer references. */
function fontTableXml(): string {
  return (
    xmlDeclaration() +
    "<w:fonts xmlns:w=\"" + W_NS + "\">" +
    '<w:font w:name="Calibri"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>' +
    '<w:font w:name="宋体"><w:charset w:val="86"/><w:family w:val="modern"/><w:pitch w:val="variable"/></w:font>' +
    '<w:font w:name="Courier New"><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>' +
    "</w:fonts>"
  )
}

/** UTF-8 bytes for one XML part. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Build the deterministic `<ip>_reg_user_manual.<lang>.docx` bytes.
 *
 * The body is the manual H1, every non-register block, then the register chapter LAST:
 * the overview table (header + two rows per register), one H3 chapter per register (offset
 * line, reset line, 6x16 bit table, detail table), and exactly one trailing `sectPr`
 * (A4 portrait). There is no TOC, cover page, header or footer, matching the eCap artifact.
 *
 * @param manual - the parsed manual (title + generic body blocks).
 * @param registers - canonical registers (gap-filled, descending) to render last.
 * @param lang - the document language, which selects labels and heading text.
 * @param opts - `ip` is written to the core properties' subject.
 * @returns the docx (OOXML ZIP) bytes.
 */
export function buildDocx(manual: Manual, registers: readonly Register[], lang: Lang, opts: { ip: string }): Uint8Array {
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: utf8(contentTypesXml()) },
    { name: "_rels/.rels", data: utf8(packageRelsXml()) },
    { name: "docProps/app.xml", data: utf8(appXml()) },
    { name: "docProps/core.xml", data: utf8(coreXml(manual.title, opts.ip, lang)) },
    { name: "word/_rels/document.xml.rels", data: utf8(documentRelsXml()) },
    { name: "word/document.xml", data: utf8(documentXml(manual, registers, lang)) },
    { name: "word/fontTable.xml", data: utf8(fontTableXml()) },
    { name: "word/settings.xml", data: utf8(settingsXml()) },
    { name: "word/styles.xml", data: utf8(stylesXml()) },
  ]
  return buildZip(entries)
}
