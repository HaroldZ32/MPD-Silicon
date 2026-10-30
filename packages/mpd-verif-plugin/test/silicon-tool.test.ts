// Tool tests: the ninth mpd_verif_toolchain tool, exercised through the SAME
// registration path the harness uses, against a temp workspace + temp DSH_HOME.
// The real ~/.dsh is never touched (helpers.withSandboxEnv sets both roots).
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { apply } from "../src/index"
import { parseJsonc } from "../src/silicon/jsonc"
import { guardEnv, makeSandbox, mpdCtx, undefinedPaths, withSandboxEnv, writeBin, writeText } from "./helpers"

interface ToolDef {
  name: string
  parameters: any
  output: { schema: any; render: (a: unknown, v: unknown) => { type: string; text: string }[] }
  execute: (args: any, exec?: any) => Promise<any>
}

function toolchainTool(): ToolDef {
  const regs: any[] = []
  apply(mpdCtx({ tools: { register: (d: any) => regs.push(d) } }) as any)
  const found = regs.find((d) => d.name === "mpd_verif_toolchain")
  if (!found) throw new Error("mpd_verif_toolchain was not registered")
  return found as ToolDef
}

function sandbox(): { user: string; project: string; ws: string; restore: () => void } {
  const g = guardEnv()
  const s = makeSandbox()
  withSandboxEnv(s)
  delete process.env.MPD_SILICON_CONFIG
  return { user: join(s, "dsh-home", "silicon.jsonc"), project: join(s, "ws", ".mpd", "silicon.jsonc"), ws: join(s, "ws"), restore: () => g.restore() }
}

test("apply registers the silicon-toolchain prompt section through the adapter seam", () => {
  const sections: any[] = []
  const regs: any[] = []
  apply(mpdCtx({
    tools: { register: (d: any) => regs.push(d) },
    systemPrompt: { section: (s: any) => { sections.push(s); return () => {} } },
  }) as any)
  const section = sections.find((s) => s.name === "silicon-toolchain")
  expect(section).toBeDefined()
  expect(section.order).toBe(30)
  expect(typeof section.text).toBe("string")
  expect(section.text).toContain("mpd_verif_toolchain")
  expect(section.text).toContain("silicon.jsonc")
})

test("a composition without the systemPrompt seam still boots (the section is optional)", () => {
  expect(() => apply(mpdCtx({ tools: { register: () => {} } }) as any)).not.toThrow()
})

test("path: reports both layer paths, DSH_HOME and the workspace without creating anything", async () => {
  const s = sandbox()
  try {
    const res = await toolchainTool().execute({ action: "path" })
    expect(res.ok).toBe(true)
    expect(res.userFile.path).toBe(s.user)
    expect(res.workspaceFile.path).toBe(s.project)
    expect(res.userFile.exists).toBe(false)
    expect(res.workspaceFile.exists).toBe(false)
    expect(existsSync(s.user)).toBe(false)
    expect(existsSync(s.project)).toBe(false)
  } finally {
    s.restore()
  }
})

test("init writes a commented template; a second init refuses without force", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    const first = await tool.execute({ action: "init" })
    expect(first.ok).toBe(true)
    expect(first.scope).toBe("user")
    expect(readFileSync(s.user, "utf8")).toContain("Silicon toolchain configuration (JSONC)")
    const second = await tool.execute({ action: "init" })
    expect(second.ok).toBe(false)
    expect(second.error.code).toBe("VERIF_E_CONFIG")
    expect(second.error.hint).toContain("force=true")
  } finally {
    s.restore()
  }
})

test("set (user) then show reports the value, its source layer and the resolved binary", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    const binDir = join(s.ws, "oss-bin")
    writeBin(binDir, "iverilog", "#!/bin/sh\necho 'Icarus Verilog version 12.0 (fake)'\nexit 0\n")
    const set = await tool.execute({ action: "set", key: "ossCadSuite.bin", value: binDir, scope: "user" })
    expect(set.ok).toBe(true)
    expect(set.old).toBeNull()
    expect(set.new).toBe(binDir)
    expect(set.file).toBe(s.user)
    expect(existsSync(s.user)).toBe(true)

    const shown = await tool.execute({ action: "show" })
    expect(shown.ok).toBe(true)
    expect(shown.config.ossCadSuite.bin).toBe(binDir)
    expect(shown.sources["ossCadSuite.bin"]).toBe("user")
    const iverilog = shown.backends.find((b: any) => b.name === "iverilog")
    expect(iverilog.source).toBe("config")
    expect(iverilog.binary).toBe(join(binDir, "iverilog"))
    expect(iverilog.exists).toBe(true)
    expect(iverilog.executable).toBe(true)
    expect(iverilog.version).toContain("Icarus Verilog")
    expect(shown.userFile.path).toBe(s.user)
    expect(shown.workspaceFile.path).toBe(s.project)
    expect(undefinedPaths(shown)).toEqual([])
  } finally {
    s.restore()
  }
})

test("workspace scope resolves a relative path before writing; project layer overrides", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    const set = await tool.execute({ action: "set", key: "ossCadSuite.home", value: "vendor/oss", scope: "workspace" })
    expect(set.ok).toBe(true)
    expect(set.new).toBe(join(s.ws, "vendor", "oss"))
    expect(set.file).toBe(s.project)
    expect(parseJsonc(readFileSync(s.project, "utf8"))).toEqual({ ossCadSuite: { home: join(s.ws, "vendor", "oss") } })
    const shown = await tool.execute({ action: "show", key: "ossCadSuite.home" })
    expect(shown.key).toEqual({ key: "ossCadSuite.home", value: join(s.ws, "vendor", "oss"), source: "workspace" })
  } finally {
    s.restore()
  }
})

