// T3 docx tests: the plan's structural assertions V6-V10 and V12, the zh/en label variants,
// and one real tool execution. Everything is read back out of the produced ZIP and parsed as
// XML, so the assertions observe the artifact rather than the writer's intent.
//
// The oracle cross-check with python-docx lives in the evidence log (a different
// implementation); these tests use T1's ZIP reader (CRC-verified) plus a small scanner.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildDocx } from "../src/docx.js"
import { parseManual } from "../src/markdown.js"
import { bitRangeText } from "../src/registers.js"
import { userManualDocxToolDefinition } from "../src/tool-docx.js"
import type { Field, Register, UserManualDocxResult } from "../src/types.js"
import { readZip } from "../src/zip.js"

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures")
const ZH = parseManual(readFileSync(join(FIXTURES, "manual.zh.md"), "utf8"), "zh-CN")
const EN = parseManual(readFileSync(join(FIXTURES, "manual.en.md"), "utf8"), "en")
const ZH_DOCX = buildDocx(ZH, ZH.registers, "zh-CN", { ip: "timer" })
const EN_DOCX = buildDocx(EN, EN.registers, "en", { ip: "timer" })
const TOOL = userManualDocxToolDefinition()

/** The nine parts plan §4 requires, and nothing else. */
const REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "word/_rels/document.xml.rels",
  "word/document.xml",
  "word/fontTable.xml",
  "word/settings.xml",
  "word/styles.xml",
].sort()

/** The eCap interface mapping (docs/acctypematch.md); unmapped codes stay verbatim. */
const ACCESS = { rw: "rw", ro: "r", wo: "w", w1c: "rc_w1", w0c: "rc_w0", rc: "rc_r", w1s: "rs", w1t: "t" } as const

/** One cell as observed in document.xml. */
interface CellFact {
  text: string
  span: number
  width: number
  fill: string | null
  vertical: boolean
  vMerge: "restart" | "continue" | null
}

/** Read one part out of a docx byte array, failing loudly when it is absent. */
function part(bytes: Uint8Array, name: string): string {
  const data = readZip(bytes).get(name)
  if (data === undefined) throw new Error("missing docx part: " + name)
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

/** Concatenated `w:t` text of an XML fragment. */
function textOf(xml: string): string {
  let out = ""
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) out += decodeEntities(match[1])
  return out
}

/** Every `<tag>...</tag>` block of a non-nested element (`w:p`, `w:tbl`, `w:tr`, `w:tc`). */
function blocksOf(xml: string, tag: string): string[] {
  const blocks: string[] = []
  const open = "<" + tag + ">"
  const close = "</" + tag + ">"
  let index = 0
  for (;;) {
    const start = xml.indexOf(open, index)
    if (start < 0) return blocks
    const end = xml.indexOf(close, start)
    if (end < 0) throw new Error("unclosed " + tag)
    blocks.push(xml.slice(start + open.length, end))
    index = end + close.length
  }
}

/** One paragraph: its pStyle and its text. */
interface Para {
  style: string | null
  text: string
}

/** All paragraphs of a document (body-level and table-cell paragraphs). */
function paragraphs(xml: string): Para[] {
  return blocksOf(xml, "w:p").map((paragraph) => ({
    style: /<w:pStyle w:val="([^"]+)"\/>/.exec(paragraph)?.[1] ?? null,
    text: textOf(paragraph),
  }))
}

/** The explicit table grid in twips. */
function gridOf(table: string): number[] {
  const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(table)?.[1] ?? ""
  return [...grid.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]))
}

/** The rows of one table. */
function rowsOf(table: string): string[] {
  return blocksOf(table, "w:tr")
}

/** The cells of one row. */
function cellsOf(row: string): string[] {
  return blocksOf(row, "w:tc")
}

