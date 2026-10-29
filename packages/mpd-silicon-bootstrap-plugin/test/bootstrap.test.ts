import { test, expect, describe } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createDshAdapter } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import {
  apply,
  bundleRoot,
  createProvider,
  inject,
  listCorpus,
  name as pluginName,
  parseFrontmatter,
  parseInvocation,
  readSkillFile,
  BUNDLED_SKILL_RANK,
  PROVIDER_NAME,
  type ParsedSkill,
} from "../src/index"

// Fixtures are checked in next to this test: the real RTL corpus (<pkg-root>/skills)
// is NOT a dependency of this suite — it is landed by a later task, and the provider
// must be verifiable without it.
const FIXTURES = dirname(fileURLToPath(import.meta.url)) + "/fixtures"
const CORPUS = join(FIXTURES, "corpus")

type Warning = { ctx: any; warnings: string[] }

function fakeCtx(): Warning {
  const warnings: string[] = []
  const ctx = { logger: { warn: (message: string) => { warnings.push(String(message)) } } }
  return { ctx, warnings }
}

function candidateFor(list: Awaited<ReturnType<ReturnType<typeof createProvider>["list"]>>, entry: string) {
  const found = list.find((item: any) => item.name === entry)
  if (found === undefined) throw new Error("candidate not listed: " + entry + " (got " + list.map((i: any) => i.name).join(", ") + ")")
  return found
}

// ── frontmatter subset ──────────────────────────────────────────────────────

describe("frontmatter parsing", () => {
  test("parses the top-level scalars, one nested metadata map and the body", () => {
    const raw = readFileSync(join(CORPUS, "flow-skill", "SKILL.md"), "utf8")
    const parsed = parseFrontmatter(raw)
    expect(parsed).toBeDefined()
    expect(parsed!.data.name).toBe("rtl-flow-fixture")
    expect(parsed!.data.description).toBe("Fixture skill used to pin the bundled RTL corpus provider end to end.")
    expect(parsed!.data.whenToUse).toBe("when a test drives the provider with a real corpus directory")
    expect(parsed!.data.metadata).toEqual({ owner: "silicon", phase: 1, fidelity: "high" })
    expect(parsed!.body.trim()).toBe("# rtl-flow-fixture\n\nBody line one.\nBody line two.")
  })

  test("parses folded (>) and literal (|) block scalars inside metadata", () => {
    const parsed = parseFrontmatter(readFileSync(join(CORPUS, "verif.md"), "utf8"))
    expect(parsed).toBeDefined()
    expect(parsed!.data.whenToUse).toBe("when a test needs a literal scalar\nspanning two source lines")
    // Literal keeps its line breaks and folded folds to spaces; both drop the
    // final break at end-of-document (the parser's documented subset behaviour —
    // the fixture's blank line before the closing `---` only affects `alpha/beta`).
    expect(parsed!.data.metadata).toEqual({ literal: "alpha\nbeta", folded: "gamma delta" })
  })

  test("returns undefined when the document carries no frontmatter block", () => {
    expect(parseFrontmatter(readFileSync(join(CORPUS, "no-frontmatter.md"), "utf8"))).toBeUndefined()
    expect(parseFrontmatter("---\nname: x\n")).toBeUndefined()
    expect(parseFrontmatter("name: x\n---\n")).toBeUndefined()
  })

  test("throws (instead of guessing) on a line outside the supported subset", () => {
    expect(() => parseFrontmatter("---\n- list-item\n---\nbody\n")).toThrow(/unsupported frontmatter line/)
  })

  test("keeps CJK scalar and body content byte-for-byte", () => {
    const parsed = parseFrontmatter(readFileSync(join(FIXTURES, "corpus-cjk", "only-cjk.md"), "utf8"))
    expect(parsed).toBeDefined()
    expect(parsed!.data.description).toBe("用于校验 CJK 描述与折叠标量的最小语料夹具。")
    expect(parsed!.data.metadata).toEqual({ note: "双语语料" })
    expect(parsed!.body.trim()).toBe("中文正文。")
  })

  test("parses invocation flags and rejects the legacy field names", () => {
    expect(parseInvocation({})).toEqual({ modelInvocable: true, userInvocable: true })
    expect(parseInvocation({ "disable-model-invocation": true, "user-invocable": false })).toEqual({ modelInvocable: false, userInvocable: false })
    expect(parseInvocation({ "disable-model-invocation": "yes" })).toEqual({ modelInvocable: false, userInvocable: true })
    expect(() => parseInvocation({ modelInvocable: true })).toThrow(/unsupported/)
    expect(() => parseInvocation({ userInvocable: false })).toThrow(/user-invocable/)
    expect(() => parseInvocation({ "user-invocable": "maybe" })).toThrow(/must be a boolean/)
  })
})

