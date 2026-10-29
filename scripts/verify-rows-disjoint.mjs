#!/usr/bin/env node
// Row-disjointness gate: the @mpd-dsh/silicon bundle must claim ZERO row ids that
// @mpd-dsh/mpd already claims. Two bundles composed into ONE profile must never
// collide, for two measured reasons:
//
//   1) a duplicate row id is a FATAL loader error — cordis-plugin-loader throws
//      `duplicate loader entry id: <id>` (src/config/group.ts), so the profile
//      cannot boot at all;
//   2) a non-insert patch on an EXISTING row id is a whole-value top-level
//      assignment, NOT a deep merge (dsh-app-boot applyEntryPatches does
//      `target[key] = value`). A silicon patch carrying `id: agent-teams` would
//      silently delete mpd's `config.profiles` map and `sessionTeamPolicy`.
//
// Measured evidence for both: evidence/t3-loader-semantics/loader-semantics.md.
//
// Row-id set of a patch file = the union of
//   A) INSERT ids  — `    - id: X` exactly 4 spaces under a column-0 `- insert:`
//   B) ID-TARGETS  — column-0 `- id: X`, i.e. a patch that targets an existing row
// Both count (a patch's id-target is just as much a claim on a foreign row).
// Commented-out rows (`# - id: X`, `#     - id: X`) are not claims; nested config
// keys deeper than 4 spaces are not rows.
//
// ── SCOPE: WHAT A GREEN RUN DOES *NOT* PROVE ────────────────────────────────
// Exit 0 means the two patches claim disjoint LOADER ROW IDS. It does NOT mean the
// two bundles can be mounted together. Two further name namespaces are single-valued
// per process and are INVISIBLE to a static patch reader:
//   * Cordis SERVICE names — a second `ctx.provide` of one name aborts the whole
//     plugin tree ("service \"mpdDsh\" has been registered"). silicon therefore
//     provides no service of its own: the consumer rows declare
//     `inject: [..., "mpdDsh"]` and read mpd's provider, while the inject-free
//     `silicon-require-mpd` guard refuses startup when that service is absent.
//   * TOOL names / MCP `serverName` — two rows registering the same tool name, or
//     reusing a `serverName`, fail the same way ("tool \"mpd_verif_venv\" is already
//     registered"; "serverName \"lsp\" is already in use").
// Both classes were observed in this project (evidence/t3-loader-semantics/
// coexistence.md). They need a MOUNT-level check; this script is a cheap offline
// FIRST gate, never the coexistence proof.
//
// ── DISCOVERY: THE PATCH IS NOT ALWAYS ONE FILE ──────────────────────────────
// mpd v0.15.1 moved its patch to the repo ROOT and added a second layer. The
// authoritative declaration is <mpd-root>/package.json `dsh.bundle.patch`:
//   "patch": "./cordis.patch.yml"                                  (string form)
//   "patch": ["./cordis.patch.yml", "./presets/mpd.patch.yml"]     (array form)
// Each entry is resolved against the mpd root and EVERY layer is read. The
// silicon layers come from THIS repo's root package.json in the same way.
// A missing or unreadable manifest falls back to <root>/cordis.patch.yml; a
// declared layer that cannot be read is exit 2, never a silent skip.
//
// Usage:
//   node scripts/verify-rows-disjoint.mjs [--silicon <patch>] [--mpd <mpd-root>] [--self-test]
//
// Discovery environment (the mpd location is resolved, never hard-coded):
//   MPD_SOURCE_PATCH  explicit patch FILE — wins, and is the ONLY mpd layer
//   MPD_SOURCE_ROOT   root of the mpd checkout; layers come from
//                     <root>/package.json dsh.bundle.patch (string OR array)
//   --mpd <root>      same, command-line form
//   default: the first USABLE auto candidate, in order —
//     1) node_modules/@mpd-dsh/mpd   (the installed dependency; `bun install`)
//     2) sibling checkout ../my-power-dsh   (a source checkout)
//   "Usable" = the candidate carries BOTH layers mpd v0.15.1 declares
//   (<root>/cordis.patch.yml AND <root>/presets/mpd.patch.yml). No usable
//   candidate is an explicit FAIL(unusable) exit 2 — never an empty intersection.
//   Fallback (manifest absent/unreadable, or no dsh.bundle.patch key):
//   <root>/cordis.patch.yml.
//
// Exit codes:
//   0  zero intersection (and, when --self-test, every fixture behaved)
//   1  intersection found (or a fixture failed) — the gate FAILS
//   2  usage / unreadable or unparseable patch / malformed manifest — the gate
//      could NOT run (distinct from 1 on purpose: CI must not read "file missing"
//      as "disjoint")
//
// Offline by construction: this script reads text files and never boots dsh,
// never touches $DSH_HOME, and never writes anything outside the self-test's
// throwaway temp dir.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { TextDecoder } from "node:util"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const SIBLING_MPD_ROOT = join(dirname(repoRoot), "my-power-dsh")
/** The installed dependency: `bun install` puts the pinned @mpd-dsh/mpd here. */
const INSTALLED_MPD_ROOT = join(repoRoot, "node_modules", "@mpd-dsh", "mpd")
/** Auto-discovery order when neither --mpd nor MPD_SOURCE_ROOT names a root. */
const MPD_ROOT_CANDIDATES = [
  { root: INSTALLED_MPD_ROOT, via: "installed dependency node_modules/@mpd-dsh/mpd" },
  { root: SIBLING_MPD_ROOT, via: "sibling checkout ../my-power-dsh" },
]
/** Strict decoder: invalid UTF-8 is an unparseable layer, not mojibake. */
const utf8 = new TextDecoder("utf-8", { fatal: true })

