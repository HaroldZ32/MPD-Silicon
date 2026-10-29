#!/usr/bin/env node
// verify-package-files: prove the npm publish surface is complete.
//
// `npm pack` ships whatever the `files` allowlist matches, so a missing entry is
// invisible until an installed bundle loads a row whose asset never travelled. This
// guard checks both halves of that contract, from source:
//   1. every path the runtime NEEDS exists in the working tree, and
//   2. package.json `files` covers each one,
//   3. the allowlist does not also drag in source, tests, evidence or local state,
//   4. dsh.bundle.patch names an existing, covered patch file that carries
//      `- insert:` rows.
//
// It is the `prepack` hook, so `npm pack`/`npm publish` cannot produce a broken
// tarball. The logic is a function of the package root, which is what makes
// `--self-test` able to run it against a COPY and rename a file there.
//
// Usage:
//   node scripts/verify-package-files.mjs              # check this checkout
//   node scripts/verify-package-files.mjs --self-test  # negative controls in a copy
//
// Exit codes: 0 = ok, 1 = a gate failed, 2 = usage error.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2

/**
 * Files the installed bundle loads or serves by reference. Each entry is why it
 * matters, so a failure names the capability that would break, not just a path.
 */
const REQUIRED_FILES = [
  ["packages/mpd-verif-plugin/dist/index.js", "silicon-verif row (mpd_verif_* tools)"],
  ["packages/mpd-silicon-bootstrap-plugin/dist/index.js", "silicon-bootstrap row (skill corpus)"],
  ["packages/mpd-silicon-guard-plugin/dist/index.js", "silicon-require-mpd row (boot guard)"],
  ["packages/mpd-docgen-plugin/dist/index.js", "silicon-docgen row (mpd_docgen_* tools)"],
  ["packages/mpd-bundle/cordis.patch.yml", "dsh.bundle.patch (the loader rows themselves)"],
  ["skills/rtl-ip-flow/SKILL.md", "rtl-ip-flow skill"],
  ["skills/rtl-codestyle/SKILL.md", "rtl-codestyle skill"],
  ["skills/rtl-verif/SKILL.md", "rtl-verif skill"],
  ["tests/golden/fixtures/verilog/modules/adder4.v", "rtl-verif Makefile default RTL_DIR"],
  ["tests/golden/fixtures/verilog/modules/cnt8.v", "rtl-verif Makefile default RTL_DIR"],
  ["packages/mpd-mcp-lsp/launch.mjs", "silicon-mcp-lsp row launcher"],
  ["packages/mpd-mcp-lsp/dist/cli.js", "silicon-mcp-lsp row stdio command"],
  ["packages/mpd-mcp-lsp/dist/BUILD.lock", "LSP build provenance"],
  ["packages/mpd-mcp-lsp/package.json", "resolveDaemonVersion() version probe"],
  ["docs/toolchain.md", "toolchain configuration guide"],
  ["docs/docgen-guide.md", "docgen guide"],
  ["scripts/verify-package-files.mjs", "the prepack guard itself (packed manifest keeps prepack)"],
  ["README.md", "package documentation"],
  ["README.zh-CN.md", "bilingual documentation pair"],
  ["LICENSE", "license text referenced by package.json"],
  ["LICENSE-NOTICES.md", "provenance notices"],
  ["CHANGELOG.md", "release history"],
]

/** Directories a shipped row addresses as a tree (the MCP client serves these). */
const REQUIRED_DIRS = [
  ["tests/golden/fixtures/verilog/modules", "rtl-verif fixture modules"],
  ["packages/mpd-mcp-lsp/references", "HDL language reference pages"],
  ["packages/mpd-mcp-lsp/templates", "HDL language-server templates"],
]

/**
 * Sample paths that must stay OUT of the tarball. If any is covered by `files`,
 * the allowlist is broad (a bare `packages/**` or `*`) and the tarball bloats with
 * source, tests and local state — the exact regression `files` exists to prevent.
 */
const FORBIDDEN_SAMPLE_PATHS = [
  "packages/mpd-verif-plugin/src/index.ts",
  "packages/mpd-verif-plugin/test/smoke.test.ts",
  "packages/mpd-mcp-lsp/test/cli.test.ts",
  "packages/mpd-mcp-lsp/overlay/README.md",
  "evidence/verification/t13-manual-commands.md",
  ".github/workflows/ci.yml",
  ".mpd/boulder.json",
  ".toolchain/bin/bun",
  "node_modules/@mpd-dsh/mpd/package.json",
  "dist/silicon-package/package.json",
]

function fail(lines, message) {
  lines.push(message)
  console.error("verify-package-files: FAIL: " + message)
}

/** Strip the leading `./` and any trailing slashes a manifest entry may carry. */
function normalizeEntry(entry) {
  return String(entry).replace(/^\.\//, "").replace(/\/+$/, "")
}

/** Convert a `files` glob (`*`, `**`) into an anchored RegExp. */
function globToRegExp(glob) {
  let out = "^"
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === "*") {
      if (glob[i + 1] === "*") {
        out += ".*"
        i += 1
      } else out += "[^/]*"
      continue
    }
    out += /[\\^$.|?+()[\]{}]/.test(char) ? "\\" + char : char
  }
  return new RegExp(out + "$")
}

