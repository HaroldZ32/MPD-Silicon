// The `mpd_docgen_verify` gate oracle: it reads ONLY the produced artifacts (never the source
// manual) and asserts the plan's V1-V9, V11 and V12 structural contracts. V10 (a byte-identical
// rerun) needs a rebuild and stays in bun:test.
//
// Design rules that make it usable by a DIFFERENT agent:
//   - one check per plan id, in plan order; `ok` is true only when every requested check passed;
//   - an artifact that is missing/corrupt NEVER throws out of the tool: every check bound to it is
//     recorded as failed with the reason, so the caller still gets the structured result;
//   - the xlsx assertions resolve each cell's `s` index through styles.xml (font/fill/border) and
//     decode inline strings, which is what openpyxl does; the docx assertions parse the
//     WordprocessingML body into paragraphs/tables and read the table geometry directly;
//   - V11 derives the zh/en skeletons from the two documents (register identifiers from the H3
//     text, offsets, widths from the reset literals, per-register `(bit range, field name)`
//     sequences from the detail tables), never from titles — translations differ by design.
import { readFileSync } from "node:fs"
import type { DshToolDef } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import { resolveInputPath } from "./paths.js"
import { offsetNumber, parseResetHex } from "./registers.js"
import { DocgenError, isDocgenError, type DocgenCheck, type DocgenVerifyResult, type Lang } from "./types.js"
import { readZip } from "./zip.js"

/** The tool name (the `mpd_verif_*` namespace stays untouched). */
const TOOL_NAME = "mpd_docgen_verify"

/** The nine A..I column letters, in order. */
const COLUMN_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const

/** The exact header texts the workbook must carry (plan §3). */
const HEADERS: readonly string[] = [
  "register name",
  "field offset",
  "field name",
  "access type",
  "reset value",
  "description（中文描述，请填此列）",
  "skip field test",
  "remarks",
  'register structure = "1"\n0 : whole register\n1 : aggregated register',
]

/** The eCap column widths (plan §3). */
const COLUMN_WIDTHS: readonly number[] = [21.22, 19.78, 21, 18.44, 18.44, 37.11, 18.89, 22.78, 53.33]

/** The eCap header row height (plan §3). */
const HEADER_ROW_HEIGHT = 43.2

/** The nine OOXML parts every produced docx must contain (plan §4). */
const DOCX_PARTS: readonly string[] = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "word/_rels/document.xml.rels",
  "word/document.xml",
  "word/fontTable.xml",
  "word/settings.xml",
  "word/styles.xml",
]

/** The xlsx checks, in plan order. */
const XLSX_IDS = ["V1", "V2", "V3", "V4", "V5"] as const
/** Template placeholders that must not survive into an artifact (plan §7 V12). */
const PLACEHOLDERS: readonly string[] = ["<寄存器名>", "<REG_NAME>", "<IP名称>"]
/** The gray band behind a RESERVED span in the overview table (plan §4). */
const RESERVED_FILL = "D9D9D9"
/** A register reset literal: 4 or 8 uppercase hex digits after `0x`. */
const REGISTER_RESET = /^0x(?:[0-9A-F]{4}|[0-9A-F]{8})$/
/** A field reset literal: `{width}'h{HEX}`. */
const FIELD_RESET = /^\d+'h[0-9A-F]+$/
/** A field offset cell: `[hi:lo]` or `[N]`. */
const FIELD_OFFSET = /^\[(\d{1,2})(?::(\d{1,2}))?\]$/
/** The detail-table grid (plan §4 / xlsx2docx.py:578-592). */
const DETAIL_GRID: readonly number[] = [830, 1659, 5807]

/** The refusal shape the tool returns instead of throwing. */
interface ToolFailure {
  ok: false
  error: { code: string; message: string; hint: string }
}

/** The plan labels each language writes into the register chapter. */
interface OutputLabels {
  readonly chapterTitle: string
  readonly offsetPrefix: string
  readonly resetPrefix: string
  readonly detailHeaders: readonly [string, string, string]
}

/** `labelsFor` without importing the writer's module: the verifier owns its own contract copy. */
const LABELS: Readonly<Record<Lang, OutputLabels>> = {
  "zh-CN": { chapterTitle: "寄存器", offsetPrefix: "地址偏移：", resetPrefix: "复位值：", detailHeaders: ["位域", "名称", "描述"] },
  en: { chapterTitle: "Registers", offsetPrefix: "Offset: ", resetPrefix: "Reset value: ", detailHeaders: ["Bit field", "Name", "Description"] },
}

/** Convert any thrown value into the structured refusal; DocgenError keeps its code/hint. */
function refusalOf(error: unknown): ToolFailure {
  if (isDocgenError(error)) {
    return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } }
  }
  return {
    ok: false,
    error: {
      code: "DOCGEN_E_INTERNAL",
      message: "unexpected internal error: " + String(error),
      hint: "check the plugin log or retry with a narrower request",
    },
  }
}

/** Read one optional string argument; blank values count as absent. */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (typeof value !== "string" || value.trim() === "") return undefined
  return value
}

