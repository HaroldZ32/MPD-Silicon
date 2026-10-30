// JSONC reading support for the silicon toolchain config (MIT; see LICENSE).
//
// Ported from @mpd-dsh/mpd `packages/mpd-config-plugin/src/index.ts` (the
// `stripJsonc` / `parseJsonc` / `deepMerge` trio). This port is MIT like the
// rest of this repository; upstream licensing is recorded in LICENSE-NOTICES.md.
// The scanner is string-aware:
// a `//` or `/*` inside a quoted value is content, a backslash escape swallows
// the next character, and a comma is trailing only when the next NON-TRIVIA
// token closes the container (so `{ "a": 1, /* c */ }` still parses). No
// dependency is added; JSON.parse does the actual grammar.

/**
 * Keys a merge refuses to copy, so a hostile config file cannot reach the
 * prototype chain through `__proto__` / `prototype` / `constructor`.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"])

/**
 * Remove JSONC comments and trailing commas, leaving the JSON text that
 * `JSON.parse` accepts. Comments inside strings survive untouched.
 */
export function stripJsonc(src: string): string {
  // Scanned output, built one character at a time so string contents survive untouched.
  let out = ""
  // True while the scan is inside a JSON string, where `//` and `/*` are literal characters.
  let inString = false
  // Read cursor over the whole source; advanced by 1, or by 2 when a unit is consumed.
  let i = 0
  while (i < src.length) {
    // The character at the cursor; the branch below decides what the scan does with it.
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += src[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === "\"") inString = false
      i++
      continue
    }
    if (ch === "\"") {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (ch === ",") {
      // A comma is TRAILING when the next non-trivia token closes the container.
      // Skipping trivia (not just whitespace) matters: `{ "a": 1, /* c */ }`
      // would keep its comma and stop parsing — measured in the ported editor tests.
      let j = i + 1
      for (;;) {
        while (j < src.length && /\s/.test(src[j])) j++
        if (src[j] === "/" && src[j + 1] === "/") {
          while (j < src.length && src[j] !== "\n") j++
          continue
        }
        if (src[j] === "/" && src[j + 1] === "*") {
          j += 2
          while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++
          j += 2
          continue
        }
        break
      }
      if (src[j] === "}" || src[j] === "]") {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/**
 * Parse JSONC into the value it denotes: comments and trailing commas are
 * removed first, then the platform parser runs. Throws on a malformed document;
 * callers that must report instead of crash wrap this in try/catch.
 */
export function parseJsonc(src: string): unknown {
  return JSON.parse(stripJsonc(src))
}

/**
 * Whether the value is a non-null, non-array object — the only shape a merge
 * walks into and the only shape a schema group may take.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

/**
 * Deep merge with `over` winning. Objects recurse; scalars and arrays replace
 * wholesale (the schema's arrays are settings, not accumulations). The merge
 * result is a fresh object keyed in first-seen order, never an alias of either
 * input, and the reserved keys are skipped so no layer can pollute a prototype.
 */
export function deepMerge(base: unknown, over: unknown): Record<string, unknown> {
  // The merge result, keyed in first-seen order; never an alias of `base` or `over`.
  const out: Record<string, unknown> = {}
  // Base keys, or none when `base` is not a plain object.
  const bkeys = isPlainObject(base) ? Object.keys(base) : []
  // Overlay keys, or none when `over` is not a plain object.
  const okeys = isPlainObject(over) ? Object.keys(over) : []
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key)) continue
    // The base value at this key; undefined when absent, so `over` alone can win.
    const bv = isPlainObject(base) ? base[key] : undefined
    // The overlay value at this key; undefined falls back to the base value.
    const ov = isPlainObject(over) ? over[key] : undefined
    if (isPlainObject(bv) && isPlainObject(ov)) out[key] = deepMerge(bv, ov)
    else if (isPlainObject(bv) && ov === undefined) out[key] = deepMerge(bv, {})
    else out[key] = ov !== undefined ? ov : bv
  }
  return out
}

/** Read one path out of a parsed document; `undefined` when any segment is absent. */
export function getPath(value: unknown, path: readonly string[]): unknown {
  let cur: unknown = value
  for (const segment of path) {
    if (!isPlainObject(cur)) return undefined
    if (!Object.prototype.hasOwnProperty.call(cur, segment)) return undefined
    cur = cur[segment]
  }
  return cur
}
