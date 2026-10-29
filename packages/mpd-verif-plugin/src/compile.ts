// mpd_verif_compile core: lint (default) / compile targets across the three
// backends, with best-effort diagnostics parsing and log sinks under <work>/logs.
import { join } from "node:path"
import { runPlan, lintPlan, compilePlan, parseDiagnostics, requireBackend, normalizeDefines, type Diagnostic, type SourceSet } from "./backends"
import { workDir, runStamp, type BackendId } from "./env"
import { writeLog, DEFAULT_TIMEOUT_MS } from "./run"
import { VerifError } from "./errors"
import type { SiliconConfig } from "./silicon/config"

export interface VerifCompileArgs {
  backend: BackendId
  sources: string[]
  top?: string
  includes?: string[]
  defines?: Record<string, string | number> | string[]
  target?: "lint" | "compile"
  timeoutSec?: number
}

export interface VerifCompileResult {
  ok: boolean
  target: "lint" | "compile"
  backend: BackendId
  binary: string
  args: string[]
  exitCode: number | null
  timedOut: boolean
  diagnostics: Diagnostic[]
  logPath: string
  /** Present only when the plan produced a filelist (vcs lanes); never undefined. */
  filelistPath?: string
  /** Present only when the target produced a binary (compile target); never undefined. */
  outBinary?: string
  logLines: string[]
  error?: { code: string; message: string; hint: string }
}

export function verifCompile(a: VerifCompileArgs, exec?: any, config?: SiliconConfig | null): VerifCompileResult {
  if (!a.sources || a.sources.length === 0) {
    throw new VerifError("VERIF_E_COMPILE", "no sources given", "pass sources[] (at least one .v/.sv file)")
  }
  const stamp = runStamp()
  const logRoot = join(workDir(exec), "logs")
  const defines = a.defines ? (Array.isArray(a.defines) ? normalizeDefines(a.defines) : a.defines) : undefined
  const src: SourceSet = { sources: a.sources, top: a.top, includes: a.includes, defines }
  const target = a.target === "compile" ? "compile" : "lint"
  // backend gate with stable taxonomy
  requireBackend(a.backend, "install it, pin MPD_DSH_VERIF_" + a.backend.toUpperCase() + ", or set ossCadSuite.bin via mpd_verif_toolchain", config)
  const plan = target === "lint" ? lintPlan(a.backend, src, logRoot, stamp, config) : compilePlan(a.backend, src, workDir(exec), stamp, config)
  const r = runPlan(plan, (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000)
  writeLog(plan.logPath, r.combined)
  if (r.timedOut) {
    throw new VerifError("VERIF_E_TIMEOUT", `${target} '${a.backend}' timed out`, "increase timeoutSec, narrow the source set, or check the tool installation")
  }
  if (r.spawnError) {
    throw new VerifError("VERIF_E_NO_BACKEND", `${target} '${a.backend}' could not be executed: ${r.spawnError}`, "install the tool or set MPD_DSH_VERIF_" + a.backend.toUpperCase())
  }
  const diagnostics = parseDiagnostics(a.backend, r.combined)
  const ok = r.status === 0
  return {
    ok,
    target,
    backend: a.backend,
    binary: plan.binary,
    args: plan.args,
    exitCode: r.status,
    timedOut: r.timedOut,
    diagnostics,
    logPath: plan.logPath,
    // Lossless-JSON rule: an optional key is added only when the plan really
    // carries it. Assigning `undefined` here would make the host reject the
    // whole tool result with "value is not lossless JSON".
    ...(plan.filelistPath === undefined ? {} : { filelistPath: plan.filelistPath }),
    ...(plan.outBinary === undefined ? {} : { outBinary: plan.outBinary }),
    logLines: r.combined.split("\n").filter((l) => l.trim().length > 0).slice(-50),
    ...(ok ? {} : {
      error: {
        code: "VERIF_E_COMPILE",
        message: `${target} failed (exit ${r.status}, ${diagnostics.length} diagnostic(s) parsed)`,
        hint: `read the log at ${plan.logPath}; fix the first error and rerun`,
      },
    }),
  }
}