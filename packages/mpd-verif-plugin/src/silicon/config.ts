// Silicon toolchain configuration: the schema, the two-layer loader and the
// comment-preserving write path.
//
// Layers (project over user, deep-merged):
//   user    : $MPD_SILICON_CONFIG if set, else <DSH_HOME ?? ~/.dsh>/silicon.jsonc
//   project : <workspaceRoot(exec)>/.mpd/silicon.jsonc
// A missing layer is normal; a malformed layer is REPORTED (thrown by set/unset,
// collected on show) and never crashes the plugin.
//
// JSONC syntax, the refuse-first editor and the prototype guard are the ported
// modules ./jsonc and ./jsonc-edit (MIT; see their headers for provenance).
// This module is the only one that performs I/O, and every write is atomic:
// mkdir -p, a sibling temp file, rename, mode 0644 — no shell.
import { spawnSync } from "node:child_process"
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { workspaceRootOf } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import { DELETE, surgicalDelete, surgicalEdit, type JsoncEditNote } from "./jsonc-edit"
import { deepMerge, getPath, isPlainObject, parseJsonc, RESERVED_KEYS } from "./jsonc"
import { VerifError } from "../errors"

/** Which file a write targets. `user` is the home layer, `workspace` the project layer. */
export type SiliconScope = "user" | "workspace"
/** Validate an optional scope argument; an unknown value is a structured refusal. */
function explicitScope(scope: string | undefined): SiliconScope | undefined {
  if (scope === undefined || scope.length === 0) return undefined
  if (scope === "user" || scope === "workspace") return scope
  throw new VerifError("VERIF_E_CONFIG", "unknown scope '" + scope + "'", "use scope=user or scope=workspace")
}

/** One leaf of the schema: the only keys `set`/`unset` accept and `show` annotates. */
export interface SiliconLeaf {
  /** Key path as dot-separated segments. */
  readonly path: readonly string[]
  /** Value kind; `enum` additionally restricts to `values`. */
  readonly type: "string" | "boolean" | "enum"
  /** Allowed values for an `enum` leaf. */
  readonly values?: readonly string[]
  /** Whether a string value is a filesystem path (expanded, made absolute, probed). */
  readonly isPath?: boolean
  /** One-line human description used in refusals and rendered output. */
  readonly description: string
}

/** The binding schema. Key spelling follows mpd: `.bin` = executable or bin dir, `.home` = install root. */
export const SILICON_LEAVES: readonly SiliconLeaf[] = [
  { path: ["ossCadSuite", "home"], type: "string", isPath: true, description: "oss-cad-suite install root (bin/ is inferred)" },
  { path: ["ossCadSuite", "bin"], type: "string", isPath: true, description: "oss-cad-suite bin dir or a single executable" },
  { path: ["verible", "home"], type: "string", isPath: true, description: "verible install root" },
  { path: ["verible", "bin"], type: "string", isPath: true, description: "verible bin dir or a single executable" },
  { path: ["slangServer", "bin"], type: "string", isPath: true, description: "slang-server bin dir or a single executable (SystemVerilog LSP)" },
  { path: ["librelane", "appimage"], type: "string", isPath: true, description: "librelane AppImage path" },
  { path: ["librelane", "mode"], type: "enum", values: ["auto", "appimage", "devshell", "binary"], description: "librelane execution mode" },
  { path: ["librelane", "appimageExtract"], type: "boolean", description: "extract the AppImage instead of mounting it" },
  { path: ["librelane", "bin"], type: "string", isPath: true, description: "librelane executable or bin dir" },
  { path: ["librelane", "home"], type: "string", isPath: true, description: "librelane install root" },
]

/** The effective config: schema keys plus every preserved unknown key. */
export interface SiliconConfig {
  ossCadSuite?: { home?: string; bin?: string; [k: string]: unknown }
  verible?: { home?: string; bin?: string; [k: string]: unknown }
  slangServer?: { bin?: string; [k: string]: unknown }
  librelane?: {
    appimage?: string
    mode?: "auto" | "appimage" | "devshell" | "binary"
    appimageExtract?: boolean
    bin?: string
    home?: string
    [k: string]: unknown
  }
  [k: string]: unknown
}