/** One-line reason for a failed check, keeping the stable error code when there is one. */
function messageOf(error: unknown): string {
  if (error instanceof DocgenError) return error.code + ": " + error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** Decode the five XML entities the writers emit. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Read one part out of a loaded archive; a missing part fails the check that asked for it. */
function partText(parts: Map<string, Uint8Array>, name: string): string {
  const data = parts.get(name)
  if (data === undefined) throw new Error("missing part: " + name)
  return new TextDecoder().decode(data)
}

/** Byte union of one span inside [31:0] (bitwise OR below truncates to 32 bits). */
function spanMask(hi: number, lo: number): number {
  const width = hi - lo + 1
  return width >= 32 ? 0xffffffff : (2 ** width - 1) * 2 ** lo
}

/** Parse a `hi` / `hi:lo` bit range cell, or null when it is malformed. */
function parseSpan(text: string): { hi: number; lo: number } | null {
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(text.trim())
  if (match === null) return null
  const hi = Number(match[1])
  const lo = match[2] === undefined ? hi : Number(match[2])
  if (hi > 31 || lo > hi) return null
  return { hi, lo }
}

/** Assert a list of spans is strictly descending and covers [31:0]. */
function assertSpanList(spans: readonly { hi: number; lo: number }[], context: string): void {
  if (spans.length === 0) throw new Error(context + ": no field spans")
  let union = 0
  let previousLo = 32
  for (const span of spans) {
    if (span.hi >= previousLo) throw new Error(context + ": spans are not strictly descending at [" + span.hi + ":" + span.lo + "]")
    previousLo = span.lo
    union = (union | spanMask(span.hi, span.lo)) >>> 0
  }
  if (union !== 0xffffffff) {
    throw new Error(context + ": spans do not cover [31:0] (union 0x" + union.toString(16).toUpperCase().padStart(8, "0") + ")")
  }
}

// ---------------------------------------------------------------------------------------------
// xlsx reader
// ---------------------------------------------------------------------------------------------

/** One decoded worksheet cell. */
interface SheetCell {
  readonly value: string
  readonly style: number
}

/** A worksheet parsed enough for V1-V5: rows, cell styles, row heights and column widths. */
interface Sheet {
  readonly rows: Map<number, Map<string, SheetCell>>
  readonly heights: Map<number, number>
  readonly widths: Map<string, number>
  readonly dimension: string
}

/** One font from styles.xml. */
interface FontInfo {
  readonly bold: boolean
  readonly size: number
  readonly name: string
  readonly charset: number | null
}

/** One xf from styles.xml. */
interface XfInfo {
  readonly fontId: number
  readonly fillId: number
  readonly borderId: number
}

/** The style inventory a sheet's `s` indexes point into. */
interface Styles {
  readonly fonts: FontInfo[]
  readonly fills: readonly (string | null)[]
  readonly borders: readonly { readonly thin: boolean }[]
  readonly xfs: XfInfo[]
}

/** Parse `xl/worksheets/sheet1.xml` into rows/cells/heights/widths. */
function parseSheet(xml: string): Sheet {
  const rows = new Map<number, Map<string, SheetCell>>()
  const heights = new Map<number, number>()
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const attributes = rowMatch[1]
    const rowNumber = Number(/\br="(\d+)"/.exec(attributes)?.[1] ?? "0")
    const height = /\bht="([^"]+)"/.exec(attributes)?.[1]
    if (height !== undefined) heights.set(rowNumber, Number(height))
    const cells = new Map<string, SheetCell>()
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = /\br="([A-Z]+)\d+"/.exec(cellMatch[1])?.[1] ?? ""
      const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(cellMatch[2] ?? "")
      cells.set(column, {
        value: inline === null ? "" : decodeEntities(inline[1]),
        style: Number(/\bs="(\d+)"/.exec(cellMatch[1])?.[1] ?? "0"),
      })
    }
    rows.set(rowNumber, cells)
  }
  const widths = new Map<string, number>()
  for (const colMatch of xml.matchAll(/<col\b([^>]*)\/>/g)) {
    const min = /\bmin="(\d+)"/.exec(colMatch[1])?.[1]
    const width = /\bwidth="([^"]+)"/.exec(colMatch[1])?.[1]
    if (min !== undefined && width !== undefined) widths.set(COLUMN_LETTERS[Number(min) - 1] ?? "", Number(width))
  }
  return { rows, heights, widths, dimension: /<dimension ref="([^"]+)"\/>/.exec(xml)?.[1] ?? "" }
}

/** Parse `xl/styles.xml` into fonts, fills, borders and xfs. */
function parseStyles(xml: string): Styles {
  const fontsBlock = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml)?.[1] ?? ""
  const fonts = [...fontsBlock.matchAll(/<font>([\s\S]*?)<\/font>/g)].map((match): FontInfo => {
    const body = match[1]
    const charset = /<charset val="(\d+)"\/>/.exec(body)
    return {
      bold: /<b\/>/.test(body),
      size: Number(/<sz val="([^"]+)"\/>/.exec(body)?.[1] ?? "0"),
      name: /<name val="([^"]+)"\/>/.exec(body)?.[1] ?? "",
      charset: charset === null ? null : Number(charset[1]),
    }
  })
  const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml)?.[1] ?? ""
  const fills = [...fillsBlock.matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((match): string | null =>
    /patternType="solid"/.test(match[1]) ? /<fgColor rgb="([^"]+)"\/>/.exec(match[1])?.[1] ?? null : null,
  )
  const bordersBlock = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(xml)?.[1] ?? ""
  const borders = [...bordersBlock.matchAll(/<border>([\s\S]*?)<\/border>/g)].map((match) => ({
    thin: ["left", "right", "top", "bottom"].every((edge) => new RegExp("<" + edge + ' style="thin"').test(match[1])),
  }))
  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ""
  const xfs = [...xfsBlock.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match): XfInfo => ({
    fontId: Number(/\bfontId="(\d+)"/.exec(match[1])?.[1] ?? "0"),
    fillId: Number(/\bfillId="(\d+)"/.exec(match[1])?.[1] ?? "0"),
    borderId: Number(/\bborderId="(\d+)"/.exec(match[1])?.[1] ?? "0"),
  }))
  return { fonts, fills, borders, xfs }
}

/** One register block of the workbook: the Reg row and its field rows. */
interface SheetModel {
  readonly rowNumbers: readonly number[]
  readonly registerRows: readonly number[]
  readonly fieldsOf: ReadonlyMap<number, readonly number[]>
  readonly unclassified: readonly number[]
}

/** Split the sheet into register blocks by the Reg-row marker (`D = Mixed`) and `[span]` cells. */
function modelOf(sheet: Sheet): SheetModel {
  const rowNumbers = [...sheet.rows.keys()].sort((a, b) => a - b)
  const registerRows: number[] = []
  const fieldsOf = new Map<number, number[]>()
  const unclassified: number[] = []
  let current: number | null = null
  for (const rowNumber of rowNumbers) {
    if (rowNumber === 1) continue
    const row = sheet.rows.get(rowNumber)
    if (row === undefined) continue
    const marker = row.get("D")?.value ?? ""
    const offset = row.get("B")?.value ?? ""
    if (marker === "Mixed") {
      current = rowNumber
      registerRows.push(rowNumber)
      fieldsOf.set(rowNumber, [])
    } else if (FIELD_OFFSET.test(offset)) {
      if (current === null) unclassified.push(rowNumber)
      else fieldsOf.get(current)?.push(rowNumber)
    } else {
      unclassified.push(rowNumber)
    }
  }
  return { rowNumbers, registerRows, fieldsOf, unclassified }
}

/** The cell at a row/column, or an empty cell when it is absent. */
function cellAt(sheet: Sheet, rowNumber: number, column: string): SheetCell {
  return sheet.rows.get(rowNumber)?.get(column) ?? { value: "", style: 0 }
}

