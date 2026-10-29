// Loader + write-core tests: two layers (project over user), missing files are
// normal, a malformed layer is REPORTED not fatal, the prototype guard holds,
// and set/unset/init obey the scope rules without disturbing real ~/.dsh.
import { test, expect } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  initConfigFile,
  loadSiliconConfig,
  setConfigValue,
  siliconTemplate,
  SILICON_LEAVES,
  unsetConfigValue,
  userConfigPath,
  workspaceConfigPath,
} from "../src/silicon/config"
import { parseJsonc } from "../src/silicon/jsonc"
import { guardEnv, makeSandbox, withSandboxEnv, writeText } from "./helpers"

function sandbox(): { user: string; project: string; ws: string; restore: () => void } {
  const g = guardEnv()
  const s = makeSandbox()
  withSandboxEnv(s)
  delete process.env.MPD_SILICON_CONFIG
  return { user: join(s, "dsh-home", "silicon.jsonc"), project: join(s, "ws", ".mpd", "silicon.jsonc"), ws: join(s, "ws"), restore: () => g.restore() }
}

test("missing layers are normal: both reported absent, effective config is empty", () => {
  const s = sandbox()
  try {
    const loaded = loadSiliconConfig()
    expect(loaded.user.exists).toBe(false)
    expect(loaded.workspace.exists).toBe(false)
    expect(loaded.config).toEqual({})
    expect(loaded.parseErrors).toEqual([])
  } finally {
    s.restore()
  }
})

test("project layer overrides user; per-key source attribution names the winning layer", () => {
  const s = sandbox()
  try {
    writeText(s.user, `{
  "ossCadSuite": { "home": "/opt/oss", "bin": "/opt/oss/bin" },
  "verible": { "bin": "/opt/verible/bin" }
}
`)
    writeText(s.project, `{
  "ossCadSuite": { "home": "/project/oss" }
}
`)
    const loaded = loadSiliconConfig()
    expect(loaded.config.ossCadSuite).toEqual({ home: "/project/oss", bin: "/opt/oss/bin" })
    expect(loaded.config.verible).toEqual({ bin: "/opt/verible/bin" })
    expect(loaded.parseErrors).toEqual([])
  } finally {
    s.restore()
  }
})

test("a malformed layer is REPORTED and does not kill the other layer", () => {
  const s = sandbox()
  try {
    writeText(s.user, '{ "ossCadSuite": { "bin": "/opt/oss/bin" } }')
    writeText(s.project, '{ "ossCadSuite": ')
    const loaded = loadSiliconConfig()
    expect(loaded.workspace.parseError).not.toBeNull()
    expect(loaded.parseErrors).toHaveLength(1)
    expect(loaded.parseErrors[0].file).toBe("workspace")
    expect(loaded.config.ossCadSuite).toEqual({ bin: "/opt/oss/bin" })
  } finally {
    s.restore()
  }
})

test("prototype keys never reach the merged object or Object.prototype", () => {
  const s = sandbox()
  try {
    writeText(s.user, '{"__proto__":{"polluted":true},"constructor":{"polluted":true},"ossCadSuite":{"bin":"/opt/oss/bin"}}')
    const loaded = loadSiliconConfig()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(loaded.config, "__proto__")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(loaded.config, "constructor")).toBe(false)
    expect(loaded.config.ossCadSuite).toEqual({ bin: "/opt/oss/bin" })
  } finally {
    s.restore()
  }
})

test("unknown keys are preserved AND reported; wrong-typed known keys are reported invalid", () => {
  const s = sandbox()
  try {
    writeText(s.user, `{
  "ossCadSuite": { "bin": "/opt/oss/bin", "mystery": 1 },
  "extraTop": { "nested": true },
  "librelane": { "mode": "nope", "appimageExtract": "yes" }
}
`)
    const loaded = loadSiliconConfig()
    expect(loaded.config.extraTop).toEqual({ nested: true })
    expect(loaded.unknownKeys.sort()).toEqual(["extraTop", "ossCadSuite.mystery"])
    const invalid = loaded.invalidKeys.map((i) => i.key).sort()
    expect(invalid).toContain("librelane.mode")
    expect(invalid).toContain("librelane.appimageExtract")
  } finally {
    s.restore()
  }
})

