// Refuse-first JSONC editor tests: a proven-span update must leave every byte
// OUTSIDE the span identical (comments, order, trailing commas), inserts must
// materialise missing parents, deletes must leave valid JSONC, and every
// ambiguity must refuse byte-untouched.
import { test, expect } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicWriteSiliconFile } from "../src/silicon/config"
import { DELETE, surgicalDelete, surgicalEdit } from "../src/silicon/jsonc-edit"
import { parseJsonc } from "../src/silicon/jsonc"

test("update an existing value: every byte outside the value span is unchanged", () => {
  const raw = `// head comment
{
  // keep this line
  "ossCadSuite": { "bin": "/old/bin", "home": "/old/home" }, // trailing note
  "verible": { "bin": "/opt/verible/bin" },
}
// tail comment
`
  const result = surgicalEdit(raw, ["ossCadSuite", "bin"], "/new/bin", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.changed).toBe(true)
  // The whole edit is exactly one span splice: byte-compare against the manual substitution.
  expect(result.text).toBe(raw.replace('"/old/bin"', '"/new/bin"'))
  expect(result.text).toContain("// head comment")
  expect(result.text).toContain("// keep this line")
  expect(result.text).toContain("// trailing note")
  expect(result.text).toContain("// tail comment")
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { bin: "/new/bin", home: "/old/home" },
    verible: { bin: "/opt/verible/bin" },
  })
})

test("insert a missing key keeps comments, key order and the trailing-comma style", () => {
  const raw = `{
  // oss-cad-suite first, deliberately
  "ossCadSuite": { "home": "/opt/oss" },
}
`
  const result = surgicalEdit(raw, ["verible", "bin"], "/opt/verible/bin", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toContain("// oss-cad-suite first, deliberately")
  expect(result.text.indexOf('"ossCadSuite"')).toBeLessThan(result.text.indexOf('"verible"'))
  // The document's trailing-comma style is preserved on the new member.
  expect(result.text).toContain('"bin": "/opt/verible/bin"')
  expect(result.text).toContain('  },\n}')
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { home: "/opt/oss" },
    verible: { bin: "/opt/verible/bin" },
  })
})

test("insert a path with a missing parent materialises the parent object", () => {
  const raw = `{
  // only a comment lives here for now
}
`
  const result = surgicalEdit(raw, ["librelane", "mode"], "auto", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toContain("// only a comment lives here for now")
  expect(parseJsonc(result.text)).toEqual({ librelane: { mode: "auto" } })
})

test("insert into an empty object keeps the document line ending", () => {
  const raw = '{\r\n}\r\n'
  const result = surgicalEdit(raw, ["verible", "home"], "/v", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toContain("\r\n")
  expect(parseJsonc(result.text)).toEqual({ verible: { home: "/v" } })
})

test("F3: a sibling insert keeps a trailing line comment on the preceding member", () => {
  const raw = `{
  "ossCadSuite": {
    "bin": "/opt/a"
  } // trailing note
}
`
  const result = surgicalEdit(raw, ["verible", "bin"], "/opt/b", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  // The comma lands BEFORE the comment, and the new member starts on the next line:
  // the comment stays attached to ossCadSuite, and every other byte is unchanged.
  expect(result.text).toBe(`{
  "ossCadSuite": {
    "bin": "/opt/a"
  }, // trailing note
  "verible": {
    "bin": "/opt/b"
  }
}
`)
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { bin: "/opt/a" },
    verible: { bin: "/opt/b" },
  })
})

test("F3 control: a sibling insert keeps a trailing block comment on the preceding member", () => {
  const raw = `{
  "ossCadSuite": { "bin": "/opt/a" } /* note */
}
`
  const result = surgicalEdit(raw, ["verible", "bin"], "/opt/b", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toBe(`{
  "ossCadSuite": { "bin": "/opt/a" }, /* note */
  "verible": {
    "bin": "/opt/b"
  }
}
`)
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { bin: "/opt/a" },
    verible: { bin: "/opt/b" },
  })
})

