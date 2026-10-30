#!/usr/bin/env node
// pack-silicon: assemble the installable @mpd-dsh/silicon package.
//
// Output: <repo>/dist/silicon-package/ — a package named @mpd-dsh/silicon whose
// dsh.bundle.patch points at a cordis.patch.yml that references plugins through
// the package's own name (`@mpd-dsh/silicon/packages/.../dist/index.js`) and every
// path-bearing value through the loader's baseUrl (the profile directory). No
// checkout-absolute path may survive into the artifact — that is a hard FAIL,
// because a packed bundle with a /root/... path installs into a profile and then
// cannot resolve its own rows.
//
// Adopted from the source project's scripts/pack-mpd.mjs, including its
// `normalizeModes` precedent: the artifact is what users install, and a clone or
// checkout that carries 600 bits must not ship files a non-root consumer cannot
// read. Regular files become 644; anything already executable STAYS 755 (stat
// first, never a blind chmod).
//
// Usage:
//   node scripts/pack-silicon.mjs            # stage + normalize into dist/silicon-package
//   node scripts/pack-silicon.mjs --check    # verify the WORKING TREE modes only (no writes)
//
// Exit codes: 0 = ok, 1 = a gate failed, 2 = usage error.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(repoRoot, "dist", "silicon-package")
const devRoot = repoRoot.replace(/\\/g, "/")
const PKG_NAME = "@mpd-dsh/silicon"
const DEV_PATCH = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")

/** Plugin packages whose dist/index.js a row loads. Order is irrelevant here. */
const PLUGIN_PKGS = ["mpd-verif-plugin", "mpd-silicon-bootstrap-plugin", "mpd-silicon-guard-plugin", "mpd-docgen-plugin"]
/**
 * Packages whose built dist must resolve @mpd-dsh/mpd at runtime instead of inlining
 * it. The guard row has no mpd import, so it is not in this set.
 */
const CONSUMER_PKGS = ["mpd-verif-plugin", "mpd-silicon-bootstrap-plugin", "mpd-docgen-plugin"]
/** The specifier fragment a consumer dist must keep (proof the dependency is external). */
const MPD_IMPORT_FRAGMENT = "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/"
/** Directories copied verbatim into the artifact (assets the rows serve by reference). */
const ASSET_DIRS = ["skills", "tests"]
/**
 * Package directories that legitimately live in the SOURCE `packages/` without being
 * PLUGIN_PKGS entries — `mpd-bundle` (the bundle patch, copied by its own step) and
 * `mpd-mcp-lsp` (the HDL language-service assets, copied by the COPIED_ASSET_PKGS step
 * below). The source-leak guard allows exactly the union of this and PLUGIN_PKGS;
 * anything else in `packages/` is a leftover from a strip. (Learned the hard way: the
 * first version used PLUGIN_PKGS alone and flagged `mpd-bundle` itself.)
 */
const ASSET_PACKAGE_DIRS = ["mpd-bundle", "mpd-mcp-lsp"]
/**
 * Asset packages that ARE copied into the artifact by their own step, because a shipped
 * row resolves into them at runtime: `mpd-mcp-lsp`'s `dist/cli.js` is the stdio command
 * of the `silicon-mcp-lsp` row, so an artifact without it would ship an enabled row that
 * cannot start (the exact retry-storm the row was kept disabled to avoid). The overlay
 * is build-time source only and deliberately does NOT travel.
 */
const COPIED_ASSET_PKGS = ["mpd-mcp-lsp"]
/**
 * Subdirectories and root files of a copied asset package that belong in the artifact.
 * `launch.mjs` is hand-written and lives beside `dist/` on purpose: it is not a build
 * artifact, so build-lsp.mjs never rewrites or deletes it, while the `silicon-mcp-lsp`
 * row launches it as the PATH-priming wrapper around the pinned `dist/cli.js`.
 */
const COPIED_ASSET_SUBDIRS = ["dist", "references", "templates", "launch.mjs"]
/** Files a copied asset package cannot ship without — both are addressed by the row. */
const COPIED_ASSET_REQUIRED_FILES = ["dist/cli.js", "launch.mjs"]
/**
 * Asset files a packed artifact cannot ship without. `tests/` is shipped because the
 * rtl-verif skill's Makefiles default `RTL_DIR` to `../../../../tests/golden/fixtures/
 * verilog/modules` — i.e. `<package>/tests` — so an artifact without it hands the
 * consumer a Makefile whose default input path is missing. This asserts the fixture
 * really travelled instead of trusting the copy step's directory list.
 */