/** Resolve one cell's style to its xf/font/fill/border, failing when the index is out of range. */
function resolveStyle(styles: Styles, cell: SheetCell): { font: FontInfo; fill: string | null; borderThin: boolean } {
  const xf = styles.xfs[cell.style]
  if (xf === undefined) throw new Error("cell style index " + cell.style + " has no cellXfs entry")
  const font = styles.fonts[xf.fontId]
  if (font === undefined) throw new Error("font id " + xf.fontId + " has no <font> entry")
  const border = styles.borders[xf.borderId]
  if (border === undefined) throw new Error("border id " + xf.borderId + " has no <border> entry")
  return { font, fill: styles.fills[xf.fillId] ?? null, borderThin: border.thin }
}

// ---------------------------------------------------------------------------------------------
// docx reader
// ---------------------------------------------------------------------------------------------

/** One body paragraph with its style id (null for a plain paragraph). */
interface DocxParagraph {
  readonly kind: "paragraph"
  readonly text: string
  readonly style: string | null
}

/** One table cell with its geometry and its paragraphs. */
interface DocxCell {
  readonly span: number
  readonly width: number
  readonly texts: readonly string[]
  readonly fill: string | null
  readonly vertical: boolean
  readonly vMerge: "restart" | "continue" | null
}

/** One table row with its exact height (when it has one). */
interface DocxRow {
  readonly height: number | null
  readonly cells: readonly DocxCell[]
}

/** One table with its explicit grid. */
interface DocxTable {
  readonly kind: "table"
  readonly grid: readonly number[]
  readonly rows: readonly DocxRow[]
}

/** A top-level body element: a paragraph or a table, in document order. */
type DocxElement = DocxParagraph | DocxTable

/** The text of a run sequence (`<w:t>` content joined), entities decoded. */
function paragraphText(fragment: string): string {
  let text = ""
  for (const match of fragment.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) text += decodeEntities(match[1])
  return text
}

/** Parse one `<w:tc>` cell. */
function parseCell(fragment: string): DocxCell {
  const properties = /<w:tcPr>([\s\S]*?)<\/w:tcPr>/.exec(fragment)?.[1] ?? ""
  const texts: string[] = []
  for (const match of fragment.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) texts.push(paragraphText(match[1] ?? ""))
  return {
    span: Number(/<w:gridSpan w:val="(\d+)"\/>/.exec(properties)?.[1] ?? "1"),
    width: Number(/<w:tcW w:w="(\d+)" w:type="dxa"\/>/.exec(properties)?.[1] ?? "0"),
    texts,
    fill: /<w:shd [^>]*w:fill="([^"]+)"\/>/.exec(properties)?.[1] ?? null,
    vertical: /<w:textDirection w:val="btLr"\/>/.test(properties),
    vMerge: /<w:vMerge w:val="restart"\/>/.test(properties) ? "restart" : /<w:vMerge\/>/.test(properties) ? "continue" : null,
  }
}

/** Parse one `<w:tr>` row. */
function parseRow(fragment: string): DocxRow {
  const cells: DocxCell[] = []
  for (const match of fragment.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) cells.push(parseCell(match[1]))
  const height = /<w:trHeight w:hRule="exact" w:val="(\d+)"\/>/.exec(fragment)
  return { height: height === null ? null : Number(height[1]), cells }
}

/** Parse one `<w:tbl>` table. */
function parseTable(fragment: string): DocxTable {
  const gridBlock = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(fragment)?.[1] ?? ""
  const grid: number[] = []
  for (const match of gridBlock.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)) grid.push(Number(match[1]))
  const rows: DocxRow[] = []
  for (const match of fragment.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) rows.push(parseRow(match[1]))
  return { kind: "table", grid, rows }
}

/** Parse `word/document.xml` into ordered body elements (tables consume their inner paragraphs). */
function parseDocument(xml: string): DocxElement[] {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? ""
  const elements: DocxElement[] = []
  for (const match of body.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const fragment = match[0]
    if (fragment.startsWith("<w:tbl")) elements.push(parseTable(fragment))
    else {
      const style = /<w:pStyle w:val="([^"]+)"\/>/.exec(fragment)?.[1]
      elements.push({ kind: "paragraph", text: paragraphText(fragment), style: style ?? null })
    }
  }
  return elements
}

/** One register chapter as the artifacts themselves describe it. */
interface Chapter {
  readonly name: string
  readonly title: string
  readonly offset: string
  readonly reset: string
  readonly bitTable: DocxTable
  readonly detailTable: DocxTable
}

/** The parsed register chapter plus the optional overview table. */
interface DocxModel {
  readonly elements: readonly DocxElement[]
  readonly chapterIndex: number
  readonly overview: DocxTable | null
  readonly chapters: readonly Chapter[]
}

/** The register identifier at the end of an H3: `title（NAME）` (zh) or `title (NAME)` (en). */
function registerNameOf(text: string): string | null {
  const zh = /（([A-Za-z_][A-Za-z0-9_]*)）\s*$/.exec(text)
  if (zh !== null) return zh[1]
  const en = /\(([A-Za-z_][A-Za-z0-9_]*)\)\s*$/.exec(text)
  return en === null ? null : en[1]
}

/** Extract the first paragraph of a cell (the label cells of the overview and detail tables). */
function cellText(cell: DocxCell | undefined): string {
  return cell === undefined ? "" : cell.texts[0] ?? ""
}

/**
 * Locate the register chapter and its per-register H3 blocks.
 *
 * The chapter is the LAST Heading 2, as the layout fixes it (plan §4). Each H3 block is the
 * fixed seven-element sequence H3, offset line, reset line, bit table, empty paragraph, detail
 * table, empty paragraph (xlsx2docx.py:596-612); a deviation names the chapter it broke in.
 */
