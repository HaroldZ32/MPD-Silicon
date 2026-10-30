// T1 foundation tests: the parser (both heading forms, zh/en fixtures, gap-fill, merge,
// width detection, reset/offset normalisation), the deterministic ZIP container, the output
// naming helpers and the atomic write.
//
// The fixtures are a realistic zh/en pair with the SAME register skeleton (2 registers: one
// 32-bit with RESERVED gaps plus a single-bit and a multi-bit field, one 16-bit with only
// low bits) so the zh/en skeleton equality the run lane will enforce has a concrete case.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { apply, inject } from "../src/index.js"
import { compareSkeletons } from "../src/consistency.js"
import { parseManual } from "../src/markdown.js"
import { buildXlsx } from "../src/xlsx.js"
import { buildDocx } from "../src/docx.js"
import {
  ACCESS_CODES,
  bitRangeText,
  canonicaliseRegisters,
  fieldLabel,
  fieldResetValue,
  normaliseOffset,
  normaliseResetValue,
  offsetNumber,
  parseResetHex,
} from "../src/registers.js"
import { atomicWriteFile, docxFileName, ipSlug, regExcelFileName, resolveInputPath, workspaceRoot } from "../src/paths.js"
import { buildZip, readZip } from "../src/zip.js"
import { DocgenError, type Field, type Register } from "../src/types.js"

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures")

/** Read one fixture manual. */
function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8")
}

/** Run `fn` and return the DocgenError code it raised ("NO_ERROR"/"NOT_DOCGEN_ERROR:…" otherwise). */
function errorCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof DocgenError ? error.code : "NOT_DOCGEN_ERROR:" + String(error)
  }
  return "NO_ERROR"
}

/** The bit spans of one register, high bit first. */
function spans(register: Register): string[] {
  return register.fields.map((field) => bitRangeText(field))
}

/** A comparable skeleton: name, offset, width and field spans (the plan §5 equality). */
function skeleton(registers: readonly Register[]): string {
  return registers.map((register) => register.name + "@" + register.offset + "/" + register.width + ":" + spans(register).join(",")).join(";")
}

/** A register with the required keys and sensible defaults for a canonicalisation test. */
function rawRegister(over: Pick<Register, "name" | "offset" | "reset"> & Partial<Register>): Register {
  return { title: "", width: 32, fields: [], ...over }
}

/** A minimal single-field register body, as a manual fragment inside a register chapter. */
function manualWith(body: string): string {
  return "# T\n\n## 寄存器\n\n" + body
}

