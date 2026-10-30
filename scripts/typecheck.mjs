#!/usr/bin/env node
// typecheck: run the TypeScript checker over packages/*/src and packages/*/test.
//
// This gate exists because `bun test` TRANSPILES without checking types, and this repository's
// tsconfig.json is `strict: true`. Without a type gate a strict config is decoration.
//
// Consequences of the "no node_modules required" property this bundle keeps (dist is committed, so
// a clone installs and runs without a package install):
//   - Type roots are optional. If they are absent, the checker reports TS2591/TS2307 for `process`
//     and `bun:test` on every test file, which is an environment gap, not a defect in the sources.
//   - So the gate SKIPS LOUDLY in that case instead of failing, and it fails permanently only on
//     real diagnostics. The skip prints the exact install command that removes it.
//
// Modes:
//   default        check, skip loudly when type roots are missing
//   --require      never skip: missing type roots is itself a failure (used by CI)
//   --self-test    prove this gate is falsifiable (offline)
//
// Checker resolution order: `tsgo` on PATH, then `tsc` on PATH, then `bunx tsc` (network on a cold
// cache). Nothing is installed here; the gate reports what it could not run.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const REQUIRED_TYPE_ROOTS = ["bun-types", "@types/node"]
const argv = process.argv.slice(2)
const requireTypes = argv.includes("--require")
const selfTest = argv.includes("--self-test")

// Resolution order matters: the LOCAL binary is checked by path (never by running `bunx`, whose
// FIRST call also resolves and caches the package — probing that way would change the very type
// roots this gate is about to inspect, and a missing-type-roots failure would silently disappear).
function resolveChecker(root) {
  const local = join(root, "node_modules", ".bin", "tsgo")
  if (existsSync(local)) return { cmd: local, args: [], label: "local tsgo" }
  const localTsc = join(root, "node_modules", ".bin", "tsc")
  if (existsSync(localTsc)) return { cmd: localTsc, args: [], label: "local tsc" }
  for (const candidate of ["tsgo", "tsc"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" })
    if (probe.status === 0) return { cmd: candidate, args: [], label: candidate + " (PATH)" }
  }
  return { cmd: "bunx", args: ["tsc"], label: "bunx tsc (cold-cache download)" }
}

function missingTypeRoots(root) {
  const missing = []
  for (const name of REQUIRED_TYPE_ROOTS) {
    if (!existsSync(join(root, "node_modules", name))) missing.push(name)
  }
  return missing
}

function parseDiagnostics(output) {
  const lines = String(output || "").split("\n")
  const diagnostics = []
  for (const line of lines) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim())
    if (m) diagnostics.push({ file: m[1], line: Number(m[2]), code: m[4], message: m[5] })
  }
  return diagnostics
}

function check(root, checkerRoot = root) {
  // Deterministic precondition: type roots are decided by the FILESYSTEM, before any checker runs.
  const missing = missingTypeRoots(root)
  const checker = resolveChecker(checkerRoot)
  const run = spawnSync(checker.cmd, [...checker.args, "--noEmit", "-p", join(root, "tsconfig.json")], {
    encoding: "utf8", cwd: root, timeout: 600000, maxBuffer: 64 * 1024 * 1024,
  })
  const output = String(run.stdout || "") + String(run.stderr || "")
  const diagnostics = parseDiagnostics(output)
  // A checker that never ran, or died without emitting a parseable diagnostic, must not be read as
  // a clean program. This is what made the self-test's negative control pass vacuously: the fixture
  // resolved `bunx`, the spawn failed with ENOENT, and zero parsed diagnostics looked like "clean".
  let reason = null
  if (run.error) reason = "could not run " + checker.label + ": " + run.error.message
  else if (run.status === null) reason = checker.label + " did not exit (killed or timed out)"
  else if (run.status !== 0 && diagnostics.length === 0) reason = checker.label + " exited " + run.status + " with no parseable diagnostic"
  // The skip is justified ONLY when the type roots are actually absent AND every diagnostic is a
  // consequence of that (a missing global, a missing module, or a missing type-definition file).
  // A mix of "environment" and real diagnostics must FAIL: otherwise a genuine defect hides behind
  // an environment excuse.
  const typeRootCodes = new Set(["TS2591", "TS2307", "TS2688"])
  const envOnly = reason === null && missing.length > 0 && diagnostics.length > 0 && diagnostics.every((d) => typeRootCodes.has(d.code))
  return { ran: reason === null, reason, checker, missing, diagnostics, envOnly, exit: run.status, output }
}