function modelOfDocx(elements: readonly DocxElement[], lang: Lang): DocxModel {
  const labels = LABELS[lang]
  const heading2 = elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.kind === "paragraph" && element.style === "Heading2")
  const chapterEntry = heading2.find(({ element }) => element.kind === "paragraph" && element.text === labels.chapterTitle)
  if (chapterEntry === undefined) throw new Error('no Heading 2 "' + labels.chapterTitle + '" chapter')
  if (chapterEntry.index !== (heading2[heading2.length - 1]?.index ?? -1)) {
    throw new Error('the "' + labels.chapterTitle + '" chapter is not the last Heading 2')
  }
  let overview: DocxTable | null = null
  const chapters: Chapter[] = []
  let index = chapterEntry.index + 1
  while (index < elements.length) {
    const element = elements[index]
    if (element.kind !== "paragraph" || element.style !== "Heading3") {
      if (overview === null && element.kind === "table") overview = element
      index++
      continue
    }
    const name = registerNameOf(element.text)
    if (name === null) throw new Error('register H3 "' + element.text + '" has no (NAME) identifier')
    const offset = elements[index + 1]
    const reset = elements[index + 2]
    const bitTable = elements[index + 3]
    const spacer = elements[index + 4]
    const detailTable = elements[index + 5]
    if (offset === undefined || offset.kind !== "paragraph" || !offset.text.startsWith(labels.offsetPrefix)) {
      throw new Error("register " + name + ": missing `" + labels.offsetPrefix + "0x..` line after its H3")
    }
    if (reset === undefined || reset.kind !== "paragraph" || !reset.text.startsWith(labels.resetPrefix)) {
      throw new Error("register " + name + ": missing `" + labels.resetPrefix + "0x..` line")
    }
    if (bitTable === undefined || bitTable.kind !== "table") throw new Error("register " + name + ": missing its bit table")
    if (spacer === undefined || spacer.kind !== "paragraph") throw new Error("register " + name + ": missing the paragraph after its bit table")
    if (detailTable === undefined || detailTable.kind !== "table") throw new Error("register " + name + ": missing its detail table")
    chapters.push({
      name,
      title: element.text,
      offset: offset.text.slice(labels.offsetPrefix.length),
      reset: reset.text.slice(labels.resetPrefix.length),
      bitTable,
      detailTable,
    })
    index += 6
  }
  if (chapters.length === 0) throw new Error('the "' + labels.chapterTitle + '" chapter has no register H3 blocks')
  const names = new Set<string>()
  for (const chapter of chapters) {
    if (names.has(chapter.name)) throw new Error("duplicate register chapter: " + chapter.name)
    names.add(chapter.name)
  }
  return { elements, chapterIndex: chapterEntry.index, overview, chapters }
}

// ---------------------------------------------------------------------------------------------
// individual checks
// ---------------------------------------------------------------------------------------------

/** V1: one sheet named `Sheet1` carrying the exact nine headers. */
function checkV1(sheet: Sheet, parts: Map<string, Uint8Array>): string {
  const workbook = partText(parts, "xl/workbook.xml")
  const sheetName = /<sheet name="([^"]+)"/.exec(workbook)?.[1]
  if (sheetName !== "Sheet1") throw new Error('sheet name is ' + JSON.stringify(sheetName ?? null) + ', expected "Sheet1"')
  const header = sheet.rows.get(1)
  if (header === undefined) throw new Error("the sheet has no header row")
  const problems: string[] = []
  for (let column = 0; column < HEADERS.length; column++) {
    const actual = header.get(COLUMN_LETTERS[column])?.value ?? ""
    if (actual !== HEADERS[column]) {
      problems.push(COLUMN_LETTERS[column] + "1 = " + JSON.stringify(actual) + ", expected " + JSON.stringify(HEADERS[column]))
    }
  }
  if (problems.length > 0) throw new Error("header row differs: " + problems.join("; "))
  return 'sheet "Sheet1" with all 9 header texts'
}

/** V2: rows = 1 header + R Reg rows + F field rows, and every row carries all 9 columns. */
function checkV2(sheet: Sheet, model: SheetModel): string {
  if (model.unclassified.length > 0) throw new Error("rows are neither Reg nor field rows: " + model.unclassified.join(", "))
  const expectedLast = model.rowNumbers.length === 0 ? 0 : model.rowNumbers[model.rowNumbers.length - 1]
  for (let index = 0; index < model.rowNumbers.length; index++) {
    if (model.rowNumbers[index] !== index + 1) throw new Error("row numbers are not contiguous at row " + model.rowNumbers[index])
  }
  const fieldCount = model.registerRows.reduce((total, row) => total + (model.fieldsOf.get(row)?.length ?? 0), 0)
  if (model.rowNumbers.length !== 1 + model.registerRows.length + fieldCount) {
    throw new Error("row model is 1 + " + model.registerRows.length + " + " + fieldCount + ", but the sheet has " + model.rowNumbers.length + " rows")
  }
  for (const rowNumber of model.rowNumbers) {
    const columns = [...(sheet.rows.get(rowNumber)?.keys() ?? [])].sort().join("")
    if (columns !== COLUMN_LETTERS.join("")) throw new Error("row " + rowNumber + " does not carry exactly A..I (" + columns + ")")
  }
  if (sheet.dimension !== "A1:I" + expectedLast) throw new Error("dimension is " + JSON.stringify(sheet.dimension) + ", expected A1:I" + expectedLast)
  return "1 header + " + model.registerRows.length + " Reg + " + fieldCount + " field rows, 9 columns each"
}

/** V3: every Reg row is bold on the yellow fill and carries the literal `Mixed`. */
function checkV3(sheet: Sheet, model: SheetModel, styles: Styles): string {
  if (model.registerRows.length === 0) throw new Error("no Reg row (`access type = Mixed`) found")
  for (const rowNumber of model.registerRows) {
    const cell = cellAt(sheet, rowNumber, "A")
    const style = resolveStyle(styles, cell)
    if (cell.value.trim() === "") throw new Error("Reg row " + rowNumber + " has an empty register name")
    if (!style.font.bold) throw new Error("Reg row " + rowNumber + " (" + cell.value + ") is not bold")
    if (style.fill !== "FFFFFF00") throw new Error("Reg row " + rowNumber + " (" + cell.value + ") fill is " + JSON.stringify(style.fill) + ", expected FFFFFF00")
    if (cellAt(sheet, rowNumber, "D").value !== "Mixed") throw new Error("Reg row " + rowNumber + " access cell is not the literal Mixed")
    if ((model.fieldsOf.get(rowNumber)?.length ?? 0) === 0) throw new Error("Reg row " + rowNumber + " (" + cell.value + ") has no field rows")
  }
  return model.registerRows.length + " Reg rows bold + FFFFFF00 + Mixed"
}