/** The facts one cell carries. */
function cellFact(cell: string): CellFact {
  const tcPr = /<w:tcPr>([\s\S]*?)<\/w:tcPr>/.exec(cell)?.[1] ?? ""
  return {
    text: textOf(cell),
    span: Number(/<w:gridSpan w:val="(\d+)"\/>/.exec(tcPr)?.[1] ?? 1),
    width: Number(/<w:tcW w:w="(\d+)" w:type="dxa"\/>/.exec(tcPr)?.[1] ?? 0),
    fill: /<w:shd [^>]*w:fill="([^"]+)"\/>/.exec(tcPr)?.[1] ?? null,
    vertical: tcPr.includes('<w:textDirection w:val="btLr"/>'),
    vMerge: /<w:vMerge w:val="restart"\/>/.test(tcPr) ? "restart" : /<w:vMerge\/>/.test(tcPr) ? "continue" : null,
  }
}

/** Exact row height, or null when the row carries no `trHeight`. */
function heightOf(row: string): number | null {
  const raw = /<w:trHeight w:hRule="exact" w:val="(\d+)"\/>/.exec(row)?.[1]
  return raw === undefined ? null : Number(raw)
}

/** The tables of a document, in body order. */
function tablesOf(xml: string): string[] {
  return blocksOf(xml, "w:tbl")
}

/** The overview table: the one whose first header cell reads `Offset`. */
function overviewOf(xml: string): string {
  const table = tablesOf(xml).find((candidate) => textOf(cellsOf(rowsOf(candidate)[0])[0]) === "Offset")
  if (table === undefined) throw new Error("overview table not found")
  return table
}

/** Bit tables: six rows over the 16-column bit grid. */
function bitTablesOf(xml: string): string[] {
  return tablesOf(xml).filter((table) => rowsOf(table).length === 6 && gridOf(table).length === 16)
}

/** Detail tables: the 830/1659/5807 grid. */
function detailTablesOf(xml: string): string[] {
  return tablesOf(xml).filter((table) => gridOf(table).join(",") === "830,1659,5807")
}

/** A field clipped to one bit half, mirroring the writer's clip. */
function clip(fields: readonly Field[], hiEdge: number, loEdge: number): { hi: number; lo: number; field: Field }[] {
  const segments: { hi: number; lo: number; field: Field }[] = []
  for (const field of fields) {
    const hi = Math.min(field.hi, hiEdge)
    const lo = Math.max(field.lo, loEdge)
    if (hi >= lo) segments.push({ hi, lo, field })
  }
  return segments
}

/** The expected overview name-row label: RESERVED bands are bare, real fields use the eCap form. */
function labelOf(field: Field): string {
  if (field.reserved) return "RESERVED"
  const width = field.hi - field.lo + 1
  return width === 32 || width === 1 ? field.name : field.name + "[" + field.hi + ":" + field.lo + "]"
}

/** The expected access text of one segment. */
function accessOf(field: Field): string {
  if (field.reserved) return ""
  return ACCESS[field.access.toLowerCase() as keyof typeof ACCESS] ?? field.access
}