describe("fixtures", () => {
  test("zh fixture: title, two registers, merged RESERVED gap and 32-bit width", () => {
    const manual = parseManual(fixture("manual.zh.md"), "zh-CN")
    expect(manual.title).toBe("定时器模块")
    expect(manual.registers.map((register) => register.name)).toEqual(["TSCTR", "STATUS"])

    const tsctr = manual.registers[0]
    expect(tsctr.title).toBe("时间戳计数器")
    expect(tsctr.offset).toBe("0x00")
    expect(tsctr.reset).toBe("0x00001020")
    expect(tsctr.width).toBe(32)
    // [31:24] is gap-filled, [23:16] is the manual RESERVED row: the two merge into [31:16].
    expect(spans(tsctr)).toEqual(["31:16", "15:8", "7", "6:2", "1", "0"])
    expect(tsctr.fields.map((field) => field.name)).toEqual(["RESERVED", "PERIOD", "RESERVED", "DIV", "FLAG", "START"])
    expect(tsctr.fields[0]).toMatchObject({ hi: 31, lo: 16, reserved: true, access: "", desc: "保留，必须保持复位值" })
    expect(tsctr.fields[1].desc).toContain("\n0:停止")
    expect(tsctr.fields[1].access).toBe("rw")
    expect(tsctr.fields[4].access).toBe("w1c")

    const bits = tsctr.fields.reduce((sum, field) => sum + (field.hi - field.lo + 1), 0)
    expect(bits).toBe(32)
    // The overview agrees with both chapters, so there is nothing to warn about.
    expect(manual.warnings).toEqual([])
  })

  test("zh fixture: 16-bit register keeps its manual RESERVED row separate from the [31:16] gap", () => {
    const manual = parseManual(fixture("manual.zh.md"), "zh-CN")
    const status = manual.registers[1]
    expect(status.offset).toBe("0x0C")
    expect(status.reset).toBe("0x0030")
    expect(status.width).toBe(16)
    expect(spans(status)).toEqual(["31:16", "15", "14", "13:12", "11:10", "9:8", "7:0"])
    // Two RESERVED rows: the synthesized [31:16] and the manual [13:12] are NOT adjacent,
    // so the merge must leave them apart.
    expect(status.fields.filter((field) => field.reserved).map((field) => bitRangeText(field))).toEqual(["31:16", "13:12"])
    expect(status.fields.find((field) => field.name === "BUSY")?.access).toBe("ro")
    expect(status.fields.find((field) => field.name === "RC_FLAG")?.access).toBe("rc")
  })

  test("en fixture: same register skeleton, English canonical RESERVED text", () => {
    const zh = parseManual(fixture("manual.zh.md"), "zh-CN")
    const en = parseManual(fixture("manual.en.md"), "en")
    expect(en.title).toBe("Timer Module")
    expect(skeleton(en.registers)).toBe(skeleton(zh.registers))
    expect(en.registers[0].fields[0].desc).toBe("Reserved; keep the reset value")
    expect(en.registers[0].fields[1].desc).toContain("\n0: stopped")
    expect(en.registers[1].fields.find((field) => field.name === "MODE")?.access).toBe("rw")
  })

  test("blocks exclude the H1 and the register chapter but keep fences, lists and tables", () => {
    const manual = parseManual(fixture("manual.zh.md"), "zh-CN")
    const kinds = manual.blocks.map((block) => block.kind)
    expect(kinds).toContain("fence")
    expect(kinds).toContain("list")
    expect(kinds).toContain("table")
    const headings = manual.blocks.filter((block) => block.kind === "heading").map((block) => (block.kind === "heading" ? block.text : ""))
    expect(headings).toContain("概述")
    expect(headings).not.toContain("寄存器")
    expect(headings).not.toContain("时间戳计数器")
    const fence = manual.blocks.find((block) => block.kind === "fence")
    expect(fence).toBeDefined()
    if (fence?.kind === "fence") {
      expect(fence.lang).toBe("text")
      expect(fence.text).toContain("TIMER_CLK")
    }
    const table = manual.blocks.find((block) => block.kind === "table")
    expect(table).toBeDefined()
    if (table?.kind === "table") {
      expect(table.header).toEqual(["参数", "最小值", "最大值", "单位"])
      expect(table.rows.length).toBe(2)
    }
  })

  test("the shipped template's register chapter shape parses with warnings, never a throw", () => {
    // This fixture keeps the template's own example overview row (`|  000h| IP_REG0|…`), its
    // `| |Reset Value|…` row, an all-zero placeholder slot and the `<寄存器名>(<REG_NAME>)`
    // heading. A fatal overview comparison would reject the template the skill ships.
    const manual = parseManual(fixture("template-shape.md"), "zh-CN")
    expect(manual.title).toBe("IP 用户手册")
    expect(manual.registers.map((register) => register.name)).toEqual(["TSCTR", "CTRL", "STATUS"])

    // Placeholders are skipped silently: no warning names them.
    expect(manual.warnings.some((warning) => warning.includes("IP_REG0"))).toBe(false)
    expect(manual.warnings.some((warning) => warning.includes("SPARE_REG"))).toBe(false)

    // CTRL's overview row says 0x08 while its chapter says 0x0C; STATUS has no overview row.
    expect(manual.warnings.length).toBe(2)
    expect(manual.warnings.some((warning) => warning.includes("CTRL") && warning.includes("0x08") && warning.includes("0x0C"))).toBe(true)
    expect(manual.warnings.some((warning) => warning.includes("STATUS") && warning.includes("missing from the overview"))).toBe(true)
  })

  test("the shipped template's placeholder section is not parsed as a register", () => {
    const manual = parseManual(fixture("template-shape.md"), "zh-CN")
    // `### <寄存器名>(<REG_NAME>)` is a placeholder heading, not a register name.
    expect(manual.registers.some((register) => register.name.includes("<"))).toBe(false)
    expect(manual.registers.every((register) => register.fields.length > 0)).toBe(true)
  })
})

