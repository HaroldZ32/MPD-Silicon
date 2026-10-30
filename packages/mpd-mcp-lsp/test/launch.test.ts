import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The launcher is a committed .mjs entry, deliberately outside dist/ so the pinned
// CLI (BUILD.lock) and the build-lsp step never own it.
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LAUNCHER = join(PACKAGE_ROOT, "launch.mjs")
const SCRATCH = mkdtempSync(join(tmpdir(), "silicon-lsp-launch-"))
const FAKE_CLI = join(SCRATCH, "fake-cli.js")
const ABSENT_USER_CONFIG = join(SCRATCH, "absent-user-silicon.jsonc")

writeFileSync(
  FAKE_CLI,
  [
    'process.stdout.write(JSON.stringify({ path: process.env.PATH ?? null, argv: process.argv.slice(2) }))',
    'process.exitCode = Number(process.env.FAKE_EXIT_CODE ?? "0")',
    "",
  ].join("\n"),
)

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

type FakeOutput = { readonly path: string | null; readonly argv: readonly string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseFakeOutput(stdout: string): FakeOutput {
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed)) throw new Error("fake CLI did not print a JSON object: " + stdout)

  const rawPath = parsed.path
  let path: string | null
  if (rawPath === null) path = null
  else if (typeof rawPath === "string") path = rawPath
  else throw new Error("fake CLI printed a non-string PATH")

  const rawArgv = parsed.argv
  if (!Array.isArray(rawArgv)) throw new Error("fake CLI printed a non-array argv")
  const argv: string[] = []
  for (const item of rawArgv) {
    if (typeof item !== "string") throw new Error("fake CLI printed a non-string argv entry")
    argv.push(item)
  }
  return { path, argv }
}

function makeEnv(configPath: string = ABSENT_USER_CONFIG): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MPD_SILICON_CONFIG: configPath }
  env.PATH = process.env.PATH ?? ""
  return env
}

