// mpd-silicon-bootstrap: bundle asset provisioning for the @mpd-dsh/silicon bundle.
//
// Scope (deliberately smaller than mpd's mpd-bootstrap row): the silicon bundle
// ships exactly ONE installable asset class — the RTL skill corpus at
// <bundle>/skills (rtl-ip-flow, rtl-codestyle, rtl-verif). This row serves it by
// REFERENCE through the skill-registry provider seam, so the corpus is visible exactly
// while the bundle is installed and disappears when the row unloads.
//
// Deliberately ABSENT (they belong to the mpd bundle, not to the RTL face):
//   * the mpd preset root — the silicon bundle ships no agent preset;
//   * the <=0.2.6 legacy $DSH_HOME copy cleanup — silicon never wrote one.
//
// This row never writes to the harness home and never copies the corpus.
import { readFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { rowLogLine, dshSeamInject, DSH_SEAM_SKILLS } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import type { DshAdapter } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"

export const name = "mpd-silicon-bootstrap"
// The skills registry is a host-plane service shipped by dsh-base; declaring it
// is a true hard dependency (this row's whole purpose is to contribute to it).
// The id comes from mpd's seam vocabulary; `dshSeamInject` returns it verbatim, so
// this array is byte-identical to the literal it replaced. The second entry is the
// HARD dependency on mpd's adapter (`mpdDsh`): this row applies only once the
// provider is ACTIVE, and a composition without it never reaches this row.
export const inject = [...dshSeamInject(DSH_SEAM_SKILLS), "mpdDsh"]

/** Provider name registered on the skill registry; must be unique process-wide. */
export const PROVIDER_NAME = "silicon-bundle"
/** Standard precedence rank for packaged skill providers (mirrors @deepseek-ai/dsh-skill). */
export const BUNDLED_SKILL_RANK = 600
/** Public skill-name grammar (mirrors @deepseek-ai/dsh-skill). */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type Config = {
  /** Corpus directory override; defaults to <pkg-root>/skills. */
  skillsDir?: string
  /** Do not register the corpus skill provider. */
  skipSkills?: boolean
}

type Ctx = { skills?: any; logger?: any; mpdDsh?: DshAdapter; on?: (event: string, fn: (...args: any[]) => any) => void; [k: string]: any }

/**
 * Bundle package root, resolved from THIS file's location (no package-name
 * resolution). The shipped entry is always the BUILT file at
 * `<pkg-root>/packages/mpd-silicon-bootstrap-plugin/dist/index.js`, so the root
 * is three directories up: .../<plugin>/dist/index.js -> .../<plugin>/dist ->
 * .../<plugin> -> .../<pkg-root>. The RTL skill corpus is `<pkg-root>/skills`,
 * which is what makes one `dsh plugin add` install the corpus too.
 */
export function bundleRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return dirname(dirname(dirname(here)))
}