// ── corpus listing ──────────────────────────────────────────────────────────

describe("corpus listing", () => {
  test("lists directory bundles and flat markdown entries, sorted, skipping .system", async () => {
    const root = mkdtempSync(join(tmpdir(), "silicon-list-"))
    mkdirSync(join(root, "zeta-skill"), { recursive: true })
    writeFileSync(join(root, "zeta-skill", "SKILL.md"), "---\nname: zeta\ndescription: z\n---\nz\n")
    mkdirSync(join(root, ".system"), { recursive: true })
    writeFileSync(join(root, ".system", "hidden.md"), "---\nname: hidden\ndescription: h\n---\n")
    writeFileSync(join(root, "aaa.md"), "---\nname: aaa\ndescription: a\n---\n")
    writeFileSync(join(root, "notes.txt"), "not markdown")
    const entries = await listCorpus(root)
    expect(entries.map((entry) => entry.entry)).toEqual(["aaa.md", "zeta-skill"])
    expect(entries[0].locator).toBe(join(root, "aaa.md"))
    expect(entries[0].directory).toBe(root)
    expect(entries[1].locator).toBe(join(root, "zeta-skill", "SKILL.md"))
    expect(entries[1].directory).toBe(join(root, "zeta-skill"))
  })

  test("an absent corpus root is an empty listing, never an error (a corpus may land later)", async () => {
    expect(await listCorpus(join(tmpdir(), "silicon-absent-" + Math.random()))).toEqual([])
  })
})

// ── readSkillFile ───────────────────────────────────────────────────────────

describe("readSkillFile", () => {
  test("returns the parsed skill for a valid corpus file", async () => {
    const { ctx } = fakeCtx()
    const parsed = (await readSkillFile(join(CORPUS, "codestyle.md"), ctx)) as ParsedSkill
    expect(parsed.name).toBe("rtl-codestyle-fixture")
    expect(parsed.invocation).toEqual({ modelInvocable: true, userInvocable: false })
    expect(parsed.metadata).toEqual({ version: 2 })
    expect(parsed.content).toBe("Flat fixture body.")
  })

  test("skips a missing file, a file without frontmatter, an invalid name and missing fields (with a warning)", async () => {
    const { ctx, warnings } = fakeCtx()
    expect(await readSkillFile(join(CORPUS, "does-not-exist.md"), ctx)).toBeUndefined()
    expect(await readSkillFile(join(CORPUS, "no-frontmatter.md"), ctx)).toBeUndefined()
    expect(await readSkillFile(join(CORPUS, "rtl_bad_name.md"), ctx)).toBeUndefined()
    const noFields = mkdtempSync(join(tmpdir(), "silicon-fields-")) + "/s.md"
    writeFileSync(noFields, "---\nname: only-name\n---\nbody\n")
    expect(await readSkillFile(noFields, ctx)).toBeUndefined()
    expect(warnings.length).toBe(3)
    expect(warnings[0]).toMatch(/missing YAML frontmatter/)
    expect(warnings[1]).toMatch(/invalid skill name "rtl_invalid_name_fixture"/)
    expect(warnings[2]).toMatch(/requires name and description/)
  })
})

// ── provider surface ────────────────────────────────────────────────────────

