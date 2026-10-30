// JSONC core tests: the string-aware stripper (comments, trailing commas,
// comment-looking string content, escapes) and the prototype-safe deep merge.
import { test, expect } from "bun:test"
import { deepMerge, getPath, parseJsonc, RESERVED_KEYS, stripJsonc } from "../src/silicon/jsonc"

test("stripJsonc removes line and block comments and still parses", () => {
  const raw = `{
    // a line comment
    "ossCadSuite": { "bin": "/opt/oss/bin" }, /* an inline block */
    "verible": { "bin": "/opt/verible/bin" } // trailing line comment
  }`
  const stripped = stripJsonc(raw)
  expect(stripped).not.toContain("//")
  expect(stripped).not.toContain("/*")
  expect(parseJsonc(raw)).toEqual({
    ossCadSuite: { bin: "/opt/oss/bin" },
    verible: { bin: "/opt/verible/bin" },
  })
})

test("stripJsonc drops trailing commas before } and ] (including across comments)", () => {
  const raw = `{
    "librelane": { "mode": "auto", /* keep style */ },
    "list": [1, 2, 3,],
  }`
  expect(parseJsonc(raw)).toEqual({ librelane: { mode: "auto" }, list: [1, 2, 3] })
})

test("comment-looking text inside strings survives untouched", () => {
  const raw = `{
    "url": "https://example.com/a//b",
    "glob": "src/**/*.sv",
    "note": "// not a comment",
    "block": "/* not a comment */"
  }`
  const stripped = stripJsonc(raw)
  expect(stripped).toContain("https://example.com/a//b")
  expect(stripped).toContain("src/**/*.sv")
  expect(stripped).toContain("// not a comment")
  expect(stripped).toContain("/* not a comment */")
  expect(parseJsonc(raw)).toEqual({
    url: "https://example.com/a//b",
    glob: "src/**/*.sv",
    note: "// not a comment",
    block: "/* not a comment */",
  })
})

test("escapes are honoured: an escaped quote does not end the string", () => {
  const raw = String.raw`{"q":"a\"//b","p":"C:\\tools\\oss"}`
  const value = parseJsonc(raw) as { q: string; p: string }
  expect(value.q).toBe('a"//b')
  expect(value.p).toBe("C:\\tools\\oss")
})

test("an unterminated document reaches JSON.parse and throws (no crash inside the scanner)", () => {
  expect(() => parseJsonc('{ "a": 1 /* unterminated')).toThrow()
})

test("deepMerge recurses into objects and replaces scalars and arrays", () => {
  const user = { ossCadSuite: { home: "/u/home", bin: "/u/bin" }, list: [1, 2], keep: "yes" }
  const project = { ossCadSuite: { home: "/p/home" }, list: [3], extra: true }
  expect(deepMerge(user, project)).toEqual({
    ossCadSuite: { home: "/p/home", bin: "/u/bin" },
    list: [3],
    keep: "yes",
    extra: true,
  })
})

test("deepMerge refuses __proto__ / prototype / constructor keys", () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"prototype":{"polluted":true},"constructor":{"polluted":true},"safe":1}') as Record<string, unknown>
  const merged = deepMerge({}, hostile)
  expect(merged).toEqual({ safe: 1 })
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  for (const key of RESERVED_KEYS) expect(Object.prototype.hasOwnProperty.call(merged, key)).toBe(false)
})

test("deepMerge never aliases its inputs", () => {
  const user = { ossCadSuite: { home: "/u" } }
  const merged = deepMerge(user, {})
  ;(merged.ossCadSuite as Record<string, unknown>).home = "/changed"
  expect(user.ossCadSuite.home).toBe("/u")
})

test("getPath reads own properties only and returns undefined on any miss", () => {
  const value = { ossCadSuite: { bin: "/opt/oss/bin" } }
  expect(getPath(value, ["ossCadSuite", "bin"])).toBe("/opt/oss/bin")
  expect(getPath(value, ["ossCadSuite", "home"])).toBeUndefined()
  expect(getPath(value, ["ossCadSuite", "bin", "nested"])).toBeUndefined()
  expect(getPath(value, ["constructor"])).toBeUndefined()
})
