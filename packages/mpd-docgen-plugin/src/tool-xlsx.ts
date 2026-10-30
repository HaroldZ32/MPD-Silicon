// The `mpd_docgen_register_xlsx` tool: read one user manual, canonicalise its register
// chapter and write the eCap-layout workbook.
//
// Every refusal crosses the DSH seam as the structured { ok:false, error:{code,message,hint} }
// shape the sibling plugin's `refusalOf` uses (mpd-verif-plugin/src/silicon/tool.ts:161-167),
// so a parse or IO failure is a result, never an unhandled throw.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DshToolDef } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import { parseManual } from "./markdown.js"
import { atomicWriteFile, ipSlug, regExcelFileName, resolveInputPath, resolveOutputDir, resolveOutputPath } from "./paths.js"
import { DocgenError, isDocgenError, type RegisterXlsxResult } from "./types.js"
import { buildXlsx } from "./xlsx.js"

/** The tool name (the `mpd_verif_*` namespace stays untouched). */
const TOOL_NAME = "mpd_docgen_register_xlsx"

/** The refusal shape the tool returns instead of throwing. */
interface ToolFailure {
  ok: false
  error: { code: string; message: string; hint: string }
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

/** Read the manual, converting a filesystem failure into DOCGEN_E_IO. */
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

/** Parse, build and atomically write the workbook; returns the summary result. */
function executeXlsx(args: Record<string, unknown>, exec: unknown): RegisterXlsxResult {
  const inputPath = resolveInputPath(requiredString(args, "input"), exec)
  const manual = parseManual(readText(inputPath), "zh-CN")
  if (manual.registers.length === 0) {
    throw new DocgenError(
      "DOCGEN_E_PARSE",
      "no registers parsed from " + inputPath,
      "add a `## 寄存器` chapter with `### title(NAME)` headings, 偏移地址/复位值 lines and a field table",
    )
  }

  const slug = ipSlug(manual.title, optionalString(args, "ip"))
  const requestedOutput = optionalString(args, "output")
  const target =
    requestedOutput === undefined
      ? join(resolveOutputDir(undefined, exec), regExcelFileName(slug))
      : resolveOutputPath(requestedOutput, exec)

  const bytes = buildXlsx(manual.registers, { ip: slug })
  const output = atomicWriteFile(target, bytes, 0o644)
  return {
    output,
    registers: manual.registers.length,
    fields: manual.registers.reduce((total, register) => total + register.fields.length, 0),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

/** Human-readable rendering for the harness UI, covering both the result and the refusal. */
function render(value: unknown): { type: "text"; text: string }[] {
  const failure = value as Partial<ToolFailure>
  if (failure.error !== undefined) {
    return [{ type: "text", text: TOOL_NAME + " FAILED [" + failure.error.code + "]: " + failure.error.message + "\nhint: " + failure.error.hint }]
  }
  const result = value as RegisterXlsxResult
  return [{ type: "text", text: TOOL_NAME + ": " + result.registers + " registers, " + result.fields + " fields, " + result.bytes + " bytes\nfile: " + result.output + "\nsha256: " + result.sha256 }]
}

/** The `mpd_docgen_register_xlsx` tool definition. */
export function registerXlsxToolDefinition(): DshToolDef {
  return {
    name: TOOL_NAME,
    description:
      "Generate the register Excel workbook (<ip>_regExcel_full.xlsx) from a user-manual markdown file. Parses the register chapter, gap-fills every register over [31:0], and writes the 9-column eCap workbook layout. Returns the output path, register/field counts, byte length and sha256.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "manual path, relative to the workspace root (e.g. docs/user-manual.md)" },
        output: { type: "string", description: "output xlsx path (default: <workspace>/docs/<ip>_regExcel_full.xlsx)" },
        ip: { type: "string", description: "IP slug override for the output name (default: from the manual H1 title, else 'ip')" },
      },
      required: ["input"],
    },
    output: {
      schema: {
        type: "object",
        properties: {
          output: { type: "string" },
          registers: { type: "number" },
          fields: { type: "number" },
          bytes: { type: "number" },
          sha256: { type: "string" },
          ok: { type: "boolean" },
          error: { type: "object" },
        },
      },
      render: (_args: unknown, value: unknown) => render(value),
    },
    execute: async (args: Record<string, unknown>, exec: unknown) => {
      try {
        return executeXlsx(args ?? {}, exec)
      } catch (error) {
        return refusalOf(error)
      }
    },
  }
}