describe("bundled provider", () => {
  test("registers the unique silicon provider name at the bundled rank with bundled source", async () => {
    const { ctx } = fakeCtx()
    const provider = createProvider(CORPUS, ctx, () => {}, createDshAdapter(ctx))
    expect(provider.name).toBe("silicon-bundle")
    expect(provider.name).not.toBe("mpd-bundle")
    const candidates = await provider.list()
    expect(candidates.map((candidate: any) => candidate.name)).toEqual([
      "rtl-codestyle-fixture",
      "rtl-flow-fixture",
      "rtl-verif-fixture",
    ])
    for (const candidate of candidates) {
      expect(candidate.provider).toBe(PROVIDER_NAME)
      expect(candidate.source).toBe("bundled")
      expect(candidate.rank).toBe(BUNDLED_SKILL_RANK)
      expect(candidate.rank).toBe(600)
      expect(candidate.path).toBe(candidate.locator.path)
      expect(candidate.resourceBase.kind).toBe("directory")
    }
    const flow = candidateFor(candidates, "rtl-flow-fixture")
    expect(flow.resourceBase.path).toBe(join(CORPUS, "flow-skill"))
    expect(flow.locator.directory).toBe(join(CORPUS, "flow-skill"))
    expect(flow.metadata).toEqual({ owner: "silicon", phase: 1, fidelity: "high" })
    const flat = candidateFor(candidates, "rtl-codestyle-fixture")
    expect(flat.resourceBase.path).toBe(CORPUS)
    const verif = candidateFor(candidates, "rtl-verif-fixture")
    expect(verif.whenToUse).toBe("when a test needs a literal scalar\nspanning two source lines")
  })

  test("get() returns the full content for a candidate and undefined for a bad locator", async () => {
    const { ctx } = fakeCtx()
    const provider = createProvider(CORPUS, ctx, () => {}, createDshAdapter(ctx))
    const [candidate] = await provider.list()
    const loaded = (await provider.get(candidate))!
    expect(loaded.name).toBe(candidate.name)
    expect(loaded.provider).toBe(PROVIDER_NAME)
    expect((loaded as { rank?: unknown }).rank).toBeUndefined()
    expect(loaded.content).toBe("Flat fixture body.")
    expect(loaded.resourceBase).toEqual(candidate.resourceBase)
    expect(await provider.get({ locator: { path: join(CORPUS, "missing.md") } })).toBeUndefined()
    expect(await provider.get(undefined)).toBeUndefined()
  })

  test("a model-facing write inside the corpus invalidates the provider once", async () => {
    const handlers: Array<(...args: any[]) => void> = []
    let invalidations = 0
    const ctx = { logger: { warn: () => {} }, on: (event: string, fn: (...args: any[]) => void) => { if (event === "fs/observed") handlers.push(fn) } }
    createProvider(CORPUS, ctx, () => { invalidations += 1 }, createDshAdapter(ctx))
    expect(handlers.length).toBe(1)
    handlers[0]({ displayPath: join(CORPUS, "codestyle.md") }, {}, { name: "write" })
    expect(invalidations).toBe(1)
    handlers[0]({ displayPath: join(CORPUS, "codestyle.md") }, {}, { name: "read" })
    handlers[0]({ displayPath: "/somewhere/else.md" }, {}, { name: "edit" })
    handlers[0]({}, {}, { name: "edit" })
    expect(invalidations).toBe(1)
  })

  test("a corpus listed lazily re-reads the directory (no stale cache in the provider)", async () => {
    const root = mkdtempSync(join(tmpdir(), "silicon-lazy-"))
    const { ctx } = fakeCtx()
    const provider = createProvider(root, ctx, () => {}, createDshAdapter(ctx))
    expect(await provider.list()).toEqual([])
    writeFileSync(join(root, "late.md"), "---\nname: late-skill\ndescription: landed after boot\n---\nlate\n")
    const after = await provider.list()
    expect(after.map((candidate: any) => candidate.name)).toEqual(["late-skill"])
  })
})

// ── plugin entry ────────────────────────────────────────────────────────────