/** V4: field spans, the RESERVED contract and the two reset formats. */
function checkV4(sheet: Sheet, model: SheetModel): string {
  let fieldTotal = 0
  let reservedTotal = 0
  for (const registerRow of model.registerRows) {
    const registerName = cellAt(sheet, registerRow, "A").value
    const reset = cellAt(sheet, registerRow, "E").value
    if (!REGISTER_RESET.test(reset)) throw new Error("register " + registerName + ": reset value " + JSON.stringify(reset) + " is not 0x + 4/8 uppercase hex")
    const rows = model.fieldsOf.get(registerRow) ?? []
    const spans: { hi: number; lo: number }[] = []
    for (const rowNumber of rows) {
      const offset = cellAt(sheet, rowNumber, "B").value
      const match = FIELD_OFFSET.exec(offset)
      if (match === null) throw new Error("register " + registerName + ": field offset " + JSON.stringify(offset) + " is not [hi:lo] or [N]")
      const hi = Number(match[1])
      const lo = match[2] === undefined ? hi : Number(match[2])
      if (hi > 31 || lo > hi) throw new Error("register " + registerName + ": field offset " + offset + " is outside [31:0]")
      spans.push({ hi, lo })
      const name = cellAt(sheet, rowNumber, "C").value
      const fieldReset = cellAt(sheet, rowNumber, "E").value
      if (!FIELD_RESET.test(fieldReset)) throw new Error("register " + registerName + ": field " + name + " reset " + JSON.stringify(fieldReset) + " is not {width}'h{HEX}")
      if (name === "RESERVED") {
        reservedTotal++
        const access = cellAt(sheet, rowNumber, "D").value
        if (access !== "") throw new Error("register " + registerName + ": RESERVED span " + offset + " carries access " + JSON.stringify(access))
        const description = cellAt(sheet, rowNumber, "F").value
        if (description !== "保留，必须保持复位值") {
          throw new Error("register " + registerName + ": RESERVED span " + offset + " description is " + JSON.stringify(description))
        }
      }
    }
    assertSpanList(spans, "register " + registerName)
    fieldTotal += rows.length
  }
  return fieldTotal + " field rows descending and covering [31:0], " + reservedTotal + " RESERVED rows canonical"
}

/** V5: thin borders, the eCap widths, the 43.2 header height and the size-11 font pair. */
function checkV5(sheet: Sheet, styles: Styles): string {
  for (let column = 0; column < COLUMN_LETTERS.length; column++) {
    const width = sheet.widths.get(COLUMN_LETTERS[column])
    if (width !== COLUMN_WIDTHS[column]) {
      throw new Error("column " + COLUMN_LETTERS[column] + " width is " + JSON.stringify(width ?? null) + ", expected " + COLUMN_WIDTHS[column])
    }
  }
  if (sheet.heights.get(1) !== HEADER_ROW_HEIGHT) throw new Error("header row height is " + JSON.stringify(sheet.heights.get(1) ?? null) + ", expected 43.2")
  for (const [rowNumber, cells] of sheet.rows) {
    for (const [column, cell] of cells) {
      const style = resolveStyle(styles, cell)
      if (!style.borderThin) throw new Error("cell " + column + rowNumber + " does not carry a thin border")
    }
  }
  for (const font of styles.fonts) {
    if (font.size !== 11) throw new Error("font " + font.name + " has size " + font.size + ", expected 11")
  }
  if (!styles.fonts.some((font) => font.name === "Calibri")) throw new Error("no Calibri font in styles.xml")
  if (!styles.fonts.some((font) => font.name === "宋体" && font.charset === 134)) throw new Error("no 宋体 font with charset 134 in styles.xml")
  if (!styles.fonts.some((font) => font.name === "宋体" && font.bold)) throw new Error("no bold 宋体 font (CJK Reg-row headers)")
  if (!styles.fills.includes("FFD9D9D9")) throw new Error("no FFD9D9D9 header fill in styles.xml")
  if (!styles.fills.includes("FFFFFF00")) throw new Error("no FFFFFF00 Reg-row fill in styles.xml")
  return "9 widths, 43.2 header height, thin borders on every cell, size 11 + Calibri/宋体(134)"
}

/** V6: the nine required parts, a well-formed-ish body and exactly one trailing sectPr. */
function checkV6(parts: Map<string, Uint8Array>): string {
  const missing = DOCX_PARTS.filter((name) => !parts.has(name))
  if (missing.length > 0) throw new Error("missing parts: " + missing.join(", "))
  const xml = partText(parts, "word/document.xml")
  if (!xml.startsWith("<?xml")) throw new Error("document.xml has no XML declaration")
  if (!/<w:document\b/.test(xml)) throw new Error("document.xml has no <w:document> root")
  if (!/<w:body>/.test(xml)) throw new Error("document.xml has no <w:body>")
  for (const tag of ["w:document", "w:body", "w:tbl", "w:tr", "w:tc", "w:p"]) {
    const open = (xml.match(new RegExp("<" + tag + "(?=[\\s/>])", "g")) ?? []).length
    const close = (xml.match(new RegExp("</" + tag + ">", "g")) ?? []).length
    const selfClosing = (xml.match(new RegExp("<" + tag + "\\b[^>]*/>", "g")) ?? []).length
    if (open !== close + selfClosing) throw new Error("unbalanced <" + tag + ">: " + open + " open, " + close + " close, " + selfClosing + " self-closing")
  }
  const sectPr = (xml.match(/<w:sectPr\b/g) ?? []).length
  if (sectPr !== 1) throw new Error("expected exactly one <w:sectPr>, found " + sectPr)
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1]?.trimEnd() ?? ""
  if (!body.endsWith("</w:sectPr>")) throw new Error("the last body element is not <w:sectPr>")
  return DOCX_PARTS.length + " required parts, balanced tags, one trailing sectPr"
}

/** V7: the register H2 chapter, one H3 per register, and each chapter's offset/reset lines. */
function checkV7(model: DocxModel): string {
  for (const chapter of model.chapters) {
    if (!/^0x[0-9A-Fa-f]+$/.test(chapter.offset)) {
      throw new Error("register " + chapter.name + ": offset line " + JSON.stringify(chapter.offset) + " is not 0x..")
    }
    if (!/^0x[0-9A-Fa-f\s]+$/.test(chapter.reset)) {
      throw new Error("register " + chapter.name + ": reset line " + JSON.stringify(chapter.reset) + " is not 0x..")
    }
  }
  return model.chapters.length + " H3 register chapters below the H2, each with offset/reset lines"
}

