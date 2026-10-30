// EDA helper-tool resolution and argv builders shared by the coverage core and
// the VCS/UVM lane: Synopsys urg (coverage merge/report) and fsdbreport
// (non-GUI FSDB integrity/warning report). Resolution: MPD_DSH_VERIF_URG /
// MPD_DSH_VERIF_FSDBREPORT first, then VCS_HOME / VERDI_HOME / NOVAS_HOME bin
// dirs, then PATH. Nothing is vendored; everything degrades with a hint.
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { run, type RunResult } from "./run"

export function resolveEdaTool(name: "urg" | "fsdbreport"): { binary: string; source: string } | null {
  const envKey = name === "urg" ? "MPD_DSH_VERIF_URG" : "MPD_DSH_VERIF_FSDBREPORT"
  const envVal = process.env[envKey]
  if (envVal && envVal.trim().length > 0) return { binary: envVal.trim(), source: "env:" + envKey }
  const homes = ["VCS_HOME", "VERDI_HOME", "NOVAS_HOME"]
  for (const h of homes) {
    const root = process.env[h]
    if (!root) continue
    const f = join(root, "bin", name)
    if (existsSync(f)) return { binary: f, source: h }
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0) continue
    const f = join(dir, name)
    if (existsSync(f)) return { binary: f, source: "path" }
  }
  return null
}

export const FSDBREPORT_HINT =
  "install/point fsdbreport: MPD_DSH_VERIF_FSDBREPORT=<path>, or export VCS_HOME/VERDI_HOME/NOVAS_HOME so <home>/bin/fsdbreport resolves"
export const URG_HINT =
  "install/point urg: MPD_DSH_VERIF_URG=<path>, or export VCS_HOME so <VCS_HOME>/bin/urg resolves"

// urg merge+report over per-case coverage dirs (gen-tb makefile contract,
// structure reference only): urg -dir <each> -report <reportDir> [-format both]
export function urgMergeArgv(covDirs: string[], reportDir: string, format?: string): string[] {
  const argv = ["urg"]
  for (const d of covDirs) argv.push("-dir", d)
  argv.push("-report", reportDir)
  if (format) argv.push("-format", format)
  return argv
}

// fsdbreport non-GUI verification hook: fsdbreport <file.fsdb> prints the dump
// integrity/warning report without opening the GUI (owner decision DP-11).
export function runFsdbreport(binary: string, fsdbPath: string, timeoutMs: number): RunResult {
  return run(binary, [fsdbPath], { timeoutMs })
}

// Collect coverage payload ROOTS under a scan root (bounded walk): urg walks
// a -dir root recursively, so cov/coverage dirs are the primary payloads; when
// none exist, per-case work_*/sim_vdb* dirs are collected directly.
export function collectCovDirs(root: string, max = 50): string[] {
  const roots: string[] = []
  const fallback: string[] = []
  const walk = (dir: string): void => {
    if (roots.length >= max) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const p = join(dir, e.name)
      if (/^(cov|coverage)$/.test(e.name)) { roots.push(p); continue }
      if (e.name.startsWith("work_") || e.name.startsWith("sim_vdb")) { fallback.push(p) }
      walk(p)
    }
  }
  walk(root)
  return (roots.length > 0 ? roots : fallback).slice(0, max)
}

export function collectDatFiles(root: string, max = 100): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(dir) || out.length >= max) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      // Verilator drops `<top>__verFiles.dat` build metadata into sim_build; it is
      // NOT coverage and verilator_coverage rejects it ("Malformed coverage point,
      // without a count"). Only real data files (coverage.dat) are merged.
      else if (e.name.endsWith(".dat") && !e.name.endsWith("__verFiles.dat")) out.push(p)
    }
  }
  walk(root)
  return out.slice(0, max)
}
