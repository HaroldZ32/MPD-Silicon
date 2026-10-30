import { test, expect, describe } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { bundleRoot, createProvider, parseFrontmatter } from "../src/index"
import { createDshAdapter } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"

// The REAL shipped corpus: <pkg-root>/skills — the same resolution the plugin uses.
const REPO_ROOT = bundleRoot()
const SKILLS = join(REPO_ROOT, "skills")

/**
 * Fidelity is asserted against the COMMITTED baseline manifest (relative path +
 * sha256 per file). A live source checkout is optional extra evidence: the RTL
 * source is stripped away by design, so pointing fidelity at it made the guard
 * silently useless after the split. Nothing here is hard-coded to a machine path:
 * MPD_SOURCE_ROOT wins, then the sibling checkout ../my-power-dsh.
 */
const BASELINE_PATH = process.env.MPD_CORPUS_BASELINE ?? join(REPO_ROOT, "evidence", "verification", "corpus-baseline.json")
const SOURCE_SKILLS = (() => {
  if (process.env.MPD_SOURCE_SKILLS) return process.env.MPD_SOURCE_SKILLS
  const root = process.env.MPD_SOURCE_ROOT ?? join(REPO_ROOT, "..", "my-power-dsh")
  return join(root, "skills")
})()

type BaselineFile = { sha256: string; bytes: number }
type Baseline = { generatedFrom?: { rev?: string }; trees: Record<string, Record<string, BaselineFile>> }
const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

