#!/usr/bin/env node
// verify-corpus: prove the RTL skill corpus this bundle ships is complete and is
// the corpus the skill provider actually serves.
//
// Checks (all offline; nothing here writes to, or reads, a harness home):
//   1. shape        skills/ contains EXACTLY the three RTL trees — no mpd
//                   general-purpose corpus (dsh-qa / programming / frontend /
//                   ulw-* …) leaks into the RTL sub-bundle.
//   2. inventory    every expected template / reference / example / fixture file
//                   exists, and the tree holds at least MIN_FILES files.
//   3. fidelity     every shipped file matches the COMMITTED baseline manifest
//                   (evidence/verification/corpus-baseline.json: relative path +
//                   sha256 per file). The baseline is self-contained on purpose:
//                   the source checkout is stripped away by design, so pointing
//                   fidelity at it made this gate fail forever after the split.
//                   When a source checkout IS present it is used as an EXTRA
//                   cross-check; a missing source tree is a printed SKIP, never
//                   a silent pass.
//   4. text hygiene every file is LF-only UTF-8 (the bundle is committed to git
//                   with eol=lf, so CRLF would be a silent tree diff).
//   5. loadability  the SHIPPED provider (packages/mpd-silicon-bootstrap-plugin)
//                   lists exactly the three skills, through bun (required for this
//                   check: a missing bun or a probe throw is a FAIL, never a skip —
//                   a skip here is how a stale provider call silently disabled the
//                   check). The only skips in this gate are check 3's cross-check.
//
// Usage:
//   node scripts/verify-corpus.mjs              validate this checkout
//   node scripts/verify-corpus.mjs --self-test   negative controls (the checks must
//                                                FAIL on a damaged corpus) + full run
//   node scripts/verify-corpus.mjs --json        machine-readable result on stdout
//
// Environment:
//   MPD_CORPUS_BASELINE  override the committed baseline manifest path
//   MPD_SOURCE_ROOT      source checkout root for the optional cross-check
//   MPD_SOURCE_SKILLS    explicit <source>/skills dir (wins over MPD_SOURCE_ROOT)
//
// Exit codes: 0 = every check passed (skips are reported, never hidden);
//             1 = a check failed; 2 = usage error.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillsRoot = join(repoRoot, "skills")
const BASELINE_PATH = process.env.MPD_CORPUS_BASELINE || join(repoRoot, "evidence", "verification", "corpus-baseline.json")

/**
 * Optional source checkout, used ONLY for the extra cross-check. Resolution order:
 * an explicit MPD_SOURCE_SKILLS, then <MPD_SOURCE_ROOT>/skills, then the sibling
 * checkout ../my-power-dsh/skills. None of them existing is the normal state after
 * the strip and yields a printed SKIP — never a failure, never a silent pass.
 */
function resolveSourceSkills() {
  if (process.env.MPD_SOURCE_SKILLS) return process.env.MPD_SOURCE_SKILLS
  const root = process.env.MPD_SOURCE_ROOT || join(dirname(repoRoot), "my-power-dsh")
  return join(root, "skills")
}
const SOURCE_SKILLS = resolveSourceSkills()

/** The three RTL skill trees this bundle owns, with their required contents. */
const TREES = {
  "rtl-ip-flow": [
    "SKILL.md",
    "templates/req-spec.md",
    "templates/user-manual.md",
    "templates/user-manual.en.md",
    "templates/detail-design.md",
    "templates/verification-plan.md",
    "templates/dfmea.md",
    "templates/validation-report.md",
    "templates/validation-manual.md",
    "templates/defect-report.md",
  ],
  "rtl-codestyle": [
    "SKILL.md",
    "templates/module_skeleton.vinc",
    "templates/parameterized_counter.vinc",
    "templates/fsm_3process.vinc",
    "references/style-checklist.md",
    "references/comment-conventions.md",
  ],
  "rtl-verif": [
    "SKILL.md",
    "README.md",
    "templates/uvm/dut_pkg.sv",
    "templates/uvm/dut_agent.sv",
    "templates/uvm/dut_driver.sv",
    "templates/uvm/dut_monitor.sv",
    "templates/uvm/dut_sequence_item.sv",
    "templates/uvm/dut_sequence.sv",
    "templates/uvm/dut_scoreboard.sv",
    "templates/uvm/dut_env.sv",
    "templates/uvm/README.md",
    "templates/cocotb/Makefile",
    "templates/cocotb/tb_template.py",
    "templates/cocotb/bootstrap_venv.sh",
    "examples/regression/README.md",
    "examples/regression/run_regression.sh",
    "fixtures/adder4/Makefile",
    "fixtures/adder4/tb_adder4.py",
    "fixtures/cnt8/Makefile",
    "fixtures/cnt8/tb_cnt8.py",
  ],
}

