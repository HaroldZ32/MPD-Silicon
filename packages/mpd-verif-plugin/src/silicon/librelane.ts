// LibreLane runner: resolve the tool (binary | AppImage | devshell AppImage),
// build its argv WITHOUT a shell, run it inside the workspace and keep a log.
//
// Resolution is tiered and reports WHY (mode + path + reason):
//   1. config  `librelane.mode` (auto default) picks the tier:
//                binary   -> librelane.bin (a file, or a dir -> <dir>/librelane)
//                            else librelane.home -> <home>/librelane,
//                            <home>/bin/librelane, <home>/.venv/bin/librelane
//                appimage -> librelane.appimage (verbatim)
//                devshell -> librelane.appimage exec'd as [appimage, "librelane", ...args]
//                auto     -> librelane.appimage when set (devshell when the
//                            filename contains "devshell"), else the binary tier
//   2. env     MPD_SILICON_LIBRELANE (binary) and
//              MPD_SILICON_LIBRELANE_APPIMAGE (AppImage) are the fallbacks when
//              the config tier is absent.
//   3. PATH    a plain `librelane` executable is the last tier.
//
// AppImage extraction: when `librelane.appimageExtract` is unset, extraction is
// AUTO only when /dev/fuse is not readable+writable (a container or a host
// without FUSE), and the child gets APPIMAGE_EXTRACT_AND_RUN=1 — the standard
// AppImage runtime switch. The decision helper takes `hasFuse` as an argument so
// it stays testable on a FUSE-less host.
//
// Devshell: the image's own wrapper takes a COMMAND, not a `--run` string — its
// usage is `devshell [--pure] <cmd> [...]`. Measured against the real
// librelane-devshell-x86_64.AppImage (LibreLane 3.0.16, no FUSE):
// `APPIMAGE_EXTRACT_AND_RUN=1 <appimage> librelane --version` → exit 0, while
// `<appimage> --run "<cmd>"` fails with `exec: --run: not found` (127). So the
// devshell argv is [appimage, "librelane", ...args]: direct argv, no shell and no
// quoting. Binary and plain-AppImage modes use the same shape.
//
// Logs go to <workspace>/.mpd/librelane/<UTC timestamp>-<slug>.log and list the
// command, cwd and ENV OVERRIDES only (never the full environment).
import { accessSync, constants, existsSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { DshToolDef, DshToolExec } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import { workspaceRootOf } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import { refusalOf, VerifError } from "../errors"
import { run as runProcess, writeLog } from "../run"
import { describePath, expandHome, findOnPath, loadSiliconConfig, type SiliconConfig } from "./config"

/** The execution shape that actually runs after resolution (never "auto"). */
export type LibreLaneMode = "binary" | "appimage" | "devshell"
/** The configured mode, including the default "auto". */
export type LibreLaneConfiguredMode = "auto" | LibreLaneMode
/** Which tier produced the resolved path. */
export type LibreLaneSource = "config" | "env" | "path"

/** Process env subset the resolver reads; injectable so tests stay process-local. */
type EnvLike = Readonly<Record<string, string | undefined>>

/** One resolution result: what will run, where it came from, and why. */
export interface LibreLaneResolution {
  readonly mode: LibreLaneMode
  readonly configuredMode: LibreLaneConfiguredMode
  readonly path: string | null
  readonly source: LibreLaneSource | null
  readonly reason: string
  readonly exists: boolean
  readonly executable: boolean
  /** True when auto chose devshell because the AppImage filename says so. */
  readonly devshellFromFilename: boolean
}

/** A resolved command plus the preview the status action shows verbatim. */
export interface LibreLaneStatus {
  readonly ok: true
  readonly action: "status"
  readonly mode: LibreLaneMode
  readonly configuredMode: LibreLaneConfiguredMode
  readonly path: string
  readonly source: LibreLaneSource | null
  readonly reason: string
  readonly exists: boolean
  readonly executable: boolean
  /** null in binary mode: APPIMAGE_EXTRACT_AND_RUN is an AppImage-only setting. */
  readonly appimageExtract: boolean | null
  readonly extractReason: string
  readonly command: string[]
  readonly commandPreview: string
  /** null when the probe was skipped (missing/non-executable path) or its output had no version. */
  readonly version: string | null
  readonly hints: string[]
}

/** The run payload (also the tool's run action shape). */
export interface LibreLaneRunResult {
  readonly ok: boolean
  readonly action: "run"
  readonly mode: LibreLaneMode
  readonly command: string[]
  readonly commandPreview: string
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  /** Command duration in milliseconds (the tool contract calls this field `duration`). */
  readonly duration: number
  readonly logPath: string
  readonly stdoutTail: string[]
  readonly stderrTail: string[]
  readonly spawnError: string | null
}

/** Default command timeout: one hour (a full flow can be long; --version is seconds). */
export const DEFAULT_RUN_TIMEOUT_MS = 3_600_000
/** Version probes stay short: `librelane --version` is instantaneous. */
const STATUS_TIMEOUT_MS = 60_000
/** "the last ~40 lines" of each stream in the run payload. */
const TAIL_LINES = 40
/** One hint for every refusal that could be fixed by configuration. */
const CONFIG_HINT =
  "set librelane.bin (or librelane.home) for a binary, or librelane.appimage for an AppImage/devshell, via mpd_verif_toolchain action=set; env MPD_SILICON_LIBRELANE / MPD_SILICON_LIBRELANE_APPIMAGE also work"

/** Trimmed non-empty string or null. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/** A configured mode, defaulting to auto for absent/invalid values. */
function configuredModeOf(value: unknown): LibreLaneConfiguredMode {
  return value === "binary" || value === "appimage" || value === "devshell" ? value : "auto"
}

/** First candidate that exists on disk, or null. */
function firstExisting(candidates: readonly string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** An unresolved result that still reports the mode the operator asked for. */
function unresolved(mode: LibreLaneMode, configuredMode: LibreLaneConfiguredMode, reason: string): LibreLaneResolution {
  return { mode, configuredMode, path: null, source: null, reason, exists: false, executable: false, devshellFromFilename: false }
}

/** A binary result (path may be null when nothing resolved). */
function binaryResolution(path: string | null, source: LibreLaneSource | null, configuredMode: LibreLaneConfiguredMode, reason: string): LibreLaneResolution {
  const info = describePath(path)
  return { mode: "binary", configuredMode, path, source, reason, exists: info.exists, executable: info.executable, devshellFromFilename: false }
}

/** `librelane.bin` semantics: a file is used as-is; a dir/missing path means <dir>/librelane. */
function binSettingCandidates(raw: string, label: string): { candidates: string[]; reason: string } {
  const expanded = resolve(expandHome(raw))
  const info = describePath(expanded)
  if (info.kind === "file") return { candidates: [expanded], reason: label + " is a file" }
  if (info.kind === "directory") return { candidates: [join(expanded, "librelane")], reason: label + " is a directory → <dir>/librelane" }
  return { candidates: [join(expanded, "librelane")], reason: label + " does not exist; treating it as a bin directory → <dir>/librelane" }
}

/** `librelane.home` candidates, in the documented probe order. */
function homeCandidates(raw: string): string[] {
  const home = resolve(expandHome(raw))
  return [join(home, "librelane"), join(home, "bin", "librelane"), join(home, ".venv", "bin", "librelane")]
}

/** The binary tier from config (bin first, then home); null when neither key is set. */
function configBinaryResolution(cfgBin: string | null, cfgHome: string | null, configuredMode: LibreLaneConfiguredMode): LibreLaneResolution | null {
  if (cfgBin !== null) {
    const setting = binSettingCandidates(cfgBin, "librelane.bin")
    const chosen = firstExisting(setting.candidates) ?? setting.candidates[0]
    return binaryResolution(chosen, "config", configuredMode, setting.reason)
  }
  if (cfgHome !== null) {
    const candidates = homeCandidates(cfgHome)
    const chosen = firstExisting(candidates) ?? candidates[0]
    return binaryResolution(chosen, "config", configuredMode, "librelane.home → " + chosen)
  }
  return null
}

/** The env-tier binary fallback (MPD_SILICON_LIBRELANE). */
function envBinaryResolution(raw: string, configuredMode: LibreLaneConfiguredMode): LibreLaneResolution {
  const setting = binSettingCandidates(raw, "MPD_SILICON_LIBRELANE")
  const chosen = firstExisting(setting.candidates) ?? setting.candidates[0]
  return binaryResolution(chosen, "env", configuredMode, setting.reason)
}

/** An AppImage result; auto decides devshell by filename, an explicit mode wins. */
function appimageResolution(path: string, source: LibreLaneSource, configuredMode: LibreLaneConfiguredMode, trigger: string): LibreLaneResolution {
  const info = describePath(path)
  const devshellName = basename(path).toLowerCase().includes("devshell")
  const mode: LibreLaneMode = configuredMode === "auto" ? (devshellName ? "devshell" : "appimage") : configuredMode
  const filenameNote = configuredMode === "auto" ? (devshellName ? "; filename contains 'devshell' → devshell" : "; filename has no 'devshell' → appimage") : ""
  return {
    mode,
    configuredMode,
    path,
    source,
    reason: trigger + filenameNote,
    exists: info.exists,
    executable: info.executable,
    devshellFromFilename: configuredMode === "auto" && devshellName,
  }
}

/**
 * Resolve the LibreLane execution shape: config, then env, then PATH.
 *
 * A configured path is returned even when missing (status must be able to say
 * "does not exist"); the next tier is only consulted when its key is absent.
 * @param config - the merged silicon config (null/undefined when absent).
 * @param env - environment to read (defaults to process.env).
 * @returns mode, path, tier and a human reason.
 */
export function resolveLibreLane(config: SiliconConfig | null | undefined, env: EnvLike = process.env): LibreLaneResolution {
  const ll = config?.librelane
  const cfgAppimage = textOf(ll?.appimage)
  const cfgBin = textOf(ll?.bin)
  const cfgHome = textOf(ll?.home)
  const configuredMode = configuredModeOf(ll?.mode)
  const envBinary = textOf(env.MPD_SILICON_LIBRELANE)
  const envAppimage = textOf(env.MPD_SILICON_LIBRELANE_APPIMAGE)

  if (configuredMode === "appimage" || configuredMode === "devshell") {
    const image = cfgAppimage ?? envAppimage
    if (image === null) {
      return unresolved(configuredMode, configuredMode, "librelane.mode=" + configuredMode + " but neither librelane.appimage nor MPD_SILICON_LIBRELANE_APPIMAGE is set")
    }
    const source: LibreLaneSource = cfgAppimage !== null ? "config" : "env"
    const label = source === "config" ? "librelane.appimage" : "MPD_SILICON_LIBRELANE_APPIMAGE"
    return appimageResolution(resolve(expandHome(image)), source, configuredMode, "librelane.mode=" + configuredMode + " → " + label)
  }

  if (configuredMode === "binary") {
    const fromConfig = configBinaryResolution(cfgBin, cfgHome, configuredMode)
    if (fromConfig !== null) return fromConfig
    if (envBinary !== null) return envBinaryResolution(envBinary, configuredMode)
    const onPath = findOnPath("librelane")
    if (onPath !== null) return binaryResolution(onPath, "path", configuredMode, "librelane.mode=binary; found 'librelane' on PATH")
    return unresolved("binary", configuredMode, "librelane.mode=binary but librelane.bin, librelane.home, MPD_SILICON_LIBRELANE and PATH did not resolve")
  }

  if (cfgAppimage !== null) return appimageResolution(resolve(expandHome(cfgAppimage)), "config", "auto", "librelane.appimage configured")
  const fromConfig = configBinaryResolution(cfgBin, cfgHome, "auto")
  if (fromConfig !== null) return fromConfig
  if (envAppimage !== null) return appimageResolution(resolve(expandHome(envAppimage)), "env", "auto", "MPD_SILICON_LIBRELANE_APPIMAGE env fallback")
  if (envBinary !== null) return envBinaryResolution(envBinary, "auto")
  const onPath = findOnPath("librelane")
  if (onPath !== null) return binaryResolution(onPath, "path", "auto", "no AppImage/bin/home configured; found 'librelane' on PATH")
  return unresolved("binary", "auto", "no librelane configured (librelane.appimage/bin/home, env) and none found on PATH")
}

/** Whether /dev/fuse is readable+writable; false on a FUSE-less host/container. */
export function hasFuseAccess(): boolean {
  try {
    accessSync("/dev/fuse", constants.R_OK | constants.W_OK)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

/**
 * The extract decision (pure). `configured` wins; otherwise auto extracts only
 * when there is no usable FUSE device.
 * @param configured - `librelane.appimageExtract` (undefined = auto).
 * @param hasFuse - whether /dev/fuse is accessible.
 */
export function decideAppimageExtract(configured: boolean | undefined, hasFuse: boolean): { readonly extract: boolean; readonly reason: string } {
  if (configured === true) return { extract: true, reason: "librelane.appimageExtract=true" }
  if (configured === false) return { extract: false, reason: "librelane.appimageExtract=false" }
  if (hasFuse) return { extract: false, reason: "auto: /dev/fuse is accessible, so mount the AppImage" }
  return { extract: true, reason: "auto: /dev/fuse is not accessible, so set APPIMAGE_EXTRACT_AND_RUN=1" }
}

/** POSIX single-quote one word: `'` becomes `'\''` inside the quoted string. */
export function posixSingleQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

/** Shell-style rendering of an argv array, used as the status preview. */
export function commandPreview(command: readonly string[]): string {
  return command.map(posixSingleQuote).join(" ")
}

/** The target shape command building needs (a resolved mode + path). */
export interface LibreLaneCommandTarget {
  readonly mode: LibreLaneMode
  readonly path: string | null
}

/**
 * Build the exact argv (pure). Every mode is a direct argv: the devshell image's
 * wrapper execs its command (`devshell [--pure] <cmd> [...]`), so `librelane` must
 * be its own argv word — NOT a `--run` string handed to a shell inside the image.
 */
export function buildLibreLaneCommand(target: LibreLaneCommandTarget, args: readonly string[]): string[] {
  if (target.path === null) {
    throw new VerifError("VERIF_E_NO_BACKEND", "cannot build a librelane command without a resolved path", CONFIG_HINT)
  }
  if (target.mode === "devshell") {
    return [target.path, "librelane", ...args]
  }
  return [target.path, ...args]
}

/** Parse the first `LibreLane v<version>` from probe output. */
export function parseLibreLaneVersion(output: string): string | null {
  const match = /LibreLane\s+v([^\s]+)/.exec(output)
  return match?.[1] ?? null
}

/** The command the status action previews and probes. */
function statusCommand(resolution: LibreLaneResolution): string[] {
  if (resolution.path === null) return []
  if (resolution.mode === "devshell") return [resolution.path, "librelane", "--version"]
  return [resolution.path, "--version"]
}

/** A configured toolchain bin dir, existing only: a `.bin` dir, a `.bin` file's dir, or `<home>/bin`. */
function binDirOf(value: unknown): string | null {
  const raw = textOf(value)
  if (raw === null) return null
  const path = resolve(expandHome(raw))
  const info = describePath(path)
  if (info.kind === "directory") return path
  if (info.kind === "file") return dirname(path)
  return null
}

/** `<home>/bin`, existing only. */
function homeBinDirOf(value: unknown): string | null {
  const raw = textOf(value)
  if (raw === null) return null
  const path = join(resolve(expandHome(raw)), "bin")
  return describePath(path).kind === "directory" ? path : null
}

/** The existing toolchain bin dirs that go in front of PATH, in the documented order. */
function toolchainBinDirs(config: SiliconConfig | null): string[] {
  const dirs: string[] = []
  const suite = config?.ossCadSuite
  const suiteBin = binDirOf(suite?.bin) ?? homeBinDirOf(suite?.home)
  if (suiteBin !== null) dirs.push(suiteBin)
  const verible = config?.verible
  const veribleBin = binDirOf(verible?.bin) ?? homeBinDirOf(verible?.home)
  if (veribleBin !== null) dirs.push(veribleBin)
  return dirs
}

/** The child env OVERRIDES (never the full environment): PATH prefix + extract switch. */
function childEnvOverrides(config: SiliconConfig | null, mode: LibreLaneMode, extract: boolean): Record<string, string> {
  const dirs = toolchainBinDirs(config)
  const base = process.env.PATH ?? ""
  const path = dirs.length === 0 ? base : dirs.join(":") + (base.length > 0 ? ":" + base : "")
  const env: Record<string, string> = { PATH: path }
  if (extract && mode !== "binary") env.APPIMAGE_EXTRACT_AND_RUN = "1"
  return env
}

/** Resolve the run cwd against the workspace, refusing anything outside it. */
function resolveCwd(raw: unknown, workspaceRoot: string): string {
  const value = textOf(raw) ?? workspaceRoot
  const resolved = isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value)
  const rel = relative(workspaceRoot, resolved)
  if (rel.length > 0 && (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))) {
    throw new VerifError(
      "VERIF_E_CONFIG",
      "cwd '" + resolved + "' is outside the workspace '" + workspaceRoot + "'",
      "pass a cwd inside the workspace; relative paths resolve against the workspace root",
    )
  }
  return resolved
}

/** Validate the timeout argument (default one hour). */
function timeoutValue(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_RUN_TIMEOUT_MS
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new VerifError("VERIF_E_CONFIG", "timeoutMs must be a positive number", "omit it for the " + DEFAULT_RUN_TIMEOUT_MS + " ms default")
  }
  return Math.floor(raw)
}

/** The last TAIL_LINES non-trimmed lines of a stream ([] when empty). */
function tailLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split("\n")
  return lines.slice(Math.max(0, lines.length - TAIL_LINES))
}

