// LibreLane runner tests: the resolution tiers (config -> env -> PATH), the
// AppImage extract decision (injectable hasFuse), pure argv building including
// devshell quoting, a real spawn against fake executables (argv/cwd/PATH/log/
// tails/exit codes), workspace cwd refusal, and the version parser.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"
import { apply } from "../src/index"
import {
  buildLibreLaneCommand,
  decideAppimageExtract,
  parseLibreLaneVersion,
  posixSingleQuote,
  resolveLibreLane,
} from "../src/silicon/librelane"
import { guardEnv, makeSandbox, mpdCtx, undefinedPaths, withSandboxEnv, writeBin, writeText } from "./helpers"

interface ToolDef {
  name: string
  parameters: any
  output: { schema: any; render: (a: unknown, v: unknown) => { type: string; text: string }[] }
  execute: (args: any, exec?: any) => Promise<any>
}

interface TestSandbox {
  dir: string
  ws: string
  restore: () => void
}

function sandbox(): TestSandbox {
  const g = guardEnv()
  const dir = makeSandbox()
  withSandboxEnv(dir)
  delete process.env.MPD_SILICON_CONFIG
  delete process.env.MPD_SILICON_LIBRELANE
  delete process.env.MPD_SILICON_LIBRELANE_APPIMAGE
  delete process.env.APPIMAGE_EXTRACT_AND_RUN
  return { dir, ws: join(dir, "ws"), restore: () => g.restore() }
}

function librelaneTool(): ToolDef {
  const regs: any[] = []
  apply(mpdCtx({ tools: { register: (d: any) => regs.push(d) } }) as any)
  const found = regs.find((d) => d.name === "mpd_verif_librelane")
  if (!found) throw new Error("mpd_verif_librelane was not registered")
  return found as ToolDef
}

function writeConfig(ws: string, config: unknown): void {
  writeText(join(ws, ".mpd", "silicon.jsonc"), JSON.stringify(config, null, 2))
}

