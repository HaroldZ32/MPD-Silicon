// Register canonicalisation: the market-equivalent port of eCap's `gap_fill_fields` +
// `merge_adjacent_reserved` (reg2excel.py:275-348) plus the width rule from
// reg2excel.py:373 and the offset/reset normalisation from reg2excel.py:133-166.
//
// Rules that are contract, not taste:
//   - every register is covered over [31:0]; uncovered bits become RESERVED rows, so a
//     16-bit register also gets a synthesized [31:16] row (eCap does exactly this);
//   - RESERVED rows that are bit-adjacent merge into one span, repeatedly (e.g.
//     [31:24]+[23:16] -> [31:16]);
//   - rows are sorted high-bit first;
//   - width is 32 iff the reset value has 8 hex digits, else 16;
//   - a manual field outside [31:0], overlapping another field, or reversed is refused
//     (DOCGEN_E_FIELDS); an access outside the 25-code block is refused
//     (DOCGEN_E_ACCESS).
//
// Bit spans are validated against [31:0], NOT against the derived width, matching
// xlsx2docx.py:97-109: eCap's own manual writes MUNIT_1_SHD_CTL / MUNIT_2_SHD_CTL with a
// 4-digit reset (width 16) while declaring fields up to bit 31, so a width-relative check
// would refuse a real manual. Width only affects reset-value formatting.
import { labelsFor } from "./labels.js"
import { DocgenError, type Field, type Lang, type Register } from "./types.js"

/** The field name reserved spans carry. */
export const RESERVED_NAME = "RESERVED"

/**
 * The 25 access abbreviations the manual template defines (skills/rtl-ip-flow/templates/
 * user-manual.md:156-180). Parsing is strict against this set; RESERVED rows may omit it.
 */
export const ACCESS_CODES: readonly string[] = [
  "rw", "ro", "wo", "w1", "w1c", "rc", "rs", "wrc", "wrs", "wc", "ws", "wsrc", "wcrs",
  "w1s", "w1t", "w0c", "w0s", "w0t", "w1src", "w1crs", "w0src", "w0crs", "woc", "wos", "wo1",
]

/** True when a field name denotes reserved bits (case-insensitive `RESERVED`). */
export function isReservedName(name: string): boolean {
  return name.trim().toUpperCase() === RESERVED_NAME
}

/** Number of hex digits needed to print a field of `width` bits: ceil(width / 4). */
export function hexlen(width: number): number {
  return Math.max(1, Math.ceil(width / 4))
}

/** `N` for a single bit, `hi:lo` otherwise (eCap's `bit_range_text`, xlsx2docx.py:433-436). */
export function bitRangeText(field: Pick<Field, "hi" | "lo">): string {
  return field.hi === field.lo ? String(field.hi) : field.hi + ":" + field.lo
}

/**
 * Overview name-row label: `NAME` for a whole-register or single-bit field, else
 * `NAME[hi:lsb]` (eCap's `field_label`, xlsx2docx.py:400-405).
 */
export function fieldLabel(field: Pick<Field, "hi" | "lo" | "name">): string {
  const width = field.hi - field.lo + 1
  if (width === 32 || width === 1) return field.name
  return field.name + "[" + field.hi + ":" + field.lo + "]"
}

/** Parse a `0x...` reset value; hex digits may be space-grouped (`0x0000 1020`). */
export function parseResetHex(raw: string): { digits: string; value: number } {
  const match = /0x([0-9A-Fa-f\s]+)/.exec(raw)
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", "cannot parse reset value " + JSON.stringify(raw), "write the reset value as 0x... (hex digits may be space-grouped)")
  }
  const digits = match[1].replace(/\s+/g, "").toUpperCase()
  if (digits.length === 0) {
    throw new DocgenError("DOCGEN_E_PARSE", "reset value has no hex digits: " + JSON.stringify(raw), "write the reset value as 0x...")
  }
  if (digits.length > 8) {
    throw new DocgenError("DOCGEN_E_PARSE", "reset value has " + digits.length + " hex digits (max 8): " + JSON.stringify(raw), "a register is at most 32 bits wide")
  }
  return { digits, value: parseInt(digits, 16) }
}

