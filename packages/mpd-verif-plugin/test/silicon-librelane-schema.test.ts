// LibreLane OUTPUT-SCHEMA regression (schema-level, not execute()-level).
//
// A real headless dsh session rejected `mpd_verif_librelane {action:"status"}` with
//   tool "mpd_verif_librelane" returned invalid output:
//     "value.appimageExtract" must be a boolean; "value.version" must be a string
// Direct execute() tests passed because they never run the harness output validation,
// so this suite validates every result shape against the tool's OWN output.schema.
//
// The harness accepts a CLOSED JSON-Schema subset (dsh-tools/lib/index.js):
//   type/oneOf/properties/required/additionalProperties/items/enum/const + annotations.
// Type arrays ("type": ["boolean","null"]) and anyOf are REJECTED as unsupported keywords,
// so nullable fields must be oneOf [<type>, null]. The two checkers below mirror that
// subset exactly; they are local because the repository ships no schema validator and
// must stay dependency-free. Their negative controls prove they still bite.
import { test, expect } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { apply } from "../src/index"
import { guardEnv, makeSandbox, mpdCtx, undefinedPaths, withSandboxEnv, writeBin, writeText } from "./helpers"

type Schema = Record<string, unknown>

const SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"]
const CONSTRAINT_KEYWORDS = new Set(["type", "oneOf", "properties", "required", "additionalProperties", "items", "enum", "const"])
const ANNOTATION_KEYWORDS = new Set(["description", "title", "default", "examples"])
const ONE_OF_SIBLING_KEYWORDS = ["properties", "required", "additionalProperties", "items", "enum", "const"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function scalarMatches(type: string, value: unknown): boolean {
  if (type === "string") return typeof value === "string"
  if (type === "number") return isJsonNumber(value)
  if (type === "integer") return isJsonNumber(value) && Number.isInteger(value)
  if (type === "boolean") return typeof value === "boolean"
  return value === null
}

// Schema conformance: the harness rejects a schema outside its keyword subset BEFORE it
// validates any value, so a schema using type arrays would still fail at registration.
function schemaViolations(schema: unknown, path = "schema"): string[] {
  if (!isRecord(schema)) return [path + " must be a schema object"]
  const found: string[] = []
  for (const key of Object.keys(schema)) {
    if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      found.push(path + "." + key + " is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)")
    }
  }
  const hasType = Object.hasOwn(schema, "type")
  const hasOneOf = Object.hasOwn(schema, "oneOf")
  if (hasType && hasOneOf) return [...found, path + " cannot declare both type and oneOf"]
  if (hasOneOf) {
    const branches = schema.oneOf
    if (!Array.isArray(branches) || branches.length < 2) found.push(path + ".oneOf must be an array of at least two schemas")
    else branches.forEach((branch, index) => found.push(...schemaViolations(branch, path + ".oneOf[" + index + "]")))
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(schema, key)) found.push(path + "." + key + " is not supported beside oneOf")
    }
    return found
  }
  const type = schema.type
  if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
    found.push(Array.isArray(type) ? path + ".type must be a single type string (type arrays are not supported)" : path + ".type must be one of " + SCHEMA_TYPES.join("/"))
    return found
  }
  const allowedTypes: Record<string, string[]> = {
    properties: ["object"],
    required: ["object"],
    additionalProperties: ["object"],
    items: ["array"],
    enum: ["string", "number", "integer", "boolean", "null"],
    const: ["string", "number", "integer", "boolean", "null"],
  }
  for (const [key, types] of Object.entries(allowedTypes)) {
    if (Object.hasOwn(schema, key) && !types.includes(type)) found.push(path + "." + key + " is not supported on type \"" + type + "\"")
  }
  if (type === "object") {
    const properties = schema.properties
    if (Object.hasOwn(schema, "properties")) {
      if (!isRecord(properties)) found.push(path + ".properties must be an object of schemas")
      else for (const [key, child] of Object.entries(properties)) found.push(...schemaViolations(child, path + ".properties." + key))
    }
    if (Object.hasOwn(schema, "required")) {
      const required = schema.required
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) found.push(path + ".required must be an array of strings")
      else {
        for (const key of required) {
          if (!isRecord(properties) || !Object.hasOwn(properties, key)) found.push(path + ".required names \"" + key + "\" which is not in properties")
        }
      }
    }
    if (Object.hasOwn(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") found.push(path + ".additionalProperties must be a boolean")
  }
  if (type === "array" && Object.hasOwn(schema, "items")) found.push(...schemaViolations(schema.items, path + ".items"))
  if (type === "string" || type === "number" || type === "integer" || type === "boolean" || type === "null") {
    if (Object.hasOwn(schema, "enum")) {
      const allowed = schema.enum
      if (!Array.isArray(allowed) || allowed.length === 0 || allowed.some((entry) => !scalarMatches(type, entry))) found.push(path + ".enum must be a non-empty array of " + type + " values")
    }
    if (Object.hasOwn(schema, "const") && !scalarMatches(type, schema.const)) found.push(path + ".const must be a " + type + " value")
  }
  return found
}