const REQUIRED_ASSET_FILES = ["tests/golden/fixtures/verilog/modules/adder4.v"]
/** Every package directory allowed to exist in the source `packages/` tree. */
const ALLOWED_SOURCE_PACKAGE_DIRS = new Set([...PLUGIN_PKGS, ...ASSET_PACKAGE_DIRS])
/** Root files that ship with the package (the bilingual pair travels together). */
const ROOT_FILES = ["LICENSE", "LICENSE-NOTICES.md", "README.md", "README.zh-CN.md"]
/**
 * Scripts that ship with the package (the gates a consumer can re-run).
 *
 * Empty by decision: `verify-rows-disjoint.mjs` stays a REPOSITORY gate and is no
 * longer copied into the artifact. The row-id check compares this bundle's patch
 * against a local @mpd-dsh/mpd checkout, which an installed package does not have,
 * so shipping it only implied a gate a consumer could not run.
 */
const SHIPPED_SCRIPTS = []
/**
 * Package directory the self-test's control group plants in a staged payload.
 *
 * It must be a package that can exist in a SOURCE tree while being absent from
 * PLUGIN_PKGS — that is the exact false-green this guard fixes ("the plugin left
 * PLUGIN_PKGS but its directory stayed in the source tree"). It must NOT be one of
 * silicon's own listed plugins: the first version of this fixture used
 * `mpd-verif-plugin`, which IS listed (silicon ships it), and the guard honestly reported
 * it as a non-offender — a useful reminder that the listed set, not intuition, decides.
 */
const UNLISTED_PACKAGE_FIXTURE = "mpd-stripped-plugin"

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2

/**
 * Scripts intended to be run DIRECTLY (every one carries a shebang), so they ship with the
 * execute bit. Kept as an explicit list rather than inferred from the shebang: a shebang
 * tells you a file CAN be executed, not that this project ships it executable, and inferring
 * would silently flip every shebang-bearing file in the tree.
 */
const RUNNABLE_SCRIPTS = ["build.mjs", "pack-silicon.mjs", "verify-corpus.mjs", "verify-rows-disjoint.mjs"]
/** Mode a directly-runnable script must carry. */
const RUNNABLE_MODE = 0o755

/**
 * Normalize file modes under `root` — regular files 644, executable files 755.
 *
 * Adopts the source project's `pack-mpd.mjs` `normalizeModes` rule: stat first, never a
 * blind chmod. `cpSync` copies the SOURCE mode verbatim, so a working tree that carries 600
 * bits would ship an artifact a non-root consumer cannot read.
 *
 * When `root` is the repo root, the `RUNNABLE_SCRIPTS` names are forced to 755 first: the
 * walk's rule preserves an existing execute bit but does not create one, so without this a
 * script that lost its bit would stay 644 and could not be run directly.
 *
 * @param {string} root directory to walk
 * @returns {{files: number, made644: number, kept755: number, already644: number, madeRunnable: number}}
 */
export function normalizeModes(root) {
  const counts = { files: 0, made644: 0, kept755: 0, already644: 0, madeRunnable: 0 }
  if (root === repoRoot) {
    for (const name of RUNNABLE_SCRIPTS) {
      const path = join(root, "scripts", name)
      if (!existsSync(path)) continue
      if ((statSync(path).mode & 0o777) !== RUNNABLE_MODE) {
        chmodSync(path, RUNNABLE_MODE)
        counts.madeRunnable += 1
      }
    }
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const st = statSync(path)
      if (st.isDirectory()) {
        walk(path)
        continue
      }
      counts.files += 1
      const mode = st.mode & 0o777
      if ((mode & 0o111) !== 0) {
        if (mode !== 0o755) chmodSync(path, 0o755)
        counts.kept755 += 1
        continue
      }
      if (mode !== 0o644) {
        chmodSync(path, 0o644)
        counts.made644 += 1
      } else counts.already644 += 1
    }
  }
  walk(root)
  return counts
}

/**
 * List files a consumer who is NOT the owner cannot read. A bundle is distributed as
 * a clone/tarball, so `mode & 0o044 !== 0o044` (missing group+other read) is a defect.
 * @param {string} root directory to walk
 * @returns {{path: string, mode: string}[]} offenders, repo-relative and sorted
 */
export function unreadableFiles(root) {
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const st = statSync(path)
      if (st.isDirectory()) {
        walk(path)
        continue
      }
      const mode = st.mode & 0o777
      if ((mode & 0o044) !== 0o044) offenders.push({ path: path.slice(root.length + 1), mode: "0" + mode.toString(8) })
    }
  }
  walk(root)
  return offenders.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function fail(message) {
  console.error("[pack-silicon] FAIL: " + message)
}

/**
 * Directories `--check` never descends into. `dist/` is the packer's own staging output
 * (normalized by the stage step, not committed); the rest are local state or dependency
 * trees. Everything ELSE in the tree is checked — a hand-listed set of directories is what
 * let a file in `docs/` slip through once already.
 */
const CHECK_EXCLUDED_DIRS = new Set(["dist", ".git", "node_modules", ".mpd", ".toolchain", ".venv-rtl"])