test("set defaults to the defining layer; unset removes it and reports the old value", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    await tool.execute({ action: "set", key: "verible.bin", value: "/opt/verible/bin", scope: "user" })
    await tool.execute({ action: "set", key: "librelane.mode", value: "devshell", scope: "user" })
    const updated = await tool.execute({ action: "set", key: "librelane.mode", value: "binary" })
    expect(updated.scope).toBe("user")
    expect(updated.old).toBe("devshell")
    const removed = await tool.execute({ action: "unset", key: "librelane.mode" })
    expect(removed.scope).toBe("user")
    expect(removed.old).toBe("binary")
    expect(removed.changed).toBe(true)
    const text = readFileSync(s.user, "utf8")
    expect(text).not.toContain('"mode"')
    // The leaf is gone; the (now empty) parent object remains, so the key is unset at runtime.
    expect(parseJsonc(text)).toEqual({ verible: { bin: "/opt/verible/bin" }, librelane: {} })
  } finally {
    s.restore()
  }
})

test("slangServer.bin: set preserves comments, show.paths probes it, unset removes it", async () => {
  const s = sandbox()
  try {
    // Seed a commented project layer so the write path has something to preserve.
    writeText(s.project, '{\n  // keep this note\n  "verible": { "bin": "/opt/verible/bin" },\n}\n')
    const tool = toolchainTool()
    const bin = join(s.ws, "slang-server")
    mkdirSync(bin, { recursive: true })

    const set = await tool.execute({ action: "set", key: "slangServer.bin", value: bin, scope: "workspace" })
    expect(set.ok).toBe(true)
    expect(set.new).toBe(bin)
    const text = readFileSync(s.project, "utf8")
    expect(text).toContain("// keep this note")
    expect(parseJsonc(text)).toEqual({ verible: { bin: "/opt/verible/bin" }, slangServer: { bin } })

    const focused = await tool.execute({ action: "show", key: "slangServer.bin" })
    expect(focused.key).toEqual({ key: "slangServer.bin", value: bin, source: "workspace" })

    const shown = await tool.execute({ action: "show" })
    const entry = shown.paths.find((p: any) => p.key === "slangServer.bin")
    expect(entry).toBeDefined()
    expect(entry.path).toBe(bin)
    expect(entry.exists).toBe(true)
    expect(entry.kind).toBe("directory")
    expect(entry.executable).toBe(false)

    const removed = await tool.execute({ action: "unset", key: "slangServer.bin", scope: "workspace" })
    expect(removed.ok).toBe(true)
    expect(removed.old).toBe(bin)
    expect(readFileSync(s.project, "utf8")).toContain("// keep this note")
  } finally {
    s.restore()
  }
})

test("refusals cross the seam as structured errors", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    const unknown = await tool.execute({ action: "set", key: "ossCadSuite.nope", value: "/x" })
    expect(unknown.ok).toBe(false)
    expect(unknown.error.code).toBe("VERIF_E_UNSUPPORTED")
    expect(unknown.error.hint).toContain("ossCadSuite.bin")

    const relativeUser = await tool.execute({ action: "set", key: "ossCadSuite.bin", value: "rel/bin", scope: "user" })
    expect(relativeUser.ok).toBe(false)
    expect(relativeUser.error.code).toBe("VERIF_E_CONFIG")

    const badScope = await tool.execute({ action: "set", key: "ossCadSuite.bin", value: "/x", scope: "project" })
    expect(badScope.ok).toBe(false)
    expect(badScope.error.code).toBe("VERIF_E_CONFIG")
    expect(badScope.error.hint).toContain("scope=user")

    writeText(s.project, '{ "ossCadSuite": ')
    const malformed = await tool.execute({ action: "set", key: "ossCadSuite.bin", value: "/x", scope: "workspace" })
    expect(malformed.ok).toBe(false)
    expect(malformed.error.code).toBe("VERIF_E_CONFIG")
    expect(readFileSync(s.project, "utf8")).toBe('{ "ossCadSuite": ')
  } finally {
    s.restore()
  }
})

test("detect returns suggestions only and writes nothing", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    const res = await tool.execute({ action: "detect" })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.suggestions)).toBe(true)
    expect(typeof res.note).toBe("string")
    expect(res.note).toContain("nothing was written")
    expect(existsSync(s.user)).toBe(false)
    expect(existsSync(s.project)).toBe(false)
    // The render is a text block for every action.
    const rendered = tool.output.render({}, res)
    expect(rendered[0].type).toBe("text")
    expect(rendered[0].text).toContain("mpd_verif_toolchain detect")
  } finally {
    s.restore()
  }
})

test("every action renders a text block and every success is lossless JSON", async () => {
  const s = sandbox()
  try {
    const tool = toolchainTool()
    const results = [
      await tool.execute({ action: "init" }),
      await tool.execute({ action: "set", key: "verible.bin", value: "/opt/verible/bin" }),
      await tool.execute({ action: "show" }),
      await tool.execute({ action: "path" }),
      await tool.execute({ action: "unset", key: "verible.bin" }),
      await tool.execute({ action: "detect" }),
    ]
    for (const res of results) {
      expect(res.ok).toBe(true)
      expect(undefinedPaths(res)).toEqual([])
      expect(JSON.parse(JSON.stringify(res))).toEqual(res)
      const rendered = tool.output.render({}, res)
      expect(rendered[0].type).toBe("text")
      expect(rendered[0].text.startsWith("mpd_verif_toolchain")).toBe(true)
    }
  } finally {
    s.restore()
  }
})