describe("V6 package", () => {
  test("the nine required parts are present and the archive passes CRC", () => {
    const names = [...readZip(ZH_DOCX).keys()].sort()
    expect(names).toEqual(REQUIRED_PARTS)
  })

  test("content types declare every XML part", () => {
    const types = part(ZH_DOCX, "[Content_Types].xml")
    for (const name of ["docProps/app.xml", "docProps/core.xml", "word/document.xml", "word/fontTable.xml", "word/settings.xml", "word/styles.xml"]) {
      expect(types).toContain('PartName="/' + name + '"')
    }
    expect(types).toContain('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>')
    expect(types).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
  })

  test("every relationship target exists inside the package", () => {
    const names = new Set(readZip(ZH_DOCX).keys())
    for (const target of [...part(ZH_DOCX, "_rels/.rels").matchAll(/Target="([^"]+)"/g)]) {
      expect(names.has(target[1])).toBe(true)
    }
    for (const target of [...part(ZH_DOCX, "word/_rels/document.xml.rels").matchAll(/Target="([^"]+)"/g)]) {
      expect(names.has("word/" + target[1])).toBe(true)
    }
  })

  test("document.xml ends with exactly one body-level sectPr (A4 portrait)", () => {
    const xml = part(ZH_DOCX, "word/document.xml")
    expect(xml.match(/<w:sectPr/g)?.length).toBe(1)
    expect(xml.endsWith("</w:sectPr></w:body></w:document>")).toBe(true)
    expect(/<w:pgSz w:w="11906" w:h="16838"\/>/.test(xml)).toBe(true)
    // No TOC, cover page, header or footer (plan §4).
    expect(xml).not.toContain("TOC")
    expect(readZip(ZH_DOCX).has("word/header1.xml")).toBe(false)
    expect(readZip(ZH_DOCX).has("word/footer1.xml")).toBe(false)
  })

  test("core.xml carries the manual title and app.xml the producer", () => {
    expect(part(ZH_DOCX, "docProps/core.xml")).toContain("<dc:title>定时器模块</dc:title>")
    expect(part(EN_DOCX, "docProps/core.xml")).toContain("<dc:title>Timer Module</dc:title>")
    expect(part(ZH_DOCX, "docProps/app.xml")).toContain("<Application>mpd-docgen</Application>")
  })

  test("styles.xml defines the heading/table styles the document references", () => {
    const styles = part(ZH_DOCX, "word/styles.xml")
    for (const id of ["Normal", "Heading1", "Heading2", "Heading3", "RegOverview", "RegBit", "RegDetail", "RegTable"]) {
      expect(styles).toContain('w:styleId="' + id + '"')
    }
    expect(styles).toContain('<w:tblLayout w:type="fixed"/>')
    expect(styles).toContain('<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:hint="eastAsia"/>')
  })

  test("every text run carries rFonts with hint=\"eastAsia\" (Calibri or Courier New + 宋体)", () => {
    const runs = blocksOf(part(ZH_DOCX, "word/document.xml"), "w:r")
    expect(runs.length).toBeGreaterThan(50)
    for (const run of runs) {
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? ""
      expect(/<w:rFonts w:ascii="(?:Calibri|Courier New)" w:hAnsi="(?:Calibri|Courier New)" w:eastAsia="宋体" w:hint="eastAsia"\/>/.test(rPr)).toBe(true)
    }
  })
})

describe("V7 register chapter", () => {
  test("the register H2 is the last H2 and one H3 chapter exists per register", () => {
    const paras = paragraphs(part(ZH_DOCX, "word/document.xml"))
    const h2 = paras.filter((paragraph) => paragraph.style === "Heading2")
    expect(h2[0].text).toBe("概述")
    expect(h2[h2.length - 1].text).toBe("寄存器")
    expect(h2.length).toBe(2)
    const h3 = paras.filter((paragraph) => paragraph.style === "Heading3")
    expect(h3.map((paragraph) => paragraph.text)).toEqual(ZH.registers.map((register) => register.title + "（" + register.name + "）"))
    expect(paras.filter((paragraph) => paragraph.style === "Heading1").map((paragraph) => paragraph.text)).toEqual([ZH.title])
  })

  test("the English variant uses the English chapter title and H3 form", () => {
    const paras = paragraphs(part(EN_DOCX, "word/document.xml"))
    const h2 = paras.filter((paragraph) => paragraph.style === "Heading2")
    expect(h2[h2.length - 1].text).toBe("Registers")
    expect(paras.filter((paragraph) => paragraph.style === "Heading3").map((paragraph) => paragraph.text)).toEqual(
      EN.registers.map((register) => register.title + " (" + register.name + ")"),
    )
  })

  test("each chapter carries its offset and reset lines in the manual language", () => {
    const zh = paragraphs(part(ZH_DOCX, "word/document.xml")).map((paragraph) => paragraph.text)
    for (const register of ZH.registers) {
      expect(zh).toContain("地址偏移：" + register.offset)
      expect(zh).toContain("复位值：" + register.reset)
    }
    const en = paragraphs(part(EN_DOCX, "word/document.xml")).map((paragraph) => paragraph.text)
    for (const register of EN.registers) {
      expect(en).toContain("Offset: " + register.offset)
      expect(en).toContain("Reset value: " + register.reset)
    }
  })

  test("each chapter follows the fixed element order: H3, offset, reset, bit table, empty p, detail table, empty p", () => {
    const xml = part(ZH_DOCX, "word/document.xml")
    const body = /<w:body>([\s\S]*?)<w:sectPr>/.exec(xml)?.[1] ?? ""
    const ordered = [...body.matchAll(/<w:pStyle w:val="(Heading3)"\/>|<w:tbl>|<w:p\/>/g)].map((match) => match[0])
    const expected = ZH.registers.flatMap(() => ['<w:pStyle w:val="Heading3"/>', "<w:tbl>", "<w:p/>", "<w:tbl>", "<w:p/>"])
    // The document also has body-level blocks before the chapter; compare the chapter tail.
    expect(ordered.slice(ordered.length - expected.length)).toEqual(expected)
  })
})