const EXIT_OK = 0
const EXIT_INTERSECT = 1
const EXIT_UNUSABLE = 2

const MPD_HINT = "[rows-disjoint] hint: since mpd v0.15.1 the mpd patch layers live at the mpd checkout ROOT — <mpd>/cordis.patch.yml and <mpd>/presets/mpd.patch.yml, declared in <mpd>/package.json dsh.bundle.patch. Run `bun install` (the installed dependency node_modules/@mpd-dsh/mpd is tried first), or set MPD_SOURCE_ROOT=<mpd-checkout> (or pass --mpd <mpd-checkout>), or set MPD_SOURCE_PATCH=<one patch file> to read a single explicit layer."

/** An input the gate could not use: reported as exit 2, never converted to a pass. */
class UnusableError extends Error {
  /**
   * @param {string} message
   * @param {{ mpd?: boolean }} [options] mpd: print the mpd-layout hint
   */
  constructor(message, options = {}) {
    super(message)
    this.name = "UnusableError"
    this.mpd = options.mpd === true
  }
}

/**
 * A candidate mpd root is USABLE when it carries BOTH layers mpd v0.15.1
 * declares. An incomplete copy is skipped as a whole: reading only one of its
 * layers would compare the silicon ids against half of mpd's claims, which can
 * pass falsely. A skipped candidate is reported by the caller, never silent.
 * @param {string} root candidate mpd root
 * @returns {boolean}
 */
function isUsableMpdRoot(root) {
  return existsSync(join(root, "cordis.patch.yml")) && existsSync(join(root, "presets", "mpd.patch.yml"))
}

/**
 * First usable auto-discovery candidate (root + provenance), or null when none is.
 * @param {Array<{root: string, via: string}>} candidates ordered candidates
 * @returns {{root: string, via: string} | null}
 */
export function pickUsableMpdRoot(candidates) {
  for (const candidate of candidates) {
    if (isUsableMpdRoot(candidate.root)) return candidate
  }
  return null
}