function main() {
  const root = selfTest ? mkdtempSync(join(tmpdir(), "silicon-typecheck-")) : repoRoot
  try {
    if (selfTest) {
      // Control group: a file with a GENUINE type error must be reported.
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022" }, include: ["src/**/*.ts"] }, null, 2))
      const src = join(root, "src"); mkdirSync(src, { recursive: true })
      writeFileSync(join(src, "bad.ts"), "export const n: number = \"not a number\"\n")
      // Resolve the checker from the repository, not from the fixture: the temp project has no
      // node_modules, so resolving there found no local checker and fell through to `bunx`.
      const bad = check(root, repoRoot)
      const caught = bad.ran && bad.exit !== 0 && bad.diagnostics.some((d) => d.code === "TS2322")
      writeFileSync(join(src, "good.ts"), "export const n: number = 1\n")
      rmSync(join(src, "bad.ts"))
      const good = check(root, repoRoot)
      const clean = good.ran && good.exit === 0 && good.diagnostics.length === 0
      if (!bad.ran || !good.ran) {
        console.error("[typecheck] self-test: checker did not run — " + (bad.ran ? good.reason : bad.reason))
        console.error("[typecheck] Run `bun install` so the gate's checker (local tsgo/tsc) is available.")
      }
      console.log("[typecheck] self-test: control (wrong type) " + (caught ? "caught (TS2322) — PASS" : "NOT caught — FAIL"))
      console.log("[typecheck] self-test: healthy control " + (clean ? "clean — PASS" : "unexpectedly dirty — FAIL"))
      process.exit(caught && clean ? 0 : 1)
    }

    // Deterministic gate for the environment itself: decided from the filesystem, BEFORE any
    // checker runs. Without this, a cold `bunx tsc` would resolve and cache the packages itself and
    // the missing-type-roots condition would silently look like a pass.
    const missingRoots = missingTypeRoots(root)
    if (missingRoots.length > 0) {
      const detail = "missing type roots: " + missingRoots.join(", ")
      if (requireTypes) {
        console.error("[typecheck] FAIL (--require): " + detail)
        process.exit(1)
      }
      console.log("[typecheck] SKIP — " + detail + ".")
      console.log("[typecheck] This is an environment gap, not a defect: run `bun install` (devDependencies carry bun-types + @types/node).")
      console.log("[typecheck] Pass --require to turn this skip into a failure.")
      process.exit(0)
    }

    const result = check(root)
    if (!result.ran) {
      console.error("[typecheck] FAIL: " + result.reason)
      process.exit(1)
    }
    if (result.diagnostics.length === 0) {
      console.log("[typecheck] PASS — no diagnostics (" + result.checker.label + ")")
      process.exit(0)
    }
    if (result.envOnly && !requireTypes) {
      console.log("[typecheck] SKIP — " + result.diagnostics.length + " diagnostic(s), all of them missing type roots (" + result.missing.join(", ") + ").")
      console.log("[typecheck] This is an environment gap, not a defect: run `bun install` first (devDependencies carry bun-types + @types/node).")
      console.log("[typecheck] Pass --require to turn this skip into a failure.")
      process.exit(0)
    }
    for (const d of result.diagnostics.slice(0, 40)) {
      console.error("[typecheck] " + d.file + "(" + d.line + "): " + d.code + ": " + d.message)
    }
    console.error("[typecheck] FAIL: " + result.diagnostics.length + " diagnostic(s) via " + result.checker.label)
    process.exit(1)
  } finally {
    if (selfTest) rmSync(root, { recursive: true, force: true })
  }
}

main()
