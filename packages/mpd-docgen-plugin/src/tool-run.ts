// The `mpd_docgen_run` tool: one call produces every spec-stage artifact from the manual pair.
//
// Order matters for the refusal contract (plan §5): the en manual is parsed and its register
// skeleton compared BEFORE anything is built or written, so a zh/en mismatch leaves the output
// directory untouched. Both docx files and the workbook share ONE `ip`, so the three names
// cannot drift apart. `manualEn` is optional because a call must not fail without it — the
// missing English manual is reported as a warning, and the rtl-ip-flow flow is what requires it.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DshToolDef } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import { compareSkeletons } from "./consistency.js"
import { buildDocx } from "./docx.js"
import { parseManual } from "./markdown.js"
import { atomicWriteFile, docxFileName, ipSlug, regExcelFileName, resolveInputPath, resolveOutputDir } from "./paths.js"
import { DocgenError, isDocgenError, type DocgenFile, type DocgenRunResult, type Lang, type Manual } from "./types.js"
import { buildXlsx } from "./xlsx.js"

/** The tool name (the `mpd_verif_*` namespace stays untouched). */
const TOOL_NAME = "mpd_docgen_run"

/** Warning appended when the caller omits `manualEn`: the flow, not the tool, requires it. */
const EN_MANUAL_NOTE =
  "manualEn was not provided: the rtl-ip-flow spec stage requires an English twin (docs/user-manual.en.md); only the zh-CN docx was generated"

/** The refusal shape the tool returns instead of throwing. */
interface ToolFailure {
  ok: false
  error: { code: string; message: string; hint: string }
}

/** The successful result: the shared counts plus every written file. */
type RunResult = DocgenRunResult & { ok: true }

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

/** Read one required string argument; a missing/blank value is DOCGEN_E_INPUT. */
function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocgenError("DOCGEN_E_INPUT", "missing or empty \"" + key + "\" argument for " + TOOL_NAME, "pass " + key + " as a non-empty string")
  }
  return value
}

/** Read one optional string argument; blank values count as absent. */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (typeof value !== "string" || value.trim() === "") return undefined
  return value
}

/** Read a manual, converting a filesystem failure into DOCGEN_E_IO. */
function readText(path: string): string {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    throw new DocgenError(
      "DOCGEN_E_IO",
      "cannot read " + path + ": " + (error instanceof Error ? error.message : String(error)),
      "check that the input path exists and is readable",
    )
  }
}

/** Parse one manual and refuse when its register chapter is absent (nothing to generate). */
function loadManual(path: string, lang: Lang): Manual {
  const manual = parseManual(readText(path), lang)
  if (manual.registers.length === 0) {
    throw new DocgenError(
      "DOCGEN_E_PARSE",
      "no registers parsed from " + path,
      "add a `## 寄存器` (en: `## Registers`) chapter with `### title(NAME)` headings, 偏移地址/复位值 (Offset/Reset value) lines and a field table",
    )
  }
  return manual
}

/** Deduplicate warnings in source order (zh first, then en's). */
function dedupe(warnings: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const warning of warnings) {
    if (seen.has(warning)) continue
    seen.add(warning)
    unique.push(warning)
  }
  return unique
}

/** One artifact to write, before it reaches the filesystem. */
interface Artifact {
  readonly name: string
  readonly lang?: Lang
  readonly bytes: Uint8Array
}

/** Build every artifact in memory, refusing a zh/en skeleton mismatch before any write. */
function buildArtifacts(zh: Manual, en: Manual | undefined, enPath: string | undefined, slug: string, zhPath: string): Artifact[] {
  if (en !== undefined) {
    const differences = compareSkeletons(zh.registers, en.registers)
    if (differences.length > 0) {
      throw new DocgenError(
        "DOCGEN_E_LANG_MISMATCH",
        "zh/en register skeletons differ (zh: " + zhPath + ", en: " + enPath + "):\n- " + differences.join("\n- "),
        "make the en manual declare the same register names, offsets, widths and field spans as the zh manual; only titles and descriptions may differ",
      )
    }
  }
  const artifacts: Artifact[] = [
    { name: regExcelFileName(slug), bytes: buildXlsx(zh.registers, { ip: slug }) },
    { name: docxFileName(slug, "zh-CN"), lang: "zh-CN", bytes: buildDocx(zh, zh.registers, "zh-CN", { ip: slug }) },
  ]
  if (en !== undefined) {
    artifacts.push({ name: docxFileName(slug, "en"), lang: "en", bytes: buildDocx(en, en.registers, "en", { ip: slug }) })
  }
  return artifacts
}