test("F3: a trailing comment after an existing comma stays on the preceding member", () => {
  const raw = `{
  "ossCadSuite": { "bin": "/opt/a" }, // trailing note
}
`
  const result = surgicalEdit(raw, ["verible", "bin"], "/opt/b", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toBe(`{
  "ossCadSuite": { "bin": "/opt/a" }, // trailing note
  "verible": {
    "bin": "/opt/b"
  }
}
`)
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { bin: "/opt/a" },
    verible: { bin: "/opt/b" },
  })
})

test("F3: a sibling insert preserves CRLF with a trailing line comment", () => {
  const raw = '{\r\n  "ossCadSuite": { "bin": "/opt/a" } // trailing note\r\n}\r\n'
  const result = surgicalEdit(raw, ["verible", "bin"], "/opt/b", { insert: true })
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toBe('{\r\n  "ossCadSuite": { "bin": "/opt/a" }, // trailing note\r\n  "verible": {\r\n    "bin": "/opt/b"\r\n  }\r\n}\r\n')
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { bin: "/opt/a" },
    verible: { bin: "/opt/b" },
  })
})

test("an identical edit is a byte-level no-op", () => {
  const raw = '{\n  "ossCadSuite": { "bin": "/opt/oss/bin" }\n}\n'
  const result = surgicalEdit(raw, ["ossCadSuite", "bin"], "/opt/oss/bin")
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.changed).toBe(false)
  expect(result.text).toBe(raw)
})

test("unset removes the member and exactly one adjacent comma, leaving valid JSONC", () => {
  const raw = `{
  // keep me
  "ossCadSuite": { "bin": "/opt/oss/bin", "home": "/opt/oss" },
  "verible": { "bin": "/opt/verible/bin" },
}
`
  const result = surgicalDelete(raw, ["ossCadSuite", "bin"])
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(result.text).toContain("// keep me")
  expect(result.text).not.toContain('"bin": "/opt/oss/bin"')
  expect(parseJsonc(result.text)).toEqual({
    ossCadSuite: { home: "/opt/oss" },
    verible: { bin: "/opt/verible/bin" },
  })
})

test("DELETE sentinel routes through the delete path", () => {
  const raw = '{\n  "librelane": { "mode": "auto" }\n}\n'
  const result = surgicalEdit(raw, ["librelane", "mode"], DELETE)
  expect(result.ok).toBe(true)
  if (result.ok !== true) return
  expect(parseJsonc(result.text)).toEqual({ librelane: {} })
})

test("a malformed document is refused (byte-untouched), never best-effort edited", () => {
  const raw = '{ "ossCadSuite": { "bin": "/opt/oss/bin" '
  const result = surgicalEdit(raw, ["ossCadSuite", "bin"], "/new")
  expect(result.ok).toBe(false)
  if (result.ok !== false) return
  expect(result.reason).toBe("unparsable")
})

test("a duplicated INTERMEDIATE key is ambiguous and refused", () => {
  const raw = '{\n  "ossCadSuite": { "bin": "/a" },\n  "ossCadSuite": { "home": "/b" }\n}\n'
  const result = surgicalEdit(raw, ["ossCadSuite", "bin"], "/new")
  expect(result.ok).toBe(false)
  if (result.ok !== false) return
  expect(result.reason).toBe("ambiguous-intermediate")
})

test("atomicWriteSiliconFile: content, mode 0644, sibling temp cleaned, parent mkdir -p", () => {
  const dir = mkdtempSync(join(tmpdir(), "silicon-atomic-"))
  const target = join(dir, "nested", "deeper", "silicon.jsonc")
  atomicWriteSiliconFile(target, '{ "a": 1 }\n')
  expect(readFileSync(target, "utf8")).toBe('{ "a": 1 }\n')
  expect(statSync(target).mode & 0o777).toBe(0o644)
  const leftovers = readdirSync(join(dir, "nested", "deeper")).filter((f) => f.endsWith(".tmp"))
  expect(leftovers).toEqual([])
})