/** A deterministic, sortable UTC timestamp (colons/dots replaced for filenames). */
function logStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-")
}

/** A short filesystem-safe slug derived from the argv. */
function logSlug(args: readonly string[]): string {
  const raw = args
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return raw.length > 0 ? raw : "run"
}

/** The evidence log: command, cwd, env overrides, both streams — no full env. */
function buildLog(command: readonly string[], cwd: string, resolution: LibreLaneResolution, env: Readonly<Record<string, string>>, result: ReturnType<typeof runProcess>, durationMs: number): string {
  const envLines = Object.entries(env).map(([key, value]) => "  " + key + "=" + value)
  return [
    "# mpd_verif_librelane run",
    "timestamp: " + new Date().toISOString(),
    "mode: " + resolution.mode + " (" + resolution.reason + ")",
    "command: " + JSON.stringify(command),
    "cwd: " + cwd,
    "env overrides:",
    ...envLines,
    "exitCode: " + String(result.status),
    "signal: " + (result.signal ?? "none"),
    "timedOut: " + String(result.timedOut),
    "spawnError: " + (result.spawnError ?? "none"),
    "durationMs: " + String(durationMs),
    "--- stdout ---",
    result.stdout,
    "--- stderr ---",
    result.stderr,
    "",
  ].join("\n")
}

