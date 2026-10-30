// T4 run/verify tests: the plan's end-to-end contract for `mpd_docgen_run` and the gate oracle
// `mpd_docgen_verify`.
//
// Every assertion observes the produced files — names, byte counts, sha256, the workbook headers
// read back out of its ZIP, and the verifier's own structured result. V10 (byte-identical rerun)
// lives here because it needs a rebuild; the verify tool asserts V1-V9, V11 and V12 only, and the
// tests also prove it is falsifiable (a corrupted copy must FAIL and name the right id) and total
// (a missing file must fail its checks, not throw).
//
// The exec stub is the adapter's real resolution path: `workspaceRootOf` reads
// `agent.session.header.cwd` (mpd-dsh-adapter-plugin/src/index.ts:2141-2175), so relative
// arguments resolve exactly as they do in a live session.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { docgenRunToolDefinition } from "../src/tool-run.js"
import { docgenVerifyToolDefinition } from "../src/tool-verify.js"
import { compareSkeletons } from "../src/consistency.js"
import type { DocgenRunResult, DocgenVerifyResult, Register } from "../src/types.js"
import { buildZip, readZip } from "../src/zip.js"

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures")
const RUN = docgenRunToolDefinition()
const VERIFY = docgenVerifyToolDefinition()

/** The nine workbook headers (plan §3). */
const HEADERS: string[] = [
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

/** The full check list the verify tool must emit for xlsx + both docx. */
const CHECK_IDS: string[] = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V11", "V12"]

/** A temporary workspace with the two fixtures copied to their documented paths. */
interface Workspace {
  readonly root: string
  readonly docs: string
}

/** The refusals both tools return instead of throwing. */
interface ToolFailure {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string; readonly hint: string }
}

/** A successful run result. */
type RunSuccess = DocgenRunResult & { readonly ok: true }

/** One raw file as reported by the run tool. */
interface Artifact {
  readonly path: string
  readonly lang?: "zh-CN" | "en"
  readonly bytes: number
  readonly sha256: string
}

/** A temporary workspace: `<root>/docs/user-manual.md` + `.en.md` (plan §5 paths). */
function makeWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "mpd-docgen-run-"))
  const docs = join(root, "docs")
  mkdirSync(docs, { recursive: true })
  copyFileSync(join(FIXTURES, "manual.zh.md"), join(docs, "user-manual.md"))
  copyFileSync(join(FIXTURES, "manual.en.md"), join(docs, "user-manual.en.md"))
  return { root, docs }
}

/** The adapter's exec stub: a live session whose header cwd is the temp workspace root. */
function execIn(root: string): unknown {
  return { agent: { session: { header: { cwd: root } } } }
}

/** Lowercase hex SHA-256 of raw bytes. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** The five XML entities the writers emit. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Read one part out of an artifact, failing loudly when it is absent. */
function partOf(parts: Map<string, Uint8Array>, name: string): Uint8Array {
  const data = parts.get(name)
  if (data === undefined) throw new Error("missing part: " + name)
  return data
}

/** Decode one XML part. */
function textOf(parts: Map<string, Uint8Array>, name: string): string {
  return new TextDecoder().decode(partOf(parts, name))
}

/** Read the header row of the first worksheet and decode its nine inline strings. */
function workbookHeaders(path: string): string[] {
  const sheet = textOf(readZip(new Uint8Array(readFileSync(path))), "xl/worksheets/sheet1.xml")
  const row = /<row r="1"[^>]*>([\s\S]*?)<\/row>/.exec(sheet)?.[1] ?? ""
  return [...row.matchAll(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/g)].map((match) => decodeEntities(match[1]))
}

/**
 * Rebuild an artifact with one XML part transformed, using the package's own zip writer so the
 * copy stays a valid OOXML package (a raw byte edit would break the deflate stream).
 */