describe("V8 overview table", () => {
  test("header is Offset | Register | 31..0 and there are exactly two rows per register", () => {
    const rows = rowsOf(overviewOf(part(ZH_DOCX, "word/document.xml")))
    expect(rows.length).toBe(1 + 2 * ZH.registers.length)
    const header = cellsOf(rows[0]).map(cellFact)
    expect(header.map((cell) => cell.text)).toEqual(["Offset", "Register", "31..0"])
    expect(header.map((cell) => cell.span)).toEqual([1, 1, 32])
    expect(heightOf(rows[0])).toBe(278)
    expect(gridOf(overviewOf(part(ZH_DOCX, "word/document.xml")))).toEqual([499, 1162, ...new Array(11).fill(208), ...new Array(21).fill(207)])
  })

  test("name rows are 902 twips with gridSpan labels, gray RESERVED bands and btLr single bits", () => {
    const rows = rowsOf(overviewOf(part(ZH_DOCX, "word/document.xml")))
    ZH.registers.forEach((register, index) => {
      const nameRow = rows[1 + index * 2]
      expect(heightOf(nameRow)).toBe(902)
      const cells = cellsOf(nameRow).map(cellFact)
      expect(cells.reduce((total, cell) => total + cell.span, 0)).toBe(34)
      expect(cells[0].text).toBe(register.offset)
      expect(cells[1].text).toBe(register.name)
      register.fields.forEach((field, fieldIndex) => {
        const cell = cells[2 + fieldIndex]
        const width = field.hi - field.lo + 1
        expect(cell.span).toBe(width)
        expect(cell.text).toBe(labelOf(field))
        if (field.reserved) {
          expect(cell.text).toBe("RESERVED")
          expect(cell.fill).toBe("D9D9D9")
          expect(cell.vertical).toBe(true)
          expect(cell.vMerge).toBe("restart")
        } else if (width === 1) {
          expect(cell.vertical).toBe(true)
          expect(cell.fill).toBeNull()
          expect(cell.vMerge).toBeNull()
        } else {
          expect(cell.vertical).toBe(false)
          expect(cell.fill).toBeNull()
        }
      })
    })
  })

  test("reset rows are 278 twips with Reset value and one 1/0 cell per bit, RESERVED spans empty", () => {
    const rows = rowsOf(overviewOf(part(ZH_DOCX, "word/document.xml")))
    ZH.registers.forEach((register, index) => {
      const resetRow = rows[2 + index * 2]
      expect(heightOf(resetRow)).toBe(278)
      const cells = cellsOf(resetRow).map(cellFact)
      expect(cells.reduce((total, cell) => total + cell.span, 0)).toBe(34)
      expect(cells[0].text).toBe("")
      expect(cells[1].text).toBe("Reset value")
      const value = parseInt(register.reset.slice(2), 16)
      let cursor = 2
      for (const field of register.fields) {
        if (field.reserved) {
          expect(cells[cursor].span).toBe(field.hi - field.lo + 1)
          expect(cells[cursor].text).toBe("")
          cursor += 1
          continue
        }
        for (let bit = field.hi; bit >= field.lo; bit--) {
          expect(cells[cursor].span).toBe(1)
          expect(cells[cursor].text).toBe(((value >>> bit) & 1) === 1 ? "1" : "0")
          cursor += 1
        }
      }
      expect(cursor).toBe(cells.length)
    })
  })

  test("the TSCTR reset bits are 0x00001020 rendered per bit", () => {
    const register = ZH.registers.find((candidate) => candidate.name === "TSCTR") as Register
    const rows = rowsOf(overviewOf(part(ZH_DOCX, "word/document.xml")))
    const cells = cellsOf(rows[2 + ZH.registers.indexOf(register) * 2]).map(cellFact)
    const bits: string[] = []
    let cursor = 2
    for (const field of register.fields) {
      if (field.reserved) {
        cursor += 1
        continue
      }
      for (let bit = field.hi; bit >= field.lo; bit--) {
        bits.push(cells[cursor].text)
        cursor += 1
      }
    }
    // Only non-reserved bits get cells: bits 15..8, 6..2, 1, 0 (bit 7 is the RESERVED span).
    expect(bits.join("")).toBe("000100000100000")
  })
})