/** Parse, build and atomically write every artifact; returns the per-file evidence. */
function executeRun(args: Record<string, unknown>, exec: unknown): RunResult {
  const zhPath = resolveInputPath(requiredString(args, "manual"), exec)
  const zh = loadManual(zhPath, "zh-CN")

  const enArg = optionalString(args, "manualEn")
  const enPath = enArg === undefined ? undefined : resolveInputPath(enArg, exec)
  const en = enPath === undefined ? undefined : loadManual(enPath, "en")

  const slug = ipSlug(zh.title, optionalString(args, "ip"))
  const outputDir = resolveOutputDir(optionalString(args, "outputDir"), exec)
  const artifacts = buildArtifacts(zh, en, enPath, slug, zhPath)

  const files: DocgenFile[] = artifacts.map((artifact) => {
    const path = atomicWriteFile(join(outputDir, artifact.name), artifact.bytes, 0o644)
    const file: DocgenFile = {
      path,
      bytes: artifact.bytes.length,
      sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
    }
    return artifact.lang === undefined ? file : { ...file, lang: artifact.lang }
  })

  const warnings = dedupe([...zh.warnings, ...(en?.warnings ?? [])])
  if (en === undefined) warnings.push(EN_MANUAL_NOTE)

  return {
    ok: true,
    files,
    registers: zh.registers.length,
    fields: zh.registers.reduce((total, register) => total + register.fields.length, 0),
    warnings,
  }
}

/** Human-readable rendering for the harness UI, covering both the result and the refusal. */
function render(value: unknown): { type: "text"; text: string }[] {
  const failure = value as Partial<ToolFailure>
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME + " FAILED [" + failure.error.code + "]: " + failure.error.message + "\nhint: " + failure.error.hint }]
  }
  const result = value as RunResult
  const lines = [
    TOOL_NAME + ": " + result.registers + " registers, " + result.fields + " fields, " + result.files.length + " files",
    ...result.files.map((file) => "  " + file.path + " (" + file.bytes + " bytes, sha256 " + file.sha256 + ")"),
  ]
  if (result.warnings.length > 0) lines.push("warnings: " + result.warnings.join("; "))
  return [{ type: "text", text: lines.join("\n") }]
}

/** The `mpd_docgen_run` tool definition. */
export function docgenRunToolDefinition(): DshToolDef {
  return {
    name: TOOL_NAME,
    description:
      "Generate all spec-stage artifacts in one call: <ip>_regExcel_full.xlsx, <ip>_reg_user_manual.zh-CN.docx and (when manualEn is given) <ip>_reg_user_manual.en.docx. Parses the zh manual (and the en twin when given), refuses a zh/en register-skeleton mismatch (DOCGEN_E_LANG_MISMATCH) before writing anything, and reports every written file with its byte length and sha256. Without manualEn it still succeeds and reports why the English twin is required.",
    parameters: {
      type: "object",
      properties: {
        manual: { type: "string", description: "zh-CN manual path, relative to the workspace root (default artifact source)" },
        manualEn: { type: "string", description: "optional en manual path; when given, its docx is generated too" },
        outputDir: { type: "string", description: "output directory (default: <workspace>/docs)" },
        ip: { type: "string", description: "IP slug override shared by every output name (default: from the manual H1 title, else 'ip')" },
      },
      required: ["manual"],
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
                sha256: { type: "string" },
              },
            },
          },
          registers: { type: "number" },
          fields: { type: "number" },
          warnings: { type: "array", items: { type: "string" } },
          error: { type: "object" },
        },
      },
      render: (_args: unknown, value: unknown) => render(value),
    },
    execute: async (args: Record<string, unknown>, exec: unknown) => {
      try {
        return executeRun(args ?? {}, exec)
      } catch (error) {
        return refusalOf(error)
      }
    },
  }
}