describe("heading forms", () => {
  test("canonical heading: ### 时间戳计数器(TSCTR)", () => {
    const manual = parseManual(fixture("manual.zh.md"), "zh-CN")
    expect(manual.registers[0].name).toBe("TSCTR")
    expect(manual.registers[0].title).toBe("时间戳计数器")
  })

  test("legacy heading: ### 寄存器1（TSCTR）——时间戳计数器", () => {
    const legacy = manualWith(
      "### 寄存器1（TSCTR）——时间戳计数器\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n|位域|名称|读写属性|描述|\n|--|--|--|----------|\n|31:0|TSCTR|rw|活动 32 位计数器|\n",
    )
    const manual = parseManual(legacy, "zh-CN")
    expect(manual.registers.length).toBe(1)
    expect(manual.registers[0].name).toBe("TSCTR")
    expect(manual.registers[0].title).toBe("时间戳计数器")
    expect(spans(manual.registers[0])).toEqual(["31:0"])
    expect(manual.registers[0].offset).toBe("0x00")
    expect(manual.registers[0].reset).toBe("0x00000000")
    expect(manual.registers[0].width).toBe(32)
    // The legacy heading is part of the chapter, so it must not leak into the body blocks.
    const headings = manual.blocks.filter((block) => block.kind === "heading")
    expect(headings.length).toBe(0)
  })

  test("a manual without a register chapter parses to zero registers", () => {
    const manual = parseManual("# Only Title\n\n## Intro\n\ntext\n", "en")
    expect(manual.title).toBe("Only Title")
    expect(manual.registers).toEqual([])
    expect(manual.warnings).toEqual([])
    expect(manual.blocks.length).toBe(2)
  })
})

describe("canonicalisation", () => {
  test("gap fill covers [31:0] and bit-adjacent RESERVED rows merge", () => {
    const fields: Field[] = [
      { hi: 23, lo: 16, name: "RESERVED", access: "", desc: "keep", reserved: true },
      { hi: 15, lo: 8, name: "A", access: "rw", desc: "a", reserved: false },
    ]
    const [register] = canonicaliseRegisters([rawRegister({ name: "R", offset: "0x0c", reset: "0x0030", fields })], "zh-CN")
    expect(spans(register)).toEqual(["31:16", "15:8", "7:0"])
    expect(register.fields[0].desc).toBe("保留，必须保持复位值")
    expect(register.width).toBe(16)
    expect(register.offset).toBe("0x0C")
    expect(register.reset).toBe("0x0030")
  })

  test("width is 32 for eight reset digits and 16 for four", () => {
    const wide = rawRegister({ name: "W", offset: "0x00", reset: "0x0000 1020", fields: [{ hi: 31, lo: 0, name: "V", access: "rw", desc: "", reserved: false }] })
    const narrow = rawRegister({ name: "N", offset: "0x04", reset: "0x0030", fields: [{ hi: 15, lo: 0, name: "V", access: "rw", desc: "", reserved: false }] })
    const [w, n] = canonicaliseRegisters([wide, narrow], "zh-CN")
    expect(w.width).toBe(32)
    expect(w.reset).toBe("0x00001020")
    expect(n.width).toBe(16)
    expect(n.reset).toBe("0x0030")
  })

  test("reset and offset helpers follow the eCap normalisation", () => {
    expect(parseResetHex("0x0000 1020")).toEqual({ digits: "00001020", value: 0x1020 })
    expect(parseResetHex("0x0030").value).toBe(0x30)
    expect(normaliseResetValue(0x1020, true)).toBe("0x00001020")
    expect(normaliseResetValue(0x30, false)).toBe("0x0030")
    expect(normaliseOffset("0x0c")).toBe("0x0C")
    expect(normaliseOffset("000h")).toBe("0x000")
    expect(offsetNumber("0x1A4")).toBe(420)
    expect(offsetNumber("000h")).toBe(0)
  })

  test("field formatting helpers match the writers' expectations", () => {
    expect(fieldResetValue(0x1020, 15, 8)).toBe("8'h10")
    expect(fieldResetValue(0x1020, 13, 12)).toBe("2'h1")
    expect(fieldResetValue(0x1020, 1, 1)).toBe("1'h0")
    expect(fieldLabel({ hi: 31, lo: 0, name: "X" })).toBe("X")
    expect(fieldLabel({ hi: 5, lo: 5, name: "X" })).toBe("X")
    expect(fieldLabel({ hi: 31, lo: 16, name: "X" })).toBe("X[31:16]")
    expect(bitRangeText({ hi: 5, lo: 5 })).toBe("5")
    expect(bitRangeText({ hi: 7, lo: 4 })).toBe("7:4")
  })

  test("RESERVED description is language-specific", () => {
    const [register] = canonicaliseRegisters([rawRegister({ name: "R", offset: "0x00", reset: "0x0000 0000", fields: [] })], "en")
    expect(register.fields[0].desc).toBe("Reserved; keep the reset value")
    expect(register.fields[0].access).toBe("")
  })
})