/**
 * `status`: resolve, report existence/executable/extract settings, preview the
 * exact --version command and probe the version (60 s).
 * @param exec - the tool execution object (workspace scoping).
 */
export function librelaneStatus(exec?: DshToolExec): LibreLaneStatus {
  const loaded = loadSiliconConfig(exec)
  const resolution = resolveLibreLane(loaded.config)
  if (resolution.path === null) {
    throw new VerifError("VERIF_E_NO_BACKEND", "librelane was not found: " + resolution.reason, CONFIG_HINT)
  }
  const cfgAppimage = textOf(loaded.config.librelane?.appimage)
  const decided = resolution.mode === "binary"
    ? { extract: null, reason: "not applicable: binary mode" }
    : decideAppimageExtract(loaded.config.librelane?.appimageExtract, hasFuseAccess())
  const command = statusCommand(resolution)
  let version: string | null = null
  if (resolution.exists && resolution.executable) {
    const env = childEnvOverrides(loaded.config, resolution.mode, decided.extract === true)
    const [binary, ...rest] = command
    const probe = runProcess(binary, rest, { cwd: resolve(workspaceRootOf(exec)), timeoutMs: STATUS_TIMEOUT_MS, env })
    version = parseLibreLaneVersion([probe.stdout, probe.stderr].filter((part) => part.length > 0).join("\n"))
  }
  const hints: string[] = []
  if (resolution.mode === "devshell") hints.push("devshell mode selected; set librelane.mode to override")
  if (resolution.mode === "binary" && cfgAppimage === null) hints.push("no AppImage configured; using the librelane binary")
  if (!resolution.exists) hints.push("resolved " + resolution.mode + " path does not exist: " + resolution.path)
  else if (!resolution.executable) hints.push("resolved " + resolution.mode + " path is not executable: " + resolution.path)
  if (version === null && resolution.exists && resolution.executable) hints.push("could not parse 'LibreLane v<version>' from the --version output")
  return {
    ok: true,
    action: "status",
    mode: resolution.mode,
    configuredMode: resolution.configuredMode,
    path: resolution.path,
    source: resolution.source,
    reason: resolution.reason,
    exists: resolution.exists,
    executable: resolution.executable,
    appimageExtract: decided.extract,
    extractReason: decided.reason,
    command,
    commandPreview: commandPreview(command),
    version,
    hints,
  }
}