/** `    - id: X` exactly 4 spaces, under a column-0 `- insert:` block. */
const INSERT_ROW = /^ {4}- id: ['"]?([A-Za-z0-9_.@/-]+)['"]?\s*$/
/** Column-0 `- id: X` — a patch that targets an existing row (whole-value assign). */
const TARGET_ROW = /^- id: ['"]?([A-Za-z0-9_.@/-]+)['"]?\s*$/
/** Column-0 `- insert:` starts an additive block; any other column-0 line ends it. */
const INSERT_BLOCK = /^- insert:\s*$/

/**
 * Parse one patch file into its complete row-id claim set.
 * @param {string} text patch file contents
 * @returns {{insertIds: string[], targetIds: string[], ids: string[]}} sorted, deduped
 */
export function parsePatchRowIds(text) {
  const insertIds = []
  const targetIds = []
  let inInsert = false
  for (const raw of text.split(/\r?\n/)) {
    const target = raw.match(TARGET_ROW)
    if (target) {
      // A column-0 id-target also closes any open insert block.
      inInsert = false
      targetIds.push(target[1])
      continue
    }
    if (INSERT_BLOCK.test(raw)) {
      inInsert = true
      continue
    }
    if (raw.trim() === "") continue
    if (!inInsert) continue
    if (!raw.startsWith(" ")) {
      inInsert = false
      continue
    }
    const insert = raw.match(INSERT_ROW)
    if (insert) insertIds.push(insert[1])
  }
  const unique = (values) => [...new Set(values)].sort()
  const ids = unique([...insertIds, ...targetIds])
  return { insertIds: unique(insertIds), targetIds: unique(targetIds), ids }
}

/**
 * Normalize a bundle manifest's `dsh.bundle.patch` into layer paths.
 *
 * The loader's contract is a string (one layer) or an array (N layers), each a
 * path relative to the bundle root. A manifest we cannot read at all, or one
 * with no declaration, falls back to `<root>/cordis.patch.yml` — the current
 * mpd layout's root layer. A declaration that IS present but malformed is a
 * failure, not a fallback: silently reading the wrong layer would weaken the gate.
 *
 * @param {string} root bundle checkout root
 * @param {"mpd"|"silicon"|string} [label] whose manifest this is (diagnostics)
 * @returns {{layers: string[], source: string}}
 */
export function discoverManifestLayers(root, label = "bundle") {
  const manifestPath = join(root, "package.json")
  /** @type {any} */
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch {
    const fallback = join(root, "cordis.patch.yml")
    return { layers: [fallback], source: `fallback ${fallback} (no readable package.json at ${manifestPath})` }
  }
  const declared = manifest?.dsh?.bundle?.patch
  if (declared === undefined || declared === null) {
    const fallback = join(root, "cordis.patch.yml")
    return { layers: [fallback], source: `fallback ${fallback} (no dsh.bundle.patch in ${manifestPath})` }
  }
  const entries = typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared : null
  if (entries === null || entries.length === 0) {
    throw new UnusableError(`${manifestPath}: dsh.bundle.patch must be a non-empty string or array of paths, got ${JSON.stringify(declared)}`, { mpd: label === "mpd" })
  }
  const layers = entries.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new UnusableError(`${manifestPath}: dsh.bundle.patch entry is not a path string: ${JSON.stringify(entry)}`, { mpd: label === "mpd" })
    }
    return resolve(root, entry)
  })
  return { layers, source: manifestPath }
}

/**
 * Read one layer, mapping every read/decode failure to UnusableError.
 * @param {string} path layer file
 * @param {"mpd"|"silicon"|string} label
 * @returns {string}
 */
function readLayerText(path, label) {
  /** @type {Buffer} */
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error) {
    const code = /** @type {{code?: string}} */ (error)?.code
    const why = code === "ENOENT" ? "not found" : `unreadable${code ? ` (${code})` : ""}`
    throw new UnusableError(`${label} patch ${why} at ${path}`, { mpd: label === "mpd" })
  }
  try {
    return utf8.decode(bytes)
  } catch {
    throw new UnusableError(`${label} patch is not parseable as UTF-8 at ${path}`, { mpd: label === "mpd" })
  }
}