describe("access codes", () => {
  test("the strict set is the template's 25 abbreviations", () => {
    expect(ACCESS_CODES.length).toBe(25)
    for (const code of ["rw", "ro", "w1c", "rc", "w1s", "w1t", "w0c"]) expect(ACCESS_CODES).toContain(code)
  })

  test("an unknown access is refused with DOCGEN_E_ACCESS", () => {
    const bad = manualWith("### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 0 | X | rwx | x |\n")
    expect(errorCode(() => parseManual(bad, "zh-CN"))).toBe("DOCGEN_E_ACCESS")
  })

  test("a non-RESERVED field with an empty access is refused", () => {
    const bad = manualWith("### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 0 | X | | x |\n")
    expect(errorCode(() => parseManual(bad, "zh-CN"))).toBe("DOCGEN_E_ACCESS")
  })
})

describe("validation", () => {
  test("missing reset value is DOCGEN_E_PARSE", () => {
    const bad = manualWith("### R(R)\n\n偏移地址：0x00\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 0 | X | rw | x |\n")
    expect(errorCode(() => parseManual(bad, "zh-CN"))).toBe("DOCGEN_E_PARSE")
  })

  test("missing offset is DOCGEN_E_PARSE", () => {
    const bad = manualWith("### R(R)\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 0 | X | rw | x |\n")
    expect(errorCode(() => parseManual(bad, "zh-CN"))).toBe("DOCGEN_E_PARSE")
  })

  test("overlapping fields are DOCGEN_E_FIELDS", () => {
    const bad = manualWith("### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 7:0 | A | rw | a |\n| 3:0 | B | rw | b |\n")
    expect(errorCode(() => parseManual(bad, "zh-CN"))).toBe("DOCGEN_E_FIELDS")
  })

  test("a field above bit 31 is DOCGEN_E_FIELDS", () => {
    const bad = manualWith("### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 32 | X | rw | x |\n")
    expect(errorCode(() => parseManual(bad, "zh-CN"))).toBe("DOCGEN_E_FIELDS")
  })

  test("a 4-digit reset may still declare fields above bit 15 (eCap's MUNIT_*_SHD_CTL)", () => {
    const manual = manualWith("### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 31:16 | HI | rw | h |\n| 15:0 | LO | rw | l |\n")
    const register = parseManual(manual, "zh-CN").registers[0]
    expect(register.width).toBe(16)
    expect(spans(register)).toEqual(["31:16", "15:0"])
  })

  test("an overview offset disagreement is a WARNING, not an error", () => {
    const bad = manualWith(
      "### 寄存器总览\n\n| Offset | Register |\n|---|---|\n| 0x10 | R |\n\n### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 31:0 | X | rw | x |\n",
    )
    const manual = parseManual(bad, "zh-CN")
    expect(manual.registers.map((register) => register.name)).toEqual(["R"])
    expect(manual.warnings.length).toBe(1)
    expect(manual.warnings[0]).toContain("R")
    expect(manual.warnings[0]).toContain("0x10")
    expect(manual.warnings[0]).toContain("0x00")
    expect(manual.warnings[0]).toContain("disagrees")
  })

  test("an overview register without a chapter is a WARNING, not an error", () => {
    const bad = manualWith("### 寄存器总览\n\n| Offset | Register |\n|---|---|\n| 0x00 | R |\n| 0x04 | GHOST |\n\n### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 31:0 | X | rw | x |\n")
    const manual = parseManual(bad, "zh-CN")
    expect(manual.registers.map((register) => register.name)).toEqual(["R"])
    expect(manual.warnings.length).toBe(1)
    expect(manual.warnings[0]).toContain("GHOST")
    expect(manual.warnings[0]).toContain("no register chapter")
  })

  test("the template's `0NNNh` overview offset compares equal to `0xNN`", () => {
    // `000h` (template form) and `0x00` (chapter form) must not warn.
    const manual = parseManual(manualWith("### 寄存器总览\n\n|Offset|Register|31|0|\n|---|---|---|---|\n|  000h| R|R| |\n\n### R(R)\n\n偏移地址：0x00\n\n复位值：0x0000 0000\n\n| 位域 | 名称 | 读写属性 | 描述 |\n|---|---|---|---|\n| 31:0 | X | rw | x |\n"), "zh-CN")
    expect(manual.warnings).toEqual([])
  })
})