/**
 * Is `relPath` inside the publish surface described by `entries`?
 *
 * A plain entry covers itself and its whole subtree (npm treats a directory entry
 * that way); a glob entry is matched literally.
 */
function isCovered(entries, relPath) {
  return entries.some((raw) => {
    const entry = normalizeEntry(raw)
    if (entry === "") return false
    if (relPath === entry || relPath.startsWith(entry + "/")) return true
    const pattern = globToRegExp(entry)
    if (pattern.test(relPath)) return true
    // npm treats a matched DIRECTORY as covering its whole subtree, so a glob
    // that matches an ancestor is a hit too (e.g. `*` matches `evidence`).
    const parts = relPath.split("/")
    for (let i = 1; i < parts.length; i += 1) {
      if (pattern.test(parts.slice(0, i).join("/"))) return true
    }
    return false
  })
}

/**
 * Run every package-surface check against `root`.
 * @param {string} root package root (this checkout, or a self-test copy)
 * @returns {string[]} failures, empty when the package is publishable
 */
export function checkPackage(root) {
  const failures = []
  const manifestPath = join(root, "package.json")
  if (!existsSync(manifestPath)) {
    fail(failures, "missing package.json at " + manifestPath)
    return failures
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    fail(failures, "package.json is not valid JSON: " + String(error))
    return failures
  }
  const entries = Array.isArray(manifest.files) ? manifest.files : []
  if (entries.length === 0) {
    fail(failures, 'package.json has no "files" allowlist — npm would ship the whole checkout')
    return failures
  }

  for (const [relPath, why] of REQUIRED_FILES) {
    if (!existsSync(join(root, relPath))) {
      fail(failures, `missing required file ${relPath} (${why}); the installed bundle cannot load it`)
      continue
    }
    if (!isCovered(entries, relPath)) {
      fail(failures, `not covered by package.json files: ${relPath} (${why}); npm pack would omit it`)
    }
  }

  for (const [relPath, why] of REQUIRED_DIRS) {
    const absolute = join(root, relPath)
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      fail(failures, `missing required directory ${relPath} (${why}); the installed bundle cannot serve it`)
      continue
    }
    if (!isCovered(entries, relPath)) {
      fail(failures, `not covered by package.json files: ${relPath} (${why}); npm pack would omit the tree`)
    }
    if (readdirSync(absolute).length === 0) {
      fail(failures, `required directory ${relPath} is empty (${why})`)
    }
  }

  for (const relPath of FORBIDDEN_SAMPLE_PATHS) {
    if (isCovered(entries, relPath)) {
      fail(failures, `files allowlist is too broad: it would also ship ${relPath}; list runtime paths, not a tree root`)
    }
  }

  const declaredPatch = manifest.dsh?.bundle?.patch
  const patchPaths = Array.isArray(declaredPatch) ? declaredPatch : declaredPatch === undefined ? [] : [declaredPatch]
  if (patchPaths.length === 0) {
    fail(failures, "package.json dsh.bundle.patch is absent — dsh plugin add would install a plain dependency, not a profile layer")
  }
  for (const declared of patchPaths) {
    const relPath = normalizeEntry(declared)
    if (!existsSync(join(root, relPath))) {
      fail(failures, `dsh.bundle.patch names a missing file: ${declared}`)
      continue
    }
    if (!isCovered(entries, relPath)) {
      fail(failures, `dsh.bundle.patch names a file the files allowlist would omit: ${relPath}`)
    }
    const text = readFileSync(join(root, relPath), "utf8")
    const inserts = (text.match(/^\s*-\s+insert:\s*$/gm) ?? []).length
    if (inserts === 0) {
      fail(failures, `bundle patch ${relPath} contains no "- insert:" rows`)
    }
  }

  return failures
}

/** Copy the minimum real tree a check needs into `root` (no node_modules, no state). */
function stageCopy(sourceRoot, root) {
  const TOP_LEVEL = new Set(["package.json"])
  for (const [relPath] of [...REQUIRED_FILES, ...REQUIRED_DIRS]) TOP_LEVEL.add(relPath.split("/")[0])
  for (const entry of TOP_LEVEL) {
    const from = join(sourceRoot, entry)
    if (existsSync(from)) cpSync(from, join(root, entry), { recursive: true })
  }
}

/**
 * Negative controls: the guard must reject a copy with one file renamed and a
 * copy whose allowlist lost the `tests` entry, and accept the untouched copy.
 * Every mutation happens inside a throwaway temp directory.
 */