/** One parsed layer: its path, whether it exists, and its own (unmerged) value. */
export interface SiliconLayer {
  path: string
  exists: boolean
  /** The file as read, or null when it does not exist. */
  raw: string | null
  /** The parsed object, or {} when absent/unparseable. Unknown keys are preserved. */
  value: Record<string, unknown>
  /** A human-readable parse error, or null. */
  parseError: string | null
}

/** The loader result: the merged config, both layers and every reported problem. */
export interface LoadedSiliconConfig {
  config: SiliconConfig
  user: SiliconLayer
  workspace: SiliconLayer
  /** One entry per malformed layer, ready to surface. */
  parseErrors: { file: "user" | "workspace"; path: string; error: string }[]
  /** Dot paths present in the merged config that the schema does not know. */
  unknownKeys: string[]
  /** Known leaves whose value has the wrong type (or whose group is not an object). */
  invalidKeys: { key: string; expected: string; actual: string }[]
}

/** `<DSH_HOME ?? ~/.dsh>` — read per call, never cached (one process serves many sessions). */
export function dshHome(): string {
  const env = (process.env.DSH_HOME ?? "").trim()
  return env.length > 0 ? resolve(env) : join(homedir(), ".dsh")
}

/** Expand a leading `~` to the home directory; other values pass through. */
export function expandHome(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2))
  return p
}

/** The user layer: `MPD_SILICON_CONFIG` wins, else `<DSH_HOME>/silicon.jsonc`. */
export function userConfigPath(): string {
  const override = (process.env.MPD_SILICON_CONFIG ?? "").trim()
  return override.length > 0 ? resolve(expandHome(override)) : join(dshHome(), "silicon.jsonc")
}

/** The project layer: `<workspaceRoot(exec)>/.mpd/silicon.jsonc`. */
export function workspaceConfigPath(exec?: unknown): string {
  return join(workspaceRootOf(exec as never), ".mpd", "silicon.jsonc")
}

/** The two paths plus the workspace root, for the `path` action. */
export function siliconPaths(exec?: unknown): { dshHome: string; workspaceRoot: string; userFile: string; workspaceFile: string } {
  return { dshHome: dshHome(), workspaceRoot: workspaceRootOf(exec as never), userFile: userConfigPath(), workspaceFile: workspaceConfigPath(exec) }
}

/** Read one layer without throwing: a malformed file becomes a reported parseError. */
export function readSiliconLayer(path: string): SiliconLayer {
  if (!existsSync(path)) return { path, exists: false, raw: null, value: {}, parseError: null }
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (e) {
    return { path, exists: true, raw: null, value: {}, parseError: "unreadable: " + String((e as Error)?.message ?? e) }
  }
  if (raw.trim().length === 0) return { path, exists: true, raw, value: {}, parseError: null }
  try {
    const parsed = parseJsonc(raw)
    if (!isPlainObject(parsed)) return { path, exists: true, raw, value: {}, parseError: "the document root is not a JSON object" }
    return { path, exists: true, raw, value: parsed, parseError: null }
  } catch (e) {
    return { path, exists: true, raw, value: {}, parseError: String((e as Error)?.message ?? e) }
  }
}

/** Whether any leaf path known to the schema starts with `prefix`. */
function isKnownPrefix(prefix: readonly string[]): boolean {
  return SILICON_LEAVES.some((leaf) => prefix.every((segment, i) => leaf.path[i] === segment))
}

/** Whether `path` is exactly one schema leaf (its value slot, not a group). */
function isExactLeaf(path: readonly string[]): boolean {
  return SILICON_LEAVES.some((leaf) => leaf.path.length === path.length && leaf.path.every((segment, i) => segment === path[i]))
}

/** Every leaf path in a parsed value, used for per-key source attribution. */
function leafPaths(value: unknown, prefix: readonly string[] = []): string[][] {
  if (!isPlainObject(value)) return prefix.length > 0 ? [[...prefix]] : []
  const keys = Object.keys(value).filter((k) => !RESERVED_KEYS.has(k))
  if (keys.length === 0) return prefix.length > 0 ? [[...prefix]] : []
  const out: string[][] = []
  for (const key of keys) out.push(...leafPaths(value[key], [...prefix, key]))
  return out
}