describe("zip", () => {
  const entries = [
    { name: "b.xml", data: new TextEncoder().encode("<b>two</b>") },
    { name: "a.txt", data: new TextEncoder().encode("hello zip") },
    { name: "empty.bin", data: new Uint8Array(0) },
  ]

  test("round-trips every entry, including an empty one", () => {
    const archive = buildZip(entries)
    const read = readZip(archive)
    expect([...read.keys()]).toEqual(["a.txt", "b.xml", "empty.bin"])
    expect(new TextDecoder().decode(read.get("a.txt"))).toBe("hello zip")
    expect(new TextDecoder().decode(read.get("b.xml"))).toBe("<b>two</b>")
    expect(read.get("empty.bin")?.length).toBe(0)
  })

  test("is byte-identical across runs and independent of input order", () => {
    const first = buildZip(entries)
    const second = buildZip(entries)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
    const reversed = buildZip([...entries].reverse())
    expect(Buffer.from(first).equals(Buffer.from(reversed))).toBe(true)
  })

  test("uses the fixed 1980-01-01 DOS timestamp and sorted local entries", () => {
    const archive = Buffer.from(buildZip(entries))
    // First local header starts at 0: time at 10, date at 12, name at 30.
    expect(archive.readUInt16LE(10)).toBe(0)
    expect(archive.readUInt16LE(12)).toBe(0x0021)
    expect(archive.toString("utf8", 30, 30 + 5)).toBe("a.txt")
  })

  test("detects a corrupted payload instead of returning wrong bytes", () => {
    const archive = Buffer.from(buildZip(entries))
    // First entry is a.txt (30-byte header + 5-byte name); flip a payload byte.
    archive[38] = archive[38] ^ 0xff
    expect(errorCode(() => readZip(archive))).toBe("DOCGEN_E_ZIP")
  })

  test("refuses duplicate entry names", () => {
    expect(errorCode(() => buildZip([{ name: "a", data: new Uint8Array(1) }, { name: "a", data: new Uint8Array(1) }]))).toBe("DOCGEN_E_ZIP")
  })
})

