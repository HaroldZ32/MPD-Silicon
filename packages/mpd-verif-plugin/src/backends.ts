// Backend abstraction: three concrete configs (iverilog/verilator/vcs), one
// shared resolve/probe core and one argv-builder contract per target.
// All commands are argv arrays; vcs additionally gets a generated filelist
// (the vcs-native -f input). No binary is ever vendored: env override first,
// then the silicon toolchain config (iverilog/verilator only), then PATH, and a
// plain refusal when absent.
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { BACKEND_IDS, BACKEND_BIN, resolveBackendBinary, type BackendId } from "./env"
import type { SiliconConfig } from "./silicon/config"
import { run, type RunResult } from "./run"
import { VerifError } from "./errors"

export interface SourceSet {
  sources: string[]
  top?: string
  includes?: string[]
  defines?: Record<string, string | number> // macro -> value (1 when flag-style)
}

export interface BackendProbe {
  backend: BackendId
  binary: string | null
  source: "env" | "config" | "path" | null
  present: boolean
  version: string | null
  /**
   * EDA environment checklist for the vcs lane (license hints), the install
   * hint when the backend is absent, or null when there is nothing to report.
   * Required and nullable on purpose: an optional key left `undefined` is
   * dropped by JSON and the harness rejects the whole tool result with
   * "value is not lossless JSON".
   */
  licenseHint: string[] | null
}

export interface LintPlan {
  backend: BackendId
  binary: string
  args: string[]
  logPath: string
  filelistPath?: string
  outBinary?: string
}

export interface CompilePlan {
  backend: BackendId
  binary: string
  args: string[]
  outBinary: string
  logPath: string
  filelistPath?: string
}

export const LICENSE_ENV: Record<BackendId, string[]> = {
  iverilog: [],
  verilator: [],
  vcs: ["VCS_HOME", "LM_LICENSE_FILE", "SNPSLMD_LICENSE_FILE"],
}

export function versionProbeArgs(backend: BackendId): string[] {
  switch (backend) {
    case "iverilog": return ["-V"]
    case "verilator": return ["--version"]
    case "vcs": return ["-ID"]
  }
}

// Probe one backend: resolve binary, probe version, collect vcs license hints.
// Never throws — "absent" is a probe result, refusals happen at lane entry.
// Every field is always JSON-lossless: `licenseHint` is null when there is
// nothing to report, never an omitted/undefined key.
export function probeBackend(backend: BackendId, config?: SiliconConfig | null): BackendProbe {
  const r = resolveBackendBinary(backend, config)
  if (!r) {
    return { backend, binary: null, source: null, present: false, version: null, licenseHint: absentHintLines(backend) }
  }
  const vr = run(r.binary, versionProbeArgs(backend), { timeoutMs: 20_000 })
  const version = vr.timedOut ? null : firstVersionLine(vr.combined) ?? (vr.status === 0 ? "unknown" : null)
  const licenseHint = backend === "vcs" ? LICENSE_ENV.vcs.map((k) => `${k}=${process.env[k] ? "set" : "missing"}`) : null
  return { backend, binary: r.binary, source: r.source, present: vr.spawnError === null, version, licenseHint }
}

function absentHintLines(backend: BackendId): string[] {
  switch (backend) {
    case "iverilog": return ["iverilog not found — install Icarus Verilog (e.g. apt install iverilog or oss-cad-suite) or set MPD_DSH_VERIF_IVERILOG"]
    case "verilator": return ["verilator not found — install Verilator (e.g. apt install verilator or oss-cad-suite) or set MPD_DSH_VERIF_VERILATOR"]
    case "vcs": return ["vcs not found — set MPD_DSH_VERIF_VCS, or add $VCS_HOME/bin to PATH; license vars: VCS_HOME, LM_LICENSE_FILE, SNPSLMD_LICENSE_FILE"]
  }
}

export function firstVersionLine(combined: string): string | null {
  for (const l of combined.split("\n")) {
    const t = l.trim()
    if (t.length === 0) continue
    return t.slice(0, 200)
  }
  return null
}