/**
 * Normalize every committed file's mode in place (regular 644, executable stays 755).
 * Shared by `--fix` and the stage step: the working tree legitimately needs this whenever
 * a tool writes a file with a restrictive default mode, and a clone consumer must be able
 * to read every file that ships.
 * @returns {{files: number, made644: number, kept755: number, already644: number}}
 */
function normalizeWorkTree() {
  const counts = { files: 0, made644: 0, kept755: 0, already644: 0, madeRunnable: 0 }
  // Directly-runnable scripts keep (or regain) their execute bit; the walk below only
  // PRESERVES an existing execute bit, it never creates one.
  for (const name of RUNNABLE_SCRIPTS) {
    const path = join(repoRoot, "scripts", name)
    if (!existsSync(path)) continue
    if ((statSync(path).mode & 0o777) !== RUNNABLE_MODE) {
      chmodSync(path, RUNNABLE_MODE)
      counts.madeRunnable += 1
    }
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const st = statSync(path)
      if (st.isDirectory()) {
        if (CHECK_EXCLUDED_DIRS.has(entry)) continue
        walk(path)
        continue
      }
      counts.files += 1
      const mode = st.mode & 0o777
      const isRunnable = dir === join(repoRoot, "scripts") && RUNNABLE_SCRIPTS.includes(entry)
      if ((mode & 0o111) !== 0 || isRunnable) {
        if (mode !== RUNNABLE_MODE) chmodSync(path, RUNNABLE_MODE)
        counts.kept755 += 1
        continue
      }
      if (mode !== 0o644) {
        chmodSync(path, 0o644)
        counts.made644 += 1
      } else counts.already644 += 1
    }
  }
  walk(repoRoot)
  return counts
}

/**
 * `--check`: report unreadable files anywhere in the committed tree, writing nothing.
 * The bundle is distributed as a clone, so a file the group/other bits cannot read is a
 * defect no matter which directory it sits in.
 * @returns {number} EXIT_OK when everything is readable, EXIT_FAIL otherwise
 */
function checkWorkingTree() {
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const st = statSync(path)
      if (st.isDirectory()) {
        if (CHECK_EXCLUDED_DIRS.has(entry)) continue
        walk(path)
        continue
      }
      const mode = st.mode & 0o777
      if ((mode & 0o044) !== 0o044) offenders.push({ path: path.slice(repoRoot.length + 1), mode: "0" + mode.toString(8) })
    }
  }
  walk(repoRoot)
  if (offenders.length === 0) {
    console.log("[pack-silicon] check PASS: every committed file is readable by a non-root consumer")
    return EXIT_OK
  }
  offenders.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const o of offenders) console.error(`[pack-silicon] UNREADABLE ${o.mode} ${o.path}`)
  fail(`${offenders.length} file(s) above must be readable by a non-root consumer; fix with: find . -type f ! -perm -111 -exec chmod 644 {} +`)
  return EXIT_FAIL
}

/**
 * Extra-package guard (captain-authorized NEW guard, not a softening of an existing one).
 *
 * The source packer's control flow is `rmSync(outDir) → cpDist() → cpAssets()`, and
 * `cpDist()` only ever checks "a package ON THE LIST has no dist". It never checks the
 * converse. So an unlisted package sitting in the staging tree — the classic cause being
 * "the plugin was removed from PLUGIN_PKGS but its directory was not removed from the
 * source tree" — is copied out and silently ships inside a supposedly stripped bundle.
 * That is a false-green: every other gate passes while the artifact still carries the
 * capability the strip was supposed to delete.
 *
 * This asserts the staging tree's `packages/` contains NO directory outside the list.
 * @param {string} stagingRoot package root to inspect
 * @returns {string[]} offending package directory names (empty = clean)
 */
export function extraPackageDirs(stagingRoot) {
  const packagesDir = join(stagingRoot, "packages")
  if (!existsSync(packagesDir)) return []
  const allowed = new Set([...PLUGIN_PKGS, ...COPIED_ASSET_PKGS])
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort()
}

/**
 * Source-tree leak guard (captain-authorized NEW guard).
 *
 * The staging-tree guard below can only fire when something unexpected REACHES the payload.
 * `cpDists()` copies one listed name at a time, so a stray directory in the SOURCE
 * `packages/` is never copied — measured: planting a stray package in the source tree and
 * running the real stage produced exit 0 and a clean payload. So the staging guard alone
 * cannot catch the leading indicator: a package directory that survived a strip (its plugin
 * left PLUGIN_PKGS, its directory did not).
 *
 * That leftover is exactly how the false-green gets built — inert today, and shipped
 * silently by any future change that makes the copy step enumerate `packages/*` instead of
 * the list. This asserts the source `packages/` holds exactly the listed packages, so the
 * leftover fails loudly at pack time, next to the change that created it.
 * @param {string} root source repo root
 * @returns {string[]} offending directory names (empty = clean)
 */