/**
 * `run`: validate argv/cwd, resolve, build the argv, execute (never through a
 * shell — the devshell image execs the argv it is given), and always write a log
 * under .mpd/librelane/.
 * @param raw - the tool arguments (args, cwd, timeoutMs).
 * @param exec - the tool execution object (workspace scoping).
 */
export function librelaneRun(raw: Record<string, unknown>, exec?: DshToolExec): LibreLaneRunResult {
  const rawArgs = raw.args
  if (!Array.isArray(rawArgs) || rawArgs.length === 0) {
    throw new VerifError("VERIF_E_CONFIG", "action=run needs a non-empty args array", "pass args like [\"--smoke-test\"] or [\"config.yaml\"]")
  }
  const args: string[] = []
  for (const value of rawArgs) {
    if (typeof value !== "string") {
      throw new VerifError("VERIF_E_CONFIG", "every element of args must be a string", "pass the LibreLane argv exactly as strings, e.g. [\"--smoke-test\"]")
    }
    args.push(value)
  }
  const timeoutMs = timeoutValue(raw.timeoutMs)
  const workspaceRoot = resolve(workspaceRootOf(exec))
  const cwd = resolveCwd(raw.cwd, workspaceRoot)
  const loaded = loadSiliconConfig(exec)
  const resolution = resolveLibreLane(loaded.config)
  if (resolution.path === null) {
    throw new VerifError("VERIF_E_NO_BACKEND", "librelane was not found: " + resolution.reason, CONFIG_HINT)
  }
  if (!resolution.exists || !resolution.executable) {
    throw new VerifError(
      "VERIF_E_NO_BACKEND",
      "resolved " + resolution.mode + " path is not usable: " + resolution.path,
      "make the path exist and be executable (chmod +x), or fix librelane.bin/home/appimage via mpd_verif_toolchain action=set",
    )
  }
  const command = buildLibreLaneCommand(resolution, args)
  const decided = resolution.mode === "binary" ? { extract: false } : decideAppimageExtract(loaded.config.librelane?.appimageExtract, hasFuseAccess())
  const env = childEnvOverrides(loaded.config, resolution.mode, decided.extract)
  const started = Date.now()
  const [binary, ...rest] = command
  const result = runProcess(binary, rest, { cwd, timeoutMs, env })
  const durationMs = Date.now() - started
  const logPath = join(workspaceRoot, ".mpd", "librelane", logStamp() + "-" + logSlug(args) + ".log")
  writeLog(logPath, buildLog(command, cwd, resolution, env, result, durationMs))
  return {
    ok: result.status === 0 && !result.timedOut && result.spawnError === null,
    action: "run",
    mode: resolution.mode,
    command,
    commandPreview: commandPreview(command),
    cwd,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    duration: durationMs,
    logPath,
    stdoutTail: tailLines(result.stdout),
    stderrTail: tailLines(result.stderr),
    spawnError: result.spawnError,
  }
}