export function requireBackend(backend: BackendId, extraHint: string, config?: SiliconConfig | null): string {
  const r = resolveBackendBinary(backend, config)
  if (!r) {
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${backend}' is not resolvable (env override, silicon config or PATH)`, [absentHintLines(backend)[0] ?? "", extraHint].filter(Boolean).join(" "))
  }
  return r.binary
}

// Normalize the defines parameter into the vcs +define+ / filelist form.
export function normalizeDefines(defs?: Record<string, string | number> | string[]): Record<string, string | number> {
  if (!defs) return {}
  if (Array.isArray(defs)) {
    const out: Record<string, string | number> = {}
    for (const d of defs) {
      const eq = d.indexOf("=")
      if (eq >= 0) out[d.slice(0, eq).trim()] = d.slice(eq + 1).trim()
      else out[d.trim()] = 1
    }
    return out
  }
  return defs
}

export function incArgs(includes?: string[]): string[] {
  return (includes ?? []).map((i) => "-I" + i)
}

export function defineArgsForIvorTool(defs: Record<string, string | number>): string[] {
  return Object.entries(defs).map(([k, v]) => (v === 1 ? "-D" + k : `-D${k}=${v}`))
}

// vcs filelist: sources plus +incdir+/+define+ lines (the vcs-native -f format).
export function writeVcsFilelist(path: string, sources: string[], includes?: string[], defs?: Record<string, string | number>): string {
  mkdirSync(dirname(path), { recursive: true })
  const defines = normalizeDefines(defs)
  const lines = [
    ...(includes ?? []).map((i) => `+incdir+${i}`),
    ...Object.entries(defines).map(([k, v]) => (v === 1 ? `+define+${k}` : `+define+${k}=${v}`)),
    ...sources,
  ]
  writeFileSync(path, lines.join("\n") + "\n")
  return path
}

// --- argv builders ---

// lint target: lint-only compile, no elaboration output.
export function lintPlan(backend: BackendId, src: SourceSet, logRoot: string, stamp: string, config?: SiliconConfig | null): LintPlan {
  // argv-shaped plan; presence gating happens at the tool layer (probe/spawn).
  const binary = resolveBackendBinary(backend, config)?.binary ?? BACKEND_BIN[backend]
  const defs = normalizeDefines(src.defines)
  switch (backend) {
    case "iverilog": {
      const args = ["-g2012", "-tnull", "-Wall"]
      if (src.top) args.push("-s", src.top)
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources)
      return { backend, binary, args, logPath: join(logRoot, `lint-iverilog-${stamp}.log`) }
    }
    case "verilator": {
      const args = ["--lint-only", "-Wall"]
      if (src.top) args.push("--top-module", src.top)
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources)
      return { backend, binary, args, logPath: join(logRoot, `lint-verilator-${stamp}.log`) }
    }
    case "vcs": {
      const filelist = join(logRoot, `vcs-filelist-${stamp}.f`)
      writeVcsFilelist(filelist, src.sources, src.includes, defs)
      const args = ["-lca", "-sverilog", "+lint=all", "-f", filelist]
      if (src.top) args.push("-top", src.top)
      const logPath = join(logRoot, `lint-vcs-${stamp}.log`)
      args.push("-l", logPath)
      return { backend, binary, args, logPath, filelistPath: filelist }
    }
  }
}

