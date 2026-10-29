#!/usr/bin/env node
// ci-boot: real MOUNT checks for @mpd-dsh/silicon in two compositions.
//
// Why this exists (and why it does not use `dsh plugin add`):
//   - `dsh plugin add` needs a writable package store under $HOME. The measured
//     sandbox has a read-only $HOME/pnpm store, so the installer path is blocked
//     there. This script builds the profile the installer would have built,
//     directly: $DSH_HOME/profiles/<name>/package.json + `bun install`.
//   - `--dump-config` proves composition only; `--help` is a known false green.
//     Only a real app boot's exit code + stderr proves the rows mounted.
//
// Modes:
//   coexist   base + mpd + silicon, bounded timeout. PASS = exit 124 (the app kept
//             running to the deadline), no `fatal`, and the bootstrap line
//             "[mpd-silicon-bootstrap] skill corpus served" (logged only after the
//             mpdDsh service is ACTIVE).
//   no-mpd    base + silicon only. The injected consumer rows stay PENDING; the
//             inject-free guard must throw. PASS = exit 1 and the exact guard line.
//             The profile manifest has no @mpd-dsh/mpd dependency, but bun installs
//             it transitively through silicon's own dependency; this script removes
//             that directory before boot so "no mpd on disk" is literal, not implied.
//
// Isolation: HOME, DSH_HOME and the workspace are fresh temp dirs. The real ~/.dsh
// is never read or written. Logs go to dist/ci-boot-logs/ (gitignored via /dist/).
//
// Usage:
//   node scripts/ci-boot.mjs [--mode both|coexist|no-mpd] [--require] [--keep]
//   node scripts/ci-boot.mjs --self-test
//
// Exit codes: 0 pass/skip, 1 a mode failed, 2 usage error, 3 required tool missing
// (only with --require; without it the script skips with a reason and exits 0).
import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version
const REGISTRY = process.env.CI_NPM_REGISTRY || "https://registry.npmjs.org"
const DSH_VERSION = process.env.CI_DSH_VERSION || "0.2.1-rc.2"
const COEXIST_TIMEOUT_S = positiveInt(process.env.CI_BOOT_COEXIST_TIMEOUT_S, 30)
const NEGATIVE_TIMEOUT_S = positiveInt(process.env.CI_BOOT_NEGATIVE_TIMEOUT_S, 30)
const SERVE_LINE = "[mpd-silicon-bootstrap] skill corpus served"
const GUARD_PREFIX = "silicon requires @mpd-dsh/mpd: the mpdDsh service is absent"
const LOG_DIR = join(repoRoot, "dist", "ci-boot-logs")

const argv = process.argv.slice(2)
const selfTest = argv.includes("--self-test")
const requireTools = argv.includes("--require")
const keep = argv.includes("--keep")
const mode = readOption(argv, "--mode") ?? "both"

/**
 * Pure verdict for one boot log. No filesystem, clock or process access, so the
 * two modes are testable without booting anything (see `--self-test`).
 * @param {"coexist"|"no-mpd"} name
 * @param {number|null} exitCode
 * @param {string} output combined stdout + stderr
 * @returns {{mode: string, ok: boolean, reasons: string[]}}
 */
export function classify(name, exitCode, output) {
  const text = String(output ?? "")
  const reasons = []
  if (name === "coexist") {
    if (exitCode !== 124) reasons.push(`expected the app to stay alive to the timeout (exit 124), observed exit ${String(exitCode)}`)
    if (!text.includes(SERVE_LINE)) reasons.push(`missing bootstrap line: ${SERVE_LINE}`)
    if (/\bfatal\b/i.test(text)) reasons.push("log contains a fatal error")
    if (text.includes(GUARD_PREFIX)) reasons.push("guard fired: the mpdDsh service was not ACTIVE")
  } else if (name === "no-mpd") {
    if (exitCode !== 1) reasons.push(`expected the guard to refuse with exit 1, observed exit ${String(exitCode)}`)
    if (!text.includes(GUARD_PREFIX)) reasons.push(`missing guard line: ${GUARD_PREFIX}`)
    if (text.includes(SERVE_LINE)) reasons.push("bootstrap served a corpus without mpd (the guard was bypassed)")
  } else {
    reasons.push(`unknown mode: ${String(name)}`)
  }
  return { mode: name, ok: reasons.length === 0, reasons }
}