/** A fake librelane that answers --version with the real 3.0.16 line. */
const VERSION_SCRIPT = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "LibreLane v3.0.16"; exit 0; fi
exit 0
`

/** A faithful fake devshell AppImage: the image wrapper EXECs its command argv. */
const DEVSHELL_SCRIPT = `#!/bin/sh
exec "$@"
`

/** A fake librelane that reports argv/cwd/PATH/extract and a 60-line stream. */
const RUN_SCRIPT = `#!/bin/sh
echo "argv:$*"
echo "cwd:$(pwd)"
echo "path:$PATH"
echo "extract:\${APPIMAGE_EXTRACT_AND_RUN:-unset}"
i=1
while [ $i -le 60 ]; do echo "line-$i"; i=$((i+1)); done
exit \${FAKE_EXIT:-0}
`

function fakeLibreLane(dir: string, script = VERSION_SCRIPT): string {
  return writeBin(dir, "librelane", script)
}

test("resolution: librelane.bin as a file, then as a directory -> <dir>/librelane", () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"))
    const asFile = resolveLibreLane({ librelane: { bin } })
    expect(asFile.mode).toBe("binary")
    expect(asFile.configuredMode).toBe("auto")
    expect(asFile.path).toBe(bin)
    expect(asFile.source).toBe("config")
    expect(asFile.exists).toBe(true)
    expect(asFile.executable).toBe(true)
    expect(asFile.reason).toContain("file")

    const asDir = resolveLibreLane({ librelane: { bin: join(s.dir, "tool-bin") } })
    expect(asDir.path).toBe(join(s.dir, "tool-bin", "librelane"))
    expect(asDir.source).toBe("config")
    expect(asDir.reason).toContain("directory")
  } finally {
    s.restore()
  }
})

test("resolution: librelane.home probes <home>/bin/librelane and <home>/.venv/bin/librelane", () => {
  const s = sandbox()
  try {
    const home = join(s.dir, "ll-home")
    const viaBin = fakeLibreLane(join(home, "bin"))
    const resolvedBin = resolveLibreLane({ librelane: { home } })
    expect(resolvedBin.mode).toBe("binary")
    expect(resolvedBin.path).toBe(viaBin)
    expect(resolvedBin.reason).toContain("librelane.home")

    const venvHome = join(s.dir, "ll-venv-home")
    const viaVenv = fakeLibreLane(join(venvHome, ".venv", "bin"))
    const resolvedVenv = resolveLibreLane({ librelane: { home: venvHome } })
    expect(resolvedVenv.path).toBe(viaVenv)
  } finally {
    s.restore()
  }
})

test("resolution: auto maps the AppImage filename to devshell/appimage; explicit mode wins", () => {
  const s = sandbox()
  try {
    const dev = resolveLibreLane({ librelane: { appimage: "/opt/librelane-devshell-x86_64.AppImage" } })
    expect(dev.mode).toBe("devshell")
    expect(dev.path).toBe("/opt/librelane-devshell-x86_64.AppImage")
    expect(dev.source).toBe("config")
    expect(dev.devshellFromFilename).toBe(true)
    expect(dev.reason).toContain("devshell")

    const plain = resolveLibreLane({ librelane: { appimage: "/opt/librelane-x86_64.AppImage" } })
    expect(plain.mode).toBe("appimage")
    expect(plain.devshellFromFilename).toBe(false)

    const bin = fakeLibreLane(join(s.dir, "override-bin"))
    const forcedBinary = resolveLibreLane({ librelane: { appimage: "/opt/librelane-devshell.AppImage", bin, mode: "binary" } })
    expect(forcedBinary.mode).toBe("binary")
    expect(forcedBinary.path).toBe(bin)

    const forcedAppimage = resolveLibreLane({ librelane: { bin, appimage: "/opt/librelane-x86_64.AppImage", mode: "appimage" } })
    expect(forcedAppimage.mode).toBe("appimage")
    expect(forcedAppimage.path).toBe("/opt/librelane-x86_64.AppImage")

    const forcedDevshell = resolveLibreLane({ librelane: { appimage: "/opt/librelane-x86_64.AppImage", mode: "devshell" } })
    expect(forcedDevshell.mode).toBe("devshell")
    expect(forcedDevshell.devshellFromFilename).toBe(false)
  } finally {
    s.restore()
  }
})

test("resolution: env fallbacks (binary + AppImage), config precedence, PATH last", () => {
  const s = sandbox()
  try {
    const envBin = fakeLibreLane(join(s.dir, "env-bin"))
    process.env.MPD_SILICON_LIBRELANE = envBin
    const viaEnvBinary = resolveLibreLane(null)
    expect(viaEnvBinary.mode).toBe("binary")
    expect(viaEnvBinary.path).toBe(envBin)
    expect(viaEnvBinary.source).toBe("env")

    process.env.MPD_SILICON_LIBRELANE_APPIMAGE = "/opt/librelane-devshell-aarch64.AppImage"
    const viaEnvImage = resolveLibreLane(null)
    expect(viaEnvImage.mode).toBe("devshell")
    expect(viaEnvImage.path).toBe("/opt/librelane-devshell-aarch64.AppImage")
    expect(viaEnvImage.source).toBe("env")

    const cfgBin = fakeLibreLane(join(s.dir, "cfg-bin"))
    const viaConfig = resolveLibreLane({ librelane: { bin: cfgBin } })
    expect(viaConfig.source).toBe("config")
    expect(viaConfig.path).toBe(cfgBin)

    delete process.env.MPD_SILICON_LIBRELANE
    delete process.env.MPD_SILICON_LIBRELANE_APPIMAGE
    process.env.PATH = join(s.dir, "env-bin")
    const viaPath = resolveLibreLane(null)
    expect(viaPath.mode).toBe("binary")
    expect(viaPath.source).toBe("path")
    expect(viaPath.path).toBe(envBin)
  } finally {
    s.restore()
  }
})

test("extract decision: auto follows /dev/fuse; the config override wins", () => {
  expect(decideAppimageExtract(undefined, true).extract).toBe(false)
  expect(decideAppimageExtract(undefined, false).extract).toBe(true)
  expect(decideAppimageExtract(true, true).extract).toBe(true)
  expect(decideAppimageExtract(false, false).extract).toBe(false)
  expect(decideAppimageExtract(undefined, false).reason).toContain("APPIMAGE_EXTRACT_AND_RUN=1")
})

test("command building: binary/appimage argv; devshell prepends `librelane` as one argv word", () => {
  expect(buildLibreLaneCommand({ mode: "binary", path: "/opt/librelane" }, ["--smoke-test", "cfg.yaml"])).toEqual(["/opt/librelane", "--smoke-test", "cfg.yaml"])
  expect(buildLibreLaneCommand({ mode: "appimage", path: "/opt/ll.AppImage" }, ["--pdk", "sky130A"])).toEqual(["/opt/ll.AppImage", "--pdk", "sky130A"])
  const command = buildLibreLaneCommand({ mode: "devshell", path: "/opt/ll-devshell.AppImage" }, ["--smoke-test", "a b", "it's"])
  expect(command).toEqual(["/opt/ll-devshell.AppImage", "librelane", "--smoke-test", "a b", "it's"])
  // The boundaries survive: a space stays INSIDE one argument, unquoted and unsplit.
  expect(command[3]).toBe("a b")
  expect(command[4]).toBe("it's")
  expect(posixSingleQuote("it's")).toBe("'it'\\''s'")
})

test("version parsing: the first LibreLane v<version>", () => {
  expect(parseLibreLaneVersion("LibreLane v3.0.16")).toBe("3.0.16")
  expect(parseLibreLaneVersion("warning: something\nLibreLane v3.0.16 (abc)\nmore")).toBe("3.0.16")
  expect(parseLibreLaneVersion("no version here")).toBeNull()
})

test("status: binary previews [bin, --version] and reports LibreLane v3.0.16", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"))
    writeConfig(s.ws, { librelane: { bin } })
    const res = await librelaneTool().execute({ action: "status" })
    expect(res.ok).toBe(true)
    expect(res.mode).toBe("binary")
    expect(res.path).toBe(bin)
    expect(res.source).toBe("config")
    expect(res.exists).toBe(true)
    expect(res.executable).toBe(true)
    expect(res.version).toBe("3.0.16")
    expect(res.command).toEqual([bin, "--version"])
    expect(res.commandPreview).toContain("--version")
    expect(res.appimageExtract).toBeNull()
    expect(res.hints).toContain("no AppImage configured; using the librelane binary")
    expect(undefinedPaths(res)).toEqual([])
  } finally {
    s.restore()
  }
})

test("status: devshell previews [appimage, librelane, --version] and reports the extract setting", async () => {
  const s = sandbox()
  try {
    const image = writeBin(join(s.dir, "images"), "librelane-devshell-x86_64.AppImage", DEVSHELL_SCRIPT)
    const ossBin = join(s.dir, "oss-bin")
    fakeLibreLane(ossBin)
    writeConfig(s.ws, { librelane: { appimage: image, appimageExtract: true }, ossCadSuite: { bin: ossBin } })
    const res = await librelaneTool().execute({ action: "status" })
    expect(res.ok).toBe(true)
    expect(res.mode).toBe("devshell")
    expect(res.configuredMode).toBe("auto")
    expect(res.appimageExtract).toBe(true)
    expect(res.command).toEqual([image, "librelane", "--version"])
    expect(res.commandPreview).toContain("librelane")
    expect(res.commandPreview).not.toContain("--run")
    expect(res.version).toBe("3.0.16")
    expect(res.hints).toContain("devshell mode selected; set librelane.mode to override")
  } finally {
    s.restore()
  }
})

test("status: a configured but missing binary reports exists=false instead of refusing", async () => {
  const s = sandbox()
  try {
    writeConfig(s.ws, { librelane: { bin: join(s.dir, "no-such-librelane") } })
    const res = await librelaneTool().execute({ action: "status" })
    expect(res.ok).toBe(true)
    expect(res.mode).toBe("binary")
    expect(res.exists).toBe(false)
    expect(res.version).toBeNull()
    expect(res.hints.some((hint: string) => hint.includes("does not exist"))).toBe(true)
  } finally {
    s.restore()
  }
})

test("run: fake binary sees argv/cwd/PATH prefix; log exists; tails; exit 0", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"), RUN_SCRIPT)
    const ossBin = join(s.dir, "oss-bin")
    const veribleBin = join(s.dir, "verible-bin")
    mkdirSync(ossBin, { recursive: true })
    mkdirSync(veribleBin, { recursive: true })
    writeConfig(s.ws, { librelane: { bin }, ossCadSuite: { bin: ossBin }, verible: { bin: veribleBin } })
    const res = await librelaneTool().execute({ action: "run", args: ["--smoke-test", "cfg.yaml"], cwd: "." })
    expect(res.ok).toBe(true)
    expect(res.exitCode).toBe(0)
    expect(res.mode).toBe("binary")
    expect(res.cwd).toBe(s.ws)
    expect(typeof res.duration).toBe("number")
    expect(res.command).toEqual([bin, "--smoke-test", "cfg.yaml"])
    expect(res.logPath.startsWith(join(s.ws, ".mpd", "librelane") + sep)).toBe(true)
    expect(existsSync(res.logPath)).toBe(true)
    const log = readFileSync(res.logPath, "utf8")
    expect(log).toContain("argv:--smoke-test cfg.yaml")
    expect(log).toContain("cwd: " + s.ws)
    expect(log).toContain("PATH=" + ossBin + ":" + veribleBin + ":")
    expect(log).toContain("extract:unset")
    expect(log).toContain("env overrides:")
    expect(log).toContain("line-60")
    expect(log).not.toContain("DEEPSEEK_API_KEY=")
    expect(res.stdoutTail).toHaveLength(40)
    expect(res.stdoutTail[0]).toBe("line-21")
    expect(res.stdoutTail.at(-1)).toBe("line-60")
    expect(undefinedPaths(res)).toEqual([])
  } finally {
    s.restore()
  }
})

test("run: a non-zero exit is reported (not thrown) and a log is still written", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"), RUN_SCRIPT)
    writeConfig(s.ws, { librelane: { bin } })
    process.env.FAKE_EXIT = "7"
    const res = await librelaneTool().execute({ action: "run", args: ["--exit-seven"] })
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(7)
    expect(existsSync(res.logPath)).toBe(true)
    expect(readFileSync(res.logPath, "utf8")).toContain("exitCode: 7")
  } finally {
    s.restore()
  }
})

test("run: devshell prepends `librelane` and preserves argv boundaries; extract env is set", async () => {
  const s = sandbox()
  try {
    const image = writeBin(join(s.dir, "images"), "librelane-devshell-x86_64.AppImage", DEVSHELL_SCRIPT)
    const ossBin = join(s.dir, "oss-bin")
    const capture = join(s.dir, "args.log")
    writeBin(
      ossBin,
      "librelane",
      `#!/bin/sh
{
  echo "count:$#"
  i=0
  for a in "$@"; do i=$((i+1)); echo "arg$i:$a"; done
  echo "extract:\${APPIMAGE_EXTRACT_AND_RUN:-unset}"
} >> "${capture}"
exit 0
`,
    )
    writeConfig(s.ws, { librelane: { appimage: image, appimageExtract: true }, ossCadSuite: { bin: ossBin } })
    const res = await librelaneTool().execute({ action: "run", args: ["--smoke-test", "--pdk", "sky130A", "a b", "it's"] })
    expect(res.ok).toBe(true)
    expect(res.mode).toBe("devshell")
    expect(res.exitCode).toBe(0)
    expect(res.command).toEqual([image, "librelane", "--smoke-test", "--pdk", "sky130A", "a b", "it's"])
    expect(res.command[1]).toBe("librelane")
    const lines = readFileSync(capture, "utf8").split("\n").filter((line) => line.length > 0)
    expect(lines).toContain("count:5")
    expect(lines).toContain("arg1:--smoke-test")
    expect(lines).toContain("arg3:sky130A")
    expect(lines).toContain("arg4:a b")
    expect(lines).toContain("arg5:it's")
    expect(lines).toContain("extract:1")
    expect(readFileSync(res.logPath, "utf8")).toContain("APPIMAGE_EXTRACT_AND_RUN=1")
  } finally {
    s.restore()
  }
})

test("run: a cwd outside the workspace is a structured refusal", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"))
    writeConfig(s.ws, { librelane: { bin } })
    const res = await librelaneTool().execute({ action: "run", args: ["--smoke-test"], cwd: s.dir })
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe("VERIF_E_CONFIG")
    expect(res.error.hint).toContain("inside the workspace")
  } finally {
    s.restore()
  }
})

test("run: empty, missing or non-string args refuse before spawning", async () => {
  const s = sandbox()
  try {
    const bin = fakeLibreLane(join(s.dir, "tool-bin"))
    writeConfig(s.ws, { librelane: { bin } })
    for (const args of [[], undefined, ["--smoke-test", 3]]) {
      const res = await librelaneTool().execute({ action: "run", args })
      expect(res.ok).toBe(false)
      expect(res.error.code).toBe("VERIF_E_CONFIG")
    }
    expect(existsSync(join(s.ws, ".mpd", "librelane"))).toBe(false)
  } finally {
    s.restore()
  }
})

test("missing librelane: status and run refuse with an actionable hint", async () => {
  const s = sandbox()
  try {
    const emptyPath = join(s.dir, "empty-path")
    mkdirSync(emptyPath, { recursive: true })
    process.env.PATH = emptyPath
    const tool = librelaneTool()
    const status = await tool.execute({ action: "status" })
    expect(status.ok).toBe(false)
    expect(status.error.code).toBe("VERIF_E_NO_BACKEND")
    expect(status.error.hint).toContain("librelane.bin")
    expect(status.error.hint).toContain("librelane.appimage")
    const run = await tool.execute({ action: "run", args: ["--smoke-test"] })
    expect(run.ok).toBe(false)
    expect(run.error.code).toBe("VERIF_E_NO_BACKEND")
  } finally {
    s.restore()
  }
})

test("apply registers the tenth tool and the silicon-toolchain prompt mentions it", () => {
  const regs: any[] = []
  const sections: any[] = []
  apply(mpdCtx({
    tools: { register: (d: any) => regs.push(d) },
    systemPrompt: { section: (s: any) => { sections.push(s); return () => {} } },
  }) as any)
  const tool = regs.find((d) => d.name === "mpd_verif_librelane")
  expect(tool).toBeDefined()
  expect(tool.parameters.properties.action.enum).toEqual(["status", "run"])
  const section = sections.find((s) => s.name === "silicon-toolchain")
  expect(section.text).toContain("mpd_verif_librelane")
})