describe("V9 bit and detail tables", () => {
  test("one 6x16 bit table per register with the eCap grid and trHeight 420 field rows", () => {
    const xml = part(ZH_DOCX, "word/document.xml")
    const bitTables = bitTablesOf(xml)
    expect(bitTables.length).toBe(ZH.registers.length)
    ZH.registers.forEach((register, index) => {
      const table = bitTables[index]
      expect(gridOf(table)).toEqual([520, 520, ...new Array(14).fill(519)])
      const rows = rowsOf(table)
      expect(rows.length).toBe(6)
      expect(cellsOf(rows[0]).map((cell) => cellFact(cell).text)).toEqual(Array.from({ length: 16 }, (_, offset) => String(31 - offset)))
      expect(cellsOf(rows[3]).map((cell) => cellFact(cell).text)).toEqual(Array.from({ length: 16 }, (_, offset) => String(15 - offset)))
      expect(heightOf(rows[1])).toBe(420)
      expect(heightOf(rows[4])).toBe(420)
      expect(heightOf(rows[2])).toBeNull()
      expect(heightOf(rows[5])).toBeNull()
      for (const row of [rows[1], rows[2], rows[4], rows[5]]) {
        expect(cellsOf(row).map(cellFact).reduce((total, cell) => total + cell.span, 0)).toBe(16)
      }
      const upper = clip(register.fields, 31, 16)
      const lower = clip(register.fields, 15, 0)
      expect(cellsOf(rows[1]).map((cell) => cellFact(cell).text)).toEqual(upper.map((segment) => segment.field.name))
      expect(cellsOf(rows[2]).map((cell) => cellFact(cell).text)).toEqual(upper.map((segment) => accessOf(segment.field)))
      expect(cellsOf(rows[4]).map((cell) => cellFact(cell).text)).toEqual(lower.map((segment) => segment.field.name))
      expect(cellsOf(rows[5]).map((cell) => cellFact(cell).text)).toEqual(lower.map((segment) => accessOf(segment.field)))
    })
  })

  test("each bit table's field cells specify gridSpan, tcW and the eCap access mapping", () => {
    const xml = part(ZH_DOCX, "word/document.xml")
    const table = bitTablesOf(xml)[0]
    const rows = rowsOf(table)
    const cells = cellsOf(rows[5]).map(cellFact)
    const segments = clip(ZH.registers[0].fields, 15, 0)
    cells.forEach((cell, index) => {
      expect(cell.span).toBe(segments[index].hi - segments[index].lo + 1)
      // tcW is the sum of the clipped grid columns; every cell carries a positive width.
      expect(cell.width).toBeGreaterThan(0)
    })
    expect(cells.map((cell) => cell.text)).toEqual(["rw", "", "rw", "rc_w1", "rw"])
  })

  test("all eight eCap access pairs are mapped and an unmapped code is verbatim", () => {
    const text = [
      "# Access map",
      "",
      "## Registers",
      "",
      "### Map register(MAPREG)",
      "",
      "Offset: 0x00",
      "",
      "Reset value: 0x0000 0000",
      "",
      "| Bits | Name | Access | Description |",
      "|---|---|---|---|",
      "| 31:28 | A | rw | a |",
      "| 27:24 | B | ro | b |",
      "| 23:20 | C | wo | c |",
      "| 19:16 | D | w1c | d |",
      "| 15:12 | E | w0c | e |",
      "| 11:8 | F | rc | f |",
      "| 7:4 | G | w1s | g |",
      "| 3:1 | H | w1t | h |",
      "| 0 | I | w1src | i |",
      "",
    ].join("\n")
    const manual = parseManual(text, "en")
    const table = bitTablesOf(part(buildDocx(manual, manual.registers, "en", { ip: "map" }), "word/document.xml"))[0]
    const rows = rowsOf(table)
    const upper = cellsOf(rows[2]).map((cell) => cellFact(cell).text)
    const lower = cellsOf(rows[5]).map((cell) => cellFact(cell).text)
    expect([...upper, ...lower]).toEqual(["rw", "r", "w", "rc_w1", "rc_w0", "rc_r", "rs", "t", "w1src"])
  })

  test("one detail table per register: 830/1659/5807 grid, headers, one row per field, descriptions split per line", () => {
    const xml = part(ZH_DOCX, "word/document.xml")
    const detailTables = detailTablesOf(xml)
    expect(detailTables.length).toBe(ZH.registers.length)
    ZH.registers.forEach((register, index) => {
      const rows = rowsOf(detailTables[index])
      expect(gridOf(detailTables[index])).toEqual([830, 1659, 5807])
      expect(rows.length).toBe(1 + register.fields.length)
      expect(cellsOf(rows[0]).map((cell) => cellFact(cell).text)).toEqual(["位域", "名称", "描述"])
      register.fields.forEach((field, fieldIndex) => {
        const cells = cellsOf(rows[1 + fieldIndex])
        expect(textOf(cells[0])).toBe(bitRangeText(field))
        expect(textOf(cells[1])).toBe(field.name)
        expect(textOf(cells[2])).toBe(field.desc.replace(/\n/g, ""))
        expect(blocksOf(cells[2], "w:p").length).toBe(field.desc.split("\n").length)
      })
    })
  })

  test("the English detail headers are Bit field | Name | Description", () => {
    const rows = rowsOf(detailTablesOf(part(EN_DOCX, "word/document.xml"))[0])
    expect(cellsOf(rows[0]).map((cell) => cellFact(cell).text)).toEqual(["Bit field", "Name", "Description"])
  })
})