/** Parse `--flag value` and `--flag=value`; a missing value returns null. */
function readOption(args, flag) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) return args[i + 1] ?? null
    if (args[i].startsWith(flag + "=")) return args[i].slice(flag.length + 1)
  }
  return null
}

function positiveInt(raw, fallback) {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/** Run a probe and return its result only when it exited 0. */
function probe(cmd, args) {
  const run = spawnSync(cmd, args, { encoding: "utf8", timeout: 30000 })
  return run.status === 0 ? run : null
}

function resolveDsh() {
  const run = probe("dsh", ["--version"])
  if (run === null) return null
  const version = String(run.stdout || run.stderr || "").trim().split("\n")[0]
  return { cmd: "dsh", version: version || "unknown" }
}

/**
 * Resolve bun in the order a developer or CI actually provides it: an explicit
 * BUN_BIN, then PATH, then the repo-local toolchain this checkout carries.
 */
function resolveBun() {
  const candidates = [process.env.BUN_BIN, "bun", join(repoRoot, ".mpd", "tools", "bun", "bin", "bun")].filter(Boolean)
  for (const cmd of candidates) {
    const run = probe(cmd, ["--version"])
    if (run !== null) return { cmd, version: String(run.stdout || "").trim() }
  }
  return null
}

/** Use the real bun cache only when it is writable; the sandbox HOME is isolated. */
function bunCacheDir() {
  const candidates = [
    process.env.BUN_INSTALL_CACHE_DIR,
    process.env.HOME ? join(process.env.HOME, ".bun", "install", "cache") : null,
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.W_OK)
      return candidate
    } catch {
      // Not present or not writable here; the sandbox HOME gets a fresh cache.
    }
  }
  return null
}

function sandboxEnv(sandbox, cacheDir) {
  const env = {
    ...process.env,
    HOME: sandbox.home,
    DSH_HOME: sandbox.dshHome,
    XDG_CONFIG_HOME: join(sandbox.home, ".config"),
    XDG_CACHE_HOME: join(sandbox.home, ".cache"),
    XDG_DATA_HOME: join(sandbox.home, ".local", "share"),
    XDG_STATE_HOME: join(sandbox.home, ".local", "state"),
    CI: "1",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
  }
  if (cacheDir !== null) env.BUN_INSTALL_CACHE_DIR = cacheDir
  return env
}

function makeSandbox(name) {
  const root = mkdtempSync(join(tmpdir(), `silicon-ci-boot-${name}-`))
  const sandbox = {
    root,
    home: join(root, "home"),
    dshHome: join(root, "dsh"),
    work: join(root, "work"),
    profileName: name === "coexist" ? "coexist" : "silicon-only",
  }
  sandbox.profileDir = join(sandbox.dshHome, "profiles", sandbox.profileName)
  mkdirSync(sandbox.home, { recursive: true })
  mkdirSync(sandbox.profileDir, { recursive: true })
  mkdirSync(sandbox.work, { recursive: true })
  return sandbox
}