function scalarViolations(schema: Schema, value: unknown, path: string): string[] {
  const found: string[] = []
  if (Object.hasOwn(schema, "enum") && !(schema.enum as unknown[]).includes(value)) found.push("\"" + path + "\" must be one of " + JSON.stringify(schema.enum))
  if (Object.hasOwn(schema, "const") && schema.const !== value) found.push("\"" + path + "\" must equal " + JSON.stringify(schema.const))
  return found
}

// Value validation, mirroring the harness's oneOf = exactly-one semantics.
function valueViolations(schema: Schema, value: unknown, path = "value"): string[] {
  if (Object.hasOwn(schema, "oneOf")) {
    const branches = schema.oneOf as Schema[]
    const matches = branches.filter((branch) => valueViolations(branch, value, path).length === 0).length
    return matches === 1 ? [] : ["\"" + path + "\" must match exactly one oneOf branch (matched " + matches + ")"]
  }
  const type = schema.type as string
  switch (type) {
    case "object": {
      if (!isRecord(value)) return ["\"" + path + "\" must be an object"]
      const properties = isRecord(schema.properties) ? schema.properties : {}
      const found: string[] = []
      const required = Array.isArray(schema.required) ? schema.required : []
      for (const key of required) {
        if (typeof key === "string" && (!Object.hasOwn(value, key) || value[key] === undefined)) found.push("missing required property \"" + path + "." + key + "\"")
      }
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) continue
        if (isRecord(child)) found.push(...valueViolations(child, value[key], path + "." + key))
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) found.push("\"" + path + "." + key + "\" is not a declared property (additionalProperties: false)")
        }
      }
      return found
    }
    case "array": {
      if (!Array.isArray(value)) return ["\"" + path + "\" must be an array"]
      if (!isRecord(schema.items)) return []
      const items = schema.items
      return value.flatMap((entry, index) => valueViolations(items, entry, path + "[" + index + "]"))
    }
    case "string":
      return typeof value === "string" ? scalarViolations(schema, value, path) : ["\"" + path + "\" must be a string"]
    case "number":
      return isJsonNumber(value) ? scalarViolations(schema, value, path) : ["\"" + path + "\" must be a number"]
    case "integer":
      return isJsonNumber(value) && Number.isInteger(value) ? scalarViolations(schema, value, path) : ["\"" + path + "\" must be an integer"]
    case "boolean":
      return typeof value === "boolean" ? scalarViolations(schema, value, path) : ["\"" + path + "\" must be a boolean"]
    case "null":
      return value === null ? scalarViolations(schema, value, path) : ["\"" + path + "\" must be null"]
    default:
      return [path + " has an unsupported type"]
  }
}

interface ToolDef {
  name: string
  output: { schema: Schema; render: (a: unknown, v: unknown) => { type: string; text: string }[] }
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown>
}

function librelaneTool(): ToolDef {
  const regs: unknown[] = []
  apply(mpdCtx({ tools: { register: (definition: unknown) => regs.push(definition) } }) as never)
  const found = regs.find((definition) => isRecord(definition) && definition.name === "mpd_verif_librelane")
  if (!isRecord(found)) throw new Error("mpd_verif_librelane was not registered")
  return found as unknown as ToolDef
}

interface TestSandbox {
  dir: string
  ws: string
  restore: () => void
}

function sandbox(): TestSandbox {
  const guard = guardEnv()
  const dir = makeSandbox()
  withSandboxEnv(dir)
  delete process.env.MPD_SILICON_CONFIG
  delete process.env.MPD_SILICON_LIBRELANE
  delete process.env.MPD_SILICON_LIBRELANE_APPIMAGE
  delete process.env.APPIMAGE_EXTRACT_AND_RUN
  return { dir, ws: join(dir, "ws"), restore: () => guard.restore() }
}

function writeConfig(ws: string, config: unknown): void {
  writeText(join(ws, ".mpd", "silicon.jsonc"), JSON.stringify(config, null, 2))
}