/** V8: the overview table — header, 2 rows per register, 902/278 heights, gray RESERVED, gridSpan. */
function checkV8(model: DocxModel): string {
  const overview = model.overview
  if (overview === null) throw new Error("no overview table between the register H2 and the first H3")
  const header = overview.rows[0]
  if (header === undefined) throw new Error("the overview table has no header row")
  const headerTexts = header.cells.map((cell) => cellText(cell))
  if (headerTexts.length !== 3 || headerTexts[0] !== "Offset" || headerTexts[1] !== "Register" || headerTexts[2] !== "31..0") {
    throw new Error("overview header is " + JSON.stringify(headerTexts) + ', expected ["Offset","Register","31..0"]')
  }
  if (header.cells[2].span !== 32) throw new Error("the 31..0 header cell spans " + header.cells[2].span + ", expected 32")
  if (header.height !== 278) throw new Error("overview header row height is " + JSON.stringify(header.height) + ", expected 278")
  if (overview.rows.length !== 1 + 2 * model.chapters.length) {
    throw new Error("overview has " + (overview.rows.length - 1) + " data rows for " + model.chapters.length + " registers")
  }
  let reserved = 0
  for (let index = 0; index < model.chapters.length; index++) {
    const chapter = model.chapters[index]
    const nameRow = overview.rows[1 + 2 * index]
    const resetRow = overview.rows[2 + 2 * index]
    if (nameRow === undefined || resetRow === undefined) throw new Error("overview rows for register " + chapter.name + " are missing")
    if (nameRow.height !== 902) throw new Error("register " + chapter.name + " name-row height is " + JSON.stringify(nameRow.height) + ", expected 902")
    if (resetRow.height !== 278) throw new Error("register " + chapter.name + " reset-row height is " + JSON.stringify(resetRow.height) + ", expected 278")
    if (cellText(nameRow.cells[0]) !== chapter.offset) {
      throw new Error("register " + chapter.name + ": overview offset " + JSON.stringify(cellText(nameRow.cells[0])) + " disagrees with its chapter " + JSON.stringify(chapter.offset))
    }
    if (cellText(resetRow.cells[1]) !== "Reset value") throw new Error("register " + chapter.name + ': reset-row label is not "Reset value"')
    const bitCells = nameRow.cells.slice(2)
    const spanSum = bitCells.reduce((total, cell) => total + cell.span, 0)
    if (spanSum !== 32) throw new Error("register " + chapter.name + ": overview field cells span " + spanSum + " bits, expected 32")
    if (resetRow.cells.slice(2).reduce((total, cell) => total + cell.span, 0) !== 32) {
      throw new Error("register " + chapter.name + ": reset-row cells do not cover 32 bits")
    }
    for (const cell of bitCells) {
      if (cellText(cell) !== "RESERVED") continue
      reserved++
      if (cell.fill !== RESERVED_FILL) throw new Error("register " + chapter.name + ': RESERVED band fill is ' + JSON.stringify(cell.fill) + ", expected " + RESERVED_FILL)
    }
    for (const cell of resetRow.cells.slice(2)) {
      const bit = cellText(cell)
      if (bit !== "" && bit !== "0" && bit !== "1") throw new Error("register " + chapter.name + ': reset bit cell is ' + JSON.stringify(bit))
    }
  }
  return model.chapters.length + " registers × 2 rows (902/278), " + reserved + " gray RESERVED bands, header + gridSpan checked"
}

/** V9: the 6×16 bit table and the 830/1659/5807 detail table per register. */
function checkV9(model: DocxModel, lang: Lang): string {
  const labels = LABELS[lang]
  let fieldTotal = 0
  for (const chapter of model.chapters) {
    const table = chapter.bitTable
    if (table.grid.length !== 16) throw new Error("register " + chapter.name + ": bit table grid has " + table.grid.length + " columns, expected 16")
    if (table.rows.length !== 6) throw new Error("register " + chapter.name + ": bit table has " + table.rows.length + " rows, expected 6")
    if (table.rows[0].cells.length !== 16 || table.rows[3].cells.length !== 16) {
      throw new Error("register " + chapter.name + ": the bit-number rows are not 16 cells wide")
    }
    if (cellText(table.rows[0].cells[0]) !== "31" || cellText(table.rows[0].cells[15]) !== "16") {
      throw new Error("register " + chapter.name + ": the upper bit-number row is not 31..16")
    }
    if (cellText(table.rows[3].cells[0]) !== "15" || cellText(table.rows[3].cells[15]) !== "0") {
      throw new Error("register " + chapter.name + ": the lower bit-number row is not 15..0")
    }
    if (table.rows[1].height !== 420 || table.rows[4].height !== 420) {
      throw new Error("register " + chapter.name + ": field-name row height is not 420")
    }

    const detail = chapter.detailTable
    if (detail.grid.length !== DETAIL_GRID.length || detail.grid.some((width, index) => width !== DETAIL_GRID[index])) {
      throw new Error("register " + chapter.name + ": detail grid is " + JSON.stringify(detail.grid) + ", expected " + JSON.stringify(DETAIL_GRID))
    }
    const header = detail.rows[0]
    if (header === undefined) throw new Error("register " + chapter.name + ": detail table has no header row")
    const headerTexts = header.cells.map((cell) => cellText(cell))
    if (headerTexts.length !== 3 || headerTexts.some((text, index) => text !== labels.detailHeaders[index])) {
      throw new Error("register " + chapter.name + ": detail header is " + JSON.stringify(headerTexts))
    }
    const spans: { hi: number; lo: number }[] = []
    for (const row of detail.rows.slice(1)) {
      const range = parseSpan(cellText(row.cells[0]))
      if (range === null) throw new Error("register " + chapter.name + ": detail bit field " + JSON.stringify(cellText(row.cells[0])) + " is not a bit range")
      if (cellText(row.cells[1]).trim() === "") throw new Error("register " + chapter.name + ": detail row " + cellText(row.cells[0]) + " has no field name")
      spans.push(range)
    }
    assertSpanList(spans, "register " + chapter.name + " detail")
    fieldTotal += spans.length
  }
  return model.chapters.length + " registers: 6×16 bit tables (trHeight 420) and 830/1659/5807 detail tables, " + fieldTotal + " fields"
}

/** One register chapter as the zh/en comparison needs it: identifier, offset, reset, fields. */
interface SkeletonChapter {
  readonly name: string
  readonly offset: string
  readonly reset: string
  readonly fields: readonly { readonly range: string; readonly name: string }[]
}

/** Derive the skeleton sequence from one document (identifiers, never translated titles). */
function skeletonOf(model: DocxModel): SkeletonChapter[] {
  return model.chapters.map((chapter) => ({
    name: chapter.name,
    offset: chapter.offset,
    reset: chapter.reset,
    fields: chapter.detailTable.rows.slice(1).map((row) => ({ range: cellText(row.cells[0]), name: cellText(row.cells[1]) })),
  }))
}