// compile target: full elaboration (iverilog/verilator produce a sim binary,
// vcs compiles simv). Diagnostic parsing still applies to failures.
export function compilePlan(backend: BackendId, src: SourceSet, workRoot: string, stamp: string, config?: SiliconConfig | null): CompilePlan {
  // argv-shaped plan; presence gating happens at the tool layer (probe/spawn).
  const binary = resolveBackendBinary(backend, config)?.binary ?? BACKEND_BIN[backend]
  const defs = normalizeDefines(src.defines)
  const outDir = join(workRoot, "build", stamp)
  // D1 fix: the build directory must exist BEFORE the tool spawns, otherwise
  // iverilog/verilator fail with ENOENT while writing -o into a missing dir.
  mkdirSync(outDir, { recursive: true })
  switch (backend) {
    case "iverilog": {
      const out = join(outDir, "simv_iverilog")
      const args = ["-g2012", "-o", out]
      if (src.top) args.push("-s", src.top)
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources)
      return { backend, binary, args, outBinary: out, logPath: join(outDir, "compile.log") }
    }
    case "verilator": {
      const out = join(outDir, "Vsim")
      const args = ["--binary"]
      if (src.top) args.push("--top-module", src.top)
      args.push("-o", out, ...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources)
      return { backend, binary, args, outBinary: out, logPath: join(outDir, "compile.log") }
    }
    case "vcs": {
      const filelist = join(outDir, "filelist.f")
      writeVcsFilelist(filelist, src.sources, src.includes, defs)
      const out = join(outDir, "simv")
      const logPath = join(outDir, "vcs_compile.log")
      const args = ["-sverilog", "+v2k", "-f", filelist, "-o", out]
      if (src.top) args.push("-top", src.top)
      args.push("-l", logPath)
      return { backend, binary, args, outBinary: out, logPath, filelistPath: filelist }
    }
  }
}

/** Diagnostic record parsed from tool output. */
export interface Diagnostic {
  file: string
  line: number | null
  severity: "error" | "warning" | "note"
  code: string
  message: string
}

// Best-effort diagnostics parsing per backend output dialect. Most listeners
// want file/line pairs from the compile log; anything unparsed stays omitted
// (never guessed).
export function parseDiagnostics(backend: BackendId, text: string): Diagnostic[] {
  const out: Diagnostic[] = []
  if (backend === "iverilog") {
    // forms: "file.v:12: error: msg" | "file.v:12: syntax error" | file.v:12: warning: msg
    const re = /^(\S+?\.[a-zA-Z]+):(\d+):(?:\s*(error|warning))?:?\s*(.*)$/gm
    for (const m of text.matchAll(re)) {
      const raw = m[4] ?? ""
      let severity: Diagnostic["severity"] = m[3] === "warning" ? "warning" : raw.toLowerCase().startsWith("syntax error") ? "error" : "error"
      if (!m[3] && raw.toLowerCase().startsWith("warning")) severity = "warning"
      out.push({ file: m[1], line: Number(m[2]), severity, code: raw.toLowerCase().startsWith("syntax error") ? "SYNTAX" : "IVL", message: raw.slice(0, 400) })
    }
  } else if (backend === "verilator") {
    // forms: "%Error: file.v:3:3: msg" | "%Warning-BLKSEQ: file.v:5:1: msg"
    const re = /%?(Error|Warning)(?:-([A-Za-z0-9_]+))?:?\s*(\S+?\.[a-zA-Z]+):(\d+):\d*:\s*(.*)$/gm
    for (const m of text.matchAll(re)) {
      out.push({ file: m[3], line: Number(m[4]), severity: m[1] === "Error" ? "error" : "warning", code: m[2] ?? m[1], message: m[5]?.slice(0, 400) ?? "" })
    }
  } else {
    // vcs: "Error-[CODE]\n" followed by '"file.v", N: msg' (line-based pairing)
    const warns = [...text.matchAll(/^(Error|Warning)-\[([^\]]+)\]\s*$/gm)]
    const locs = [...text.matchAll(/"([^"]+)"\s*,\s*(\d+)[:.]\s*(.*)$/gm)]
    let w = 0
    for (const l of locs) {
      const wm = warns[w] ?? null
      out.push({ file: l[1], line: Number(l[2]), severity: wm && wm[1] === "Warning" ? "warning" : "error", code: wm ? wm[2] : "VCS", message: (l[3] ?? "").slice(0, 400) })
      if (wm) w++
    }
  }
  return out.slice(0, 500)
}

export function probeAll(config?: SiliconConfig | null): BackendProbe[] {
  return BACKEND_IDS.map((b) => probeBackend(b, config))
}

export function runPlan(plan: LintPlan | CompilePlan, timeoutMs?: number): RunResult {
  return run(plan.binary, plan.args, { timeoutMs })
}