function workspace(name: string): string {
  const dir = join(SCRATCH, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function binDir(name: string): string {
  const dir = join(SCRATCH, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function run(env: NodeJS.ProcessEnv, cwd: string, args: readonly string[] = ["mcp"]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [LAUNCHER, FAKE_CLI, ...args], { cwd, env, encoding: "utf8" })
}

function expectSuccess(result: SpawnSyncReturns<string>): FakeOutput {
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  return parseFakeOutput(result.stdout)
}

describe("launch.mjs", () => {
  test("no config leaves the child PATH equal to the parent PATH", () => {
    const parsed = expectSuccess(run(makeEnv(), workspace("plain")))
    expect(parsed.path).toBe(process.env.PATH ?? "")
  })

  test("user config prepends verible.bin, tolerating JSONC comments and trailing commas", () => {
    const veribleBin = binDir("user-verible-bin")
    const userConfig = join(SCRATCH, "user-silicon.jsonc")
    writeFileSync(userConfig, `{\n  // local verible install\n  "verible": { "bin": ${JSON.stringify(veribleBin)} },\n}\n`)

    const parsed = expectSuccess(run(makeEnv(userConfig), workspace("user-config")))
    expect((parsed.path ?? "").split(delimiter)[0]).toBe(veribleBin)
    expect(parsed.path).toBe(veribleBin + delimiter + (process.env.PATH ?? ""))
  })

  test("project config overrides the user layer", () => {
    const userHome = binDir("user-verible-home")
    mkdirSync(join(userHome, "bin"))
    const projectBin = binDir("project-verible-bin")

    const userConfig = join(SCRATCH, "override-user.jsonc")
    writeFileSync(userConfig, JSON.stringify({ verible: { home: userHome } }))

    const ws = workspace("project-override")
    mkdirSync(join(ws, ".mpd"), { recursive: true })
    writeFileSync(join(ws, ".mpd", "silicon.jsonc"), JSON.stringify({ verible: { bin: projectBin } }))

    const parsed = expectSuccess(run(makeEnv(userConfig), ws))
    const parts = (parsed.path ?? "").split(delimiter)
    expect(parts[0]).toBe(projectBin)
    expect(parts).not.toContain(join(userHome, "bin"))
  })

  test("malformed config warns once on stderr and still spawns with the inherited PATH", () => {
    const ws = workspace("malformed")
    mkdirSync(join(ws, ".mpd"), { recursive: true })
    writeFileSync(join(ws, ".mpd", "silicon.jsonc"), '{ "verible": { "bin": } }\n')

    const result = run(makeEnv(), ws)
    expect(result.status).toBe(0)
    expect(parseFakeOutput(result.stdout).path).toBe(process.env.PATH ?? "")

    const lines = result.stderr.trim().split("\n")
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("WARN")
    expect(lines[0]).toContain(join(ws, ".mpd", "silicon.jsonc"))
  })

  test("extra argv reaches the child unchanged", () => {
    const parsed = expectSuccess(run(makeEnv(), workspace("argv"), ["mcp", "--stdio", "probe"]))
    expect(parsed.argv).toEqual(["mcp", "--stdio", "probe"])
  })

  test("prepends ossCadSuite before verible and skips directories that do not exist", () => {
    const ossHome = binDir("oss-home")
    mkdirSync(join(ossHome, "bin"))
    const veribleBin = binDir("both-verible-bin")
    const bothConfig = join(SCRATCH, "both-sections.jsonc")
    writeFileSync(bothConfig, JSON.stringify({ ossCadSuite: { home: ossHome }, verible: { bin: veribleBin } }))

    const parts = (expectSuccess(run(makeEnv(bothConfig), workspace("both-sections"))).path ?? "").split(delimiter)
    expect(parts[0]).toBe(join(ossHome, "bin"))
    expect(parts[1]).toBe(veribleBin)

    const missingConfig = join(SCRATCH, "missing-bin.jsonc")
    writeFileSync(missingConfig, JSON.stringify({ verible: { bin: join(SCRATCH, "does-not-exist") } }))
    const missing = expectSuccess(run(makeEnv(missingConfig), workspace("missing-bin")))
    expect(missing.path).toBe(process.env.PATH ?? "")
  })

  test("prepends slangServer.bin after ossCadSuite and verible so slang-server resolves", () => {
    const ossHome = binDir("slang-oss-home")
    mkdirSync(join(ossHome, "bin"))
    const veribleBin = binDir("slang-verible-bin")
    const slangBin = binDir("slang-server-bin")
    writeFileSync(join(slangBin, "slang-server"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    const configPath = join(SCRATCH, "slang-server.jsonc")
    writeFileSync(
      configPath,
      JSON.stringify({ ossCadSuite: { home: ossHome }, verible: { bin: veribleBin }, slangServer: { bin: slangBin } }),
    )

    const parts = (expectSuccess(run(makeEnv(configPath), workspace("slang-server"))).path ?? "").split(delimiter)
    expect(parts[0]).toBe(join(ossHome, "bin"))
    expect(parts[1]).toBe(veribleBin)
    expect(parts[2]).toBe(slangBin)
    expect(parts.slice(3).join(delimiter)).toBe(process.env.PATH ?? "")
    // The prepended directory really makes the binary resolvable for the child.
    expect(existsSync(join(parts[2], "slang-server"))).toBe(true)

    // Alone, the same key is the FIRST PATH entry (same prepend rule, no special case).
    const onlyConfig = join(SCRATCH, "slang-only.jsonc")
    writeFileSync(onlyConfig, JSON.stringify({ slangServer: { bin: slangBin } }))
    const only = (expectSuccess(run(makeEnv(onlyConfig), workspace("slang-only"))).path ?? "").split(delimiter)
    expect(only[0]).toBe(slangBin)
    expect(only.slice(1).join(delimiter)).toBe(process.env.PATH ?? "")
  })

  test("derives <home>/bin when a section has no explicit bin", () => {
    const veribleHome = binDir("home-only-verible")
    mkdirSync(join(veribleHome, "bin"))
    const configPath = join(SCRATCH, "home-only.jsonc")
    writeFileSync(configPath, JSON.stringify({ verible: { home: veribleHome } }))

    const parsed = expectSuccess(run(makeEnv(configPath), workspace("home-only")))
    expect((parsed.path ?? "").split(delimiter)[0]).toBe(join(veribleHome, "bin"))
  })

  test("propagates the child exit code", () => {
    const env = makeEnv()
    env.FAKE_EXIT_CODE = "7"
    expect(run(env, workspace("exit-code")).status).toBe(7)
  })

  test("forwards SIGTERM and exits with the child's code", async () => {
    const signalCli = join(SCRATCH, "signal-cli.js")
    writeFileSync(
      signalCli,
      [
        'process.stdout.write("ready\\n")',
        'process.on("SIGTERM", () => { process.exit(23) })',
        "setInterval(() => {}, 1000)",
        "",
      ].join("\n"),
    )

    const child = spawn(process.execPath, [LAUNCHER, signalCli, "mcp"], {
      cwd: workspace("signal"),
      env: makeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      let forwarded = false
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        reject(new Error("launcher did not exit after SIGTERM"))
      }, 5000)
      child.stdout?.on("data", (chunk: Buffer) => {
        if (forwarded || !chunk.toString().includes("ready")) return
        forwarded = true
        child.kill("SIGTERM")
      })
      child.on("error", reject)
      child.on("exit", (exitCode) => {
        clearTimeout(timer)
        resolve(exitCode)
      })
    })

    expect(code).toBe(23)
  })
})