// Report one recoverable corpus problem. The HARNESS logger stays the primary
// destination (it is the operator's channel, and the frozen suite pins it); when
// the composition exposes none, the line falls back to the adapter's logging seam
// instead of printing to a terminal (R5). Logging must never fail provisioning.
function warn(ctx: Ctx, message: string): void {
  try {
    if (ctx.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
    else rowLogLine("mpd-silicon-bootstrap", "[mpd-silicon-bootstrap] " + message)
  } catch { /* logging must never fail provisioning */ }
}

function readVersion(root: string): string {
  try {
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.version
    return typeof version === "string" && version.length > 0 ? version : "unknown"
  } catch { return "unknown" }
}

// ── frontmatter parsing ─────────────────────────────────────────────────────
// The corpus is ours and its frontmatter is a deliberately small YAML subset
// (top-level scalars, one nested `metadata` mapping, optional block scalars).
// Parsing it here keeps the plugin dependency-free; the unit tests under
// test/ pin the subset against fixture files, so this row never depends on the
// real corpus being present.

export type Frontmatter = { data: Record<string, unknown>; body: string }

function isAbsent(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}

export function parseFrontmatter(raw: string): Frontmatter | undefined {
  const firstLineEnd = raw.indexOf("\n")
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return undefined
  let lineStart = firstLineEnd + 1
  let closingStart = -1
  let bodyStart = -1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf("\n", lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      closingStart = lineStart
      bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      break
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  if (closingStart < 0) return undefined
  return { data: parseYamlBlock(raw.slice(firstLineEnd + 1, closingStart)), body: raw.slice(bodyStart) }
}

function parseScalar(value: string): unknown {
  const text = value.trim()
  if (text === "") return ""
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try { return JSON.parse(text) as unknown } catch { return text.slice(1, -1) }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  const lower = text.toLowerCase()
  if (lower === "true" || lower === "yes" || lower === "on") return true
  if (lower === "false" || lower === "no" || lower === "off") return false
  if (lower === "null" || text === "~") return null
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d*\.\d+$/.test(text)) return Number(text)
  return text
}

function foldLines(lines: string[]): string {
  let out = ""
  for (const line of lines) {
    if (line === "") out += "\n"
    else out += (out === "" || out.endsWith("\n") ? "" : " ") + line
  }
  return out
}

function parseYamlBlock(text: string): Record<string, unknown> {
  const lines = text.split("\n")
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }]
  let index = 0
  while (index < lines.length) {
    const raw = lines[index]
    index += 1
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.slice(indent)
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:[ \t]+(.*))?$/.exec(line)
    if (match === null) throw new Error("unsupported frontmatter line: " + line)
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].map
    const key = match[1]
    const rest = match[2] ?? ""
    if (rest.trim() === "") {
      let next: { indent: number; text: string } | undefined
      for (let probe = index; probe < lines.length; probe += 1) {
        const candidate = lines[probe]
        if (candidate.trim() === "" || candidate.trimStart().startsWith("#")) continue
        next = { indent: candidate.length - candidate.trimStart().length, text: candidate.trimStart() }
        break
      }
      if (next !== undefined && next.indent > indent && /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:/.test(next.text)) {
        const child: Record<string, unknown> = {}
        parent[key] = child
        stack.push({ indent, map: child })
      } else parent[key] = null
      continue
    }
    const block = /^([|>])([+-]?)(\d*)$/.exec(rest.trim())
    if (block !== null) {
      const collected: string[] = []
      let blockIndent = -1
      while (index < lines.length) {
        const candidate = lines[index]
        if (candidate.trim() === "") { collected.push(""); index += 1; continue }
        const candidateIndent = candidate.length - candidate.trimStart().length
        if (candidateIndent <= indent) break
        if (blockIndent < 0) blockIndent = candidateIndent
        collected.push(candidate.slice(Math.min(blockIndent, candidateIndent)))
        index += 1
      }
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop()
      const joined = block[1] === "|" ? collected.join("\n") : foldLines(collected)
      parent[key] = block[2] === "-" ? joined.replace(/\n+$/, "") : joined
      continue
    }
    parent[key] = parseScalar(rest)
  }
  return root
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === "boolean") return value
  if (value === 1 || value === "1") return true
  if (value === 0 || value === "0") return false
  if (typeof value === "string") {
    switch (value.toLowerCase()) {
      case "true": case "yes": case "on": return true
      case "false": case "no": case "off": return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

export function parseInvocation(data: Record<string, unknown>): { modelInvocable: boolean; userInvocable: boolean } {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) throw new Error(`frontmatter field "${legacy}" is unsupported; use "${legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation"}"`)
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false,
  }
}

export type ParsedSkill = {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  metadata?: Record<string, unknown>
  content: string
}