export function sourcePackageLeaks(root) {
  const packagesDir = join(root, "packages")
  if (!existsSync(packagesDir)) return []
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !ALLOWED_SOURCE_PACKAGE_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort()
}

/**
 * Assert the staging tree holds exactly the listed plugin packages: every listed package
 * present with a dist (missing-dist guard) and nothing else present (extra-package guard).
 * @param {string} stagingRoot package root to inspect
 * @returns {string[]} violations, empty when the guard passes
 */
export function packageSetViolations(stagingRoot) {
  const violations = []
  for (const pkg of PLUGIN_PKGS) {
    if (!existsSync(join(stagingRoot, "packages", pkg, "dist"))) violations.push(`missing dist for listed package ${pkg}`)
  }
  for (const extra of extraPackageDirs(stagingRoot)) violations.push(`unlisted package in staged payload: ${extra}`)
  for (const pkg of COPIED_ASSET_PKGS) {
    for (const required of COPIED_ASSET_REQUIRED_FILES) {
      if (!existsSync(join(stagingRoot, "packages", pkg, required))) {
        violations.push(`missing copied asset ${required} for ${pkg}`)
      }
    }
  }
  for (const required of REQUIRED_ASSET_FILES) {
    if (!existsSync(join(stagingRoot, required))) violations.push(`missing shipped asset ${required}`)
  }
  return violations
}

function cpDists(root = outDir) {
  const missing = []
  for (const pkg of PLUGIN_PKGS) {
    const src = join(repoRoot, "packages", pkg, "dist")
    if (!existsSync(src)) {
      missing.push(pkg)
      continue
    }
    mkdirSync(join(root, "packages", pkg), { recursive: true })
    cpSync(src, join(root, "packages", pkg, "dist"), { recursive: true })
  }
  if (missing.length > 0) {
    fail("missing dist for " + missing.join(", ") + " — run node scripts/build.mjs first; a bundle must never ship without a plugin")
    return false
  }
  return true
}

function cpAssets(root = outDir) {
  for (const dir of ASSET_DIRS) {
    const src = join(repoRoot, dir)
    if (!existsSync(src)) {
      fail("missing asset directory " + dir + " — the bundle patch serves it by reference, so a packed bundle without it ships rows that cannot resolve")
      return false
    }
    cpSync(src, join(root, dir), { recursive: true })
  }
  mkdirSync(join(root, "scripts"), { recursive: true })
  for (const pkg of COPIED_ASSET_PKGS) {
    for (const sub of COPIED_ASSET_SUBDIRS) {
      const from = join(repoRoot, "packages", pkg, sub)
      if (!existsSync(from)) continue
      mkdirSync(join(root, "packages", pkg), { recursive: true })
      cpSync(from, join(root, "packages", pkg, sub), { recursive: true })
    }
    for (const required of COPIED_ASSET_REQUIRED_FILES) {
      if (!existsSync(join(root, "packages", pkg, required))) {
        fail("copied asset package " + pkg + " has no " + required + " — the shipped silicon-mcp-lsp row would address a missing file")
        return false
      }
    }
  }
  for (const file of SHIPPED_SCRIPTS) {
    const src = join(repoRoot, "scripts", file)
    if (!existsSync(src)) {
      fail("missing " + file + " — the row-disjointness gate must ship with the package")
      return false
    }
    cpSync(src, join(root, "scripts", file))
  }
  for (const file of ROOT_FILES) {
    if (existsSync(join(repoRoot, file))) cpSync(join(repoRoot, file), join(root, file))
  }
  return true
}

/**
 * Decouple the dev patch: every plugin path must address the INSTALLED package name,
 * never this checkout. Returns the text plus whether anything was rewritten.
 * @param {string} patchText dev patch contents
 * @returns {{text: string, rewrites: number}}
 */
export function decouplePatch(patchText) {
  let text = patchText
  let rewrites = 0
  for (const pkg of PLUGIN_PKGS) {
    const from = "'" + devRoot + "/packages/" + pkg + "/dist/index.js'"
    const to = "'" + PKG_NAME + "/packages/" + pkg + "/dist/index.js'"
    if (text.includes(from)) {
      text = text.split(from).join(to)
      rewrites += 1
    }
  }
  return { text, rewrites }
}

/**
 * Hard gate on the artifact's patch: no checkout-absolute path may survive. A packed
 * bundle that names /root/... installs into a profile and cannot resolve its own rows.
 * @param {string} text packed patch contents
 * @returns {string[]} violations (empty = clean)
 */
