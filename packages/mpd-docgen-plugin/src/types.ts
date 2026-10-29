// Shared document model for mpd-docgen. Every lane (foundation, xlsx, docx, run/verify)
// compiles against these types, so the shapes in plan §2 live here and nowhere else.
//
// Canonical-model contract: a Register's `fields` are GAP-FILLED over [31:0], sorted in
// DESCENDING bit order (high bit first), and their union is exactly 0xFFFFFFFF. RESERVED
// spans carry an empty access and the language's canonical reserved description.
// A 16-bit register is still gap-filled to [31:0] — bits [31:16] become one RESERVED row,
// which is what the eCap workbook does (reg2excel.py:275-303).

/** The two manual languages this plugin generates. */
export type Lang = "zh-CN" | "en"

/** One register field after canonicalisation. */
export interface Field {
  /** Most significant bit index (0..31). */
  hi: number
  /** Least significant bit index (0..hi). */
  lo: number
  /** Field name as written in the manual; `RESERVED` for synthesized/merged spans. */
  name: string
  /** Access abbreviation from the 25-code block (empty for RESERVED). */
  access: string
  /** Description with `<br>` expanded to `\n`; canonical text for RESERVED. */
  desc: string
  /** True when the field covers reserved bits (case-insensitive `RESERVED` name). */
  reserved: boolean
}

/** One register parsed from the manual's register chapter. */
export interface Register {
  /** Register name used in headings/tables, e.g. `TSCTR`. */
  name: string
  /** Human title: the heading text before the parenthesis. */
  title: string
  /** Normalised offset, e.g. `0x00` (uppercase hex digits, `0x` prefix). */
  offset: string
  /** Normalised reset value, H8 for 32-bit registers and H4 for 16-bit ones, e.g. `0x00001020`. */
  reset: string
  /** Width derived from the reset value's digit count: 32 for 8 hex digits, else 16. */
  width: 16 | 32
  /** Gap-filled, descending, union === 0xFFFFFFFF. */
  fields: Field[]
}

/**
 * One non-register markdown block of the docx body.
 *
 * `Manual.blocks` deliberately EXCLUDES the H1 title (carried by `Manual.title`) and the
 * whole register chapter (carried by `Manual.registers`): the docx lane renders the H1 and
 * the register chapter itself, in the eCap layout, from those two fields.
 */
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "fence"; lang: string; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }

/** One parsed manual: the H1 title, the generic body blocks and the canonical registers. */
export interface Manual {
  /** H1 text (`# <IP 名称>`); empty when the document has no H1. */
  title: string
  /** Generic body blocks, minus the H1 and the register chapter (see {@link Block}). */
  blocks: Block[]
  /** Canonical registers in chapter order (empty when there is no register chapter). */
  registers: Register[]
  /**
   * Non-fatal parse findings, in source order: the overview table is a CROSS-CHECK only
   * (plan §2), so a disagreement is reported here and never rejects the manual. Empty when
   * the overview agrees or when the manual has no overview table.
   */
  warnings: string[]
  /** The language this manual was parsed as. */
  lang: Lang
}

/** One written artifact as reported by the run tool. */
export interface DocgenFile {
  /** Absolute path of the written file. */
  path: string
  /** Language of a docx artifact; absent for the xlsx. */
  lang?: Lang
  /** Byte length of the written file. */
  bytes: number
  /** Lowercase hex SHA-256 of the written file. */
  sha256: string
}

/** `mpd_docgen_register_xlsx` result. */
export interface RegisterXlsxResult {
  output: string
  registers: number
  fields: number
  bytes: number
  sha256: string
}

/** `mpd_docgen_user_manual_docx` result. */
export interface UserManualDocxResult {
  output: string
  lang: Lang
  registers: number
  tables: number
  headings: number
  bytes: number
  sha256: string
}

/** `mpd_docgen_run` result. */
export interface DocgenRunResult {
  files: DocgenFile[]
  registers: number
  fields: number
  warnings: string[]
}

/** One assertion of the `mpd_docgen_verify` gate oracle. */
export interface DocgenCheck {
  id: string
  ok: boolean
  detail: string
}

/** `mpd_docgen_verify` result. */
export interface DocgenVerifyResult {
  ok: boolean
  checks: DocgenCheck[]
  failed: string[]
}

/** Stable error codes carried across the DSH seam (plan §2 and §5). */
export type DocgenErrorCode =
  | "DOCGEN_E_PARSE" // unparsable markdown: missing offset/reset, unknown heading/table shape
  | "DOCGEN_E_FIELDS" // field spans overlap, are out of range, or do not cover [31:0]
  | "DOCGEN_E_ACCESS" // unknown access abbreviation
  | "DOCGEN_E_LANG_MISMATCH" // zh and en manuals describe different register skeletons
  | "DOCGEN_E_INPUT" // a tool argument is missing or malformed
  | "DOCGEN_E_IO" // reading an input or writing an output failed
  | "DOCGEN_E_ZIP" // a ZIP container is malformed, truncated or fails its CRC
  | "DOCGEN_E_INTERNAL" // fallback for an unexpected internal error

/**
 * Typed refusal raised by the document pipeline.
 *
 * Tool boundaries convert it to `{ ok: false, error: { code, message, hint } }` instead of
 * letting it escape, so a failed call stays a structured result (the sibling plugin's
 * `refusalOf` pattern). `hint` states the remediation, never a restatement of the message.
 */
export class DocgenError extends Error {
  readonly code: DocgenErrorCode
  readonly hint: string

  constructor(code: DocgenErrorCode, message: string, hint: string) {
    super(message)
    this.name = "DocgenError"
    this.code = code
    this.hint = hint
  }
}

/** Narrow an unknown value to {@link DocgenError} without a cast at the call site. */
export function isDocgenError(value: unknown): value is DocgenError {
  return value instanceof DocgenError
}