describe("V10 determinism", () => {
  test("two builds of the same model are byte-identical", () => {
    const again = buildDocx(ZH, ZH.registers, "zh-CN", { ip: "timer" })
    expect(Buffer.compare(Buffer.from(ZH_DOCX), Buffer.from(again))).toBe(0)
    expect(createHash("sha256").update(again).digest("hex")).toBe(createHash("sha256").update(ZH_DOCX).digest("hex"))
  })

  test("the English build is likewise byte-identical", () => {
    const again = buildDocx(EN, EN.registers, "en", { ip: "timer" })
    expect(Buffer.compare(Buffer.from(EN_DOCX), Buffer.from(again))).toBe(0)
  })
})

describe("V12 no template placeholders", () => {
  test("the fixture manuals produce no placeholder text", () => {
    for (const bytes of [ZH_DOCX, EN_DOCX]) {
      const xml = part(bytes, "word/document.xml")
      for (const placeholder of ["<寄存器名>", "<REG_NAME>", "<IP名称>"]) expect(xml).not.toContain(placeholder)
      expect(xml).not.toContain("not implemented")
    }
  })

  test("the shipped template shape parses and renders without leaving its placeholders", () => {
    const template = parseManual(readFileSync(join(FIXTURES, "template-shape.md"), "utf8"), "zh-CN")
    expect(template.registers.map((register) => register.name)).toEqual(["TSCTR", "CTRL", "STATUS"])
    const xml = part(buildDocx(template, template.registers, "zh-CN", { ip: "ip" }), "word/document.xml")
    for (const placeholder of ["<寄存器名>", "<REG_NAME>", "<IP名称>"]) expect(xml).not.toContain(placeholder)
    expect(rowsOf(overviewOf(xml)).length).toBe(1 + 2 * template.registers.length)
  })
})