/** Collect the dot paths the schema does not know, recursing only into known groups. */
function collectUnknown(value: unknown, prefix: readonly string[] = []): string[] {
  if (!isPlainObject(value)) return []
  const out: string[] = []
  for (const key of Object.keys(value)) {
    if (RESERVED_KEYS.has(key)) continue
    const path = [...prefix, key]
    if (!isKnownPrefix(path)) out.push(path.join("."))
    // An exact leaf is a scalar slot: a non-object value there is an invalidKeys report,
    // not a set of unknown children.
    else if (!isExactLeaf(path)) out.push(...collectUnknown(value[key], path))
  }
  return out
}

/** The declared kind of a JavaScript value, for an invalid-key report. */
function kindOf(v: unknown): string {
  if (Array.isArray(v)) return "array"
  if (v === null) return "null"
  return typeof v
}

/** Validate a known leaf's value; returns a report or null when the value matches. */
function invalidLeaf(leaf: SiliconLeaf, value: unknown): { key: string; expected: string; actual: string } | null {
  const key = leaf.path.join(".")
  if (value === undefined) return null
  if (leaf.type === "boolean") return typeof value === "boolean" ? null : { key, expected: "boolean", actual: kindOf(value) }
  if (leaf.type === "enum") {
    if (typeof value !== "string") return { key, expected: leaf.values?.join("|") ?? "string", actual: kindOf(value) }
    return leaf.values?.includes(value) ? null : { key, expected: leaf.values?.join("|") ?? "string", actual: JSON.stringify(value) }
  }
  return typeof value === "string" ? null : { key, expected: "string", actual: kindOf(value) }
}

/**
 * Load both layers and merge them (project over user). Missing files are normal.
 * Never throws on a malformed file: the error is collected so `show` can report it
 * while still returning whatever the other layer (and the unparseable one's empty
 * fallback) provides.
 */
export function loadSiliconConfig(exec?: unknown): LoadedSiliconConfig {
  const user = readSiliconLayer(userConfigPath())
  const workspace = readSiliconLayer(workspaceConfigPath(exec))
  const config = deepMerge(user.value, workspace.value) as SiliconConfig
  const parseErrors: LoadedSiliconConfig["parseErrors"] = []
  if (user.parseError) parseErrors.push({ file: "user", path: user.path, error: user.parseError })
  if (workspace.parseError) parseErrors.push({ file: "workspace", path: workspace.path, error: workspace.parseError })
  const invalidKeys: LoadedSiliconConfig["invalidKeys"] = []
  /** Groups already reported, so a scalar group appears once instead of once per child leaf. */
  const reportedGroups = new Set<string>()
  for (const leaf of SILICON_LEAVES) {
    const groupPath = leaf.path.slice(0, -1)
    const group = leaf.path.length > 1 ? getPath(config, groupPath) : config
    if (groupPath.length > 0 && group !== undefined && !isPlainObject(group)) {
      const key = groupPath.join(".")
      if (!reportedGroups.has(key)) {
        reportedGroups.add(key)
        invalidKeys.push({ key, expected: "object", actual: kindOf(group) })
      }
      continue
    }
    const bad = invalidLeaf(leaf, getPath(config, leaf.path))
    if (bad) invalidKeys.push(bad)
  }
  return { config, user, workspace, parseErrors, unknownKeys: collectUnknown(config), invalidKeys }
}

/** Which layer defines a dot path (workspace wins, since it is the overriding layer). */
export function sourceLayerOf(loaded: LoadedSiliconConfig, path: readonly string[]): SiliconScope | null {
  if (getPath(loaded.workspace.value, path) !== undefined) return "workspace"
  if (getPath(loaded.user.value, path) !== undefined) return "user"
  return null
}

/**
 * Resolve the layer a set/unset targets: an explicit scope, else the layer that
 * already defines the key (workspace first), else the user layer.
 */
export function targetScope(loaded: LoadedSiliconConfig, path: readonly string[], explicit?: string): SiliconScope {
  if (explicit === "user" || explicit === "workspace") return explicit
  return sourceLayerOf(loaded, path) ?? "user"
}