describe("plugin entry", () => {
  function fakeHost() {
    const registered: any[] = []
    const contexts: any[] = []
    const dsh = {
      registerSkillProvider: (factory: any) => {
        const context = { invalidate: () => { contexts.push("invalidate") } }
        registered.push(factory(context))
        return () => {}
      },
    }
    return { dsh, registered, contexts }
  }

  test("exposes the cordis entry contract and the bundle-root resolution", () => {
    expect(pluginName).toBe("mpd-silicon-bootstrap")
    const root = bundleRoot()
    // Path-agnostic: the bundle root is THIS test file's repository/package root, whatever
    // the clone directory is called. Falsifiable — a wrong resolution (the plugin dir, the
    // packages dir) no longer equals it, and the manifest names the bundle it must find.
    expect(resolve(root)).toBe(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."))
    expect(root.startsWith("/")).toBe(true)
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    expect(manifest.name).toBe("@mpd-dsh/silicon")
    expect(existsSync(join(root, "skills"))).toBe(true)
  })

  test("apply() registers the silicon provider over <pkg-root>/skills through the adapter", () => {
    const host = fakeHost()
    const { ctx } = fakeCtx()
    const applied = { ...ctx, mpdDsh: host.dsh }
    const logs: string[] = []
    const original = console.log
    console.log = (...args: any[]) => { logs.push(args.join(" ")) }
    try { apply(applied) } finally { console.log = original }
    expect(host.registered.length).toBe(1)
    expect(host.registered[0].name).toBe(PROVIDER_NAME)
    expect(logs.join("\n")).toContain("skill corpus served from " + join(bundleRoot(), "skills"))
    expect(logs.join("\n")).toContain("provider " + PROVIDER_NAME)
  })

  test("apply() honours skillsDir and skipSkills", () => {
    const host = fakeHost()
    const { ctx } = fakeCtx()
    const applied = { ...ctx, mpdDsh: host.dsh }
    apply(applied, { skillsDir: "/tmp/corpus-override" })
    expect(host.registered.length).toBe(1)
    apply(applied, { skipSkills: true })
    expect(host.registered.length).toBe(1)
    const logs: string[] = []
    const original = console.log
    console.log = (...args: any[]) => { logs.push(args.join(" ")) }
    try { apply(applied, { skipSkills: true }) } finally { console.log = original }
    expect(logs.join("\n")).toContain("skill corpus provider skipped (config)")
  })

  // HARD dependency: mpd's adapter service (`mpdDsh`) is the ONLY provider this row
  // resolves. The `siliconDsh` name and the local fallback adapter are gone; the
  // inject array names mpdDsh, so the loader applies this row only after the provider
  // is ACTIVE, and a composition without it throws here. (The guard row turns that
  // same condition into a fatal boot refusal before this row would apply.)
  test("apply() uses mpd's adapter service (mpdDsh) and has NO fallback", () => {
    expect(inject).toContain("mpdDsh")
    expect(inject).not.toContain("siliconDsh")

    const mpd = fakeHost()
    const { ctx } = fakeCtx()
    apply({ ...ctx, mpdDsh: mpd.dsh })
    expect(mpd.registered.length).toBe(1)

    const missing = { ...ctx }
    expect(() => apply(missing as any)).toThrow()
  })

  test("apply() carries NO preset and NO legacy home-copy logic", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts"), "utf8")
    // Assert on EFFECTIVE code, not on prose: the module header documents the two
    // mpd-only behaviours this row deliberately omits, so comment lines are stripped.
    const code = source
      .split("\n")
      .map((line: string) => line.replace(/\s*\/\/.*$/, ""))
      .filter((line: string) => line.trim() !== "" && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n")
    expect(code).not.toMatch(/preset/i)
    expect(code).not.toMatch(/DSH_HOME|homedir|harnessHome/)
    expect(code).not.toMatch(/rmSync|removeIfPresent|cleanLegacy/)
    expect(code).not.toMatch(/mpd-bundle/)
  })
})
