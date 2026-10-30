// T2 xlsx tests: the plan's structural assertions V1-V5, the byte-identical rerun V10, and
// one real tool execution. Everything is read back out of the produced ZIP, so the assertions
// observe the artifact rather than the writer's intent.
//
// Style checks resolve a cell's `s` index through styles.xml (font/fill/border/alignment), which
// is exactly what openpyxl reads; the separate oracle run in the evidence log repeats the same
// reading with a different implementation.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseManual } from "../src/markdown.js"
import { registerXlsxToolDefinition } from "../src/tool-xlsx.js"
import type { Register, RegisterXlsxResult } from "../src/types.js"
import { buildXlsx } from "../src/xlsx.js"
import { readZip } from "../src/zip.js"

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures")
const MANUAL = parseManual(readFileSync(join(FIXTURES, "manual.zh.md"), "utf8"), "zh-CN")
const TOOL = registerXlsxToolDefinition()

/** The nine header texts, including the col-I structure legend (reg2excel.py:40-50). */
const HEADERS = [
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
/** Column widths from the eCap workbook (reg2excel.py:54-64). */
const WIDTHS = [21.22, 19.78, 21, 18.44, 18.44, 37.11, 18.89, 22.78, 53.33]

/** One cell as read from sheet1.xml. */
interface Cell {
  style: number
  value: string
}

/** One parsed worksheet: rows, cell styles, row heights and column widths. */
interface Sheet {
  rows: Map<number, Map<number, Cell>>
  rowHeights: Map<number, number>
  cols: Map<number, number>
  dimension: string
  xml: string
}

/** One font entry from styles.xml. */
interface Font {
  bold: boolean
  size: number
  name: string
  charset: number | null
}

/** One xf (cell format) entry from styles.xml. */
interface Xf {
  fontId: number
  fillId: number
  borderId: number
  wrap: boolean
  horizontal: string | null
  vertical: string | null
}

/** The style table a sheet's `s` indexes point into. */
interface Styles {
  fonts: Font[]
  fills: (string | null)[]
  borders: string[][]
  xfs: Xf[]
}

/** Read one part out of an xlsx byte array, failing loudly when it is absent. */
function partOf(bytes: Uint8Array, name: string): string {
  const data = readZip(bytes).get(name)
  if (data === undefined) throw new Error("missing xlsx part: " + name)
  return new TextDecoder().decode(data)
}

/** Decode the five XML entities the writer emits. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** A..I -> 1..9 (the writer never emits past I). */
function columnIndex(letters: string): number {
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index
}

/** Parse sheet1.xml: rows, cells, row heights, column widths and the dimension ref. */
function parseSheet(xml: string): Sheet {
  const rows = new Map<number, Map<number, Cell>>()
  const rowHeights = new Map<number, number>()
  for (const rowMatch of xml.matchAll(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1])
    const height = /ht="([^"]+)"/.exec(rowMatch[2])
    if (height !== null) rowHeights.set(rowNumber, Number(height[1]))
    const cells = new Map<number, Cell>()
    for (const cellMatch of rowMatch[3].matchAll(/<c r="([A-Z]+)(\d+)" s="(\d+)"(?: t="[^"]*")?(?:\/>|><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>)/g)) {
      cells.set(columnIndex(cellMatch[1]), { style: Number(cellMatch[3]), value: decodeEntities(cellMatch[4] ?? "") })
    }
    rows.set(rowNumber, cells)
  }
  const cols = new Map<number, number>()
  for (const colMatch of xml.matchAll(/<col min="(\d+)" max="(\d+)" width="([^"]+)"/g)) {
    cols.set(Number(colMatch[1]), Number(colMatch[3]))
  }
  const dimension = /<dimension ref="([^"]+)"\/>/.exec(xml)?.[1] ?? ""
  return { rows, rowHeights, cols, dimension, xml }
}