/** The commented template `init` writes and a missing layer starts from. */
export function siliconTemplate(): string {
  return [
    "// Silicon toolchain configuration (JSONC).",
    "// User layer: $DSH_HOME/silicon.jsonc — project layer: <workspace>/.mpd/silicon.jsonc.",
    "// Project values override user values; a key absent from both layers falls through.",
    "//",
    "// oss-cad-suite provides iverilog, verilator and verilator_coverage.",
    '// ossCadSuite: { home: "/opt/oss-cad-suite" }',
    "//",
    "// verible provides verible-verilog-lint / verible-verilog-format.",
    '// verible: { bin: "/opt/verible/bin" }',
    "//",
    "// slang-server provides the SystemVerilog LSP used for .sv/.svh.",
    '// slangServer: { bin: "/opt/slang-server" }',
    "//",
    "// librelane is the standalone flow driver (its own tool lane).",
    '// librelane: { mode: "auto", appimage: "~/librelane.AppImage" }',
    "{}",
    "",
  ].join("\n")
}

/** Write text atomically: mkdir -p, a sibling temp file, rename, mode 0644. No shell. */
export function atomicWriteSiliconFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const sibling = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`)
  writeFileSync(sibling, text, { mode: 0o644 })
  renameSync(sibling, path)
  // rename preserves the temp file's mode; force 0644 past a restrictive umask.
  chmodSync(path, 0o644)
}

/** Expand and type-check one schema leaf value; throws a structured refusal on a mismatch. */
export function validateSiliconValue(leaf: SiliconLeaf, value: unknown): string | boolean {
  const key = leaf.path.join(".")
  if (leaf.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new VerifError("VERIF_E_CONFIG", `'${key}' expects a boolean, got ${kindOf(value)}`, "pass value=true or value=false")
    }
    return value
  }
  if (leaf.type === "enum") {
    if (typeof value !== "string" || !(leaf.values ?? []).includes(value)) {
      throw new VerifError("VERIF_E_CONFIG", `'${key}' expects one of ${(leaf.values ?? []).join("|")}, got ${JSON.stringify(value)}`, `pass value=<${(leaf.values ?? []).join("|")}>`)
    }
    return value
  }
  if (typeof value !== "string") {
    throw new VerifError("VERIF_E_CONFIG", `'${key}' expects a string, got ${kindOf(value)}`, "pass value as a JSON string")
  }
  const expanded = expandHome(value.trim())
  if (expanded.length === 0) throw new VerifError("VERIF_E_CONFIG", `'${key}' rejects an empty value`, "pass a non-empty path")
  return expanded
}

/** Parse a dot-separated key into segments, refusing an empty key. */
export function parseKeyPath(key: string): string[] {
  const segments = key.split(".").map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) throw new VerifError("VERIF_E_CONFIG", "key is required", "pass key like ossCadSuite.bin")
  return segments
}

/** The schema leaf for a key path, or a refusal naming every accepted key. */
export function leafForPath(path: readonly string[]): SiliconLeaf {
  const leaf = SILICON_LEAVES.find((candidate) => candidate.path.length === path.length && candidate.path.every((segment, i) => segment === path[i]))
  if (leaf) return leaf
  const known = SILICON_LEAVES.map((candidate) => candidate.path.join(".")).join(", ")
  throw new VerifError("VERIF_E_UNSUPPORTED", `unknown toolchain key '${path.join(".")}'`, `known keys: ${known}`)
}

/** One configured path key as `show` reports it. */
export interface ResolvedPathInfo {
  key: string
  raw: string | null
  path: string | null
  exists: boolean
  kind: "file" | "directory" | "missing"
  executable: boolean
}

/** Probe one filesystem path without throwing. */
export function describePath(p: string | null): { exists: boolean; kind: "file" | "directory" | "missing"; executable: boolean } {
  if (p === null || p.length === 0 || !existsSync(p)) return { exists: false, kind: "missing", executable: false }
  try {
    const st = statSync(p)
    if (st.isDirectory()) return { exists: true, kind: "directory", executable: false }
    let executable = false
    try {
      accessSync(p, constants.X_OK)
      executable = true
    } catch {
      executable = false
    }
    return { exists: true, kind: "file", executable }
  } catch {
    return { exists: false, kind: "missing", executable: false }
  }
}

/** Candidate executable paths a bin-dir-or-executable setting implies, in order. */
export function binCandidates(raw: string | null | undefined, names: readonly string[]): string[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return []
  const expanded = expandHome(raw.trim())
  const info = describePath(expanded)
  if (info.kind === "directory") return names.map((name) => join(expanded, name))
  // An explicit executable is a candidate only for the tool it is named after; otherwise
  // a single ossCadSuite.bin=/path/iverilog would wrongly resolve verilator to iverilog.
  if (info.kind === "file") return names.includes(basename(expanded)) ? [expanded] : []
  // A path that does not exist yet is still a bin-dir setting by the `.bin` convention.
  return names.map((name) => join(expanded, name))
}

/**
 * Config-tier candidates for a tool binary, from `ossCadSuite.bin` then
 * `ossCadSuite.home/bin`. Empty when no usable key is configured.
 */
export function configBinCandidates(name: string, config: SiliconConfig | null | undefined): string[] {
  if (!config) return []
  const suite = isPlainObject(config.ossCadSuite) ? config.ossCadSuite : undefined
  if (!suite) return []
  const out: string[] = []
  if (typeof suite.bin === "string") out.push(...binCandidates(suite.bin, [name]))
  if (typeof suite.home === "string") out.push(...binCandidates(join(expandHome(suite.home), "bin"), [name]))
  return out
}

/** Scan PATH for a plain binary name (the last resolution tier). */
export function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** A cheap version probe: execFile-shaped spawn, no shell, short timeout. */
export function probeVersion(binary: string, args: readonly string[], timeoutMs = 1500): string | null {
  try {
    const r = spawnSync(binary, [...args], { timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null
    const line = r.stdout.split("\n").map((l) => l.trim()).find((l) => l.length > 0)
    return line === undefined ? null : line.slice(0, 200)
  } catch {
    return null
  }
}

/** The result of `set`: old/new plus the file that was written. */
export interface SetResult {
  ok: true
  action: "set"
  scope: SiliconScope
  file: string
  key: string
  old: unknown
  new: string | boolean
  changed: boolean
  created: boolean
  notes: JsoncEditNote[]
}

/**
 * Validate and write one schema leaf (surgical edit; comments/order preserved).
 * A malformed target file is a refusal, never a clobber.
 */
export function setConfigValue(args: { key: string; value: unknown; scope?: string }, exec?: unknown): SetResult {
  const loaded = loadSiliconConfig(exec)
  const path = parseKeyPath(args.key)
  const leaf = leafForPath(path)
  // The target layer is decided BEFORE path normalisation: a relative path is legal
  // for workspace scope (resolved against the workspace) and refused for user scope.
  const scope = targetScope(loaded, path, explicitScope(args.scope))
  const value = validateSiliconValue(leaf, args.value)
  let finalValue: string | boolean = value
  if (leaf.isPath && typeof value === "string" && !isAbsolute(value)) {
    if (scope === "user") {
      throw new VerifError("VERIF_E_CONFIG", `user-scope '${leaf.path.join(".")}' requires an absolute path, got '${value}'`, "pass an absolute path (a leading ~ is expanded) — relative paths are only accepted for workspace scope")
    }
    finalValue = resolve(workspaceRootOf(exec as never), value)
  }
  const file = scope === "workspace" ? workspaceConfigPath(exec) : userConfigPath()
  const layer = scope === "workspace" ? loaded.workspace : loaded.user
  if (layer.exists && layer.parseError) {
    throw new VerifError("VERIF_E_CONFIG", `${file} is not parseable JSONC: ${layer.parseError}`, "fix the file by hand (or pass scope=user) — the tool refuses to clobber a broken document")
  }
  // A missing (or empty) target starts from the commented template, so a new file
  // is self-documenting instead of a bare `{}`.
  const base = layer.raw !== null && layer.raw.trim().length > 0 ? layer.raw : siliconTemplate()
  const result = surgicalEdit(base, path, finalValue, { insert: true })
  if (result.ok !== true) {
    throw new VerifError("VERIF_E_CONFIG", `refused to edit ${file}: ${result.reason}${result.detail ? " (" + result.detail + ")" : ""}`, "the document is ambiguous or malformed; edit it by hand or run action=init with force")
  }
  const old = getPath(loaded.config, path) ?? null
  if (result.changed) atomicWriteSiliconFile(file, result.text)
  return {
    ok: true,
    action: "set",
    scope,
    file,
    key: path.join("."),
    old,
    new: finalValue,
    changed: result.changed,
    created: !layer.exists,
    notes: result.notes === undefined ? [] : [...result.notes],
  }
}

/** The result of `unset`. */
export interface UnsetResult {
  ok: true
  action: "unset"
  scope: SiliconScope
  file: string
  key: string
  old: unknown
  new: null
  changed: boolean
  notes: JsoncEditNote[]
}

/** Remove one schema leaf from the layer that defines it; never touches another byte. */
export function unsetConfigValue(args: { key: string; scope?: string }, exec?: unknown): UnsetResult {
  const loaded = loadSiliconConfig(exec)
  const path = parseKeyPath(args.key)
  leafForPath(path)
  const scope = targetScope(loaded, path, explicitScope(args.scope))
  const file = scope === "workspace" ? workspaceConfigPath(exec) : userConfigPath()
  const layer = scope === "workspace" ? loaded.workspace : loaded.user
  const old = getPath(loaded.config, path) ?? null
  if (!layer.exists || getPath(layer.value, path) === undefined) {
    return { ok: true, action: "unset", scope, file, key: path.join("."), old, new: null, changed: false, notes: [] }
  }
  if (layer.parseError) {
    throw new VerifError("VERIF_E_CONFIG", `${file} is not parseable JSONC: ${layer.parseError}`, "fix the file by hand — the tool refuses to clobber a broken document")
  }
  const result = surgicalDelete(layer.raw ?? "", path)
  if (result.ok !== true) {
    throw new VerifError("VERIF_E_CONFIG", `refused to edit ${file}: ${result.reason}${result.detail ? " (" + result.detail + ")" : ""}`, "the document is ambiguous or malformed; edit it by hand")
  }
  if (result.changed) atomicWriteSiliconFile(file, result.text)
  return {
    ok: true,
    action: "unset",
    scope,
    file,
    key: path.join("."),
    old,
    new: null,
    changed: result.changed,
    notes: result.notes === undefined ? [] : [...result.notes],
  }
}

/** The result of `init`. */
export interface InitResult {
  ok: true
  action: "init"
  scope: SiliconScope
  file: string
  created: boolean
  text: string
}

/** Write the commented template; refuse to overwrite unless `force` is set. */
export function initConfigFile(args: { scope?: string; force?: boolean }, exec?: unknown): InitResult {
  const scope: SiliconScope = explicitScope(args.scope) ?? "user"
  const file = scope === "workspace" ? workspaceConfigPath(exec) : userConfigPath()
  if (existsSync(file) && args.force !== true) {
    throw new VerifError("VERIF_E_CONFIG", `${file} already exists`, "pass force=true to overwrite it, or use action=set to edit it surgically")
  }
  const text = siliconTemplate()
  atomicWriteSiliconFile(file, text)
  return { ok: true, action: "init", scope, file, created: true, text }
}

/** One backend as `show`/`detect` report it. */
export interface ResolvedBackendInfo {
  name: string
  binary: string | null
  source: "env" | "config" | "path" | null
  exists: boolean
  executable: boolean
  version: string | null
}

/** The version-probe argv per tool (the same dialect the backend probe uses). */
const VERSION_ARGS: Record<string, readonly string[]> = {
  iverilog: ["-V"],
  verilator: ["--version"],
  verilator_coverage: ["--version"],
}

/**
 * Resolve one tool through the documented order: env override (returned even when
 * missing), then config, then PATH. VCS/urg/fsdbreport deliberately have no config
 * tier — the caller passes an empty config for them.
 */
export function resolveToolForShow(name: string, config: SiliconConfig | null, envVar: string | null): { binary: string; source: "env" | "config" | "path" } | null {
  if (envVar !== null) {
    const envVal = (process.env[envVar] ?? "").trim()
    if (envVal.length > 0) return { binary: resolve(expandHome(envVal)), source: "env" }
  }
  for (const candidate of configBinCandidates(name, config)) {
    if (existsSync(candidate)) return { binary: candidate, source: "config" }
  }
  const onPath = findOnPath(name)
  return onPath === null ? null : { binary: onPath, source: "path" }
}

/** Backends the toolchain config can influence (vcs is intentionally absent). */
export const TOOLCHAIN_BACKENDS: readonly { name: string; envVar: string }[] = [
  { name: "iverilog", envVar: "MPD_DSH_VERIF_IVERILOG" },
  { name: "verilator", envVar: "MPD_DSH_VERIF_VERILATOR" },
  { name: "verilator_coverage", envVar: "MPD_DSH_VERIF_VERILATOR_COVERAGE" },
]

/** The `show` payload (also the documented shape of the effective config). */
export interface ShowResult {
  ok: true
  action: "show"
  dshHome: string
  workspaceRoot: string
  userFile: { path: string; exists: boolean; parseError: string | null }
  workspaceFile: { path: string; exists: boolean; parseError: string | null }
  config: SiliconConfig
  /** Dot path -> the layer whose value wins. */
  sources: Record<string, SiliconScope>
  unknownKeys: string[]
  invalidKeys: { key: string; expected: string; actual: string }[]
  parseErrors: { file: "user" | "workspace"; path: string; error: string }[]
  paths: ResolvedPathInfo[]
  backends: ResolvedBackendInfo[]
  key: { key: string; value: unknown; source: SiliconScope | null } | null
}

/** Build the effective view, optionally focused on one key. */
export function showConfig(exec?: unknown, key?: string): ShowResult {
  const loaded = loadSiliconConfig(exec)
  const p = siliconPaths(exec)
  const sources: Record<string, SiliconScope> = {}
  for (const path of leafPaths(loaded.config)) {
    const source = sourceLayerOf(loaded, path)
    if (source !== null) sources[path.join(".")] = source
  }
  const paths: ResolvedPathInfo[] = []
  for (const leaf of SILICON_LEAVES) {
    if (leaf.isPath !== true) continue
    const rawValue = getPath(loaded.config, leaf.path)
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) continue
    const expanded = expandHome(rawValue.trim())
    const info = describePath(expanded)
    paths.push({ key: leaf.path.join("."), raw: rawValue, path: expanded, exists: info.exists, kind: info.kind, executable: info.executable })
  }
  const backends: ResolvedBackendInfo[] = TOOLCHAIN_BACKENDS.map(({ name, envVar }) => {
    const resolved = resolveToolForShow(name, loaded.config, envVar)
    if (resolved === null) return { name, binary: null, source: null, exists: false, executable: false, version: null }
    const info = describePath(resolved.binary)
    const version = info.kind === "file" ? probeVersion(resolved.binary, VERSION_ARGS[name] ?? ["--version"]) : null
    return { name, binary: resolved.binary, source: resolved.source, exists: info.exists, executable: info.executable, version }
  })
  let focused: ShowResult["key"] = null
  if (key !== undefined && key.trim().length > 0) {
    const path = parseKeyPath(key)
    focused = { key: path.join("."), value: getPath(loaded.config, path) ?? null, source: sourceLayerOf(loaded, path) }
  }
  return {
    ok: true,
    action: "show",
    dshHome: p.dshHome,
    workspaceRoot: p.workspaceRoot,
    userFile: { path: loaded.user.path, exists: loaded.user.exists, parseError: loaded.user.parseError },
    workspaceFile: { path: loaded.workspace.path, exists: loaded.workspace.exists, parseError: loaded.workspace.parseError },
    config: loaded.config,
    sources,
    unknownKeys: loaded.unknownKeys,
    invalidKeys: loaded.invalidKeys,
    parseErrors: loaded.parseErrors,
    paths,
    backends,
    key: focused,
  }
}

/** One detection suggestion: where a toolchain appears to live (never written by `detect`). */
export interface DetectSuggestion {
  key: string
  value: string
  evidence: string
}

/** The `detect` payload. */
export interface DetectResult {
  ok: true
  action: "detect"
  suggestions: DetectSuggestion[]
  env: Record<string, string | null>
  pathHits: { name: string; binary: string }[]
  roots: { path: string; exists: boolean; kind: string }[]
  note: string
}

/** Which home-relative globs the detector scans (read-only; nothing is ever written). */
function appImages(): string[] {
  const home = homedir()
  try {
    return readdirSync(home).filter((f) => f.toLowerCase().endsWith(".appimage")).map((f) => join(home, f)).sort()
  } catch {
    return []
  }
}

/** Site-package librelane roots under `~/.local/lib/python<version>/site-packages`. */
function librelaneSitePackages(): string[] {
  const libRoot = join(homedir(), ".local", "lib")
  const out: string[] = []
  try {
    for (const entry of readdirSync(libRoot)) {
      if (!entry.startsWith("python")) continue
      const candidate = join(libRoot, entry, "site-packages", "librelane")
      if (existsSync(candidate)) out.push(candidate)
    }
  } catch {
    // No ~/.local/lib: nothing to suggest.
  }
  return out
}

/**
 * Probe env, PATH and the common install roots and return SUGGESTIONS ONLY.
 * The action never writes: a suggestion is a value the human can accept with `set`.
 */
export function detectToolchains(): DetectResult {
  const home = homedir()
  const envKeys = [
    "MPD_SILICON_CONFIG",
    "OSS_CAD_SUITE",
    "OSS_CAD_SUITE_HOME",
    "VERIBLE_HOME",
    "VERIBLE_BIN",
    "LIBRELANE_HOME",
    "LIBRELANE_BIN",
    "MPD_DSH_VERIF_IVERILOG",
    "MPD_DSH_VERIF_VERILATOR",
    "MPD_DSH_VERIF_VERILATOR_COVERAGE",
  ]
  const env: Record<string, string | null> = {}
  for (const key of envKeys) env[key] = (process.env[key] ?? "").trim().length > 0 ? process.env[key]! : null

  const pathHits: { name: string; binary: string }[] = []
  for (const name of ["iverilog", "verilator", "verilator_coverage", "verible-verilog-lint", "verible-verilog-format"]) {
    if (pathHits.some((hit) => hit.name === name)) continue
    const binary = findOnPath(name)
    if (binary !== null) pathHits.push({ name, binary })
  }

  const suiteRoots = ["/opt/oss-cad-suite", join(home, "oss-cad-suite"), join(home, ".local", "oss-cad-suite")]
  const veribleRoots = ["/opt/verible", join(home, "verible"), join(home, ".local", "verible")]
  const librelaneRoots = [join(home, "librelane")]
  const scanned = [
    ...suiteRoots.map((path) => ({ path, group: "ossCadSuite" })),
    ...veribleRoots.map((path) => ({ path, group: "verible" })),
    ...librelaneRoots.map((path) => ({ path, group: "librelane" })),
    { path: join(home, ".local", "bin"), group: "path" },
  ]
  const roots = scanned.map(({ path }) => {
    const info = describePath(path)
    return { path, exists: info.exists, kind: info.kind }
  })

  const suggestions: DetectSuggestion[] = []
  const suggest = (key: string, value: string, evidence: string): void => {
    if (!suggestions.some((s) => s.key === key && s.value === value)) suggestions.push({ key, value, evidence })
  }
  for (const path of suiteRoots) {
    if (existsSync(join(path, "bin", "iverilog")) || existsSync(join(path, "bin", "verilator"))) {
      suggest("ossCadSuite.home", path, `found ${join(path, "bin")} with iverilog/verilator`)
    }
  }
  for (const path of veribleRoots) {
    if (existsSync(join(path, "bin", "verible-verilog-lint"))) suggest("verible.home", path, `found ${join(path, "bin", "verible-verilog-lint")}`)
  }
  const binDir = join(home, ".local", "bin")
  if (existsSync(join(binDir, "verible-verilog-lint")) || existsSync(join(binDir, "iverilog"))) {
    suggest("verible.bin", binDir, `found toolchain binaries in ${binDir}`)
  }
  for (const image of appImages()) {
    const base = basename(image).toLowerCase()
    if (base.includes("librelane")) suggest("librelane.appimage", image, "AppImage in the home directory")
  }
  for (const path of librelaneRoots) {
    if (existsSync(path)) suggest("librelane.home", path, "librelane checkout in the home directory")
  }
  for (const path of librelaneSitePackages()) suggest("librelane.home", path, "librelane Python package on this machine")
  for (const hit of pathHits) {
    if (hit.name === "iverilog" || hit.name === "verilator") suggest("ossCadSuite.bin", dirname(hit.binary), `PATH resolves ${hit.name} to ${hit.binary}`)
    if (hit.name.startsWith("verible")) suggest("verible.bin", dirname(hit.binary), `PATH resolves ${hit.name} to ${hit.binary}`)
  }
  return {
    ok: true,
    action: "detect",
    suggestions,
    env,
    pathHits,
    roots,
    note: "suggestions only — nothing was written; accept one with action=set",
  }
}

/** Re-exported so a caller has ONE import for the editor's delete sentinel. */
export { DELETE }