describe("body blocks and labels", () => {
  test("markdown tables become real Word tables with a header row", () => {
    const tables = tablesOf(part(ZH_DOCX, "word/document.xml"))
    const bodyTable = tables[0]
    expect(gridOf(bodyTable).length).toBe(4)
    const rows = rowsOf(bodyTable)
    expect(rows.length).toBe(3)
    expect(cellsOf(rows[0]).map((cell) => cellFact(cell).text)).toEqual(["参数", "最小值", "最大值", "单位"])
    expect(rows[0]).toContain("<w:b/>")
    expect(rows[1]).not.toContain("<w:b/>")
    expect(rows[2]).not.toContain("<w:b/>")
  })

  test("bullet lists, fenced code and inline bold render as runs", () => {
    const xml = part(ZH_DOCX, "word/document.xml")
    const paras = paragraphs(xml)
    const list = paras.filter((paragraph) => paragraph.style === "ListParagraph")
    expect(list.length).toBe(3)
    expect(list.every((paragraph) => paragraph.text.startsWith("• "))).toBe(true)
    const code = paras.filter((paragraph) => paragraph.style === "Code")
    expect(code.map((paragraph) => paragraph.text)).toEqual(["TIMER_CLK = SYSCLK / (DIV + 1)", "TIMER_EN  = START"])
    expect(xml).toContain('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="宋体" w:hint="eastAsia"/>')

    const boldText = "# 粗体\n\n**加粗**与普通文本。\n"
    const boldManual = parseManual(boldText, "zh-CN")
    const boldXml = part(buildDocx(boldManual, boldManual.registers, "zh-CN", { ip: "bold" }), "word/document.xml")
    expect(boldXml).toContain("<w:b/><w:bCs/>")
    expect(boldXml).toContain('<w:t xml:space="preserve">加粗</w:t>')
    expect(boldXml).toContain('<w:t xml:space="preserve">与普通文本。</w:t>')
  })

  test("zh and en label variants are distinct where the plan requires it", () => {
    const zh = part(ZH_DOCX, "word/document.xml")
    const en = part(EN_DOCX, "word/document.xml")
    expect(zh).toContain("寄存器")
    expect(zh).toContain("地址偏移：0x00")
    expect(zh).toContain("复位值：0x00001020")
    expect(en).toContain("Registers")
    expect(en).toContain("Offset: 0x00")
    expect(en).toContain("Reset value: 0x00001020")
    // Overview headers stay English in both languages (plan §4).
    for (const xml of [zh, en]) {
      const header = cellsOf(rowsOf(overviewOf(xml))[0]).map((cell) => cellFact(cell).text)
      expect(header).toEqual(["Offset", "Register", "31..0"])
    }
  })
})