function writeProfile(sandbox, name) {
  const dependencies = { "@mpd-dsh/silicon": `file:${repoRoot}` }
  if (name === "coexist") dependencies["@mpd-dsh/mpd"] = "0.15.1"
  const bundles =
    name === "coexist"
      ? ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd", "@mpd-dsh/silicon"]
      : ["@deepseek-ai/dsh-base", "@mpd-dsh/silicon"]
  const manifest = {
    name: `dsh-profile-${sandbox.profileName}`,
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }
  writeFileSync(join(sandbox.profileDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  return manifest
}

function installProfile(sandbox, bun) {
  const env = sandboxEnv(sandbox, bunCacheDir())
  const run = spawnSync(bun.cmd, ["install", "--registry", REGISTRY], {
    cwd: sandbox.profileDir,
    env,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    exitCode: run.status,
    output: String(run.stdout || "") + String(run.stderr || ""),
    error: run.error ? String(run.error.message) : null,
  }
}

/**
 * bun materializes @mpd-dsh/mpd as a transitive dependency of silicon even when the
 * profile manifest does not list it. Remove it so the negative control boots with no
 * mpd package on disk at all — the guard's install hint is then literally true.
 */
function removeTransitiveMpd(sandbox) {
  const mpdDir = join(sandbox.profileDir, "node_modules", "@mpd-dsh", "mpd")
  if (!existsSync(mpdDir)) return false
  rmSync(mpdDir, { recursive: true, force: true })
  return true
}

const TIMEOUT_AVAILABLE = probe("timeout", ["--version"]) !== null

function boot(sandbox, name, dsh) {
  const timeoutS = name === "coexist" ? COEXIST_TIMEOUT_S : NEGATIVE_TIMEOUT_S
  const args = ["--profile", sandbox.profileName, "--no-open", "--port", "0"]
  const options = {
    cwd: sandbox.work,
    env: sandboxEnv(sandbox, null),
    encoding: "utf8",
    timeout: (timeoutS + 30) * 1000,
    maxBuffer: 64 * 1024 * 1024,
  }
  const run = TIMEOUT_AVAILABLE
    ? spawnSync("timeout", [`${timeoutS}s`, dsh.cmd, ...args], options)
    : spawnSync(dsh.cmd, args, { ...options, timeout: timeoutS * 1000, killSignal: "SIGTERM" })
  const errorCode = run.error && run.error.code ? String(run.error.code) : ""
  const timedOut = TIMEOUT_AVAILABLE
    ? run.status === 124
    : errorCode === "ETIMEDOUT" || run.signal === "SIGTERM"
  return {
    exitCode: timedOut ? 124 : run.status,
    signal: run.signal,
    timedOut,
    output: String(run.stdout || "") + String(run.stderr || ""),
    error: run.error ? String(run.error.message) : null,
    command: TIMEOUT_AVAILABLE
      ? `timeout ${timeoutS}s ${dsh.cmd} ${args.join(" ")}`
      : `${dsh.cmd} ${args.join(" ")}`,
    timeoutS,
  }
}

function runMode(name, dsh, bun) {
  const sandbox = makeSandbox(name)
  const record = {
    mode: name,
    profile: sandbox.profileName,
    sandbox: sandbox.root,
    bootCommand: null,
    installOk: false,
    mpdRemoved: false,
    exitCode: null,
    ok: false,
    reasons: [],
  }
  try {
    const manifest = writeProfile(sandbox, name)
    record.manifest = manifest
    const installed = installProfile(sandbox, bun)
    mkdirSync(LOG_DIR, { recursive: true })
    writeFileSync(join(LOG_DIR, `${name}-install.log`), installed.output)
    if (installed.exitCode !== 0) {
      record.reasons.push(`bun install failed (exit ${String(installed.exitCode)}; see ${name}-install.log)`)
      if (installed.error) record.reasons.push(installed.error)
      return record
    }
    record.installOk = true
    if (name === "no-mpd") record.mpdRemoved = removeTransitiveMpd(sandbox)
    const booted = boot(sandbox, name, dsh)
    record.bootCommand = booted.command
    record.timeoutS = booted.timeoutS
    record.exitCode = booted.exitCode
    record.timedOut = booted.timedOut
    writeFileSync(join(LOG_DIR, `${name}.log`), booted.output)
    const verdict = classify(name, booted.exitCode, booted.output)
    record.ok = verdict.ok
    record.reasons = verdict.reasons
    return record
  } catch (error) {
    record.reasons.push(`harness error: ${error instanceof Error ? error.message : String(error)}`)
    return record
  } finally {
    if (!keep) rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function runSelfTest() {
  const cases = [
    { name: "coexist alive + bootstrap line", mode: "coexist", exit: 124, out: `${SERVE_LINE} from /tmp/x (provider silicon-bundle)`, want: true },
    { name: "coexist exited early", mode: "coexist", exit: 0, out: SERVE_LINE, want: false },
    { name: "coexist fatal", mode: "coexist", exit: 124, out: `${SERVE_LINE}\ndsh: fatal uncaught exception: boom`, want: false },
    { name: "coexist missing bootstrap line", mode: "coexist", exit: 124, out: "listening on http://127.0.0.1:0", want: false },
    { name: "coexist guard fired", mode: "coexist", exit: 124, out: `${SERVE_LINE}\n${GUARD_PREFIX}`, want: false },
    { name: "no-mpd guard fired", mode: "no-mpd", exit: 1, out: `dsh: fatal uncaught exception: Error: ${GUARD_PREFIX}; install @mpd-dsh/mpd@0.15.1`, want: true },
    { name: "no-mpd timed out (guard never threw)", mode: "no-mpd", exit: 124, out: GUARD_PREFIX, want: false },
    { name: "no-mpd served a corpus (bypass)", mode: "no-mpd", exit: 1, out: `${GUARD_PREFIX}\n${SERVE_LINE}`, want: false },
    { name: "no-mpd exited 0", mode: "no-mpd", exit: 0, out: "", want: false },
  ]
  let failures = 0
  for (const item of cases) {
    const verdict = classify(item.mode, item.exit, item.out)
    const passed = verdict.ok === item.want
    if (!passed) failures += 1
    console.log(`${passed ? "PASS" : "FAIL"} classify: ${item.name} (ok=${verdict.ok}, want=${item.want})`)
  }
  console.log(`ci-boot self-test: ${cases.length - failures}/${cases.length} negative controls behaved`)
  return failures === 0
}

function main() {
  if (selfTest) return runSelfTest() ? 0 : 1
  if (!["both", "coexist", "no-mpd"].includes(mode)) {
    console.error(`ci-boot: --mode must be both|coexist|no-mpd, got ${JSON.stringify(mode)}`)
    return 2
  }
  const dsh = resolveDsh()
  const bun = resolveBun()
  const missing = []
  if (dsh === null) {
    missing.push(`dsh (expected ${DSH_VERSION}): npm i -g --prefix "$HOME/.ci-dsh" @deepseek-ai/dsh@${DSH_VERSION} --registry=${REGISTRY}`)
  }
  if (bun === null) {
    missing.push(`bun 1.4.3: npm i -g --prefix "$HOME/.ci-bun" bun@1.4.3 --registry=${REGISTRY}`)
  }
  if (missing.length > 0) {
    console.log("ci-boot: SKIP — required tool(s) missing:")
    for (const item of missing) console.log(`  - ${item}`)
    console.log("ci-boot: without --require this is a skip (exit 0); --require turns it into exit 3.")
    return requireTools ? 3 : 0
  }
  console.log(`ci-boot: dsh ${dsh.version}, bun ${bun.version}, silicon ${packageVersion}, registry ${REGISTRY}`)
  const names = mode === "both" ? ["coexist", "no-mpd"] : [mode]
  const records = names.map((name) => runMode(name, dsh, bun))
  mkdirSync(LOG_DIR, { recursive: true })
  const report = {
    tool: "ci-boot",
    generatedAt: new Date().toISOString(),
    repo: repoRoot,
    siliconVersion: packageVersion,
    dsh: dsh.version,
    bun: bun.version,
    registry: REGISTRY,
    modes: records,
    ok: records.every((record) => record.ok),
  }
  writeFileSync(join(LOG_DIR, "result.json"), JSON.stringify(report, null, 2) + "\n")
  for (const record of records) {
    console.log(`ci-boot: ${record.mode} exit=${String(record.exitCode)} ${record.ok ? "PASS" : "FAIL"}`)
    for (const reason of record.reasons) console.log(`  - ${reason}`)
    console.log(`  log: dist/ci-boot-logs/${record.mode}.log`)
  }
  console.log(`ci-boot: ${report.ok ? "PASS" : "FAIL"} — logs under dist/ci-boot-logs/`)
  return report.ok ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