/** mpd's own corpus directories: their presence here means the split leaked. */
const FOREIGN = ["dsh-qa", "programming", "frontend", "debugging", "ulw", "ulw-loop", "rtl-dev", "agent-teams"]
/** The corpus must hold at least this many files (the contract's floor). */
const MIN_FILES = 36

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function walk(root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true, encoding: "utf8" })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

function listTree(root, tree) {
  const base = join(root, tree)
  if (!existsSync(base)) return []
  return walk(base).map((file) => relative(base, file).split("\\").join("/")).sort()
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

// ── checks ──────────────────────────────────────────────────────────────────

function checkShape(root, problems, passes) {
  if (!existsSync(root)) {
    problems.push(`skills/ missing at ${root}`)
    return
  }
  const entries = readdirSync(root, { withFileTypes: true, encoding: "utf8" })
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  const expected = Object.keys(TREES).sort()
  if (!sameList(dirs, expected)) {
    problems.push(`skills/ trees = [${dirs.join(", ")}] but expected exactly [${expected.join(", ")}]`)
  } else {
    passes.push(`skills/ holds exactly the three RTL trees (${expected.join(", ")})`)
  }
  const foreign = dirs.filter((dir) => FOREIGN.includes(dir) || dir.startsWith("ulw"))
  if (foreign.length > 0) problems.push(`mpd general-purpose corpus leaked into the RTL bundle: ${foreign.join(", ")}`)
  if (files.length > 0) problems.push(`unexpected top-level files under skills/ (corpus is tree-only): ${files.join(", ")}`)
}

function checkInventory(root, problems, passes) {
  let total = 0
  for (const [tree, required] of Object.entries(TREES)) {
    const shipped = listTree(root, tree)
    total += shipped.length
    const missing = required.filter((file) => !shipped.includes(file))
    if (missing.length > 0) problems.push(`${tree}: missing ${missing.length} required file(s): ${missing.join(", ")}`)
    const extra = shipped.filter((file) => !required.includes(file))
    if (extra.length > 0) problems.push(`${tree}: unexpected file(s) not in the required inventory: ${extra.join(", ")}`)
    if (missing.length === 0 && extra.length === 0) passes.push(`${tree}: all ${shipped.length} required files present`)
  }
  if (total < MIN_FILES) problems.push(`corpus has ${total} files, below the required floor of ${MIN_FILES}`)
  else passes.push(`corpus file count ${total} >= ${MIN_FILES}`)
  return total
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

/** The committed baseline manifest, or undefined when it is absent/unreadable. */
function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return parsed && typeof parsed === "object" && parsed.trees ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Self-held fidelity: the shipped corpus must match the committed manifest
 * (relative path + sha256 per file). This is the authoritative check — it needs
 * no source checkout, which is the whole point after the RTL strip.
 */
function checkFidelity(root, problems, passes, skipped, options = {}) {
  const baseline = loadBaseline(options.baselinePath)
  if (baseline === undefined) {
    problems.push(`fidelity baseline missing or unreadable at ${options.baselinePath ?? BASELINE_PATH} (set MPD_CORPUS_BASELINE to override)`)
    return
  }
  const rev = baseline.generatedFrom?.rev ?? "unknown"
  for (const [tree, entries] of Object.entries(baseline.trees)) {
    const shipped = listTree(root, tree)
    const expected = Object.keys(entries).sort()
    if (shipped.length === 0) {
      problems.push(`${tree}: not present in the shipped corpus (the committed baseline expects ${expected.length} files)`)
      continue
    }
    const onlyShipped = shipped.filter((file) => !expected.includes(file))
    const onlyBaseline = expected.filter((file) => !shipped.includes(file))
    if (onlyShipped.length > 0 || onlyBaseline.length > 0) {
      problems.push(`${tree}: file list differs from the committed baseline (extra here: [${onlyShipped.join(", ")}]; missing here: [${onlyBaseline.join(", ")}])`)
      continue
    }
    const differing = shipped.filter((file) => sha256(join(root, tree, file)) !== entries[file].sha256)
    if (differing.length > 0) {
      problems.push(`${tree}: ${differing.length} file(s) differ from the committed baseline (sha256): ${differing.join(", ")}`)
    } else {
      passes.push(`${tree}: ${shipped.length} files match the committed baseline (sha256, source rev ${rev})`)
    }
  }
  checkSourceCrossCheck(root, problems, passes, skipped)
}

/**
 * Optional extra evidence: compare against a live source checkout when one is
 * present. Every absence is reported as a SKIP line (visible in the output and in
 * the skipped count) — never silently swallowed, and never a failure.
 */
function checkSourceCrossCheck(root, problems, passes, skipped) {
  if (!existsSync(SOURCE_SKILLS)) {
    skipped.push(`fidelity cross-check: no source checkout at ${SOURCE_SKILLS} — the committed baseline above is authoritative (set MPD_SOURCE_ROOT or MPD_SOURCE_SKILLS to cross-check)`)
    return
  }
  for (const tree of Object.keys(TREES)) {
    const sourceTree = join(SOURCE_SKILLS, tree)
    if (!existsSync(sourceTree)) {
      skipped.push(`fidelity cross-check: tree ${tree} is not present in the source checkout at ${SOURCE_SKILLS} (expected after the RTL strip)`)
      continue
    }
    const shipped = listTree(root, tree)
    const source = listTree(SOURCE_SKILLS, tree)
    if (!sameList(shipped, source)) {
      const onlyShipped = shipped.filter((file) => !source.includes(file))
      const onlySource = source.filter((file) => !shipped.includes(file))
      problems.push(`${tree}: file list differs from the source checkout (only here: [${onlyShipped.join(", ")}]; only there: [${onlySource.join(", ")}])`)
      continue
    }
    const differing = shipped.filter((file) => sha256(join(root, tree, file)) !== sha256(join(SOURCE_SKILLS, tree, file)))
    if (differing.length > 0) problems.push(`${tree}: ${differing.length} file(s) differ from the source checkout: ${differing.join(", ")}`)
    else passes.push(`${tree}: ${shipped.length} files byte-identical to the source checkout at ${SOURCE_SKILLS}`)
  }
}

function checkTextHygiene(root, problems, passes) {
  const files = Object.keys(TREES).flatMap((tree) => listTree(root, tree).map((file) => `${tree}/${file}`))
  const crlf = []
  const invalid = []
  for (const file of files) {
    const bytes = readFileSync(join(root, file))
    if (bytes.includes(0x0d)) crlf.push(file)
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { invalid.push(file) }
  }
  if (crlf.length > 0) problems.push(`CRLF line endings in ${crlf.length} file(s) (the corpus is committed eol=lf): ${crlf.join(", ")}`)
  if (invalid.length > 0) problems.push(`non-UTF-8 file(s): ${invalid.join(", ")}`)
  if (crlf.length === 0 && invalid.length === 0) passes.push(`text hygiene: all ${files.length} files are LF-only UTF-8`)
}

/**
 * The adapter surface the probe hands to `createProvider` (which now REQUIRES it).
 * `onEvent` is the only member the provider reads at construction; it does not call
 * `registerSkillProvider` (that is `apply`'s seam), so this stub is sufficient and
 * allocating a real adapter would couple the gate to the dependency's runtime.
 * Self-test controls override this expression to model a broken probe.
 */
const PROBE_ADAPTER = "{ onEvent: () => () => {} }"

/**
 * Ask the SHIPPED provider what it lists. Uses bun (the repo's toolchain).
 * The provider CODE always comes from this checkout; `corpusRoot` is the skills
 * directory to read — so the self-test can point the real provider at a mutated
 * sandbox corpus.
 *
 * Every failure is STRUCTURED (`kind`), because the caller must distinguish nothing:
 * a missing provider source, a missing bun, or a provider throw are all defects this
 * check exists to catch. Only the fidelity cross-check may skip.
 */
function providerSkills(bundleRoot, corpusRoot = join(bundleRoot, "skills"), options = {}) {
  const runner = join(bundleRoot, "packages", "mpd-silicon-bootstrap-plugin", "src", "index.ts")
  if (!existsSync(runner)) return { available: false, kind: "missing-source", reason: `provider source missing at ${runner}` }
  const adapterExpr = options.adapterExpr ?? PROBE_ADAPTER
  const program = `
    const m = await import(${JSON.stringify(runner)})
    const adapter = ${adapterExpr}
    const provider = m.createProvider(${JSON.stringify(corpusRoot)}, { logger: { warn: (x) => { console.error("[provider-warn] " + x) } } }, () => {}, adapter)
    const list = await provider.list()
    const out = []
    for (const candidate of list) {
      const loaded = await provider.get(candidate)
      out.push({ name: candidate.name, provider: candidate.provider, source: candidate.source, rank: candidate.rank, descriptionLength: String(candidate.description ?? "").length, contentLength: String(loaded?.content ?? "").length })
    }
    console.log(JSON.stringify({ provider: provider.name, skills: out }))
  `
  try {
    const stdout = execFileSync("bun", ["-e", program], { cwd: bundleRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const parsed = JSON.parse(stdout.trim().split("\n").pop())
    return { available: true, ...parsed }
  } catch (error) {
    const first = String(error?.message ?? error).split("\n")[0]
    if (error?.code === "ENOENT") {
      return { available: false, kind: "probe", reason: `provider probe could not run: bun is not on PATH (install bun or add .mpd/tools/bun/bin); ${first}` }
    }
    return { available: false, kind: "probe", reason: `provider probe failed: ${first}` }
  }
}

function checkLoadability(bundleRoot, problems, passes, options = {}) {
  const result = providerSkills(bundleRoot, options.corpusRoot ?? join(bundleRoot, "skills"), options)
  if (!result.available) {
    // NO SKIP HERE. A stale call signature, a missing provider source or a missing
    // bun used to degrade to SKIP and exit 0, which is exactly how the loadability
    // check went silently dead. It is a FAIL: a green corpus gate must mean the
    // provider really listed the skills.
    problems.push(`loadability: ${result.reason}`)
    return
  }
  const names = result.skills.map((skill) => skill.name).sort()
  const expected = Object.keys(TREES).sort()
  if (result.provider !== "silicon-bundle") problems.push(`provider name = "${result.provider}", expected "silicon-bundle"`)
  if (!sameList(names, expected)) problems.push(`provider lists [${names.join(", ")}] but the corpus should surface exactly [${expected.join(", ")}]`)
  for (const skill of result.skills) {
    if (!SKILL_NAME.test(skill.name)) problems.push(`provider surfaced an illegal skill name: ${skill.name}`)
    if (skill.provider !== "silicon-bundle") problems.push(`${skill.name}: provider field = ${skill.provider}`)
    if (skill.source !== "bundled") problems.push(`${skill.name}: source field = ${skill.source}`)
    if (skill.rank !== 600) problems.push(`${skill.name}: rank = ${skill.rank}, expected 600`)
    if (!(skill.descriptionLength > 0)) problems.push(`${skill.name}: empty description`)
    if (!(skill.contentLength > 0)) problems.push(`${skill.name}: empty content from get()`)
  }
  if (sameList(names, expected) && result.provider === "silicon-bundle") {
    passes.push(`provider "silicon-bundle" loads all ${names.length} skills: ${names.join(", ")}`)
  }
}

// ── self-test: the checks must FAIL on a damaged corpus ─────────────────────

function copyTree(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true, encoding: "utf8" })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else writeFileSync(target, readFileSync(source))
  }
}

function selfTest() {
  const failures = []
  let negativeControls = 0
  let healthyControls = 0
  const sandbox = mkdtempSync(join(tmpdir(), "silicon-corpus-selftest-"))

  const runOn = (root, options = {}) => {
    const problems = []
    const passes = []
    const skipped = []
    checkShape(root, problems, passes)
    checkInventory(root, problems, passes)
    if (options.fidelity !== false) checkFidelity(root, problems, passes, skipped, options)
    checkTextHygiene(root, problems, passes)
    if (options.loadability) checkLoadability(root, problems, passes)
    return { problems, passes, skipped }
  }

  // control 1: a HEALTHY copy of the real corpus must pass every check, INCLUDING
  // the self-held baseline fidelity check (no source checkout involved)
  const healthy = join(sandbox, "healthy")
  copyTree(skillsRoot, healthy)
  const good = runOn(healthy, { fidelity: true })
  if (good.problems.length > 0) failures.push(`healthy control did NOT pass: ${good.problems.join("; ")}`)
  else healthyControls++

  // control 2: a missing required file must be caught
  const missing = join(sandbox, "missing")
  copyTree(skillsRoot, missing)
  rmSync(join(missing, "rtl-verif", "fixtures", "cnt8", "tb_cnt8.py"))
  const caught1 = runOn(missing, { fidelity: false }).problems
  if (!caught1.some((problem) => problem.includes("tb_cnt8.py"))) failures.push("missing-file control was NOT caught")
  else negativeControls++

  // control 3: a stray mpd corpus directory must be caught
  const foreign = join(sandbox, "foreign")
  copyTree(skillsRoot, foreign)
  mkdirSync(join(foreign, "dsh-qa"), { recursive: true })
  const caught2 = runOn(foreign, { fidelity: false }).problems
  if (!caught2.some((problem) => problem.includes("dsh-qa"))) failures.push("foreign-corpus control was NOT caught")
  else negativeControls++

  // control 4: a modified byte must be caught by the SELF-HELD baseline (no source
  // checkout involved — this is the control that proves fidelity is still real
  // after the RTL strip)
  const tampered = join(sandbox, "tampered")
  copyTree(skillsRoot, tampered)
  const skillFile = join(tampered, "rtl-ip-flow", "SKILL.md")
  writeFileSync(skillFile, readFileSync(skillFile, "utf8").replace("Stage 0", "Stage Zero"))
  const caught3 = runOn(tampered, { fidelity: true }).problems
  if (!caught3.some((problem) => problem.includes("differ from the committed baseline"))) failures.push("tampered-byte control was NOT caught")
  else negativeControls++

  // control 4b: a WHOLE TREE missing must be caught by the self-held baseline too
  // (the failure mode that made the old gate go silently useless: a stripped tree
  // must be a FAIL, not a skip)
  const treeGone = join(sandbox, "tree-gone")
  copyTree(skillsRoot, treeGone)
  rmSync(join(treeGone, "rtl-codestyle"), { recursive: true, force: true })
  const caught3b = runOn(treeGone, { fidelity: true }).problems
  if (!caught3b.some((problem) => problem.includes("not present in the shipped corpus"))) failures.push("whole-tree-missing control was NOT caught")
  else negativeControls++

  // control 4c: an absent/unreadable baseline must FAIL loudly instead of passing
  const noBaseline = runOn(healthy, { fidelity: true, baselinePath: join(sandbox, "no-such-baseline.json") }).problems
  if (!noBaseline.some((problem) => problem.includes("fidelity baseline missing"))) failures.push("missing-baseline control was NOT caught")
  else negativeControls++

  // control 5: a CRLF file must be caught
  const crlf = join(sandbox, "crlf")
  copyTree(skillsRoot, crlf)
  const crlfFile = join(crlf, "rtl-codestyle", "SKILL.md")
  writeFileSync(crlfFile, readFileSync(crlfFile, "utf8").replace(/\n/g, "\r\n"))
  const caught4 = runOn(crlf, { fidelity: false }).problems
  if (!caught4.some((problem) => problem.includes("CRLF"))) failures.push("CRLF control was NOT caught")
  else negativeControls++

  // control 6: frontmatter OUTSIDE the provider subset must cost the provider a skill
  // (the point of the subset check: drift is visible as a MISSING skill, not silence)
  const subsetBreak = join(sandbox, "subset-break")
  copyTree(skillsRoot, subsetBreak)
  const subsetFile = join(subsetBreak, "rtl-verif", "SKILL.md")
  writeFileSync(subsetFile, readFileSync(subsetFile, "utf8").replace("metadata:", "- not-a-map\nmetadata:"))
  const probe1 = providerSkills(repoRoot, subsetBreak)
  if (probe1.available) {
    const names = probe1.skills.map((skill) => skill.name).sort()
    if (names.includes("rtl-verif")) failures.push("subset control: a YAML list in the frontmatter did not stop rtl-verif from being served")
    if (!sameList(names, ["rtl-codestyle", "rtl-ip-flow"])) failures.push(`subset control: expected exactly the two intact skills, provider listed [${names.join(", ")}]`)
    if (!names.includes("rtl-verif") && sameList(names, ["rtl-codestyle", "rtl-ip-flow"])) negativeControls++
  } else {
    failures.push(`subset control could not run: ${probe1.reason}`)
  }

  // control 7: a skill whose frontmatter loses `description` must drop out entirely
  const noDescription = join(sandbox, "no-description")
  copyTree(skillsRoot, noDescription)
  const noDescriptionFile = join(noDescription, "rtl-ip-flow", "SKILL.md")
  writeFileSync(noDescriptionFile, readFileSync(noDescriptionFile, "utf8").replace(/^description:.*$/m, ""))
  const probe2 = providerSkills(repoRoot, noDescription)
  if (probe2.available) {
    const names = probe2.skills.map((skill) => skill.name).sort()
    if (!sameList(names, ["rtl-codestyle", "rtl-verif"])) failures.push(`missing-description control: provider listed [${names.join(", ")}], expected the two intact skills only`)
    else negativeControls++
  } else {
    failures.push(`missing-description control could not run: ${probe2.reason}`)
  }

  // control 8: a healthy corpus must surface ALL THREE skills through the same probe
  const healthyProbe = providerSkills(repoRoot, healthy)
  if (healthyProbe.available) {
    const names = healthyProbe.skills.map((skill) => skill.name).sort()
    if (!sameList(names, Object.keys(TREES).sort())) failures.push(`healthy provider control: listed [${names.join(", ")}] instead of all three skills`)
    else healthyControls++
  } else {
    failures.push(`healthy provider control could not run: ${healthyProbe.reason}`)
  }

  // control 9: the loadability CHECK must PASS on the real stub. Without this the
  // negative controls below could be satisfied by a check that fails everything.
  {
    const problems = []
    const passes = []
    checkLoadability(repoRoot, problems, passes)
    if (problems.length > 0) failures.push(`healthy loadability control did NOT pass: ${problems.join("; ")}`)
    else if (passes.length === 0) failures.push("healthy loadability control produced no pass line")
    else healthyControls++
  }

  // control 10 (NEGATIVE, the exact regression this gate missed): the stale
  // THREE-argument probe — no adapter at all. createProvider reads `adapter.onEvent`,
  // so omitting it throws. That throw must be a loadability FAILURE, never a skip.
  {
    const problems = []
    const passes = []
    checkLoadability(repoRoot, problems, passes, { adapterExpr: "undefined" })
    if (!problems.some((problem) => problem.includes("loadability")) || passes.length > 0) {
      failures.push(`omitted-adapter control was NOT caught as a loadability failure (problems=[${problems.join("; ")}])`)
    } else {
      negativeControls++
    }
  }

  // control 11 (NEGATIVE): a broken adapter stub whose onEvent THROWS is a probe
  // failure too. (A stub that merely OMITS onEvent does not throw: the provider
  // tolerates a missing event bus by design, so the two controls above model the
  // two ways createProvider actually fails.)
  {
    const problems = []
    const passes = []
    checkLoadability(repoRoot, problems, passes, { adapterExpr: "{ onEvent: () => { throw new Error('broken-adapter control') } }" })
    if (!problems.some((problem) => problem.includes("loadability")) || passes.length > 0) {
      failures.push(`throwing-onEvent control was NOT caught as a loadability failure (problems=[${problems.join("; ")}])`)
    } else {
      negativeControls++
    }
  }

  // control 12: a stub that OMITS onEvent is TOLERATED by design (the provider
  // feature-detects the event bus), so it must PASS. Pinned so nobody "fixes" the
  // probe by asserting onEvent is required: control 10/11 are the real failures.
  {
    const problems = []
    const passes = []
    checkLoadability(repoRoot, problems, passes, { adapterExpr: "{}" })
    if (problems.length > 0 || passes.length === 0) {
      failures.push(`onEvent-less stub control: expected PASS, got problems=[${problems.join("; ")}]`)
    } else {
      healthyControls++
    }
  }

  rmSync(sandbox, { recursive: true, force: true })
  return { failures, negativeControls, healthyControls }
}

// ── main ────────────────────────────────────────────────────────────────────

function validate(skills, bundleRoot = repoRoot) {
  const problems = []
  const passes = []
  const skipped = []
  checkShape(skills, problems, passes)
  const total = checkInventory(skills, problems, passes)
  checkFidelity(skills, problems, passes, skipped)
  checkTextHygiene(skills, problems, passes)
  checkLoadability(bundleRoot, problems, passes)
  return { problems, passes, skipped, total }
}

function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((arg) => arg !== "--self-test" && arg !== "--json")
  if (unknown.length > 0) {
    console.error("[verify-corpus] usage: node scripts/verify-corpus.mjs [--self-test] [--json]")
    process.exit(2)
  }
  const selfTestRequested = args.includes("--self-test")
  const selfTestResult = selfTestRequested ? selfTest() : { failures: [], negative: 0, healthy: 0 }
  const selfTestFailures = selfTestResult.failures
  const report = validate(skillsRoot, repoRoot)

  if (args.includes("--json")) {
    console.log(JSON.stringify({ repoRoot, skillsRoot, baseline: BASELINE_PATH, sourceSkills: SOURCE_SKILLS, total: report.total, passes: report.passes, skipped: report.skipped, problems: report.problems, selfTestFailures }, null, 2))
  } else {
    console.log("[verify-corpus] root: " + resolve(repoRoot) + " | corpus: " + resolve(skillsRoot) + " | files: " + report.total)
    console.log("[verify-corpus] fidelity baseline: " + resolve(BASELINE_PATH) + " | source cross-check: " + resolve(SOURCE_SKILLS))
    for (const pass of report.passes) console.log("  PASS  " + pass)
    for (const skip of report.skipped) console.log("  SKIP  " + skip)
    for (const problem of report.problems) console.error("  FAIL  " + problem)
    for (const failure of selfTestFailures) console.error("  FAIL  (self-test) " + failure)
    if (selfTestRequested) console.log(`  self-test: ${selfTestFailures.length === 0 ? `PASS (${selfTestResult.negativeControls} negative controls caught, ${selfTestResult.healthyControls} healthy controls clean)` : `${selfTestFailures.length} control(s) failed`}`)
  }

  const failed = report.problems.length > 0 || selfTestFailures.length > 0
  console.log(failed
    ? `[verify-corpus] FAIL — ${report.problems.length} problem(s)${selfTestRequested ? `, ${selfTestFailures.length} self-test failure(s)` : ""}`
    : `[verify-corpus] PASS — ${report.passes.length} check(s) passed, ${report.skipped.length} skipped`)
  process.exit(failed ? 1 : 0)
}

main()