function selfTest() {
  console.log("verify-package-files self-test: proving the guard fails when the publish surface breaks")
  const scratch = mkdtempSync(join(tmpdir(), "verify-package-files-"))
  let failures = 0
  const check = (name, condition, detail) => {
    if (condition) {
      console.log("verify-package-files self-test PASS: " + name)
      return
    }
    failures += 1
    console.error("verify-package-files self-test FAIL: " + name + (detail ? "\n  " + detail : ""))
  }
  try {
    const copy = join(scratch, "copy")
    cpSync(join(repoRoot, "scripts", "verify-package-files.mjs"), join(copy, "scripts", "verify-package-files.mjs"), {
      recursive: true,
    })
    stageCopy(repoRoot, copy)

    const clean = checkPackage(copy)
    check("an untouched copy passes", clean.length === 0, JSON.stringify(clean))

    // Control 1: rename ONE required file inside the copy. It must be reported
    // as missing by name (and no longer covered).
    const victim = join(copy, "skills", "rtl-codestyle", "SKILL.md")
    renameSync(victim, victim + ".renamed")
    const missing = checkPackage(copy)
    check(
      "control group: a renamed required file is rejected by name",
      missing.some((line) => line.includes("missing required file skills/rtl-codestyle/SKILL.md")),
      JSON.stringify(missing),
    )
    renameSync(victim + ".renamed", victim)

    // Control 2: remove the docs tree from the copy. The required docs files must
    // be named as missing — a publish surface that silently drops documentation is
    // broken even though every code path still resolves. Restore it for the next
    // controls, which mutate the manifest rather than the tree.
    rmSync(join(copy, "docs"), { recursive: true, force: true })
    const noDocs = checkPackage(copy)
    check(
      "control group: a copy without the docs tree is rejected",
      noDocs.some((line) => line.includes("missing required file docs/toolchain.md")),
      JSON.stringify(noDocs),
    )
    cpSync(join(repoRoot, "docs"), join(copy, "docs"), { recursive: true })

    // Control 3: drop the `tests` entry from the allowlist copy. A present file
    // that the allowlist no longer covers must be named as uncovered.
    const manifest = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"))
    manifest.files = manifest.files.filter((entry) => entry !== "tests")
    writeFileSync(join(copy, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
    const uncovered = checkPackage(copy)
    check(
      "control group: a required tree missing from files is rejected as uncovered",
      uncovered.some((line) => line.includes("not covered by package.json files: tests/golden/fixtures/verilog/modules")),
      JSON.stringify(uncovered),
    )

    // Control 4: a broad allowlist (`*`) must be caught as bloat.
    manifest.files = ["*"]
    writeFileSync(join(copy, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
    const broad = checkPackage(copy)
    check(
      "control group: a broad allowlist is rejected as bloat",
      broad.some((line) => line.includes("files allowlist is too broad")),
      JSON.stringify(broad),
    )

    // Control 5: a patch with no insert rows must be rejected.
    manifest.files = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).files
    writeFileSync(join(copy, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
    writeFileSync(join(copy, "packages", "mpd-bundle", "cordis.patch.yml"), "# no rows here\n")
    const noRows = checkPackage(copy)
    check(
      "control group: a patch without insert rows is rejected",
      noRows.some((line) => line.includes('contains no "- insert:" rows')),
      JSON.stringify(noRows),
    )

    // Control 6: a payload with NO license file must be rejected. The package must
    // ship the license text its manifest names, so dropping LICENSE cannot pass.
    cpSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), join(copy, "packages", "mpd-bundle", "cordis.patch.yml"))
    rmSync(join(copy, "LICENSE"), { force: true })
    const noLicense = checkPackage(copy)
    check(
      "control group: a package without its license file is rejected",
      noLicense.some((line) => line.includes("missing required file LICENSE")),
      JSON.stringify(noLicense),
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  if (failures > 0) {
    console.error(`verify-package-files self-test: FAILED (${failures} control(s))`)
    return EXIT_FAIL
  }
  console.log("verify-package-files self-test: PASS (copy passes; rename, dropped docs tree, dropped files entry, broad allowlist, empty patch and a missing license file each fail)")
  return EXIT_OK
}

function main(argv) {
  for (const arg of argv) {
    if (arg === "--self-test") return selfTest()
    if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/verify-package-files.mjs [--self-test]")
      return EXIT_OK
    }
    fail([], "unknown argument " + JSON.stringify(arg))
    return EXIT_USAGE
  }
  const failures = checkPackage(repoRoot)
  if (failures.length > 0) {
    console.error(`verify-package-files: FAILED (${failures.length} problem(s))`)
    return EXIT_FAIL
  }
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  const patchPath = normalizeEntry(Array.isArray(manifest.dsh.bundle.patch) ? manifest.dsh.bundle.patch[0] : manifest.dsh.bundle.patch)
  const inserts = (readFileSync(join(repoRoot, patchPath), "utf8").match(/^\s*-\s+insert:\s*$/gm) ?? []).length
  console.log(
    `verify-package-files: PASS (every required file and tree present and covered, ${inserts} patch insert row(s), allowlist excludes src/test/evidence/state)`,
  )
  return EXIT_OK
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