/** Numeric offset of one chapter as written; `0x`/`NNNh` and whitespace-grouped forms parse. */
function chapterOffset(chapter: SkeletonChapter, lang: Lang): number {
  try {
    return offsetNumber(chapter.offset.replace(/\s+/g, ""))
  } catch {
    throw new Error("register " + chapter.name + " offset is not a hex literal in " + lang + ": " + JSON.stringify(chapter.offset))
  }
}

/** Register width derived from its reset literal: eight hex digits are 32-bit, otherwise 16. */
function chapterWidth(chapter: SkeletonChapter, lang: Lang): 16 | 32 {
  try {
    return parseResetHex(chapter.reset).digits.length === 8 ? 32 : 16
  } catch {
    throw new Error("register " + chapter.name + " reset value has no derivable width in " + lang + ": " + JSON.stringify(chapter.reset))
  }
}

/** V11: the zh and en documents describe the same register skeleton, derived from the files. */
function checkV11(zh: SkeletonChapter[], en: SkeletonChapter[]): string {
  if (zh.length !== en.length) throw new Error("register count differs: zh " + zh.length + ", en " + en.length)
  let fieldTotal = 0
  for (let index = 0; index < zh.length; index++) {
    const left = zh[index]
    const right = en[index]
    if (left.name !== right.name) throw new Error("register " + (index + 1) + " identifier differs: zh " + left.name + ", en " + right.name)
    const zhOffset = chapterOffset(left, "zh-CN")
    const enOffset = chapterOffset(right, "en")
    if (zhOffset !== enOffset) {
      throw new Error("register " + left.name + " offset differs: zh " + left.offset + " (" + zhOffset + "), en " + right.offset + " (" + enOffset + ")")
    }
    const zhWidth = chapterWidth(left, "zh-CN")
    const enWidth = chapterWidth(right, "en")
    if (zhWidth !== enWidth) throw new Error("register " + left.name + " width differs: zh " + zhWidth + ", en " + enWidth)
    if (left.fields.length !== right.fields.length) {
      throw new Error("register " + left.name + " field count differs: zh " + left.fields.length + ", en " + right.fields.length)
    }
    for (let field = 0; field < left.fields.length; field++) {
      const a = left.fields[field]
      const b = right.fields[field]
      if (a.range !== b.range || a.name !== b.name) {
        throw new Error("register " + left.name + " field " + (field + 1) + " differs: zh (" + a.range + ", " + a.name + "), en (" + b.range + ", " + b.name + ")")
      }
    }
    fieldTotal += left.fields.length
  }
  return zh.length + " registers and " + fieldTotal + " fields agree between zh and en (identifiers, offsets, widths, spans)"
}

/** V12: no template placeholder survived into any supplied artifact. */
function checkV12(texts: readonly string[], paths: readonly string[]): string {
  const found: string[] = []
  for (let index = 0; index < texts.length; index++) {
    for (const placeholder of PLACEHOLDERS) {
      if (texts[index].includes(placeholder)) found.push(paths[index] + ": " + placeholder)
    }
  }
  if (found.length > 0) throw new Error("placeholder text found: " + found.join("; "))
  return "no template placeholder in " + texts.length + " artifact(s)"
}

// ---------------------------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------------------------

/** One artifact opened as a ZIP package. */
interface LoadedArtifact {
  readonly path: string
  readonly parts: Map<string, Uint8Array>
}

/** One docx as the verifier sees it, carrying its language and parsed model. */
interface LoadedDocx {
  readonly path: string
  readonly lang: Lang
  readonly parts: Map<string, Uint8Array>
  readonly model: DocxModel
}

/** The result of loading one docx: a model or the reason it could not be read. */
type DocxLoad =
  | { readonly ok: true; readonly docx: LoadedDocx }
  | { readonly ok: false; readonly path: string; readonly reason: string }

/** Read one artifact and open its ZIP container; the thrown reason names the path. */
function loadArtifact(argument: string, exec: unknown): LoadedArtifact {
  const path = resolveInputPath(argument, exec)
  return { path, parts: readZip(new Uint8Array(readFileSync(path))) }
}

/** Load one docx (bytes + parsed model); never throws, the reason becomes a failed check. */
function loadDocx(argument: string, lang: Lang, exec: unknown): DocxLoad {
  try {
    const artifact = loadArtifact(argument, exec)
    const xml = partText(artifact.parts, "word/document.xml")
    return { ok: true, docx: { path: artifact.path, lang, parts: artifact.parts, model: modelOfDocx(parseDocument(xml), lang) } }
  } catch (error) {
    const path = resolveInputPath(argument, exec)
    return { ok: false, path, reason: messageOf(error) }
  }
}

/** Record one check, converting a thrown assertion into a failed check with its reason. */
function record(checks: DocgenCheck[], id: string, body: () => string): void {
  try {
    checks.push({ id, ok: true, detail: body() })
  } catch (error) {
    checks.push({ id, ok: false, detail: messageOf(error) })
  }
}

/** Record every id of a group as failed with one shared reason. */
function failAll(checks: DocgenCheck[], ids: readonly string[], reason: string): void {
  for (const id of ids) checks.push({ id, ok: false, detail: reason })
}