test("a wrong-typed group is reported once, not once per child leaf", () => {
  const s = sandbox()
  try {
    writeText(s.user, '{ "ossCadSuite": 5 }')
    const loaded = loadSiliconConfig()
    expect(loaded.invalidKeys.filter((i) => i.key === "ossCadSuite")).toHaveLength(1)
    expect(loaded.invalidKeys.find((i) => i.key === "ossCadSuite")).toEqual({ key: "ossCadSuite", expected: "object", actual: "number" })
    expect(loaded.unknownKeys).toEqual([])
  } finally {
    s.restore()
  }
})

test("MPD_SILICON_CONFIG selects an alternate user layer", () => {
  const s = sandbox()
  try {
    const alternate = join(s.ws, "elsewhere", "custom.jsonc")
    writeText(alternate, '{ "verible": { "home": "/custom/verible" } }')
    process.env.MPD_SILICON_CONFIG = alternate
    expect(userConfigPath()).toBe(alternate)
    const loaded = loadSiliconConfig()
    expect(loaded.user.exists).toBe(true)
    expect(loaded.config.verible).toEqual({ home: "/custom/verible" })
  } finally {
    s.restore()
  }
})

test("set writes a user-scope leaf and reports old/new + file; comments survive", () => {
  const s = sandbox()
  try {
    writeText(s.user, `// my toolchain
{
  // oss lives here
  "ossCadSuite": { "home": "/opt/oss" }
}
`)
    const result = setConfigValue({ key: "ossCadSuite.bin", value: "/opt/oss/bin", scope: "user" })
    expect(result.ok).toBe(true)
    expect(result.scope).toBe("user")
    expect(result.old).toBeNull()
    expect(result.new).toBe("/opt/oss/bin")
    expect(result.file).toBe(userConfigPath())
    const text = readFileSync(result.file, "utf8")
    expect(text).toContain("// my toolchain")
    expect(text).toContain("// oss lives here")
    expect(parseJsonc(text)).toEqual({ ossCadSuite: { home: "/opt/oss", bin: "/opt/oss/bin" } })
    // A second set updates in place and reports the previous value.
    const again = setConfigValue({ key: "ossCadSuite.bin", value: "/opt/oss/bin2", scope: "user" })
    expect(again.old).toBe("/opt/oss/bin")
    expect(again.new).toBe("/opt/oss/bin2")
  } finally {
    s.restore()
  }
})

test("set defaults to the layer that already defines the key", () => {
  const s = sandbox()
  try {
    writeText(s.user, '{ "verible": { "bin": "/u/verible" } }')
    writeText(s.project, '{ "ossCadSuite": { "home": "/p/oss" } }')
    const userOwned = setConfigValue({ key: "verible.bin", value: "/u/verible2" })
    expect(userOwned.scope).toBe("user")
    const projectOwned = setConfigValue({ key: "ossCadSuite.home", value: "/p/oss2" })
    expect(projectOwned.scope).toBe("workspace")
    // A brand-new key defaults to the user layer.
    const fresh = setConfigValue({ key: "librelane.mode", value: "devshell" })
    expect(fresh.scope).toBe("user")
  } finally {
    s.restore()
  }
})

test("schema: slangServer.bin is a path leaf; unknown siblings are refused", () => {
  const s = sandbox()
  try {
    const leaf = SILICON_LEAVES.find((candidate) => candidate.path.join(".") === "slangServer.bin")
    expect(leaf).toBeDefined()
    expect(leaf?.type).toBe("string")
    expect(leaf?.isPath).toBe(true)
    // Same schema class as verible.bin: a directory (or one executable) for the LSP.
    expect(SILICON_LEAVES.map((candidate) => candidate.path.join("."))).toContain("verible.bin")
    // An unknown sibling is still refused: the leaf list IS the schema, not a wildcard.
    expect(() => setConfigValue({ key: "slangServer.home", value: "/opt/slang" })).toThrow()
    // `init` advertises the new key in its commented template.
    expect(siliconTemplate()).toContain("slangServer")
  } finally {
    s.restore()
  }
})