/** Narrow an unknown to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A string field of a rendered record. */
function fieldString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  return typeof field === "string" ? field : ""
}

/** A string-array field of a rendered record. */
function fieldStrings(value: Record<string, unknown>, key: string): string[] {
  const field = value[key]
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string") : []
}

/** One text block. */
function textBlock(text: string): { type: "text"; text: string }[] {
  return [{ type: "text", text }]
}

/** Compact text rendering for the harness UI. */
function render(value: unknown): { type: "text"; text: string }[] {
  if (!isRecord(value)) return textBlock("mpd_verif_librelane: " + JSON.stringify(value))
  const error = isRecord(value.error) ? value.error : null
  if (error !== null) return textBlock("mpd_verif_librelane FAILED: " + fieldString(error, "message") + "\nhint: " + fieldString(error, "hint"))
  switch (value.action) {
    case "status": {
      const hints = fieldStrings(value, "hints")
      const extract = value.appimageExtract === null ? "n/a" : String(value.appimageExtract) + " (" + fieldString(value, "extractReason") + ")"
      const version = fieldString(value, "version")
      const lines = [
        "mpd_verif_librelane status — mode " + fieldString(value, "mode") + " [" + (fieldString(value, "source") || "unresolved") + "]",
        "path: " + (fieldString(value, "path") || "(none)") + " (" + (value.exists === true ? "exists" : "missing") + (value.executable === true ? ", executable" : "") + ")",
        "version: " + (version.length > 0 ? "LibreLane v" + version : "unknown"),
        "extract: " + extract,
        "command: " + fieldString(value, "commandPreview"),
        hints.length > 0 ? "hints:\n  " + hints.join("\n  ") : "",
      ]
      return textBlock(lines.filter((line) => line.length > 0).join("\n"))
    }
    case "run": {
      const stdoutTail = fieldStrings(value, "stdoutTail")
      const stderrTail = fieldStrings(value, "stderrTail")
      return textBlock([
        "mpd_verif_librelane run — " + fieldString(value, "mode") + (value.ok === true ? " ok" : " exit " + String(value.exitCode ?? "?")) + " (" + String(value.duration ?? "?") + " ms)",
        "cwd: " + fieldString(value, "cwd"),
        "command: " + fieldString(value, "commandPreview"),
        "log: " + fieldString(value, "logPath"),
        "stdout tail:",
        stdoutTail.length > 0 ? stdoutTail.join("\n") : "  (empty)",
        "stderr tail:",
        stderrTail.length > 0 ? stderrTail.join("\n") : "  (empty)",
      ].join("\n"))
    }
    default:
      return textBlock("mpd_verif_librelane: " + JSON.stringify(value))
  }
}

