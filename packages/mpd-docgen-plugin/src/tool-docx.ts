// The `mpd_docgen_user_manual_docx` tool: read one user manual, parse it in the requested
// language and write the eCap-layout docx. Every refusal crosses the DSH seam as the
// structured { ok:false, error:{code,message,hint} } shape (sibling plugin's `refusalOf`,
// mpd-verif-plugin/src/silicon/tool.ts:161-167), so a parse or IO failure is a result.
//
// The reported `tables`/`headings` counts come from the MODEL (the thing the writer renders),
// not from counting the produced XML: tables = 1 overview + 2 per register (bit + detail) +
// every markdown table in the body; headings = 1 H1 + body headings + 1 register H2 + one H3
// per register (plan §5).
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DshToolDef } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import { buildDocx } from "./docx.js"
import { parseManual } from "./markdown.js"
import { atomicWriteFile, docxFileName, ipSlug, resolveInputPath, resolveOutputDir, resolveOutputPath } from "./paths.js"
import { DocgenError, isDocgenError, type Lang, type Manual, type UserManualDocxResult } from "./types.js"

/** The tool name (the `mpd_verif_*` namespace stays untouched). */
const TOOL_NAME = "mpd_docgen_user_manual_docx"

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

/** Read the `lang` argument and narrow it to the two supported languages. */
function requiredLang(args: Record<string, unknown>): Lang {
  const value = requiredString(args, "lang")
  if (value !== "zh-CN" && value !== "en") {
    throw new DocgenError("DOCGEN_E_INPUT", "unsupported lang \"" + value + "\" for " + TOOL_NAME, "pass lang as \"zh-CN\" or \"en\"")
  }
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

/** Tables the document will contain: overview + bit/detail per register + body tables. */
function countTables(manual: Manual): number {
  const bodyTables = manual.blocks.filter((block) => block.kind === "table").length
  return 1 + manual.registers.length * 2 + bodyTables
}

/** Headings the document will contain: H1 + body headings + register H2 + one H3 per register. */
function countHeadings(manual: Manual): number {
  const bodyHeadings = manual.blocks.filter((block) => block.kind === "heading").length
  return 1 + bodyHeadings + 1 + manual.registers.length
}

/** Parse, build and atomically write the docx; returns the summary result. */
function executeDocx(args: Record<string, unknown>, exec: unknown): UserManualDocxResult {
  const inputPath = resolveInputPath(requiredString(args, "input"), exec)
  const lang = requiredLang(args)
  const manual = parseManual(readText(inputPath), lang)
  if (manual.registers.length === 0) {
    throw new DocgenError(
      "DOCGEN_E_PARSE",
      "no registers parsed from " + inputPath,
      "add a `## 寄存器` (en: `## Registers`) chapter with `### title(NAME)` headings, 偏移地址/复位值 (Offset/Reset value) lines and a field table",
    )
  }

  const slug = ipSlug(manual.title, optionalString(args, "ip"))
  const requestedOutput = optionalString(args, "output")
  const target =
    requestedOutput === undefined
      ? join(resolveOutputDir(undefined, exec), docxFileName(slug, lang))
      : resolveOutputPath(requestedOutput, exec)

  const bytes = buildDocx(manual, manual.registers, lang, { ip: slug })
  const output = atomicWriteFile(target, bytes, 0o644)
  return {
    output,
    lang,
    registers: manual.registers.length,
    tables: countTables(manual),
    headings: countHeadings(manual),
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
  const result = value as UserManualDocxResult
  return [
    {
      type: "text",
      text:
        TOOL_NAME + " (" + result.lang + "): " + result.registers + " registers, " + result.tables + " tables, " + result.headings + " headings, " + result.bytes + " bytes\nfile: " + result.output + "\nsha256: " + result.sha256,
    },
  ]
}

/** The `mpd_docgen_user_manual_docx` tool definition. */
export function userManualDocxToolDefinition(): DshToolDef {
  return {
    name: TOOL_NAME,
    description:
      "Generate one language version of the user-manual docx (<ip>_reg_user_manual.<lang>.docx) from a user-manual markdown file. Renders the generic body plus the eCap-layout register chapter (overview table, per-register bit table and detail table). Returns the output path, language, register/table/heading counts, byte length and sha256.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "manual path, relative to the workspace root (e.g. docs/user-manual.md)" },
        lang: { type: "string", enum: ["zh-CN", "en"], description: "manual language; selects labels and heading text" },
        output: { type: "string", description: "output docx path (default: <workspace>/docs/<ip>_reg_user_manual.<lang>.docx)" },
        ip: { type: "string", description: "IP slug override for the output name (default: from the manual H1 title, else 'ip')" },
      },
      required: ["input", "lang"],
    },
    output: {
      schema: {
        type: "object",
        properties: {
          output: { type: "string" },
          lang: { type: "string" },
          registers: { type: "number" },
          tables: { type: "number" },
          headings: { type: "number" },
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
        return executeDocx(args ?? {}, exec)
      } catch (error) {
        return refusalOf(error)
      }
    },
  }
}
