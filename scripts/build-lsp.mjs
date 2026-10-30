#!/usr/bin/env node
// build-lsp: the silicon-side build/verify entry for the HDL language-service assets.
//
//   node scripts/build-lsp.mjs --check                                  (default)
//   node scripts/build-lsp.mjs --build --upstream <checkout>            (needs lsp-daemon)
//   node scripts/build-lsp.mjs --self-test                              (offline controls)
//
// --check verifies the SHIPPED artifact rather than producing one: dist/cli.js must match
// BUILD.lock by sha256 and byte size, must carry both HDL registry entries (verible and
// slang-server, with their extensions and the EXT_TO_LANG mappings), the overlay must exist
// and carry the drift-guard anchor, and the HDL reference docs the lsp-setup routing points
// at must exist and be non-empty (the precondition the t17 deletion depends on).
//
// --build is the equivalent of the source repo's offline build for the HDL half: copy the
// upstream lsp-daemon source into a temp workspace, apply this package's overlay over
// lsp-core (failing loudly when the anchor is missing, so a drifted upstream cannot produce a
// silently wrong dist), run `bun build`, then record the artifact in BUILD.lock. It requires
// an upstream checkout and is NOT exercised in this repository's environment; the shipped
// dist is the recorded copy from @mpd-dsh/mpd.
//
// Exit codes: 0 = ok, 1 = a check failed or the build failed, 2 = usage error.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG = join(repoRoot, "packages", "mpd-mcp-lsp")
const CLI = join(PKG, "dist", "cli.js")
const LOCK = join(PKG, "dist", "BUILD.lock")
const ANCHOR = "mpd-rtl-overlay-v1"
const OVERLAY_FILES = [
  { name: "server-definitions.ts", rel: "src/lsp/server-definitions.ts" },
  { name: "language-mappings.ts", rel: "src/lsp/language-mappings.ts" },
]
/** The registry surface the HDL rows are useless without. */
const HDL_REGISTRY = [
  'verible: { command: ["verible-verilog-ls"], extensions: [".v", ".vh"] }',
  '"slang-server": { command: ["slang-server"], extensions: [".sv", ".svh"] }',
  '".v": "verilog"',
  '".sv": "systemverilog"',
]
const REFERENCE_DOCS = ["references/verilog/README.md", "references/systemverilog/README.md"]
const FIXTURES = [
  "tests/golden/fixtures/verilog/README.md",
  "tests/golden/fixtures/verilog/modules/adder4.v",
  "tests/golden/fixtures/verilog/modules/cnt8.v",
  "tests/golden/fixtures/verilog/tb/tb_adder4.v",
]

function fail(message) {
  console.error("[build-lsp] FAIL: " + message)
  process.exit(1)
}
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}
function registryProblems(text) {
  return HDL_REGISTRY.filter((entry) => !text.includes(entry))
}

function check() {
  if (!existsSync(CLI)) fail("dist/cli.js missing — the silicon-mcp-lsp row would address a command that does not exist")
  const lock = JSON.parse(readFileSync(LOCK, "utf8"))
  const digest = sha256(CLI)
  if (digest !== lock.artifact.sha256) fail(`dist/cli.js sha256 ${digest.slice(0, 16)}… does not match BUILD.lock ${lock.artifact.sha256.slice(0, 16)}…`)
  const bytes = statSync(CLI).size
  if (bytes !== lock.artifact.bytes) fail(`dist/cli.js is ${bytes} bytes, BUILD.lock records ${lock.artifact.bytes}`)
  const missing = registryProblems(readFileSync(CLI, "utf8"))
  if (missing.length > 0) fail("dist/cli.js is missing HDL registry entry(ies): " + missing.join(" | "))
  for (const file of OVERLAY_FILES) {
    const path = join(PKG, "overlay", "lsp", file.name)
    if (!existsSync(path)) fail("overlay file missing: " + path)
    if (!readFileSync(path, "utf8").includes(ANCHOR)) fail(`overlay ${file.name} lacks the drift-guard anchor "${ANCHOR}"`)
  }
  for (const file of REFERENCE_DOCS) {
    const path = join(PKG, file)
    if (!existsSync(path) || statSync(path).size === 0) fail("HDL reference doc missing or empty: " + file)
  }
  for (const file of FIXTURES) {
    if (!existsSync(join(repoRoot, file))) fail("golden fixture missing: " + file)
  }
  console.log(`[build-lsp] check PASS: dist/cli.js sha256 ${digest.slice(0, 16)}… (${bytes} bytes) matches BUILD.lock, both HDL registry entries present, overlay anchor present, 2 reference docs and ${FIXTURES.length} fixtures in place`)
}