/** Print a register reset value: `0x` + 8 digits for 32-bit registers, 4 for 16-bit ones. */
export function normaliseResetValue(value: number, is32: boolean): string {
  const digits = is32 ? 8 : 4
  return "0x" + (value >>> 0).toString(16).toUpperCase().padStart(digits, "0")
}

/** Print one field's reset value as `{width}'h{HEX}` (eCap's `field_reset_value`). */
export function fieldResetValue(value: number, hi: number, lo: number): string {
  const width = hi - lo + 1
  const mask = width >= 32 ? 0xffffffff : (1 << width) - 1
  const extracted = ((value >>> lo) & mask) >>> 0
  return width + "'h" + extracted.toString(16).toUpperCase().padStart(hexlen(width), "0")
}

/** Normalise an offset to `0x` + uppercase hex digits (`0x0c` -> `0x0C`, `000h` -> `0x000`). */
export function normaliseOffset(raw: string): string {
  const match = /^\s*(?:0x)?([0-9A-Fa-f]+)h?\s*$/.exec(raw)
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", "cannot parse register offset " + JSON.stringify(raw), "write the offset as 0x... (or the overview form 000h)")
  }
  const digits = match[1].toUpperCase()
  return "0x" + (digits.length < 2 ? digits.padStart(2, "0") : digits)
}

/** Numeric value of an offset, used by the overview cross-check. */
export function offsetNumber(raw: string): number {
  const match = /^\s*(?:0x)?([0-9A-Fa-f]+)h?\s*$/.exec(raw)
  if (!match) {
    throw new DocgenError("DOCGEN_E_PARSE", "cannot parse register offset " + JSON.stringify(raw), "write the offset as 0x... (or the overview form 000h)")
  }
  return parseInt(match[1], 16)
}

/** Synthesize a RESERVED row for every uncovered bit range, then merge and sort (descending). */
export function gapFillFields(fields: readonly Field[], reservedDesc: string): Field[] {
  const covered = new Array<boolean>(32).fill(false)
  for (const field of fields) {
    for (let bit = Math.max(0, field.lo); bit <= Math.min(31, field.hi); bit++) covered[bit] = true
  }
  const synthesized: Field[] = []
  let lo = 0
  while (lo <= 31) {
    if (covered[lo]) {
      lo++
      continue
    }
    let hi = lo
    while (hi + 1 <= 31 && !covered[hi + 1]) hi++
    synthesized.push({ hi, lo, name: RESERVED_NAME, access: "", desc: reservedDesc, reserved: true })
    lo = hi + 1
  }
  const merged = [...fields, ...synthesized].sort((a, b) => b.hi - a.hi)
  return mergeAdjacentReserved(merged, reservedDesc)
}

/**
 * Merge bit-contiguous RESERVED rows into one span, repeating until no pair remains
 * (eCap's `merge_adjacent_reserved`). Non-RESERVED rows never participate.
 */
export function mergeAdjacentReserved(fields: readonly Field[], reservedDesc: string): Field[] {
  let result = [...fields].sort((a, b) => b.hi - a.hi)
  let changed = true
  while (changed) {
    changed = false
    const merged: Field[] = []
    let i = 0
    while (i < result.length) {
      const current = result[i]
      const next = i + 1 < result.length ? result[i + 1] : undefined
      const currentReserved = current.reserved || isReservedName(current.name)
      const nextReserved = next !== undefined && (next.reserved || isReservedName(next.name))
      if (next !== undefined && currentReserved && nextReserved && current.lo === next.hi + 1) {
        merged.push({ hi: current.hi, lo: next.lo, name: RESERVED_NAME, access: "", desc: reservedDesc, reserved: true })
        i += 2
        changed = true
        continue
      }
      merged.push(current)
      i++
    }
    result = merged
  }
  return result
}

/**
 * Canonicalise parsed registers: normalise offset/reset, derive width, validate spans and
 * access codes, gap-fill over [31:0], merge adjacent RESERVED rows and sort descending.
 *
 * @param registers - registers as parsed from a manual (fields need not be gap-filled).
 * @param lang - selects the canonical RESERVED description and is not otherwise used.
 * @returns new register objects; the input array is not mutated.
 */