function rewritePart(bytes: Uint8Array, part: string, transform: (text: string) => string): Uint8Array {
  const entries = [...readZip(bytes).entries()].map(([name, data]) => ({
    name,
    data: name === part ? new TextEncoder().encode(transform(new TextDecoder().decode(data))) : data,
  }))
  return buildZip(entries)
}

/** Remove the overview table (the only one with a D9D9D9 RESERVED band) from document.xml. */
function removeOverviewTable(xml: string): string {
  const tables = [...xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)]
  const overview = tables.find((match) => match[0].includes('w:fill="D9D9D9"'))
  if (overview === undefined) throw new Error("fixture docx has no overview table to remove")
  const start = overview.index ?? 0
  return xml.slice(0, start) + xml.slice(start + overview[0].length)
}

/** Run the tool in one workspace and return the success arm (tests that expect success). */
async function runOk(args: Record<string, unknown>, workspace: Workspace): Promise<RunSuccess> {
  const result = (await RUN.execute(args, execIn(workspace.root))) as RunSuccess | ToolFailure
  if ("error" in result) throw new Error("mpd_docgen_run refused: " + result.error.code + ": " + result.error.message)
  return result
}

/** Verify the named artifacts and return the structured result (refusals are test failures). */
async function verifyOk(args: Record<string, unknown>, workspace: Workspace): Promise<DocgenVerifyResult> {
  const result = (await VERIFY.execute(args, execIn(workspace.root))) as DocgenVerifyResult | ToolFailure
  if ("error" in result) throw new Error("mpd_docgen_verify refused: " + result.error.code + ": " + result.error.message)
  return result
}

/** One produced file's name, for the naming assertions. */
function names(files: readonly Artifact[]): string[] {
  return files.map((file) => basename(file.path))
}

/** Replace `from` with `to`, failing when the fixture no longer contains it. */
function replaceText(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error("fixture does not contain " + JSON.stringify(from))
  return text.split(from).join(to)
}

/** Rewrite the EN docx's document.xml and write the tampered copy into the workspace. */
function tamperEnDocx(run: RunSuccess, workspace: Workspace, transform: (xml: string) => string): string {
  const en = run.files.find((file) => file.lang === "en")
  if (en === undefined) throw new Error("the run produced no EN docx")
  const tampered = rewritePart(new Uint8Array(readFileSync(en.path)), "word/document.xml", transform)
  const relative = "docs/tampered.en.docx"
  writeFileSync(join(workspace.root, relative), tampered)
  return relative
}