/** The inner XML of the first `<tag ...>` block. */
function blockOf(xml: string, tag: string): string {
  const match = new RegExp("<" + tag + "(?: [^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(xml)
  if (match === null) throw new Error("missing styles block: " + tag)
  return match[1]
}

/** Parse styles.xml into fonts, fills, borders and xfs. */
function parseStyles(xml: string): Styles {
  const fonts = [...blockOf(xml, "fonts").matchAll(/<font>([\s\S]*?)<\/font>/g)].map((match) => {
    const body = match[1]
    const charset = /<charset val="(\d+)"\/>/.exec(body)?.[1]
    return {
      bold: /<b\/>/.test(body),
      size: Number(/<sz val="([^"]+)"\/>/.exec(body)?.[1] ?? "0"),
      name: /<name val="([^"]+)"\/>/.exec(body)?.[1] ?? "",
      charset: charset === undefined ? null : Number(charset),
    }
  })
  const fills = [...blockOf(xml, "fills").matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((match) =>
    /patternType="solid"/.test(match[1]) ? (/<fgColor rgb="([^"]+)"\/>/.exec(match[1])?.[1] ?? null) : null,
  )
  const borders = [...blockOf(xml, "borders").matchAll(/<border>([\s\S]*?)<\/border>/g)].map((match) =>
    ["left", "right", "top", "bottom"].map((edge) => new RegExp("<" + edge + ' style="([^"]+)"').exec(match[1])?.[1] ?? ""),
  )
  const xfs = [...blockOf(xml, "cellXfs").matchAll(/<xf ([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map((match) => {
    const attributes = match[1]
    const body = match[2] ?? ""
    const attribute = (name: string): string | null => new RegExp(name + '="([^"]*)"').exec(attributes)?.[1] ?? null
    const alignment = (name: string): string | null => new RegExp(name + '="([^"]*)"').exec(body)?.[1] ?? null
    return {
      fontId: Number(attribute("fontId") ?? "0"),
      fillId: Number(attribute("fillId") ?? "0"),
      borderId: Number(attribute("borderId") ?? "0"),
      wrap: alignment("wrapText") === "1",
      horizontal: alignment("horizontal"),
      vertical: alignment("vertical"),
    }
  })
  return { fonts, fills, borders, xfs }
}

/** The resolved style of one cell (font, fill colour, border edges, alignment). */
function styleOf(sheet: Sheet, styles: Styles, row: number, column: number): { cell: Cell; font: Font; fill: string | null; border: string[]; xf: Xf } {
  const cell = sheet.rows.get(row)?.get(column)
  if (cell === undefined) throw new Error("missing cell at row " + row + " column " + column)
  const xf = styles.xfs[cell.style]
  if (xf === undefined) throw new Error("unknown cell style " + cell.style)
  const font = styles.fonts[xf.fontId]
  if (font === undefined) throw new Error("unknown font " + xf.fontId)
  return { cell, font, fill: styles.fills[xf.fillId] ?? null, border: styles.borders[xf.borderId] ?? [], xf }
}

/** One register block: its Reg row and the field rows that follow it. */
interface Block {
  row: number
  fields: number[]
}

/** Group data rows into Reg rows (non-empty column A) and their field rows. */
function blocksOf(sheet: Sheet): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  for (const rowNumber of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    if (rowNumber === 1) continue
    const name = sheet.rows.get(rowNumber)?.get(1)?.value ?? ""
    if (name !== "") {
      current = { row: rowNumber, fields: [] }
      blocks.push(current)
    } else if (current !== null) {
      current.fields.push(rowNumber)
    }
  }
  return blocks
}

/** Parse a `[hi:lo]` or `[N]` field offset. */
function parseFieldOffset(text: string): { hi: number; lo: number } {
  const match = /^\[(\d+)(?::(\d+))?\]$/.exec(text)
  if (match === null) throw new Error("not a field offset: " + text)
  const hi = Number(match[1])
  return { hi, lo: match[2] === undefined ? hi : Number(match[2]) }
}

/** eCap's CJK range (reg2excel.py:101-105), used to check the per-cell font choice. */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/

describe("xlsx workbook V1-V5", () => {
  const bytes = buildXlsx(MANUAL.registers, { ip: "timer" })
  const sheetXml = partOf(bytes, "xl/worksheets/sheet1.xml")
  const sheet = parseSheet(sheetXml)
  const styles = parseStyles(partOf(bytes, "xl/styles.xml"))

  test("V1: Sheet1 plus the nine header cells are readable from the zip", () => {
    expect(partOf(bytes, "xl/workbook.xml")).toContain('name="Sheet1"')
    expect(partOf(bytes, "xl/workbook.xml").match(/<sheet /g)?.length).toBe(1)
    expect([...sheet.rows.get(1)!.values()].map((cell) => cell.value)).toEqual(HEADERS)
    // Inline strings only: no sharedStrings part, and every non-empty cell is t="inlineStr".
    expect(readZip(bytes).has("xl/sharedStrings.xml")).toBe(false)
    expect(sheetXml).toContain('t="inlineStr"')
    for (const name of ["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) {
      expect(readZip(bytes).has(name)).toBe(true)
    }
    expect(partOf(bytes, "[Content_Types].xml")).toContain("/xl/worksheets/sheet1.xml")
  })

  test("V1: the col-I legend keeps its line breaks and is centred", () => {
    const legend = styleOf(sheet, styles, 1, 9)
    expect(legend.cell.value).toBe('register structure = "1"\n0 : whole register\n1 : aggregated register')
    expect(legend.xf.horizontal).toBe("center")
    expect(legend.xf.vertical).toBe("center")
  })

  test("V2: rows = 1 header + R Reg rows + F field rows, 9 columns", () => {
    const fieldCount = MANUAL.registers.reduce((total, register) => total + register.fields.length, 0)
    expect(sheet.rows.size).toBe(1 + MANUAL.registers.length + fieldCount)
    expect(sheet.dimension).toBe("A1:I" + sheet.rows.size)
    for (const cells of sheet.rows.values()) {
      expect([...cells.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
    expect(blocksOf(sheet).length).toBe(MANUAL.registers.length)
  })

  test("V3: Reg rows are bold with fill FFFFFF00 and access literal Mixed", () => {
    for (const block of blocksOf(sheet)) {
      expect(styleOf(sheet, styles, block.row, 4).cell.value).toBe("Mixed")
      for (let column = 1; column <= 9; column++) {
        const style = styleOf(sheet, styles, block.row, column)
        expect(style.font.bold).toBe(true)
        expect(style.fill).toBe("FFFFFF00")
      }
    }
  })

  test("V3: field rows are not bold and carry no fill", () => {
    for (const block of blocksOf(sheet)) {
      for (const row of block.fields) {
        for (let column = 1; column <= 9; column++) {
          const style = styleOf(sheet, styles, row, column)
          expect(style.font.bold).toBe(false)
          expect(style.fill).toBeNull()
        }
      }
    }
  })

  test("V4: field offsets are bracketed, strictly descending and cover 0xFFFFFFFF", () => {
    for (const [index, block] of blocksOf(sheet).entries()) {
      const register = MANUAL.registers[index]
      let union = 0
      let previousLo = 32
      expect(block.fields.length).toBe(register.fields.length)
      for (const [fieldIndex, row] of block.fields.entries()) {
        const range = parseFieldOffset(sheet.rows.get(row)!.get(2)!.value)
        expect(range.hi).toBeLessThan(previousLo)
        previousLo = range.lo
        expect(range.hi).toBeGreaterThanOrEqual(range.lo)
        expect([range.hi, range.lo]).toEqual([register.fields[fieldIndex].hi, register.fields[fieldIndex].lo])
        const width = range.hi - range.lo + 1
        union = (union | ((width === 32 ? 0xffffffff : ((1 << width) - 1) << range.lo) >>> 0)) >>> 0
      }
      expect(union).toBe(0xffffffff)
    }
  })

  test("V4: RESERVED rows have an empty access and the canonical description", () => {
    let reservedRows = 0
    for (const block of blocksOf(sheet)) {
      for (const row of block.fields) {
        const cells = sheet.rows.get(row)!
        if (cells.get(3)!.value !== "RESERVED") {
          expect(cells.get(4)!.value).toMatch(/^[A-Z0-9]+$/)
          continue
        }
        reservedRows++
        expect(cells.get(4)!.value).toBe("")
        expect(cells.get(6)!.value).toBe("保留，必须保持复位值")
      }
    }
    expect(reservedRows).toBeGreaterThan(0)
  })

  test("V4: reset literals are uppercase, sized to the field and derived from the register reset", () => {
    for (const [index, block] of blocksOf(sheet).entries()) {
      const register = MANUAL.registers[index]
      expect(sheet.rows.get(block.row)!.get(5)!.value).toBe(register.reset)
      const reset = Number.parseInt(register.reset.slice(2), 16)
      for (const [fieldIndex, row] of block.fields.entries()) {
        const field = register.fields[fieldIndex]
        const literal = sheet.rows.get(row)!.get(5)!.value
        const match = /^(\d+)'h([0-9A-F]+)$/.exec(literal)
        expect(match).not.toBeNull()
        const width = Number(match![1])
        const digits = match![2]
        expect(width).toBe(field.hi - field.lo + 1)
        expect(digits.length).toBe(Math.max(1, Math.ceil(width / 4)))
        const expected = ((reset >>> field.lo) & (width >= 32 ? 0xffffffff : (1 << width) - 1)) >>> 0
        expect(Number.parseInt(digits, 16)).toBe(expected)
      }
    }
  })

  test("V5: every A..I cell has a thin border, the eCap widths and the 43.2 header height", () => {
    for (const [rowNumber, cells] of sheet.rows) {
      for (const column of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        expect(cells.has(column)).toBe(true)
        expect(styleOf(sheet, styles, rowNumber, column).border).toEqual(["thin", "thin", "thin", "thin"])
      }
    }
    expect([...sheet.cols.entries()].sort((a, b) => a[0] - b[0])).toEqual(WIDTHS.map((width, index) => [index + 1, width]))
    expect(sheet.rowHeights.get(1)).toBe(43.2)
    expect(sheet.rowHeights.size).toBe(1)
  })

  test("V5: header gray + bold, size 11, 宋体 charset 134 for CJK and Calibri elsewhere", () => {
    for (let column = 1; column <= 9; column++) {
      const header = styleOf(sheet, styles, 1, column)
      expect(header.font.bold).toBe(true)
      expect(header.fill).toBe("FFD9D9D9")
      expect(header.font.size).toBe(11)
      expect(header.font.name).toBe(CJK_RE.test(HEADERS[column - 1]) ? "宋体" : "Calibri")
    }
    expect(styleOf(sheet, styles, 1, 6).font.charset).toBe(134)
    expect(styleOf(sheet, styles, 1, 9).font.charset).toBeNull()
    for (const [rowNumber, cells] of sheet.rows) {
      for (const [column, cell] of cells) {
        const style = styleOf(sheet, styles, rowNumber, column)
        expect(style.font.size).toBe(11)
        expect(style.font.name).toBe(CJK_RE.test(cell.value) ? "宋体" : "Calibri")
        if (CJK_RE.test(cell.value)) expect(style.font.charset).toBe(134)
      }
    }
  })

  test("V5: descriptions wrap in column F only", () => {
    for (const [rowNumber] of sheet.rows) {
      expect(styleOf(sheet, styles, rowNumber, 6).xf.wrap).toBe(true)
      expect(styleOf(sheet, styles, rowNumber, 1).xf.wrap).toBe(false)
    }
  })

  test("V10: two builds over the same registers are byte-identical", () => {
    const again = buildXlsx(MANUAL.registers, { ip: "timer" })
    expect(again.length).toBe(bytes.length)
    expect(Buffer.compare(Buffer.from(again), Buffer.from(bytes))).toBe(0)
  })
})

describe("registerXlsxToolDefinition", () => {
  test("name, object-rooted parameters and output schema", () => {
    expect(TOOL.name).toBe("mpd_docgen_register_xlsx")
    expect(TOOL.parameters?.type).toBe("object")
    expect(TOOL.parameters?.required).toEqual(["input"])
    expect(Object.keys(TOOL.parameters?.properties ?? {}).sort()).toEqual(["input", "ip", "output"])
    const schema = TOOL.output?.schema as { properties?: Record<string, unknown> } | undefined
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(["bytes", "error", "fields", "ok", "output", "registers", "sha256"])
    expect(typeof TOOL.output?.render).toBe("function")
    expect(typeof TOOL.execute).toBe("function")
  })

  test("execute writes a real file whose sha256 and byte count match the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-docgen-xlsx-"))
    try {
      const input = join(dir, "manual.md")
      const output = join(dir, "timer_regExcel_full.xlsx")
      writeFileSync(input, readFileSync(join(FIXTURES, "manual.zh.md")))
      const result = (await TOOL.execute({ input, output, ip: "timer" }, {})) as RegisterXlsxResult
      expect(existsSync(output)).toBe(true)
      const written = readFileSync(output)
      expect(result.output).toBe(output)
      expect(result.bytes).toBe(written.length)
      expect(result.sha256).toBe(createHash("sha256").update(written).digest("hex"))
      expect(result.registers).toBe(MANUAL.registers.length)
      expect(result.fields).toBe(MANUAL.registers.reduce((total, register) => total + register.fields.length, 0))
      expect(statSync(output).mode & 0o777).toBe(0o644)
      // The written bytes are a valid workbook, not merely a file of the right size.
      expect(readZip(new Uint8Array(written)).has("xl/worksheets/sheet1.xml")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("missing input is a structured DOCGEN_E_INPUT refusal, not a throw", async () => {
    const result = (await TOOL.execute({}, {})) as { ok: false; error: { code: string; message: string; hint: string } }
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe("DOCGEN_E_INPUT")
    expect(result.error.hint.length).toBeGreaterThan(0)
  })

  test("an unreadable manual is a structured DOCGEN_E_IO refusal", async () => {
    const result = (await TOOL.execute({ input: join(tmpdir(), "definitely-missing-manual.md") }, {})) as { ok: false; error: { code: string } }
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe("DOCGEN_E_IO")
  })
})