/** Parse every discovered layer; any unreadable layer throws (exit 2). */
function readPatches(paths, label) {
  return paths.map((path) => ({
    path,
    ...parsePatchRowIds(readLayerText(path, label)),
  }))
}

/** Union the row ids of N parsed layers. */
function combineLayers(layers) {
  const unique = (values) => [...new Set(values)].sort()
  const insertIds = unique(layers.flatMap((layer) => layer.insertIds))
  const targetIds = unique(layers.flatMap((layer) => layer.targetIds))
  return { insertIds, targetIds, ids: unique([...insertIds, ...targetIds]) }
}

function intersection(a, b) {
  const setB = new Set(b)
  return a.filter((id) => setB.has(id))
}

// ── the gate ────────────────────────────────────────────────────────────────

function checkDisjoint({ siliconLayers, mpdLayers, siliconLabel, mpdLabel }) {
  const silicon = combineLayers(siliconLayers)
  const mpd = combineLayers(mpdLayers)
  const overlap = intersection(silicon.ids, mpd.ids)

  for (const [label, layers] of [[siliconLabel, siliconLayers], [mpdLabel, mpdLayers]]) {
    layers.forEach((layer, index) => {
      console.log(`[rows-disjoint] ${label} layer ${index + 1}/${layers.length} (${layer.path}): ${layer.ids.length} row id(s) — insert ${layer.insertIds.length}, id-target ${layer.targetIds.length}`)
    })
  }
  console.log(`[rows-disjoint] ${siliconLabel} total: ${silicon.ids.length} row id(s) — insert ${silicon.insertIds.length}, id-target ${silicon.targetIds.length}, across ${siliconLayers.length} layer(s)`)
  console.log(`[rows-disjoint] ${mpdLabel} total: ${mpd.ids.length} row id(s) — insert ${mpd.insertIds.length}, id-target ${mpd.targetIds.length}, across ${mpdLayers.length} layer(s)`)
  if (mpd.targetIds.length > 0) {
    console.log(`[rows-disjoint] ${mpdLabel} id-targets (must never be re-patched by silicon): ${mpd.targetIds.join(", ")}`)
  }
  if (silicon.targetIds.length > 0) {
    console.log(`[rows-disjoint] ${siliconLabel} id-targets: ${silicon.targetIds.join(", ")}`)
  }

  if (overlap.length > 0) {
    for (const id of overlap) {
      const kind = silicon.targetIds.includes(id) ? "id-target" : "insert"
      console.error(`[rows-disjoint] COLLISION (${kind}): row id "${id}" is claimed by BOTH bundles`)
    }
    console.error(`[rows-disjoint] FAIL: ${overlap.length} colliding row id(s): ${overlap.join(", ")}`)
    console.error("[rows-disjoint] fix: rename the silicon row (silicon-* prefix) or drop the silicon id-target")
    return EXIT_INTERSECT
  }
  console.log("[rows-disjoint] PASS: silicon ∩ mpd = ∅")
  return EXIT_OK
}

// ── self-test: the parser and the gate must both be provably honest ─────────

const FIXTURES = [
  {
    name: "insert ids and column-0 id-targets are both claimed",
    text: "- id: agent-presets\n  name: x\n- insert:\n    - id: mpd-verif\n      name: y\n",
    expectIds: ["agent-presets", "mpd-verif"],
  },
  {
    name: "commented-out rows are not claims",
    text: "- insert:\n    - id: real-row\n# - id: commented\n#     - id: also-commented\n",
    expectIds: ["real-row"],
  },
  {
    name: "deeper nested config keys are not rows",
    text: "- insert:\n    - id: outer\n      config:\n        id: not-a-row\n        profiles:\n          z: {}\n",
    expectIds: ["outer"],
  },
  {
    name: "a column-0 line ends the insert block",
    text: "- insert:\n    - id: first\n    - id: second\n- id: target-after\n",
    expectIds: ["first", "second", "target-after"],
  },
  {
    name: "the same id twice in one file is reported once",
    text: "- insert:\n    - id: dup\n    - id: dup\n",
    expectIds: ["dup"],
  },
  {
    name: "quoted ids parse",
    text: "- insert:\n    - id: 'quoted-row'\n",
    expectIds: ["quoted-row"],
  },
]