export function absolutePathViolations(text) {
  const violations = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue
    if (line.includes(devRoot)) violations.push(line.trim())
    else if (/['"]\/(root|home|Users|tmp)\//.test(line)) violations.push(line.trim())
  }
  return violations
}

/**
 * Hard gate on the artifact's ADAPTER wiring. @mpd-dsh/mpd is a real dependency, so the
 * shipped payload must (a) carry no row or package for the deleted local adapter port
 * and (b) keep a real `@mpd-dsh/mpd/...` specifier in each consumer dist instead of
 * inlining the adapter. Both halves are the same regression seen from opposite sides:
 * a reintroduced local port, or a dropped `--external` flag that silently ships a
 * second adapter instance inside our files.
 *
 * The patch is checked when present (the self-test fixtures stage a payload before the
 * patch is written; `stage()` checks it after writing the real one).
 * @param {string} stagingRoot staged package root
 * @returns {string[]} violations (empty = clean)
 */
export function externalDependencyViolations(stagingRoot) {
  const violations = []
  const patchPath = join(stagingRoot, "cordis.patch.yml")
  if (existsSync(patchPath)) {
    const patch = readFileSync(patchPath, "utf8")
    if (patch.includes("mpd-dsh-adapter-plugin")) {
      violations.push("staged patch still references the deleted local adapter (mpd-dsh-adapter-plugin)")
    }
  }
  for (const pkg of CONSUMER_PKGS) {
    const dist = join(stagingRoot, "packages", pkg, "dist", "index.js")
    if (!existsSync(dist)) {
      violations.push(`consumer ${pkg} has no built dist to inspect`)
      continue
    }
    const text = readFileSync(dist, "utf8")
    if (!text.includes(MPD_IMPORT_FRAGMENT)) {
      violations.push(`consumer ${pkg} does not import @mpd-dsh/mpd (the dependency is not external)`)
    }
    if (/SERVICE_NAME\s*=\s*"mpdDsh"/.test(text)) {
      violations.push(`consumer ${pkg} has the adapter INLINED (SERVICE_NAME = "mpdDsh" definition present)`)
    }
  }
  return violations
}

function writeManifest() {
  const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  const manifest = {
    name: PKG_NAME,
    version: root.version,
    private: true,
    // Derived from the root manifest, never hard-coded: the staged package is
    // MIT exactly when the repository manifest says so.
    license: root.license,
    type: "module",
    description: root.description,
    main: "./packages/mpd-silicon-bootstrap-plugin/dist/index.js",
    exports: {
      ".": "./packages/mpd-silicon-bootstrap-plugin/dist/index.js",
      "./package.json": "./package.json",
      "./packages/*": "./packages/*",
      "./skills/*": "./skills/*",
    },
    // A real runtime dependency, not a bundled copy: the adapter is externalized
    // from the dists and resolved from the consumer's node_modules.
    dependencies: root.dependencies ?? {},
    files: [
      "packages/**",
      "skills/**",
      "tests/**",
      "scripts/**",
      "cordis.patch.yml",
      "LICENSE",
      "LICENSE-NOTICES.md",
      "README.md",
      "README.zh-CN.md",
    ],
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
  }
  writeFileSync(join(outDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
}

function stage() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // Source-tree leak guard: catch a package directory that outlived its entry in
  // PLUGIN_PKGS. Runs FIRST, because this is the state that turns into a silently
  // shipped extra package the moment the copy step enumerates packages/* instead of
  // the list — i.e. it flags the cause, not only the symptom.
  const leaks = sourcePackageLeaks(repoRoot)
  if (leaks.length > 0) {
    fail("source packages/ contains director(y/ies) outside the shipped list:")
    for (const leak of leaks) console.error("  " + leak)
    console.error(`  listed: ${PLUGIN_PKGS.join(", ")}`)
    console.error("  a stripped package must be REMOVED from the source tree, not only from PLUGIN_PKGS")
    return false
  }

  if (!cpDists()) return false
  if (!cpAssets()) return false

  // Package-set guard (captain-authorized NEW guard): the staged payload must hold
  // EXACTLY the listed plugin packages. The missing-dist half mirrors the source
  // packer; the extra-package half is the false-green fix — an unlisted package that
  // reaches the payload would otherwise ship silently with every other gate green.
  const packageViolations = packageSetViolations(outDir)
  if (packageViolations.length > 0) {
    fail("staged package set is not exactly the listed plugins:")
    for (const v of packageViolations) console.error("  " + v)
    console.error(`  listed: ${PLUGIN_PKGS.join(", ")}`)
    return false
  }
  console.log(`[pack-silicon] package set guard PASS: exactly ${PLUGIN_PKGS.length} listed package(s), no extras (${PLUGIN_PKGS.join(", ")})`)

  const { text, rewrites } = decouplePatch(readFileSync(DEV_PATCH, "utf8"))
  const violations = absolutePathViolations(text)
  if (violations.length > 0) {
    fail("the packed cordis.patch.yml still names a checkout-absolute path:")
    for (const v of violations) console.error("  " + v)
    return false
  }
  writeFileSync(join(outDir, "cordis.patch.yml"), text)
  writeManifest()

  // Adapter-wiring guard: no shipped row names the deleted local port, and every
  // consumer dist keeps @mpd-dsh/mpd as an EXTERNAL specifier. A dropped
  // `--external` flag would otherwise ship a second adapter instance silently.
  const externalViolations = externalDependencyViolations(outDir)
  if (externalViolations.length > 0) {
    fail("the staged payload does not depend on @mpd-dsh/mpd the way it must:")
    for (const v of externalViolations) console.error("  " + v)
    return false
  }
  console.log(`[pack-silicon] dependency guard PASS: no local adapter row; ${CONSUMER_PKGS.join(", ")} import @mpd-dsh/mpd externally`)

  const modes = normalizeModes(outDir)
  console.log(`[pack-silicon] modes normalized: ${modes.files} files (chmod 644: ${modes.made644}, kept/forced 755: ${modes.kept755}, already 644: ${modes.already644})`)
  console.log(`[pack-silicon] patch decoupled: ${rewrites} plugin path group(s) rewritten to ${PKG_NAME}/packages/...`)

  const unreadable = unreadableFiles(outDir)
  if (unreadable.length > 0) {
    fail("packed artifact contains files a non-root consumer cannot read:")
    for (const o of unreadable) console.error(`  ${o.mode} ${o.path}`)
    return false
  }
  console.log(`[pack-silicon] staged package -> ${outDir}`)
  return true
}

/**
 * Would `stage()` accept a staging tree at `root`? The guards only, reusing the same
 * functions `stage()` runs, so the self-test exercises the real decision path instead of
 * a re-implementation that could drift from it.
 * @param {string} root staging root to judge
 * @returns {boolean} true when every guard passes
 */
export function stageAccepts(root) {
  return packageSetViolations(root).length === 0
}

/**
 * `--self-test`: prove the guards are falsifiable rather than permanently green.
 *
 * The control group is the point: it stages a payload that CONTAINS an unlisted package
 * and asserts the extra-package guard FAILS. A guard nobody has ever seen fail is
 * indistinguishable from a decorative one. Everything happens in a throwaway temp dir;
 * no repo file is written.
 * @returns {number} EXIT_OK when every fixture behaved, EXIT_FAIL otherwise
 */
function selfTest() {
  console.log("[pack-silicon] self-test: proving the package-set guards can fail")
  const scratch = mkdtempSync(join(tmpdir(), "pack-silicon-selftest-"))
  let failures = 0
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
      console.log(`[pack-silicon] self-test PASS: ${name}`)
      return
    }
    failures += 1
    console.error(`[pack-silicon] self-test FAIL: ${name}\n  expected ${e}\n  actual   ${a}`)
  }
  try {
    // Fixture 1 — CONTROL GROUP: a fully valid payload plus ONE unlisted package.
    // The guard must catch it and report the exact offender.
    const withExtra = join(scratch, "with-extra")
    mkdirSync(withExtra, { recursive: true })
    cpDists(withExtra)
    cpAssets(withExtra)
    mkdirSync(join(withExtra, "packages", UNLISTED_PACKAGE_FIXTURE, "dist"), { recursive: true })
    writeFileSync(join(withExtra, "packages", UNLISTED_PACKAGE_FIXTURE, "dist", "index.js"), "// fixture\n")
    check(
      `control group: an unlisted package (${UNLISTED_PACKAGE_FIXTURE}) is caught`,
      extraPackageDirs(withExtra),
      [UNLISTED_PACKAGE_FIXTURE],
    )
    check(
      `control group: the guard reports the unlisted package as a violation`,
      packageSetViolations(withExtra).filter((v) => v.includes(UNLISTED_PACKAGE_FIXTURE)).length,
      1,
    )
    check(`control group: stage() would be rejected`, stageAccepts(withExtra), false)

    // Fixture 2 — the same payload WITHOUT the extra package must be accepted, so the
    // control group proves discrimination rather than a guard that always fails.
    const clean = join(scratch, "clean")
    mkdirSync(clean, { recursive: true })
    cpDists(clean)
    cpAssets(clean)
    check("clean payload: no unlisted packages", extraPackageDirs(clean), [])
    check("clean payload: no violations at all", packageSetViolations(clean), [])
    check("clean payload: stage() would be accepted", stageAccepts(clean), true)
    check("clean payload: the launcher ships with the copied asset package", existsSync(join(clean, "packages", "mpd-mcp-lsp", "launch.mjs")), true)
    check(
      "clean payload: the tests fixture tree ships",
      existsSync(join(clean, "tests", "golden", "fixtures", "verilog", "modules", "adder4.v")),
      true,
    )

    // Fixture 2f — CONTROL GROUP for the tests fixture: the rtl-verif Makefiles
    // default RTL_DIR to <package>/tests, so an artifact that drops the tree ships a
    // broken default. Removing it must be rejected, not silently tolerated.
    const noTests = join(scratch, "no-tests")
    cpSync(clean, noTests, { recursive: true })
    rmSync(join(noTests, "tests"), { recursive: true, force: true })
    check(
      "control group: a staged payload without the tests fixture is caught",
      packageSetViolations(noTests).filter((v) => v.includes("missing shipped asset")).length,
      1,
    )
    check("control group: stage() would be rejected without the tests fixture", stageAccepts(noTests), false)

    // Fixture 2a — adapter wiring: a clean payload carries no local adapter row and
    // both consumer dists keep the external @mpd-dsh/mpd specifier. The patch is
    // staged here because these fixtures run before stage() writes the real one.
    const CLEAN_PATCH = "- insert:\n    - id: silicon-require-mpd\n      name: '@mpd-dsh/silicon/packages/mpd-silicon-guard-plugin/dist/index.js'\n      config:\n        timeoutMs: 15000\n"
    writeFileSync(join(clean, "cordis.patch.yml"), CLEAN_PATCH)
    check("clean payload: no adapter-wiring violations", externalDependencyViolations(clean), [])

    // Fixture 2b — CONTROL GROUP for the patch half: a staged row naming the deleted
    // local adapter must be caught by name.
    const localAdapterRow = join(scratch, "local-adapter-row")
    cpSync(clean, localAdapterRow, { recursive: true })
    writeFileSync(
      join(localAdapterRow, "cordis.patch.yml"),
      CLEAN_PATCH + "    - id: silicon-dsh-adapter\n      name: '@mpd-dsh/silicon/packages/mpd-dsh-adapter-plugin/dist/index.js'\n",
    )
    check(
      "control group: a staged patch naming the deleted local adapter is caught",
      externalDependencyViolations(localAdapterRow).filter((v) => v.includes("mpd-dsh-adapter-plugin")),
      ["staged patch still references the deleted local adapter (mpd-dsh-adapter-plugin)"],
    )

    // Fixture 2c — CONTROL GROUP for the inlining half: a dist that carries the
    // adapter's own SERVICE_NAME definition means the --external flag was dropped.
    const inlined = join(scratch, "inlined-adapter")
    cpSync(clean, inlined, { recursive: true })
    const inlinedDist = join(inlined, "packages", "mpd-verif-plugin", "dist", "index.js")
    writeFileSync(inlinedDist, readFileSync(inlinedDist, "utf8") + '\nvar SERVICE_NAME = "mpdDsh";\n')
    check(
      "control group: an inlined adapter is caught",
      externalDependencyViolations(inlined).filter((v) => v.includes("INLINED")),
      ['consumer mpd-verif-plugin has the adapter INLINED (SERVICE_NAME = "mpdDsh" definition present)'],
    )

    // Fixture 2d — CONTROL GROUP for the missing-import half: a dist with no
    // @mpd-dsh/mpd specifier is not resolving the hard dependency.
    const missingImport = join(scratch, "missing-import")
    cpSync(clean, missingImport, { recursive: true })
    writeFileSync(join(missingImport, "packages", "mpd-verif-plugin", "dist", "index.js"), "// no dependency specifier here\n")
    check(
      "control group: a consumer dist without the external import is caught",
      externalDependencyViolations(missingImport).filter((v) => v.includes("does not import @mpd-dsh/mpd")),
      ["consumer mpd-verif-plugin does not import @mpd-dsh/mpd (the dependency is not external)"],
    )

    // Fixture 2e — CONTROL GROUP for the launcher asset: drop launch.mjs from an
    // otherwise valid payload and the pack must reject it. The row launches that
    // file, so a silent omission would ship a broken row with every other gate green.
    const noLauncher = join(scratch, "no-launcher")
    cpSync(clean, noLauncher, { recursive: true })
    rmSync(join(noLauncher, "packages", "mpd-mcp-lsp", "launch.mjs"))
    check(
      "control group: a copied asset package without launch.mjs is caught",
      packageSetViolations(noLauncher).filter((v) => v.includes("launch.mjs")),
      ["missing copied asset launch.mjs for mpd-mcp-lsp"],
    )
    check("control group: stage() would be rejected without the launcher", stageAccepts(noLauncher), false)

    // Fixture 3 — missing-dist half: drop one listed package's dist and the guard must
    // still fail (keeps behaviour aligned with the source packer's own guard).
    const missing = join(scratch, "missing")
    mkdirSync(join(missing, "packages"), { recursive: true })
    check(
      "missing-dist: a listed package without dist is caught",
      packageSetViolations(missing).filter((v) => v.startsWith("missing dist")).length,
      PLUGIN_PKGS.length,
    )

    // Fixture 4 — CONTROL GROUP for the source-tree leak guard: a fake source root whose
    // packages/ carries one directory outside the list (the leftover a strip leaves
    // behind). Without this the leak guard would be untested decoration.
    const fakeSource = join(scratch, "fake-source")
    mkdirSync(join(fakeSource, "packages", UNLISTED_PACKAGE_FIXTURE), { recursive: true })
    for (const pkg of PLUGIN_PKGS) mkdirSync(join(fakeSource, "packages", pkg), { recursive: true })
    check("control group: a source-tree leftover package is caught", sourcePackageLeaks(fakeSource), [UNLISTED_PACKAGE_FIXTURE])

    // Fixture 5 — the leak guard must stay quiet on a correct source tree, so it
    // discriminates instead of always failing.
    const cleanSource = join(scratch, "clean-source")
    for (const pkg of PLUGIN_PKGS) mkdirSync(join(cleanSource, "packages", pkg), { recursive: true })
    check("clean source tree: no leak reported", sourcePackageLeaks(cleanSource), [])

    // Fixture 5b — CONTROL GROUP for the DELETED local adapter: the port was removed,
    // so a resurrected `packages/mpd-dsh-adapter-plugin` directory must be caught by
    // name. This is what keeps the deletion enforced by a gate instead of by memory.
    const adapterLeftover = join(scratch, "adapter-leftover-source")
    for (const pkg of PLUGIN_PKGS) mkdirSync(join(adapterLeftover, "packages", pkg), { recursive: true })
    mkdirSync(join(adapterLeftover, "packages", "mpd-dsh-adapter-plugin"), { recursive: true })
    check(
      "control group: a resurrected local adapter package is caught",
      sourcePackageLeaks(adapterLeftover),
      ["mpd-dsh-adapter-plugin"],
    )

    // Fixture 6 — CONTROL GROUP for mode normalization: a 600 file must become 644, and a
    // pre-existing executable bit must be PRESERVED (not flattened to 644). Without the
    // second half, the rule "regular 644 / keep 755" would be untested in the half that
    // protects runnable scripts.
    const modeTree = join(scratch, "mode-tree")
    mkdirSync(join(modeTree, "nested"), { recursive: true })
    writeFileSync(join(modeTree, "written-by-tool.mjs"), "// 600 by default\n")
    chmodSync(join(modeTree, "written-by-tool.mjs"), 0o600)
    writeFileSync(join(modeTree, "nested", "also-600.md"), "x\n")
    chmodSync(join(modeTree, "nested", "also-600.md"), 0o600)
    writeFileSync(join(modeTree, "runnable.sh"), "#!/bin/sh\necho hi\n")
    chmodSync(join(modeTree, "runnable.sh"), 0o755)
    writeFileSync(join(modeTree, "odd-exec.sh"), "#!/bin/sh\necho hi\n")
    chmodSync(join(modeTree, "odd-exec.sh"), 0o700)
    const modeCounts = normalizeModes(modeTree)
    const modeOf = (p) => (statSync(join(modeTree, p)).mode & 0o777).toString(8)
    check("control group: a 600 file is normalized to 644", modeOf("written-by-tool.mjs"), "644")
    check("control group: a nested 600 file is normalized too", modeOf("nested/also-600.md"), "644")
    check("control group: an existing 755 bit is preserved", modeOf("runnable.sh"), "755")
    check("control group: a 700 executable is normalized to 755", modeOf("odd-exec.sh"), "755")
    check("control group: the 600 fix is counted, not silently skipped", modeCounts.made644, 2)
    check("control group: no file stays unreadable after normalization", unreadableFiles(modeTree), [])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  if (failures > 0) {
    fail(`self-test FAILED (${failures} fixture(s))`)
    return EXIT_FAIL
  }
  console.log("[pack-silicon] self-test PASSED: package-set guards are falsifiable and mode normalization is proven (600 -> 644, 755 preserved)")
  return EXIT_OK
}

function main(argv) {
  for (const arg of argv) {
    if (arg === "--check") return checkWorkingTree()
    if (arg === "--self-test") return selfTest()
    if (arg === "--fix") {
      const counts = normalizeWorkTree()
      console.log(`[pack-silicon] fix: ${counts.files} files (chmod 644: ${counts.made644}, forced 755: ${counts.kept755}, already 644: ${counts.already644})`)
      return checkWorkingTree()
    }
    if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/pack-silicon.mjs [--check | --fix | --self-test]")
      return EXIT_OK
    }
    fail("unknown argument " + JSON.stringify(arg))
    return EXIT_USAGE
  }
  return stage() ? EXIT_OK : EXIT_FAIL
}

process.exit(main(process.argv.slice(2)))
