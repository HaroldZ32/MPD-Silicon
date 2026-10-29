// zh/en register-skeleton comparison (plan §5): the two manuals may differ in titles,
// descriptions and access text, but must describe the SAME skeleton — register count and
// order, register names, numeric offsets, widths, and the ordered (hi, lo) field spans with
// their reserved-ness. `mpd_docgen_run` turns any difference here into a
// DOCGEN_E_LANG_MISMATCH refusal before it writes a single byte.
import type { Register } from "./types.js"

/** Print one field span the way the reports render it: `[31:16]` or `[7]`. */
function spanText(hi: number, lo: number): string {
  return "[" + (hi === lo ? String(hi) : hi + ":" + lo) + "]"
}

/**
 * Numeric value of a register offset, or null when it is not parseable.
 *
 * Offsets are compared NUMERICALLY, never as text (plan §5; contract example `0x10 == 16`):
 * `0x`-prefixed and `NNNh` forms are hex, a plain digit run is DECIMAL — the one place this
 * differs from the parser's `offsetNumber`, which reads bare digits as hex because it also
 * accepts `000h`. Canonical registers always carry the `0x` prefix, so this branch exists only
 * for hand-built skeletons and for the contract's own equality example.
 */
function offsetValue(offset: string): number | null {
  const text = offset.trim()
  if (/^0x[0-9A-Fa-f]+$/.test(text)) return parseInt(text.slice(2), 16)
  if (/^[0-9A-Fa-f]+h$/i.test(text)) return parseInt(text.slice(0, -1), 16)
  if (/^[0-9]+$/.test(text)) return parseInt(text, 10)
  if (/^[0-9A-Fa-f]+$/.test(text)) return parseInt(text, 16)
  return null
}

/** Compare one register pair at the same position, appending every difference it finds. */
function compareRegister(a: Register, b: Register, position: string, differences: string[]): void {
  const label = a.name === b.name ? position + " (" + a.name + ")" : position
  if (a.name !== b.name) {
    differences.push(label + ' name differs: a="' + a.name + '", b="' + b.name + '"')
  }

  const aOffset = offsetValue(a.offset)
  const bOffset = offsetValue(b.offset)
  if (aOffset === null || bOffset === null) {
    if (a.offset !== b.offset) differences.push(label + " offset differs: a=" + a.offset + ", b=" + b.offset)
  } else if (aOffset !== bOffset) {
    differences.push(label + " offset differs: a=" + a.offset + ", b=" + b.offset)
  }

  if (a.width !== b.width) differences.push(label + " width differs: a=" + a.width + ", b=" + b.width)

  if (a.fields.length !== b.fields.length) {
    differences.push(label + " field count differs: a has " + a.fields.length + ", b has " + b.fields.length)
  }
  const shared = Math.min(a.fields.length, b.fields.length)
  for (let i = 0; i < shared; i++) {
    const left = a.fields[i]
    const right = b.fields[i]
    const field = label + " field " + (i + 1)
    if (left.hi !== right.hi || left.lo !== right.lo) {
      differences.push(field + " span differs: a=" + spanText(left.hi, left.lo) + ", b=" + spanText(right.hi, right.lo))
    }
    if (left.reserved !== right.reserved) {
      differences.push(field + " reserved differs: a=" + left.reserved + ", b=" + right.reserved)
    }
  }
}

/**
 * Compare two register skeletons and report every difference.
 *
 * Comparison is ORDER-SENSITIVE: register i of `a` is compared with register i of `b`, so a
 * reordering is a difference even when the sets are equal. Offsets are compared numerically
 * (`0x10` equals `16`); field spans are compared as ordered (hi, lo) pairs.
 *
 * @param a - first skeleton (e.g. the zh-CN manual's registers).
 * @param b - second skeleton (e.g. the en manual's registers).
 * @returns one human-readable difference per mismatch; empty when the skeletons agree.
 */
export function compareSkeletons(a: readonly Register[], b: readonly Register[]): string[] {
  const differences: string[] = []
  if (a.length !== b.length) {
    differences.push("register count differs: a has " + a.length + ", b has " + b.length)
  }
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    compareRegister(a[i], b[i], "register " + (i + 1), differences)
  }
  return differences
}