export function canonicaliseRegisters(registers: readonly Register[], lang: Lang = "zh-CN"): Register[] {
  const reservedDesc = labelsFor(lang).reservedDesc
  const seenNames = new Set<string>()

  return registers.map((register) => {
    const name = register.name.trim()
    if (name.length === 0) {
      throw new DocgenError("DOCGEN_E_PARSE", "register has an empty name", "write the heading as ### <title>(<REG_NAME>)")
    }
    if (seenNames.has(name)) {
      throw new DocgenError("DOCGEN_E_PARSE", "duplicate register name: " + name, "each register name must appear once in the register chapter")
    }
    seenNames.add(name)

    const offset = normaliseOffset(register.offset)
    const { digits, value } = parseResetHex(register.reset)
    const width: 16 | 32 = digits.length === 8 ? 32 : 16
    if (width === 16 && value > 0xffff) {
      throw new DocgenError("DOCGEN_E_PARSE", "register " + name + ": reset value does not fit 16 bits", "use 8 hex digits for a 32-bit register")
    }

    const covered = new Array<boolean>(32).fill(false)
    const fields: Field[] = register.fields.map((raw) => {
      const hi = Number(raw.hi)
      const lo = Number(raw.lo)
      if (!Number.isInteger(hi) || !Number.isInteger(lo)) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": non-integer bit range " + raw.hi + ":" + raw.lo, "write the bit range as N or N:M")
      }
      if (hi < lo) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": bit range " + bitRangeText({ hi, lo }) + " has the high bit below the low bit", "write the range high:low")
      }
      if (lo < 0 || hi > 31) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": bit range " + bitRangeText({ hi, lo }) + " is outside [31:0]", "keep fields inside [31:0]")
      }
      for (let bit = lo; bit <= hi; bit++) {
        if (covered[bit]) {
          throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": bit range " + bitRangeText({ hi, lo }) + " overlaps another field", "field spans must not overlap")
        }
        covered[bit] = true
      }
      const trimmedName = raw.name.trim()
      if (trimmedName.length === 0) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": field " + bitRangeText({ hi, lo }) + " has an empty name", "give every field a name (RESERVED for reserved bits)")
      }
      const reserved = raw.reserved || isReservedName(trimmedName)
      const access = reserved ? "" : raw.access.trim().toLowerCase()
      if (!reserved) {
        if (access.length === 0) {
          throw new DocgenError("DOCGEN_E_ACCESS", "register " + name + ": field " + trimmedName + " has no access code", "use one of the 25 access abbreviations (rw, ro, w1c, ...)")
        }
        if (!ACCESS_CODES.includes(access)) {
          throw new DocgenError("DOCGEN_E_ACCESS", "register " + name + ": unknown access code " + JSON.stringify(raw.access) + " on field " + trimmedName, "use one of: " + ACCESS_CODES.join(", "))
        }
      }
      const desc = reserved ? reservedDesc : raw.desc.replace(/<br\s*\/?>/gi, "\n").trim()
      return { hi, lo, name: trimmedName, access, desc, reserved }
    })

    const filled = gapFillFields(fields, reservedDesc)
    let union = 0
    let previousLo = 32
    for (const field of filled) {
      if (field.hi >= previousLo) {
        throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": canonical fields are not strictly descending at " + bitRangeText(field), "this is an internal canonicalisation defect")
      }
      previousLo = field.lo
      const span = field.hi - field.lo + 1
      union = (union | (span >= 32 ? 0xffffffff : (((1 << span) - 1) << field.lo) >>> 0)) >>> 0
    }
    if (union !== 0xffffffff) {
      throw new DocgenError("DOCGEN_E_FIELDS", "register " + name + ": fields do not cover [31:0] after gap filling", "this is an internal canonicalisation defect")
    }

    return {
      name,
      title: register.title.trim(),
      offset,
      reset: normaliseResetValue(value, width === 32),
      width,
      fields: filled,
    }
  })
}