/** Verify the artifacts named on the command line; returns every requested check. */
function executeVerify(args: Record<string, unknown>, exec: unknown): DocgenVerifyResult {
  const xlsxArg = optionalString(args, "xlsx")
  const zhArg = optionalString(args, "docxZh")
  const enArg = optionalString(args, "docxEn")
  if (xlsxArg === undefined && zhArg === undefined && enArg === undefined) {
    throw new DocgenError(
      "DOCGEN_E_INPUT",
      "no artifact to verify for " + TOOL_NAME,
      "pass at least one of xlsx, docxZh, docxEn (paths relative to the workspace root)",
    )
  }

  const checks: DocgenCheck[] = []

  // ---- xlsx: V1-V5 ---------------------------------------------------------------
  let xlsxArtifact: LoadedArtifact | null = null
  let xlsxReason = ""
  if (xlsxArg !== undefined) {
    try {
      xlsxArtifact = loadArtifact(xlsxArg, exec)
    } catch (error) {
      xlsxReason = messageOf(error)
    }
    if (xlsxArtifact === null) {
      failAll(checks, XLSX_IDS, xlsxReason)
    } else {
      const artifact = xlsxArtifact
      let sheet: Sheet | null = null
      let styles: Styles | null = null
      try {
        sheet = parseSheet(partText(artifact.parts, "xl/worksheets/sheet1.xml"))
        styles = parseStyles(partText(artifact.parts, "xl/styles.xml"))
      } catch (error) {
        failAll(checks, XLSX_IDS, messageOf(error))
      }
      if (sheet !== null && styles !== null) {
        const parsedSheet = sheet
        const parsedStyles = styles
        const model = modelOf(parsedSheet)
        record(checks, "V1", () => checkV1(parsedSheet, artifact.parts))
        record(checks, "V2", () => checkV2(parsedSheet, model))
        record(checks, "V3", () => checkV3(parsedSheet, model, parsedStyles))
        record(checks, "V4", () => checkV4(parsedSheet, model))
        record(checks, "V5", () => checkV5(parsedSheet, parsedStyles))
      }
    }
  }

  // ---- docx: V6-V9, V11 ----------------------------------------------------------
  const docxLoads: DocxLoad[] = []
  if (zhArg !== undefined) docxLoads.push(loadDocx(zhArg, "zh-CN", exec))
  if (enArg !== undefined) docxLoads.push(loadDocx(enArg, "en", exec))

  if (docxLoads.length > 0) {
    const failures = docxLoads.filter((load) => !load.ok)
    const loaded: LoadedDocx[] = []
    for (const load of docxLoads) if (load.ok) loaded.push(load.docx)
    const runDocx = (id: string, body: (docx: LoadedDocx) => string): void => {
      if (failures.length > 0) {
        const reasons = failures.map((load) => (load.ok ? "" : load.path + ": " + load.reason))
        checks.push({ id, ok: false, detail: reasons.join("; ") })
        return
      }
      record(checks, id, () => loaded.map((docx) => docx.lang + ": " + body(docx)).join("; "))
    }
    runDocx("V6", (docx) => checkV6(docx.parts))
    runDocx("V7", (docx) => checkV7(docx.model))
    runDocx("V8", (docx) => checkV8(docx.model))
    runDocx("V9", (docx) => checkV9(docx.model, docx.lang))

    if (zhArg !== undefined && enArg !== undefined) {
      const zhLoad = docxLoads[0]
      const enLoad = docxLoads[1]
      if (zhLoad.ok && enLoad.ok) {
        const zhDocx = zhLoad.docx
        const enDocx = enLoad.docx
        record(checks, "V11", () => checkV11(skeletonOf(zhDocx.model), skeletonOf(enDocx.model)))
      } else {
        const reasons = docxLoads.filter((load) => !load.ok).map((load) => (load.ok ? "" : load.path + ": " + load.reason))
        checks.push({ id: "V11", ok: false, detail: reasons.join("; ") })
      }
    }
  }

  // ---- V12: placeholders, over every supplied artifact ---------------------------
  const placeholderTexts: string[] = []
  const placeholderPaths: string[] = []
  const placeholderFailures: string[] = []
  if (xlsxArg !== undefined) {
    if (xlsxArtifact === null) placeholderFailures.push(xlsxReason)
    else {
      try {
        placeholderTexts.push(
          decodeEntities(partText(xlsxArtifact.parts, "xl/worksheets/sheet1.xml")) + "\n" + decodeEntities(partText(xlsxArtifact.parts, "xl/workbook.xml")),
        )
        placeholderPaths.push(xlsxArtifact.path)
      } catch (error) {
        placeholderFailures.push(messageOf(error))
      }
    }
  }
  for (const load of docxLoads) {
    if (!load.ok) {
      placeholderFailures.push(load.path + ": " + load.reason)
      continue
    }
    try {
      placeholderTexts.push(
        decodeEntities(partText(load.docx.parts, "word/document.xml")) + "\n" + decodeEntities(partText(load.docx.parts, "docProps/core.xml")),
      )
      placeholderPaths.push(load.docx.path)
    } catch (error) {
      placeholderFailures.push(messageOf(error))
    }
  }
  if (placeholderFailures.length > 0) {
    checks.push({ id: "V12", ok: false, detail: placeholderFailures.join("; ") })
  } else {
    record(checks, "V12", () => checkV12(placeholderTexts, placeholderPaths))
  }

  return { ok: checks.every((check) => check.ok), checks, failed: checks.filter((check) => !check.ok).map((check) => check.id) }
}

/** Human-readable rendering for the harness UI, covering both the result and the refusal. */
function render(value: unknown): { type: "text"; text: string }[] {
  const failure = value as Partial<ToolFailure>
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME + " FAILED [" + failure.error.code + "]: " + failure.error.message + "\nhint: " + failure.error.hint }]
  }
  const result = value as DocgenVerifyResult
  const lines = [TOOL_NAME + ": " + (result.ok ? "PASS" : "FAIL") + ", " + result.checks.length + " checks"]
  for (const check of result.checks) lines.push("  " + (check.ok ? "ok  " : "FAIL") + " " + check.id + " — " + check.detail)
  if (result.failed.length > 0) lines.push("failed: " + result.failed.join(", "))
  return [{ type: "text", text: lines.join("\n") }]
}

/** The `mpd_docgen_verify` tool definition. */
export function docgenVerifyToolDefinition(): DshToolDef {
  return {
    name: TOOL_NAME,
    description:
      "Gate oracle for the generated artifacts: reads only the produced xlsx/docx files and asserts V1-V5 (sheet name and 9 headers, row model, Reg-row style, field spans/RESERVED/reset formats, borders/widths/fonts), V6-V9 (9 parts + trailing sectPr, register H2 + H3 chapters, overview table, bit/detail tables), V11 (zh/en skeleton equality derived from the two documents) and V12 (no template placeholders). A missing or corrupt file fails its checks with the reason instead of throwing; ok is true only when every requested check passed.",
    parameters: {
      type: "object",
      properties: {
        xlsx: { type: "string", description: "xlsx path to verify, relative to the workspace root" },
        docxZh: { type: "string", description: "zh-CN docx path to verify, relative to the workspace root" },
        docxEn: { type: "string", description: "en docx path to verify, relative to the workspace root" },
      },
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
                detail: { type: "string" },
              },
            },
          },
          failed: { type: "array", items: { type: "string" } },
          error: { type: "object" },
        },
      },
      render: (_args: unknown, value: unknown) => render(value),
    },
    execute: async (args: Record<string, unknown>, exec: unknown) => {
      try {
        return executeVerify(args ?? {}, exec)
      } catch (error) {
        return refusalOf(error)
      }
    },
  }
}