/** The tenth `mpd_verif_*` tool: resolve and run LibreLane. */
export function librelaneToolDefinition(): DshToolDef {
  return {
    name: "mpd_verif_librelane",
    description:
      "Resolve and run LibreLane (open-source RTL-to-GDS flow). Resolution: config librelane.mode (auto|binary|appimage|devshell), then librelane.bin/home or librelane.appimage, then env MPD_SILICON_LIBRELANE / MPD_SILICON_LIBRELANE_APPIMAGE, then PATH. action=status reports the resolved mode/path/source/reason, existence/executable bit, the AppImage extract setting (librelane.appimageExtract, auto = ON when /dev/fuse is not accessible) and the exact --version command preview plus hints; action=run executes args as argv (no shell for binary/AppImage) in a workspace-confined cwd, prepends the configured oss-cad-suite/verible bins to PATH, sets APPIMAGE_EXTRACT_AND_RUN=1 when extraction applies, enforces a timeout (default 3600000 ms) and always writes a log under <workspace>/.mpd/librelane/. Devshell mode prepends 'librelane' to the arguments and executes [appimage, librelane, ...args] directly: the image's devshell wrapper execs its command, so there is no shell and no --run.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "run"], description: "status (default) resolves and probes --version; run executes the LibreLane argv" },
        args: { type: "array", items: { type: "string" }, description: "run: LibreLane argv (required, non-empty), e.g. [\"--smoke-test\"] or [\"config.yaml\"]" },
        cwd: { type: "string", description: "run: workspace-relative (or inside-workspace absolute) working directory; defaults to the workspace root. Outside the workspace is refused" },
        timeoutMs: { type: "number", description: "run: command timeout in ms (default 3600000)" },
      },
    },
    output: {
      schema: {
        // The harness accepts a CLOSED subset only: type/oneOf/properties/required/
        // additionalProperties/items/enum/const + annotations. Type arrays and anyOf
        // are rejected outright, so every nullable field is oneOf [<type>, null].
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
          action: { type: "string", enum: ["status", "run"], description: "absent on a structured refusal" },
          mode: { type: "string", enum: ["binary", "appimage", "devshell"] },
          configuredMode: { type: "string", enum: ["auto", "binary", "appimage", "devshell"] },
          path: { type: "string", description: "status: the resolved path; status refuses instead of returning a null path" },
          source: { oneOf: [{ type: "string", enum: ["config", "env", "path"] }, { type: "null" }], description: "resolution tier; null when nothing resolved" },
          reason: { type: "string" },
          exists: { type: "boolean" },
          executable: { type: "boolean" },
          appimageExtract: { oneOf: [{ type: "boolean" }, { type: "null" }], description: "AppImage extraction switch; null means NOT APPLICABLE (binary mode), never a fabricated false" },
          extractReason: { type: "string" },
          command: { type: "array", items: { type: "string" } },
          commandPreview: { type: "string" },
          version: { oneOf: [{ type: "string" }, { type: "null" }], description: "probed LibreLane version; null when the probe was skipped (missing/non-executable path) or its output had no 'LibreLane v<version>'" },
          hints: { type: "array", items: { type: "string" } },
          cwd: { type: "string", description: "run: absolute working directory (workspace-confined)" },
          exitCode: { oneOf: [{ type: "number" }, { type: "null" }], description: "run: exit code; null when a signal or the timeout ended the child" },
          signal: { oneOf: [{ type: "string" }, { type: "null" }], description: "run: terminating signal, when one ended the child" },
          timedOut: { type: "boolean", description: "run: the timeout killed the direct child" },
          duration: { type: "number", description: "command duration in milliseconds" },
          logPath: { type: "string" },
          stdoutTail: { type: "array", items: { type: "string" } },
          stderrTail: { type: "array", items: { type: "string" } },
          spawnError: { oneOf: [{ type: "string" }, { type: "null" }], description: "run: spawn-level failure code (e.g. ENOENT), null when the child spawned" },
          error: { type: "object", required: ["code", "message", "hint"], properties: { code: { type: "string" }, message: { type: "string" }, hint: { type: "string" } }, description: "structured refusal" },
        },
      },
      render: (_a: unknown, v: unknown) => render(v),
    },
    execute: async (raw: Record<string, unknown>, exec: DshToolExec) => {
      try {
        const args = raw ?? {}
        switch (args.action) {
          case "run":
            return librelaneRun(args, exec)
          case "status":
          default:
            return librelaneStatus(exec)
        }
      } catch (e) {
        return refusalOf(e)
      }
    },
  }
}