/** A layer as checkDisjoint consumes it, for text-only fixtures. */
function fixtureLayer(path, text) {
  return { path, ...parsePatchRowIds(text) }
}

/** Run one discovery scenario in a throwaway directory and clean up afterwards. */
function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "rows-disjoint-"))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function selfTest() {
  let failures = 0
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
      console.log(`[rows-disjoint] self-test PASS: ${name}`)
      return
    }
    failures += 1
    console.error(`[rows-disjoint] self-test FAIL: ${name}\n  expected ${e}\n  actual   ${a}`)
  }

  for (const fixture of FIXTURES) {
    check(fixture.name, parsePatchRowIds(fixture.text).ids, fixture.expectIds)
  }

  // The gate itself: overlapping input MUST fail, disjoint input MUST pass.
  const overlap = checkDisjoint({
    siliconLayers: [fixtureLayer("fixture-silicon", "- insert:\n    - id: shared-row\n")],
    mpdLayers: [fixtureLayer("fixture-mpd", "- insert:\n    - id: shared-row\n")],
    siliconLabel: "fixture-silicon",
    mpdLabel: "fixture-mpd",
  })
  check("gate fails on an overlap", overlap, EXIT_INTERSECT)

  const disjoint = checkDisjoint({
    siliconLayers: [fixtureLayer("fixture-silicon", "- insert:\n    - id: silicon-only\n")],
    mpdLayers: [fixtureLayer("fixture-mpd", "- id: agent-presets\n  name: x\n- insert:\n    - id: mpd-only\n")],
    siliconLabel: "fixture-silicon",
    mpdLabel: "fixture-mpd",
  })
  check("gate passes on disjoint sets", disjoint, EXIT_OK)

  // (a) a STRING dsh.bundle.patch is one layer.
  const stringManifest = withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dsh: { bundle: { patch: "./cordis.patch.yml" } } }))
    writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n    - id: string-row\n")
    const discovery = discoverManifestLayers(dir, "mpd")
    const layers = readPatches(discovery.layers, "mpd")
    return {
      count: discovery.layers.length,
      expected: join(dir, "cordis.patch.yml"),
      path: discovery.layers[0],
      ids: layers[0].ids,
    }
  })
  check("string patch manifest yields one layer", stringManifest.count, 1)
  check("string patch manifest resolves against the bundle root", stringManifest.path, stringManifest.expected)
  check("string patch manifest layer parses", stringManifest.ids, ["string-row"])

  // (b) an ARRAY dsh.bundle.patch is N layers — every one is read.
  const arrayManifest = withTempDir((dir) => {
    mkdirSync(join(dir, "presets"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dsh: { bundle: { patch: ["./cordis.patch.yml", "./presets/mpd.patch.yml"] } } }))
    writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n    - id: root-row\n")
    writeFileSync(join(dir, "presets", "mpd.patch.yml"), "- insert:\n    - id: preset-row\n")
    const discovery = discoverManifestLayers(dir, "mpd")
    const layers = readPatches(discovery.layers, "mpd")
    return { count: discovery.layers.length, ids: layers.flatMap((layer) => layer.ids) }
  })
  check("array patch manifest yields two layers", arrayManifest.count, 2)
  check("array patch manifest parses both layers", arrayManifest.ids, ["root-row", "preset-row"])

  // (c) no manifest at all falls back to <root>/cordis.patch.yml.
  const fallback = withTempDir((dir) => {
    writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n    - id: fallback-row\n")
    const discovery = discoverManifestLayers(dir, "mpd")
    const layers = readPatches(discovery.layers, "mpd")
    return {
      count: discovery.layers.length,
      expected: join(dir, "cordis.patch.yml"),
      path: discovery.layers[0],
      source: discovery.source,
      ids: layers[0].ids,
    }
  })
  check("missing manifest falls back to one root layer", fallback.count, 1)
  check("fallback layer is <root>/cordis.patch.yml", fallback.path, fallback.expected)
  check("fallback is announced in the discovery source", fallback.source.startsWith("fallback "), true)
  check("fallback layer parses", fallback.ids, ["fallback-row"])

  // (d) a DECLARED layer that is missing must fail loudly (exit 2, not skip).
  const missing = withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dsh: { bundle: { patch: ["./cordis.patch.yml", "./presets/mpd.patch.yml"] } } }))
    writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n    - id: only-row\n")
    const discovery = discoverManifestLayers(dir, "mpd")
    try {
      readPatches(discovery.layers, "mpd")
      return { code: EXIT_OK, message: "", mpd: false }
    } catch (error) {
      return {
        code: error instanceof UnusableError ? EXIT_UNUSABLE : "unexpected",
        message: String(error?.message),
        mpd: error?.mpd === true,
      }
    }
  })
  check("a missing declared layer fails loudly", missing.code, EXIT_UNUSABLE)
  check("the missing-layer failure names the layer", missing.message.includes(join("presets", "mpd.patch.yml")), true)
  check("the missing-layer failure carries the mpd hint", missing.mpd, true)

  // (d2) an unparseable (non-UTF-8) layer is the same failure class.
  const undecodable = withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dsh: { bundle: { patch: "./cordis.patch.yml" } } }))
    writeFileSync(join(dir, "cordis.patch.yml"), Buffer.from([0xff, 0xfe, 0x00]))
    try {
      readPatches(discoverManifestLayers(dir, "mpd").layers, "mpd")
      return EXIT_OK
    } catch (error) {
      return error instanceof UnusableError ? EXIT_UNUSABLE : "unexpected"
    }
  })
  check("an unparseable layer fails loudly", undecodable, EXIT_UNUSABLE)

  // (e) a collision inside a LATER discovered layer is still caught.
  const collision = withTempDir((dir) => {
    mkdirSync(join(dir, "presets"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dsh: { bundle: { patch: ["./cordis.patch.yml", "./presets/mpd.patch.yml"] } } }))
    writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n    - id: root-row\n")
    writeFileSync(join(dir, "presets", "mpd.patch.yml"), "- insert:\n    - id: shared-row\n")
    return checkDisjoint({
      siliconLayers: [fixtureLayer("fixture-silicon", "- insert:\n    - id: shared-row\n")],
      mpdLayers: readPatches(discoverManifestLayers(dir, "mpd").layers, "mpd"),
      siliconLabel: "fixture-silicon",
      mpdLabel: "fixture-mpd",
    })
  })
  check("gate catches a collision in a later discovered layer", collision, EXIT_INTERSECT)

  // (f) auto-discovery takes the first USABLE candidate and reports none when all are incomplete.
  const candidates = withTempDir((dir) => {
    const incomplete = join(dir, "incomplete")
    const usable = join(dir, "usable")
    mkdirSync(incomplete, { recursive: true })
    mkdirSync(join(usable, "presets"), { recursive: true })
    writeFileSync(join(usable, "cordis.patch.yml"), "- insert:\n    - id: usable-row\n")
    writeFileSync(join(usable, "presets", "mpd.patch.yml"), "- insert:\n    - id: usable-preset-row\n")
    return {
      selected: pickUsableMpdRoot([{ root: incomplete, via: "incomplete" }, { root: usable, via: "usable" }])?.root,
      expected: usable,
      none: pickUsableMpdRoot([{ root: incomplete, via: "incomplete" }]),
    }
  })
  check("auto-discovery skips an incomplete candidate", candidates.selected, candidates.expected)
  check("auto-discovery reports no usable candidate", candidates.none, null)

  if (failures > 0) {
    console.error(`[rows-disjoint] self-test FAILED (${failures})`)
    return EXIT_INTERSECT
  }
  console.log("[rows-disjoint] self-test PASSED (6 parser fixtures + 2 gate fixtures + 7 discovery fixtures)")
  return EXIT_OK
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(argv) {
  let siliconPatch
  let explicitMpdRoot = process.env.MPD_SOURCE_ROOT
  let runSelfTest = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--self-test") runSelfTest = true
    else if (arg === "--silicon") {
      siliconPatch = argv[++i]
      if (siliconPatch === undefined) {
        console.error("[rows-disjoint] FAIL(unusable): --silicon needs a path")
        return EXIT_UNUSABLE
      }
    } else if (arg === "--mpd") {
      explicitMpdRoot = argv[++i]
      if (explicitMpdRoot === undefined) {
        console.error("[rows-disjoint] FAIL(unusable): --mpd needs an mpd checkout root")
        return EXIT_UNUSABLE
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/verify-rows-disjoint.mjs [--silicon <patch>] [--mpd <mpd-root>] [--self-test]")
      return EXIT_OK
    } else {
      console.error(`[rows-disjoint] FAIL(unusable): unknown argument ${JSON.stringify(arg)}`)
      return EXIT_UNUSABLE
    }
  }

  if (runSelfTest) {
    const tested = selfTest()
    if (tested !== EXIT_OK) return tested
  }

  try {
    // MPD_SOURCE_PATCH is an explicit FILE: it wins and is the only mpd layer.
    let mpdDiscovery
    if (process.env.MPD_SOURCE_PATCH) {
      mpdDiscovery = { layers: [resolve(process.env.MPD_SOURCE_PATCH)], source: "MPD_SOURCE_PATCH (explicit single layer)" }
    } else {
      const resolved = explicitMpdRoot === undefined
        ? pickUsableMpdRoot(MPD_ROOT_CANDIDATES)
        : { root: explicitMpdRoot, via: "--mpd / MPD_SOURCE_ROOT (explicit)" }
      if (resolved === null) {
        const tried = MPD_ROOT_CANDIDATES.map((candidate) => `${candidate.root} (${candidate.via})`).join(", ")
        throw new UnusableError(`no usable mpd root — tried ${tried}; a candidate must carry cordis.patch.yml AND presets/mpd.patch.yml`, { mpd: true })
      }
      console.log(`[rows-disjoint] mpd root: ${resolved.root} (via ${resolved.via})`)
      mpdDiscovery = discoverManifestLayers(resolved.root, "mpd")
    }
    const siliconDiscovery = siliconPatch
      ? { layers: [resolve(siliconPatch)], source: "--silicon (explicit single layer)" }
      : discoverManifestLayers(repoRoot, "silicon")

    console.log(`[rows-disjoint] silicon: ${siliconDiscovery.layers.length} layer(s) via ${siliconDiscovery.source}`)
    console.log(`[rows-disjoint] mpd: ${mpdDiscovery.layers.length} layer(s) via ${mpdDiscovery.source}`)

    return checkDisjoint({
      siliconLayers: readPatches(siliconDiscovery.layers, "silicon"),
      mpdLayers: readPatches(mpdDiscovery.layers, "mpd"),
      siliconLabel: "silicon",
      mpdLabel: "mpd",
    })
  } catch (error) {
    if (!(error instanceof UnusableError)) throw error
    console.error(`[rows-disjoint] FAIL(unusable): ${error.message}`)
    if (error.mpd) console.error(MPD_HINT)
    return EXIT_UNUSABLE
  }
}

process.exit(main(process.argv.slice(2)))