describe("tool definition", () => {
  test("name, parameters and output contract match the plan", () => {
    expect(TOOL.name).toBe("mpd_docgen_user_manual_docx")
    expect(TOOL.description.length).toBeGreaterThan(20)
    const params = TOOL.parameters as {
      type?: string
      properties?: Record<string, { enum?: readonly string[] }>
      required?: readonly string[]
    }
    expect(params.type).toBe("object")
    expect(params.required).toEqual(["input", "lang"])
    expect(Object.keys(params.properties ?? {}).sort()).toEqual(["input", "ip", "lang", "output"])
    expect(params.properties?.["lang"]?.enum).toEqual(["zh-CN", "en"])
    const schema = TOOL.output?.schema as { properties?: Record<string, unknown> } | undefined
    for (const key of ["output", "lang", "registers", "tables", "headings", "bytes", "sha256"]) {
      expect(schema?.properties).toHaveProperty(key)
    }
    expect(typeof TOOL.output?.render).toBe("function")
    expect(typeof TOOL.execute).toBe("function")
  })
})

describe("execute", () => {
  test("writes a real docx whose counts, byte length and sha256 match the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-docgen-docx-"))
    try {
      const input = join(dir, "manual.md")
      const output = join(dir, "timer_reg_user_manual.zh-CN.docx")
      writeFileSync(input, readFileSync(join(FIXTURES, "manual.zh.md")))
      const result = (await TOOL.execute({ input, output, lang: "zh-CN", ip: "timer" }, {})) as UserManualDocxResult
      expect(existsSync(output)).toBe(true)
      const written = readFileSync(output)
      expect(result.output).toBe(output)
      expect(result.lang).toBe("zh-CN")
      expect(result.bytes).toBe(written.length)
      expect(result.sha256).toBe(createHash("sha256").update(written).digest("hex"))
      expect(result.registers).toBe(ZH.registers.length)
      expect(result.tables).toBe(1 + ZH.registers.length * 2 + ZH.blocks.filter((block) => block.kind === "table").length)
      expect(result.headings).toBe(1 + ZH.blocks.filter((block) => block.kind === "heading").length + 1 + ZH.registers.length)
      expect(statSync(output).mode & 0o777).toBe(0o644)
      // The written bytes are the model's deterministic build, and a valid package.
      expect(createHash("sha256").update(buildDocx(ZH, ZH.registers, "zh-CN", { ip: "timer" })).digest("hex")).toBe(result.sha256)
      expect(readZip(new Uint8Array(written)).has("word/document.xml")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a missing or unsupported lang is a structured DOCGEN_E_INPUT refusal", async () => {
    const missing = (await TOOL.execute({ input: "x" }, {})) as { ok: false; error: { code: string } }
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe("DOCGEN_E_INPUT")
    const unsupported = (await TOOL.execute({ input: "x", lang: "fr" }, {})) as { ok: false; error: { code: string } }
    expect(unsupported.ok).toBe(false)
    expect(unsupported.error.code).toBe("DOCGEN_E_INPUT")
  })

  test("an unreadable manual is a structured DOCGEN_E_IO refusal", async () => {
    const result = (await TOOL.execute({ input: join(tmpdir(), "definitely-missing-manual.md"), lang: "zh-CN" }, {})) as {
      ok: false
      error: { code: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe("DOCGEN_E_IO")
  })

  test("a manual without a register chapter is a structured DOCGEN_E_PARSE refusal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-docgen-docx-"))
    try {
      const input = join(dir, "no-registers.md")
      writeFileSync(input, "# Title\n\n## Section\n\nText only.\n")
      const result = (await TOOL.execute({ input, lang: "en" }, {})) as { ok: false; error: { code: string; hint: string } }
      expect(result.ok).toBe(false)
      expect(result.error.code).toBe("DOCGEN_E_PARSE")
      expect(result.error.hint.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