export async function readSkillFile(filePath: string, ctx: Ctx): Promise<ParsedSkill | undefined> {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (isAbsent(error)) return undefined
    throw error
  }
  let parsed: Frontmatter | undefined
  try {
    parsed = parseFrontmatter(raw)
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: invalid frontmatter: ${String((error as Error)?.message ?? error)}`)
    return undefined
  }
  if (parsed === undefined) {
    warn(ctx, `skill file ${filePath} ignored: missing YAML frontmatter`)
    return undefined
  }
  const skillName = stringField(parsed.data, "name")
  const description = stringField(parsed.data, "description")
  if (skillName === undefined || description === undefined) {
    warn(ctx, `skill file ${filePath} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!SKILL_NAME.test(skillName)) {
    warn(ctx, `skill file ${filePath} ignored: invalid skill name "${skillName}"`)
    return undefined
  }
  let invocation: { modelInvocable: boolean; userInvocable: boolean }
  try {
    invocation = parseInvocation(parsed.data)
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: ${String((error as Error)?.message ?? error)}`)
    return undefined
  }
  const metadata = parsed.data.metadata
  return {
    name: skillName,
    description,
    ...(stringField(parsed.data, "whenToUse") !== undefined ? { whenToUse: stringField(parsed.data, "whenToUse") as string } : {}),
    invocation,
    ...(typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? { metadata: metadata as Record<string, unknown> } : {}),
    content: parsed.body.trim(),
  }
}

/** Corpus entries in the filesystem provider's shape: directory bundles + flat markdown files. */
export async function listCorpus(root: string): Promise<Array<{ entry: string; locator: string; directory: string }>> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: "utf8" })
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }
  const found: Array<{ entry: string; locator: string; directory: string }> = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".system") continue
    if (entry.isDirectory()) found.push({ entry: entry.name, locator: join(root, entry.name, "SKILL.md"), directory: join(root, entry.name) })
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push({ entry: entry.name, locator: join(root, entry.name), directory: root })
  }
  return found
}

/**
 * The bundled-corpus provider: read-only, lazily loaded, ranked below user roots.
 *
 * `adapter` is the `mpdDsh` adapter `apply` resolved — a REQUIRED argument, because
 * this package has no local adapter and must not build a private seam beside the
 * mounted one. Unit tests pass the same fake adapter they hand `apply`.
 */
export function createProvider(root: string, ctx: Ctx, invalidate: () => void, adapter: DshAdapter) {
  const provider = {
    name: PROVIDER_NAME,
    async list() {
      const candidates = []
      for (const entry of await listCorpus(root)) {
        const parsed = await readSkillFile(entry.locator, ctx)
        if (parsed === undefined) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
          invocation: parsed.invocation,
          provider: PROVIDER_NAME,
          source: "bundled",
          rank: BUNDLED_SKILL_RANK,
          locator: { path: entry.locator, directory: entry.directory },
          resourceBase: { kind: "directory", path: entry.directory },
          path: entry.locator,
          ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        })
      }
      return candidates
    },
    async get(candidate: any) {
      const parsed = await readSkillFile(candidate?.locator?.path ?? "", ctx)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: "bundled",
        resourceBase: candidate.resourceBase ?? { kind: "directory", path: dirname(candidate?.locator?.path ?? "") },
        path: candidate?.locator?.path,
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        content: parsed.content,
      }
    },
  }
  // Invalidate on a model-facing write inside the corpus so an edited skill is
  // re-read without a restart (same trigger the filesystem provider uses).
  //
  // The EVENT NAME is part of the harness surface, so it is reached through the
  // adapter's `onEvent` (which returns a disposer, or undefined when no event bus
  // is reachable): a release that renames `fs/observed` is absorbed in ONE file.
  // The payload fields the handler reads (`target.displayPath`, `actor.name`) and
  // its invalidation behaviour are unchanged.
  if (typeof adapter.onEvent === "function") {
    adapter.onEvent("fs/observed", (target: any, _observation: any, actor: any) => {
      const toolName = actor?.name
      if (toolName !== "edit" && toolName !== "write") return
      const displayPath = typeof target?.displayPath === "string" ? target.displayPath : undefined
      if (displayPath === undefined || !displayPath.startsWith(root)) return
      invalidate()
    })
  }
  return provider
}

// ── plugin entry ────────────────────────────────────────────────────────────

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through mpd's adapter, a HARD dependency: `mpdDsh` is
  // injected, so a composition without the provider never applies this row. There is
  // deliberately NO fallback adapter here.
  const adapter = ctx.mpdDsh as DshAdapter
  const root = bundleRoot()
  const corpus = config.skillsDir ? config.skillsDir : join(root, "skills")

  if (config.skipSkills === true) {
    console.log("[mpd-silicon-bootstrap] skill corpus provider skipped (config)")
    return
  }
  adapter.registerSkillProvider((control: any) =>
    createProvider(corpus, ctx, () => control?.invalidate?.(), adapter),
  )
  console.log("[mpd-silicon-bootstrap] skill corpus served from " + corpus + " (provider " + PROVIDER_NAME + ", bundle " + readVersion(root) + ")")
}