/** The three RTL skill trees this bundle owns; nothing else may ship under skills/. */
const TREES = ["rtl-codestyle", "rtl-ip-flow", "rtl-verif"] as const
/** Public skill-name grammar (mirrors @deepseek-ai/dsh-skill and the provider). */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function walkFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true, encoding: "utf8" })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) walkFiles(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

const markdown = walkFiles(SKILLS).filter((file) => file.endsWith(".md")).sort()
const allFiles = walkFiles(SKILLS).sort()

function fakeCtx() {
  const warnings: string[] = []
  return { ctx: { logger: { warn: (message: string) => { warnings.push(String(message)) } } }, warnings }
}

// ── the corpus is present and complete ──────────────────────────────────────

describe("shipped RTL corpus", () => {
  test("ships exactly the three RTL trees, and no mpd general-purpose corpus", () => {
    const entries = readdirSync(SKILLS, { withFileTypes: true, encoding: "utf8" })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(entries).toEqual([...TREES])
    // The mpd bundle's own corpus must NOT be duplicated into the RTL sub-bundle.
    for (const foreign of ["dsh-qa", "programming", "frontend", "debugging", "rtl-ip-flow.md"]) {
      expect(entries).not.toContain(foreign)
      expect(existsSync(join(SKILLS, foreign))).toBe(false)
    }
    expect(entries.filter((entry) => entry.startsWith("ulw"))).toEqual([])
  })

  test("every expected template / reference / example / fixture file is present", () => {
    const expected = [
      "rtl-ip-flow/SKILL.md",
      "rtl-ip-flow/templates/req-spec.md",
      "rtl-ip-flow/templates/user-manual.md",
      "rtl-ip-flow/templates/user-manual.en.md",
      "rtl-ip-flow/templates/detail-design.md",
      "rtl-ip-flow/templates/verification-plan.md",
      "rtl-ip-flow/templates/dfmea.md",
      "rtl-ip-flow/templates/validation-report.md",
      "rtl-ip-flow/templates/validation-manual.md",
      "rtl-ip-flow/templates/defect-report.md",
      "rtl-codestyle/SKILL.md",
      "rtl-codestyle/templates/fsm_3process.vinc",
      "rtl-codestyle/templates/module_skeleton.vinc",
      "rtl-codestyle/templates/parameterized_counter.vinc",
      "rtl-codestyle/references/comment-conventions.md",
      "rtl-codestyle/references/style-checklist.md",
      "rtl-verif/SKILL.md",
      "rtl-verif/README.md",
      "rtl-verif/templates/uvm/dut_agent.sv",
      "rtl-verif/templates/uvm/dut_driver.sv",
      "rtl-verif/templates/uvm/dut_env.sv",
      "rtl-verif/templates/uvm/dut_monitor.sv",
      "rtl-verif/templates/uvm/dut_pkg.sv",
      "rtl-verif/templates/uvm/dut_scoreboard.sv",
      "rtl-verif/templates/uvm/dut_sequence_item.sv",
      "rtl-verif/templates/uvm/dut_sequence.sv",
      "rtl-verif/templates/uvm/README.md",
      "rtl-verif/templates/cocotb/bootstrap_venv.sh",
      "rtl-verif/templates/cocotb/Makefile",
      "rtl-verif/templates/cocotb/tb_template.py",
      "rtl-verif/examples/regression/README.md",
      "rtl-verif/examples/regression/run_regression.sh",
      "rtl-verif/fixtures/adder4/Makefile",
      "rtl-verif/fixtures/adder4/tb_adder4.py",
      "rtl-verif/fixtures/cnt8/Makefile",
      "rtl-verif/fixtures/cnt8/tb_cnt8.py",
    ]
    for (const relative of expected) {
      const absolute = join(SKILLS, relative)
      expect(existsSync(absolute)).toBe(true)
      expect(statSync(absolute).isFile()).toBe(true)
    }
    expect(allFiles.length).toBe(expected.length)
    expect(allFiles.length).toBeGreaterThanOrEqual(36)
  })

  test("each tree matches the committed corpus baseline (relative path + sha256 per file)", () => {
    expect(baseline.generatedFrom?.rev).toBeDefined()
    for (const tree of TREES) {
      const base = join(SKILLS, tree)
      const entries = baseline.trees[tree]
      expect(entries).toBeDefined()
      const shipped = walkFiles(base).map((file) => file.slice(base.length + 1)).sort()
      expect(shipped.length).toBeGreaterThan(0)
      expect(shipped).toEqual(Object.keys(entries).sort())
      for (const relative of shipped) {
        const bytes = readFileSync(join(base, relative))
        expect(bytes.length).toBe(entries[relative].bytes)
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(entries[relative].sha256)
      }
    }
  })

  // Optional extra evidence — and never a silent pass. The source checkout is
  // stripped away by design, so when it is absent this test is SKIPPED VISIBLY
  // (bun reports the skip count) rather than `continue`-ing 38 assertions away
  // inside an otherwise green run.
  const sourceTrees = TREES.filter((tree) => existsSync(join(SOURCE_SKILLS, tree)))
  test.skipIf(sourceTrees.length === 0)(
    `cross-check: byte-identical to the source checkout at ${SOURCE_SKILLS} (${sourceTrees.length}/${TREES.length} trees present)`,
    () => {
      for (const tree of sourceTrees) {
        const base = join(SKILLS, tree)
        const sourceBase = join(SOURCE_SKILLS, tree)
        const shipped = walkFiles(base).map((file) => file.slice(base.length + 1)).sort()
        const source = walkFiles(sourceBase).map((file) => file.slice(sourceBase.length + 1)).sort()
        expect(shipped).toEqual(source)
        for (const relative of shipped) {
          expect(sha256(join(base, relative))).toBe(sha256(join(sourceBase, relative)))
        }
      }
    },
  )
})

// ── every corpus .md parses inside the provider's frontmatter subset ────────

describe("corpus frontmatter subset", () => {
  test("parses every markdown file without throwing (templates carry none on purpose)", () => {
    expect(markdown.length).toBeGreaterThanOrEqual(16)
    for (const file of markdown) {
      let parsed
      expect(() => { parsed = parseFrontmatter(readFileSync(file, "utf8")) }).not.toThrow()
      const relative = file.slice(SKILLS.length + 1)
      if (parsed === undefined) {
        // Only non-skill documents (templates / references / READMEs) may omit it.
        expect(relative.endsWith("SKILL.md")).toBe(false)
      }
    }
  })

  test("every SKILL.md carries a legal name and a non-empty description", () => {
    const skillFiles = markdown.filter((file) => file.endsWith("SKILL.md"))
    expect(skillFiles.length).toBe(3)
    for (const file of skillFiles) {
      const relative = file.slice(SKILLS.length + 1)
      const parsed = parseFrontmatter(readFileSync(file, "utf8"))
      expect(parsed).toBeDefined()
      const data = parsed!.data
      const skillName = data.name
      expect(typeof skillName).toBe("string")
      expect(SKILL_NAME.test(String(skillName))).toBe(true)
      expect(String(skillName)).toBe(relative.split("/")[0])
      expect(typeof data.description).toBe("string")
      expect(String(data.description).trim().length).toBeGreaterThan(0)
      expect(parsed!.body.trim().length).toBeGreaterThan(0)
      // Frontmatter parsing must be lossless: the body starts right after `---`.
      expect(parsed!.body.startsWith("\n")).toBe(true)
    }
  })

  test("the subset is enforced, not guessed: a mutated SKILL.md is detected", () => {
    const original = readFileSync(join(SKILLS, "rtl-verif/SKILL.md"), "utf8")
    // a top-level YAML list is outside the subset -> parseFrontmatter throws
    expect(() => parseFrontmatter(original.replace("metadata:", "- not-a-map\nmetadata:"))).toThrow(/unsupported frontmatter line/)
    // a legacy invocation field is outside the subset -> the skill is refused
    expect(parseFrontmatter("---\nname: x\ndescription: y\nmodelInvocable: true\n---\nbody\n")!.data).toMatchObject({ modelInvocable: true })
    // the parser is not tolerant of a missing closing fence
    expect(parseFrontmatter("---\nname: x\ndescription: y\n")).toBeUndefined()
  })
})

// ── the provider exposes the three skills (loadability proof) ───────────────

describe("skill provider over the shipped corpus", () => {
  test("lists exactly the three RTL skills at the bundled rank, with no warnings", async () => {
    const { ctx, warnings } = fakeCtx()
    const provider = createProvider(SKILLS, ctx, () => {}, createDshAdapter(ctx))
    expect(provider.name).toBe("silicon-bundle")
    const candidates = await provider.list()
    expect(warnings).toEqual([])
    expect(candidates.map((candidate: any) => candidate.name).sort()).toEqual(["rtl-codestyle", "rtl-ip-flow", "rtl-verif"])
    for (const candidate of candidates) {
      expect(candidate.provider).toBe("silicon-bundle")
      expect(candidate.source).toBe("bundled")
      expect(candidate.rank).toBe(600)
      expect(candidate.description.trim().length).toBeGreaterThan(0)
      expect(candidate.invocation).toEqual({ modelInvocable: true, userInvocable: true })
      expect(candidate.locator.directory).toBe(join(SKILLS, candidate.name))
      expect(candidate.locator.path).toBe(join(SKILLS, candidate.name, "SKILL.md"))
      expect(candidate.resourceBase).toEqual({ kind: "directory", path: join(SKILLS, candidate.name) })
    }
  })

  test("get() loads each skill's full content, and the resource base is the tree root", async () => {
    const { ctx } = fakeCtx()
    const provider = createProvider(SKILLS, ctx, () => {}, createDshAdapter(ctx))
    const byName = new Map((await provider.list()).map((candidate: any) => [candidate.name, candidate]))
    for (const skillName of ["rtl-codestyle", "rtl-ip-flow", "rtl-verif"]) {
      const candidate = byName.get(skillName)
      expect(candidate).toBeDefined()
      const loaded = (await provider.get(candidate))!
      expect(loaded.name).toBe(skillName)
      expect(loaded.provider).toBe("silicon-bundle")
      expect(loaded.path).toBe(join(SKILLS, skillName, "SKILL.md"))
      expect(loaded.content.length).toBeGreaterThan(500)
      expect(loaded.content).toBe(readFileSync(join(SKILLS, skillName, "SKILL.md"), "utf8").split("---\n").slice(2).join("---\n").trim())
    }
  })

  test("the corpus paths the skills reference actually resolve (templates are shipped, not described)", async () => {
    const { ctx } = fakeCtx()
    const provider = createProvider(SKILLS, ctx, () => {}, createDshAdapter(ctx))
    const loaded = (await Promise.all((await provider.list()).map((candidate: any) => provider.get(candidate)))).filter(Boolean) as any[]
    const referenced = new Set<string>()
    for (const skill of loaded) {
      for (const match of skill.content.matchAll(/`((?:templates|references|examples|fixtures)\/[A-Za-z0-9_./-]+)`/g)) {
        referenced.add(match[1])
      }
      for (const match of skill.content.matchAll(/`?(templates\/[A-Za-z0-9_./-]+\.(?:md|vinc|sv|py|sh))`?/g)) {
        referenced.add(match[1])
      }
    }
    // The rtl-ip-flow skill names its nine templates in prose lists, so at minimum
    // the explicit backticked references must exist on disk.
    const missing: string[] = []
    for (const relative of referenced) {
      // references may be tree-relative (rtl-verif) or written for their own tree
      const candidates = [join(SKILLS, relative), ...TREES.map((tree) => join(SKILLS, tree, relative))]
      if (!candidates.some((path) => existsSync(path))) missing.push(relative)
    }
    expect(missing).toEqual([])
    expect(referenced.size).toBeGreaterThanOrEqual(5)
  })

  test("the provider's corpus root is <pkg-root>/skills, i.e. what the bundle patch will serve", async () => {
    const { ctx } = fakeCtx()
    const provider = createProvider(SKILLS, ctx, () => {}, createDshAdapter(ctx))
    const candidates = await provider.list()
    expect(candidates.length).toBe(3)
    for (const tree of TREES) {
      expect(existsSync(join(SKILLS, tree, "SKILL.md"))).toBe(true)
    }
  })
})