function build(upstream) {
  if (!upstream) fail("--build needs --upstream <checkout containing packages/lsp-daemon>")
  const daemon = join(upstream, "packages", "lsp-daemon")
  if (!existsSync(daemon)) fail("no packages/lsp-daemon under the upstream checkout: " + upstream)
  const work = mkdtempSync(join(tmpdir(), "silicon-lsp-build-"))
  try {
    cpSync(daemon, join(work, "lsp-daemon"), { recursive: true })
    for (const file of OVERLAY_FILES) {
      const overlay = join(PKG, "overlay", "lsp", file.name)
      const target = join(work, "lsp-daemon", "..", "lsp-core", file.rel)
      if (!existsSync(overlay)) fail("overlay missing: " + overlay)
      if (!readFileSync(overlay, "utf8").includes(ANCHOR)) fail(`overlay ${file.name} lacks the anchor "${ANCHOR}"`)
      if (!existsSync(target)) fail("upstream baseline missing (layout drift?): " + target)
      cpSync(overlay, target)
    }
    const built = spawnSync("bun", ["build", "src/cli.ts", "--outdir", "dist", "--target", "node", "--format", "esm"], { cwd: join(work, "lsp-daemon"), encoding: "utf8", timeout: 600000 })
    if (built.status !== 0) fail("bun build failed: " + (built.stderr || built.stdout || "").slice(-400))
    const produced = join(work, "lsp-daemon", "dist", "cli.js")
    if (!existsSync(produced)) fail("bun build produced no dist/cli.js")
    const digest = sha256(produced)
    const missing = registryProblems(readFileSync(produced, "utf8"))
    if (missing.length > 0) fail("freshly built cli.js lacks HDL registry entry(ies): " + missing.join(" | "))
    cpSync(produced, CLI)
    const lock = JSON.parse(readFileSync(LOCK, "utf8"))
    lock.artifact = { file: "dist/cli.js", sha256: digest, bytes: statSync(produced).size }
    lock.builtAt = new Date().toISOString()
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n")
    console.log(`[build-lsp] build PASS: rebuilt dist/cli.js sha256 ${digest.slice(0, 16)}… (${lock.artifact.bytes} bytes) with both HDL registry entries; BUILD.lock refreshed`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function selfTest() {
  const good = 'verible: { command: ["verible-verilog-ls"], extensions: [".v", ".vh"] }\n"slang-server": { command: ["slang-server"], extensions: [".sv", ".svh"] }\n".v": "verilog"\n".sv": "systemverilog"'
  const problems = []
  if (registryProblems(good).length !== 0) problems.push("positive control: a complete registry text was flagged")
  if (!registryProblems(good.replace('"slang-server"', '"slang"')).includes('"slang-server": { command: ["slang-server"], extensions: [".sv", ".svh"] }')) {
    problems.push("negative control: a registry without slang-server was NOT flagged")
  }
  if (!registryProblems("nothing here").length) problems.push("empty-text control was NOT flagged")
  if (problems.length > 0) {
    for (const problem of problems) console.error("[build-lsp] FAIL  " + problem)
    process.exit(1)
  }
  check()
  console.log("[build-lsp self-test] ok: registry controls (complete text passes, a missing server is caught) + live --check")
}

const argv = process.argv.slice(2)
const upstreamIndex = argv.indexOf("--upstream")
const upstream = upstreamIndex >= 0 ? argv[upstreamIndex + 1] : process.env.MPD_UPSTREAM_ROOT
const known = argv.filter((arg, index) => arg !== "--upstream" && index !== upstreamIndex + 1)
const unknown = known.filter((arg) => !["--check", "--build", "--self-test"].includes(arg))
if (unknown.length > 0) {
  console.error("[build-lsp] usage: node scripts/build-lsp.mjs [--check] [--build --upstream <checkout>] [--self-test]")
  process.exit(2)
}
if (argv.includes("--self-test")) selfTest()
else if (argv.includes("--build")) build(upstream)
else check()