const VERSION_SCRIPT = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "LibreLane v3.0.16"; exit 0; fi
exit 0
`

/** A binary killed by its own signal: exitCode null, signal set, timedOut false. */
const SIGNAL_SCRIPT = `#!/bin/sh
echo "about to die"
kill -TERM $$
`

/** A run that exits 7 after one line of output. */
const FAIL_SCRIPT = `#!/bin/sh
echo "flow failed"
exit 7
`

const DEVSHELL_SCRIPT = `#!/bin/sh
exec "$@"
`

function fakeLibreLane(dir: string, script = VERSION_SCRIPT): string {
  return writeBin(dir, "librelane", script)
}

// Every result must be BOTH schema-valid and lossless JSON: the harness snapshots the
// value before validating it, so an undefined-valued key fails one step earlier.
function expectValid(tool: ToolDef, value: unknown): void {
  expect(valueViolations(tool.output.schema, value)).toEqual([])
  expect(undefinedPaths(value)).toEqual([])
  // the render runs on the same value and must not throw
  expect(tool.output.render({}, value)[0].type).toBe("text")
}

test("the declared output schema is inside the harness's closed subset", () => {
  const tool = librelaneTool()
  expect(schemaViolations(tool.output.schema)).toEqual([])
  // negative controls: the checker must reject the two shapes the harness rejects,
  // otherwise a type-array "fix" would pass this suite and fail in the host.
  expect(schemaViolations({ type: ["boolean", "null"] })).not.toEqual([])
  expect(schemaViolations({ anyOf: [{ type: "boolean" }, { type: "null" }] })).not.toEqual([])
  expect(schemaViolations({ type: "object", properties: { ok: { type: "boolean" } }, required: ["missing"] })).not.toEqual([])
  expect(schemaViolations({ type: "object", properties: { ok: { type: "string", items: { type: "string" } } } })).not.toEqual([])
})

test("status (binary) validates: appimageExtract null is NOT APPLICABLE, version is a string", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"))
    writeConfig(s.ws, { librelane: { bin } })
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "status" })) as Record<string, unknown>
    expect(res.appimageExtract).toBeNull()
    expect(res.version).toBe("3.0.16")
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("status (binary, configured but missing) validates: version null when the probe was skipped", async () => {
  const s = sandbox()
  try {
    writeConfig(s.ws, { librelane: { bin: join(s.dir, "no-such-librelane") } })
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "status" })) as Record<string, unknown>
    expect(res.exists).toBe(false)
    expect(res.appimageExtract).toBeNull()
    expect(res.version).toBeNull()
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("status (devshell) validates: appimageExtract is a real boolean, not null", async () => {
  const s = sandbox()
  try {
    const image = writeBin(join(s.dir, "images"), "librelane-devshell-x86_64.AppImage", DEVSHELL_SCRIPT)
    const ossBin = join(s.dir, "oss-bin")
    fakeLibreLane(ossBin)
    writeConfig(s.ws, { librelane: { appimage: image, appimageExtract: true }, ossCadSuite: { bin: ossBin } })
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "status" })) as Record<string, unknown>
    expect(res.mode).toBe("devshell")
    expect(res.appimageExtract).toBe(true)
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("status unresolved (structured refusal) validates: {ok:false, error:{code,message,hint}}", async () => {
  const s = sandbox()
  try {
    const emptyPath = join(s.dir, "empty-path")
    mkdirSync(emptyPath, { recursive: true })
    process.env.PATH = emptyPath
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "status" })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect(isRecord(res.error)).toBe(true)
    expect((res.error as Record<string, unknown>).code).toBe("VERIF_E_NO_BACKEND")
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("run success validates: cwd/signal/timedOut/spawnError are now described", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"), `#!/bin/sh
echo "argv:$*"
exit 0
`)
    writeConfig(s.ws, { librelane: { bin } })
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "run", args: ["--smoke-test"] })) as Record<string, unknown>
    expect(res.ok).toBe(true)
    expect(res.exitCode).toBe(0)
    expect(res.cwd).toBe(s.ws)
    expect(res.timedOut).toBe(false)
    expect(res.signal).toBeNull()
    expect(res.spawnError).toBeNull()
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("run non-zero exit validates: ok false with a numeric exitCode", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"), FAIL_SCRIPT)
    writeConfig(s.ws, { librelane: { bin } })
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "run", args: ["--smoke-test"] })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(7)
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("run killed by a signal validates: exitCode null, signal set", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"), SIGNAL_SCRIPT)
    writeConfig(s.ws, { librelane: { bin } })
    const tool = librelaneTool()
    const res = (await tool.execute({ action: "run", args: ["--smoke-test"] })) as Record<string, unknown>
    expect(res.exitCode).toBeNull()
    expect(typeof res.signal).toBe("string")
    expect(res.timedOut).toBe(false)
    expectValid(tool, res)
  } finally {
    s.restore()
  }
})

test("regression control: the PRE-FIX nullability still fails on the real binary-mode value", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"))
    writeConfig(s.ws, { librelane: { bin } })
    const tool = librelaneTool()
    const ok = (await tool.execute({ action: "status" })) as Record<string, unknown>
    const preFix: Schema = {
      type: "object",
      properties: { appimageExtract: { type: "boolean" }, version: { type: "string" } },
    }
    // exactly the harness's rejection of the shipped schema
    expect(valueViolations(preFix, ok)).toEqual(["\"value.appimageExtract\" must be a boolean"])

    writeConfig(s.ws, { librelane: { bin: join(s.dir, "no-such-librelane") } })
    const missing = (await tool.execute({ action: "status" })) as Record<string, unknown>
    expect(valueViolations(preFix, missing)).toEqual([
      "\"value.appimageExtract\" must be a boolean",
      "\"value.version\" must be a string",
    ])
  } finally {
    s.restore()
  }
})