describe("paths", () => {
  test("artifact names and the ip slug", () => {
    expect(regExcelFileName("timer")).toBe("timer_regExcel_full.xlsx")
    expect(docxFileName("timer", "zh-CN")).toBe("timer_reg_user_manual.zh-CN.docx")
    expect(docxFileName("timer", "en")).toBe("timer_reg_user_manual.en.docx")
    expect(ipSlug()).toBe("ip")
    // Case is PRESERVED and the FIRST ASCII WORD of the title wins.
    expect(ipSlug("eCap 用户手册")).toBe("eCap")
    expect(ipSlug("TIMER top")).toBe("TIMER")
    expect(ipSlug("Timer Module")).toBe("Timer")
    // A title with no ASCII word falls back to the literal default.
    expect(ipSlug("定时器模块")).toBe("ip")
    expect(ipSlug("   ")).toBe("ip")
    // An explicit override is used WHOLE (case preserved, unsafe characters replaced).
    expect(ipSlug("定时器模块", "timer")).toBe("timer")
    expect(ipSlug("任意", "My IP")).toBe("My_IP")
    expect(ipSlug("eCap 用户手册", "Timer")).toBe("Timer")
  })

  test("the zh/en fixtures derive different default slugs, so run must pass one ip", () => {
    expect(ipSlug(parseManual(fixture("manual.zh.md"), "zh-CN").title)).toBe("ip")
    expect(ipSlug(parseManual(fixture("manual.en.md"), "en").title)).toBe("Timer")
  })

  test("relative paths resolve against the workspace root; absolute paths are kept", () => {
    const previous = process.env.DSH_WORKSPACE_ROOT
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-docgen-paths-"))
    try {
      process.env.DSH_WORKSPACE_ROOT = sandbox
      expect(workspaceRoot()).toBe(resolve(sandbox))
      expect(resolveInputPath("docs/user-manual.md")).toBe(join(sandbox, "docs", "user-manual.md"))
      expect(resolveInputPath("/etc/hostname")).toBe("/etc/hostname")
    } finally {
      if (previous === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previous
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test("atomic write lands mode 0644, replaces content and leaves no temp file", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-docgen-write-"))
    try {
      const target = join(sandbox, "docs", "artifact.bin")
      const written = atomicWriteFile(target, new Uint8Array([1, 2, 3]))
      expect(written).toBe(resolve(target))
      expect([...readFileSync(target)]).toEqual([1, 2, 3])
      expect(statSync(target).mode & 0o777).toBe(0o644)
      expect(readdirSync(dirname(target))).toEqual(["artifact.bin"])

      atomicWriteFile(target, "second")
      expect(readFileSync(target, "utf8")).toBe("second")
      expect(readdirSync(dirname(target))).toEqual(["artifact.bin"])
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe("plugin registration", () => {
  /** Register through a fake adapter and return the definitions, in registration order. */
  function registeredTools(): Array<{ name: string; parameters: { type?: string }; output: { render: unknown }; execute: (args: unknown, exec: unknown) => Promise<unknown> }> {
    const definitions: any[] = []
    apply({ mpdDsh: { registerTool: (definition: any) => { definitions.push(definition); return () => {} } } } as any)
    return definitions
  }

  test("apply registers the four mpd_docgen_* tools with object parameters and a render", () => {
    const definitions = registeredTools()
    expect(definitions.map((definition) => definition.name)).toEqual([
      "mpd_docgen_register_xlsx",
      "mpd_docgen_user_manual_docx",
      "mpd_docgen_run",
      "mpd_docgen_verify",
    ])
    for (const definition of definitions) {
      expect(definition.parameters.type).toBe("object")
      expect(typeof definition.output.render).toBe("function")
    }
  })

  test("inject declares the tool seam and the hard mpdDsh dependency", () => {
    expect(inject).toContain("mpdDsh")
    expect(inject).toContain("tools")
  })

  test("the lane modules export the pinned function shapes", () => {
    // Behaviour belongs to each lane's own test file. This only pins the exported API T1
    // reported, so a lane replacing its stub does not invalidate the foundation suite.
    expect(typeof buildXlsx).toBe("function")
    expect(typeof buildDocx).toBe("function")
    expect(typeof compareSkeletons).toBe("function")
  })
})