describe("mpd_docgen_run", () => {
  test("writes all three artifacts with matching bytes and sha256", async () => {
    const workspace = makeWorkspace()
    try {
      const result = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)

      expect(result.ok).toBe(true)
      expect(result.registers).toBe(2)
      expect(result.fields).toBeGreaterThan(0)
      expect(result.warnings).toEqual([])
      expect(names(result.files)).toEqual(["timer_regExcel_full.xlsx", "timer_reg_user_manual.zh-CN.docx", "timer_reg_user_manual.en.docx"])
      expect(result.files.map((file) => file.lang)).toEqual([undefined, "zh-CN", "en"])
      for (const file of result.files) {
        expect(file.path.startsWith(workspace.docs)).toBe(true)
        const bytes = new Uint8Array(readFileSync(file.path))
        expect(bytes.length).toBe(file.bytes)
        expect(sha256(bytes)).toBe(file.sha256)
      }
      expect(workbookHeaders(result.files[0].path)).toEqual(HEADERS)

      // The docx pair is a real OOXML package with the register chapter present.
      const zhDocx = readZip(new Uint8Array(readFileSync(result.files[1].path)))
      expect(textOf(zhDocx, "word/document.xml")).toContain("寄存器")
      const enDocx = readZip(new Uint8Array(readFileSync(result.files[2].path)))
      expect(textOf(enDocx, "word/document.xml")).toContain("Registers")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("derives one ip from the zh title when the argument is absent", async () => {
    const workspace = makeWorkspace()
    try {
      const result = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md" }, workspace)
      // `# 定时器模块` has no ASCII word, so ipSlug falls back to the literal `ip` (paths.ts:71-76).
      expect(names(result.files)).toEqual(["ip_regExcel_full.xlsx", "ip_reg_user_manual.zh-CN.docx", "ip_reg_user_manual.en.docx"])
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("V10: two runs over the same manuals are byte-identical", async () => {
    const workspace = makeWorkspace()
    try {
      const first = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      const second = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      expect(second.files.map((file) => file.sha256)).toEqual(first.files.map((file) => file.sha256))
      for (let index = 0; index < first.files.length; index++) {
        expect(readFileSync(second.files[index].path).equals(readFileSync(first.files[index].path))).toBe(true)
      }
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("propagates the parser's overview warning", async () => {
    const workspace = makeWorkspace()
    try {
      const manualPath = join(workspace.docs, "user-manual.md")
      const original = readFileSync(manualPath, "utf8")
      // The overview is a cross-check only: a disagreement is a warning, never a refusal.
      writeFileSync(manualPath, original.replace("| 0x0C | STATUS | 16 |", "| 0x10 | STATUS | 16 |"))
      const result = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((warning) => warning.includes("STATUS") && warning.includes("overview offset"))).toBe(true)
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("reports the missing English twin as a warning, not a failure", async () => {
    const workspace = makeWorkspace()
    try {
      const result = await runOk({ manual: "docs/user-manual.md", ip: "timer" }, workspace)
      expect(result.files.length).toBe(2)
      expect(result.warnings.some((warning) => warning.includes("manualEn was not provided"))).toBe(true)
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("a zh/en offset mismatch is DOCGEN_E_LANG_MISMATCH and writes nothing", async () => {
    const workspace = makeWorkspace()
    try {
      const enPath = join(workspace.docs, "user-manual.en.md")
      const original = readFileSync(enPath, "utf8")
      writeFileSync(enPath, original.replace("Offset: 0x0C", "Offset: 0x10"))
      const result = (await RUN.execute(
        { manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" },
        execIn(workspace.root),
      )) as RunSuccess | ToolFailure
      expect("error" in result).toBe(true)
      if (!("error" in result)) return
      expect(result.error.code).toBe("DOCGEN_E_LANG_MISMATCH")
      expect(result.error.message).toContain("offset differs")
      expect(result.error.message).toContain("0x10")
      expect(result.error.message).toContain("STATUS")
      // Nothing was written: the output directory still holds only the two source manuals.
      expect(readdirSync(workspace.docs).sort()).toEqual(["user-manual.en.md", "user-manual.md"])
      expect(existsSync(join(workspace.docs, "timer_regExcel_full.xlsx"))).toBe(false)
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("a missing manual is a structured refusal, not a throw", async () => {
    const workspace = makeWorkspace()
    try {
      const result = (await RUN.execute({ manual: "docs/absent.md" }, execIn(workspace.root))) as RunSuccess | ToolFailure
      expect("error" in result).toBe(true)
      if (!("error" in result)) return
      expect(result.error.code).toBe("DOCGEN_E_IO")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })
})

describe("mpd_docgen_verify", () => {
  test("passes every requested check on the produced artifacts", async () => {
    const workspace = makeWorkspace()
    try {
      const run = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      const result = await verifyOk(
        { xlsx: "docs/timer_regExcel_full.xlsx", docxZh: "docs/timer_reg_user_manual.zh-CN.docx", docxEn: "docs/timer_reg_user_manual.en.docx" },
        workspace,
      )
      expect(result.ok).toBe(true)
      expect(result.failed).toEqual([])
      expect(result.checks.map((check) => check.id)).toEqual(CHECK_IDS)
      for (const check of result.checks) expect(check.ok).toBe(true)
      // The verifier read the same files the run tool wrote.
      expect(result.checks.length).toBe(CHECK_IDS.length)
      expect(run.files.length).toBe(3)
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("V11 rejects an EN docx whose offset disagrees with the ZH docx", async () => {
    const workspace = makeWorkspace()
    try {
      const run = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      // Tamper ONLY the EN docx: the STATUS chapter line and its overview cell move together,
      // so V7 (a 0x literal) and V8 (overview vs chapter) still pass and only V11 can catch it.
      const tampered = tamperEnDocx(run, workspace, (xml) => replaceText(replaceText(xml, "Offset: 0x0C", "Offset: 0x10"), ">0x0C<", ">0x10<"))
      const result = await verifyOk(
        { xlsx: "docs/timer_regExcel_full.xlsx", docxZh: "docs/timer_reg_user_manual.zh-CN.docx", docxEn: tampered },
        workspace,
      )
      expect(result.ok).toBe(false)
      expect(result.failed).toContain("V11")
      expect(result.failed).not.toContain("V7")
      expect(result.failed).not.toContain("V8")
      const detail = result.checks.find((check) => check.id === "V11")?.detail ?? ""
      expect(detail).toContain("STATUS")
      expect(detail).toContain("offset differs")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("V11 rejects an EN docx whose reset value flips the register width", async () => {
    const workspace = makeWorkspace()
    try {
      const run = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      // STATUS is a 16-bit register (4 reset digits); 8 digits derive a 32-bit width. No other
      // check reads the reset literal, so this isolates the width branch of V11.
      const tampered = tamperEnDocx(run, workspace, (xml) => replaceText(xml, "Reset value: 0x0030", "Reset value: 0x00000030"))
      const result = await verifyOk(
        { xlsx: "docs/timer_regExcel_full.xlsx", docxZh: "docs/timer_reg_user_manual.zh-CN.docx", docxEn: tampered },
        workspace,
      )
      expect(result.ok).toBe(false)
      expect(result.failed).toContain("V11")
      expect(result.failed).not.toContain("V7")
      expect(result.failed).not.toContain("V8")
      const detail = result.checks.find((check) => check.id === "V11")?.detail ?? ""
      expect(detail).toContain("STATUS")
      expect(detail).toContain("width differs")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("V11 passes on the untampered zh/en pair, comparing offsets and widths", async () => {
    const workspace = makeWorkspace()
    try {
      await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      const result = await verifyOk(
        { xlsx: "docs/timer_regExcel_full.xlsx", docxZh: "docs/timer_reg_user_manual.zh-CN.docx", docxEn: "docs/timer_reg_user_manual.en.docx" },
        workspace,
      )
      expect(result.ok).toBe(true)
      const detail = result.checks.find((check) => check.id === "V11")?.detail ?? ""
      expect(detail).toContain("identifiers, offsets, widths, spans")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("only the requested checks are emitted (V11 needs both docx files)", async () => {
    const workspace = makeWorkspace()
    try {
      await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      const result = await verifyOk({ docxZh: "docs/timer_reg_user_manual.zh-CN.docx" }, workspace)
      expect(result.ok).toBe(true)
      expect(result.checks.map((check) => check.id)).toEqual(["V6", "V7", "V8", "V9", "V12"])
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("a corrupted workbook header fails V1 and names it", async () => {
    const workspace = makeWorkspace()
    try {
      const run = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      const corrupt = rewritePart(new Uint8Array(readFileSync(run.files[0].path)), "xl/worksheets/sheet1.xml", (xml) =>
        xml.replace("register name", "register names"),
      )
      writeFileSync(join(workspace.docs, "corrupt.xlsx"), corrupt)
      const result = await verifyOk({ xlsx: "docs/corrupt.xlsx" }, workspace)
      expect(result.ok).toBe(false)
      expect(result.failed).toContain("V1")
      expect(result.checks.find((check) => check.id === "V1")?.detail).toContain("header row differs")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("a docx without its overview table fails V8 only", async () => {
    const workspace = makeWorkspace()
    try {
      const run = await runOk({ manual: "docs/user-manual.md", manualEn: "docs/user-manual.en.md", ip: "timer" }, workspace)
      const corrupt = rewritePart(new Uint8Array(readFileSync(run.files[1].path)), "word/document.xml", removeOverviewTable)
      writeFileSync(join(workspace.docs, "no-overview.docx"), corrupt)
      const result = await verifyOk({ docxZh: "docs/no-overview.docx" }, workspace)
      expect(result.ok).toBe(false)
      expect(result.failed).toContain("V8")
      expect(result.failed).not.toContain("V7")
      expect(result.failed).not.toContain("V9")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("a missing file fails its checks with the reason instead of throwing", async () => {
    const workspace = makeWorkspace()
    try {
      const result = await verifyOk({ xlsx: "docs/absent.xlsx" }, workspace)
      expect(result.ok).toBe(false)
      expect(result.failed).toEqual(["V1", "V2", "V3", "V4", "V5", "V12"])
      for (const check of result.checks) expect(check.detail).toContain("absent.xlsx")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })

  test("no artifact argument is a structured DOCGEN_E_INPUT refusal", async () => {
    const workspace = makeWorkspace()
    try {
      const result = (await VERIFY.execute({}, execIn(workspace.root))) as DocgenVerifyResult | ToolFailure
      expect("error" in result).toBe(true)
      if (!("error" in result)) return
      expect(result.error.code).toBe("DOCGEN_E_INPUT")
    } finally {
      rmSync(workspace.root, { recursive: true, force: true })
    }
  })
})

describe("compareSkeletons", () => {
  /** One synthetic register with a whole-register or explicitly split field list. */
  function register(name: string, offset: string, width: 16 | 32, spans: readonly (readonly [number, number, boolean])[]): Register {
    return {
      name,
      title: name,
      offset,
      reset: width === 32 ? "0x00000000" : "0x0000",
      width,
      fields: spans.map(([hi, lo, reserved]) => ({
        hi,
        lo,
        name: reserved ? "RESERVED" : "FIELD",
        access: reserved ? "" : "rw",
        desc: "",
        reserved,
      })),
    }
  }

  test("is empty when the skeletons agree", () => {
    const zh = [register("TSCTR", "0x00", 32, [[31, 0, false]]), register("STATUS", "0x0C", 16, [[15, 0, false]])]
    const en = [register("TSCTR", "0x00", 32, [[31, 0, false]]), register("STATUS", "0x0C", 16, [[15, 0, false]])]
    expect(compareSkeletons(zh, en)).toEqual([])
  })

  test("compares offsets numerically (0x10 equals 16)", () => {
    expect(compareSkeletons([register("A", "0x10", 32, [[31, 0, false]])], [register("A", "16", 32, [[31, 0, false]])])).toEqual([])
  })

  test("is order-sensitive and names the register that moved", () => {
    const a = [register("A", "0x00", 32, [[31, 0, false]]), register("B", "0x04", 32, [[31, 0, false]])]
    const b = [register("B", "0x04", 32, [[31, 0, false]]), register("A", "0x00", 32, [[31, 0, false]])]
    const differences = compareSkeletons(a, b)
    expect(differences.length).toBeGreaterThan(0)
    expect(differences.some((difference) => difference.includes("register 1") && difference.includes("name differs"))).toBe(true)
  })

  test("reports count, width, span and reserved-ness differences", () => {
    const a = [register("A", "0x00", 32, [[31, 16, true], [15, 0, false]])]
    const b = [register("A", "0x00", 16, [[31, 8, true], [7, 0, false]])]
    const differences = compareSkeletons(a, b)
    expect(differences.some((difference) => difference.includes("width differs"))).toBe(true)
    expect(differences.some((difference) => difference.includes("field 1 span differs"))).toBe(true)
    expect(compareSkeletons([], a)).toContain("register count differs: a has 0, b has 1")
  })

  test("reports a reserved-ness change at the same span", () => {
    const a = [register("A", "0x00", 32, [[31, 0, true]])]
    const b = [register("A", "0x00", 32, [[31, 0, false]])]
    expect(compareSkeletons(a, b).some((difference) => difference.includes("reserved differs"))).toBe(true)
  })
})