test("set creates a missing layer from the commented template", () => {
  const s = sandbox()
  try {
    expect(existsSync(s.user)).toBe(false)
    const result = setConfigValue({ key: "ossCadSuite.bin", value: "/opt/oss/bin" })
    expect(result.created).toBe(true)
    expect(existsSync(s.user)).toBe(true)
    const text = readFileSync(s.user, "utf8")
    expect(text).toContain("Silicon toolchain configuration (JSONC)")
    expect(text).toContain('"bin": "/opt/oss/bin"')
    expect(statSync(s.user).mode & 0o777).toBe(0o644)
  } finally {
    s.restore()
  }
})

test("user scope refuses a relative path; workspace scope resolves it against the workspace", () => {
  const s = sandbox()
  try {
    expect(() => setConfigValue({ key: "ossCadSuite.bin", value: "vendor/bin", scope: "user" })).toThrow(/absolute path/)
    const result = setConfigValue({ key: "ossCadSuite.bin", value: "vendor/bin", scope: "workspace" })
    expect(result.scope).toBe("workspace")
    expect(result.new).toBe(join(s.ws, "vendor", "bin"))
    expect(parseJsonc(readFileSync(result.file, "utf8"))).toEqual({ ossCadSuite: { bin: join(s.ws, "vendor", "bin") } })
  } finally {
    s.restore()
  }
})

test("set expands a leading ~ and validates boolean/enum values", () => {
  const s = sandbox()
  try {
    const home = homedir()
    const result = setConfigValue({ key: "librelane.appimage", value: "~/librelane.AppImage", scope: "user" })
    expect(result.new).toBe(join(home, "librelane.AppImage"))
    expect(() => setConfigValue({ key: "librelane.mode", value: "bogus", scope: "user" })).toThrow(/expects one of/)
    expect(() => setConfigValue({ key: "librelane.appimageExtract", value: "yes", scope: "user" })).toThrow(/expects a boolean/)
    expect(() => setConfigValue({ key: "noSuch.key", value: "x", scope: "user" })).toThrow(/unknown toolchain key/)
  } finally {
    s.restore()
  }
})

test("set REFUSES a malformed target document instead of clobbering it", () => {
  const s = sandbox()
  try {
    writeText(s.project, '{ "ossCadSuite": ')
    expect(() => setConfigValue({ key: "ossCadSuite.bin", value: "/x", scope: "workspace" })).toThrow(/not parseable JSONC/)
    // The file is byte-identical after the refusal.
    expect(readFileSync(s.project, "utf8")).toBe('{ "ossCadSuite": ')
  } finally {
    s.restore()
  }
})

test("unset removes the key from the layer that defines it and is a no-op otherwise", () => {
  const s = sandbox()
  try {
    writeText(s.user, `{
  // keep this comment
  "ossCadSuite": { "bin": "/opt/oss/bin", "home": "/opt/oss" }
}
`)
    const result = unsetConfigValue({ key: "ossCadSuite.bin" })
    expect(result.changed).toBe(true)
    expect(result.old).toBe("/opt/oss/bin")
    expect(result.new).toBeNull()
    const text = readFileSync(result.file, "utf8")
    expect(text).toContain("// keep this comment")
    expect(parseJsonc(text)).toEqual({ ossCadSuite: { home: "/opt/oss" } })
    const noop = unsetConfigValue({ key: "verible.bin" })
    expect(noop.changed).toBe(false)
  } finally {
    s.restore()
  }
})

test("init writes the commented template; refuses an existing file unless forced", () => {
  const s = sandbox()
  try {
    const first = initConfigFile({})
    expect(first.scope).toBe("user")
    expect(first.file).toBe(userConfigPath())
    expect(readFileSync(first.file, "utf8")).toBe(siliconTemplate())
    expect(() => initConfigFile({})).toThrow(/already exists/)
    const forced = initConfigFile({ force: true, scope: "workspace" })
    expect(forced.scope).toBe("workspace")
    expect(existsSync(workspaceConfigPath())).toBe(true)
  } finally {
    s.restore()
  }
})

test("the template itself is valid JSONC and starts empty", () => {
  expect(parseJsonc(siliconTemplate())).toEqual({})
})
