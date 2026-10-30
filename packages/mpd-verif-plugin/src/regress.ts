// mpd_verif_regress core: multi-case regression over one backend.
// cocotb lane (iverilog/verilator): per-case work dirs, seed = seedBase+idx
// (deterministic), each case runs through the sim core; results aggregated
// into <work>/regress/<stamp>/results.json + a markdown report.
// vcs lane: delegates to the UVM regress action (per-case work dirs contract).
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { dateSeedBase, workspaceRoot, workDir, runStamp, type BackendId } from "./env"
import { probeBackend } from "./backends"
import { requireCocotbVenv } from "./venv"
import { verifSim, type SimCase } from "./sim"
import { verifUvm, type VerifUvmResult } from "./uvm"
import { runWaveHooks, waveSessionDir, type WaveHookResult, type WaveTools } from "./wave"
import { VerifError } from "./errors"
import type { SiliconConfig } from "./silicon/config"

export interface RegressCase {
  backend: BackendId
  test: string
  seed: string
  status: "pass" | "fail" | "skip"
  timeMs: number
  wave?: { file: string; fmt: string } | null
  failureMsg?: string | null
}

export interface RegressResult {
  ok: boolean
  backend: BackendId
  total: number
  passed: number
  failed: number
  skipped: number
  seedBase: number
  cases: RegressCase[]
  resultsJson?: string
  reportMarkdown: string
  reportPath: string
  waveHooks: WaveHookResult[]
  error?: { code: string; message: string; hint: string }
}

export interface RegressArgs {
  backend: BackendId
  cases?: string[]
  glob?: string
  seedBase?: number
  maxFailures?: number
  stopOnError?: boolean
  waveHook?: boolean
  timeoutSec?: number
  sim?: {
    top?: string
    tbModules?: string[]
    sources?: string[]
    includes?: string[]
    defines?: Record<string, string | number> | string[]
    waves?: boolean
    traceFst?: boolean
    coverage?: boolean
  }
}

// Expand case names: explicit cases[]; else a glob over the workspace when
// provided; else for the cocotb lane a single "all" pass (cocotb runs every
// @cocotb.test in the tb module).
function expandCases(args: RegressArgs, exec?: any): { kind: "explicit"; names: string[] } {
  if (args.cases && args.cases.length > 0) return { kind: "explicit", names: args.cases }
  if (args.glob) {
    // cocotb lane glob: tb .py files under the workspace (basename = test module marker);
    // actual filtering still happens inside cocotb, names here are directory-local
    // entries for per-case seeding.
    const root = workspaceRoot(exec)
    return { kind: "explicit", names: globFiles(root, args.glob) }
  }
  return { kind: "explicit", names: ["all"] }
}

function globFiles(root: string, pattern: string): string[] {
  const out: string[] = []
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$")
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (!e.name.startsWith(".")) walk(p); continue }
      const rel = p.slice(root.length + 1)
      if (re.test(rel)) out.push(rel)
    }
  }
  walk(root)
  return out.slice(0, 100)
}

// R1 (gate ordering): the regress work directory is created ONLY after every
// lane gate has passed. A refusal (iron-rule venv gate, backend resolution, bad
// args) must never leave a directory behind, and a no-session call must surface
// the actionable VERIF_E_NO_VENV instead of an opaque host-root filesystem
// error (ENOENT/EROFS) from mkdirSync. Mirrors sim.ts: gate first, then the dir.
function createRegressDir(exec?: any): string {
  const regressDir = join(workDir(exec), "regress", runStamp())
  mkdirSync(regressDir, { recursive: true })
  return regressDir
}

export async function verifRegress(args: RegressArgs, tools?: WaveTools, exec?: any, config?: SiliconConfig | null): Promise<RegressResult> {
  const backend = args.backend
  if (!["iverilog", "verilator", "vcs"].includes(backend) || (backend as string) === "") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "unsupported regression backend: " + String(backend), "use iverilog | verilator (cocotb lane) or vcs (UVM lane)")
  }
  const seedBase = args.seedBase ?? dateSeedBase()

  if (backend === "vcs") {
    // UVM lane: require the vcs gate + top (ip root) — ipRoot reuses sim.top
    const top = args.sim?.top
    if (!top) throw new VerifError("VERIF_E_RUN", "vcs regression needs sim.top (the <ip> root for the UVM layout)", "pass sim.top=<ip-root>")
    const probe = probeBackend("vcs", config)
    if (!probe.present) throw new VerifError("VERIF_E_NO_BACKEND", "vcs not resolvable", "set MPD_DSH_VERIF_VCS or add $VCS_HOME/bin to PATH")
    const uvmRes: VerifUvmResult = await verifUvm({
      action: "regress",
      top,
      coverage: true,
      test: undefined,
      timeoutSec: args.timeoutSec,
      waveHook: args.waveHook !== false,
    }, tools)
    const cases: RegressCase[] = uvmRes.cases.map((c) => ({ backend: "vcs", test: c.test, seed: c.seed, status: c.status === "pass" ? "pass" : "fail", timeMs: 0, wave: c.wavefile ?? null, failureMsg: null }))
    const rep = buildReport("vcs", cases, seedBase)
    const regressDir = createRegressDir(exec)
    const resultsJson = join(regressDir, "results.json")
    writeFileSync(resultsJson, JSON.stringify({ backend, seedBase, total: cases.length, passed: cases.filter((c) => c.status === "pass").length, failed: cases.filter((c) => c.status === "fail").length, skipped: 0, cases }, null, 2))
    const reportPath = join(regressDir, "results.md")
    writeFileSync(reportPath, rep)
    return {
      ok: uvmRes.ok, backend, total: cases.length,
      passed: cases.filter((c) => c.status === "pass").length,
      failed: cases.filter((c) => c.status === "fail").length,
      skipped: 0,
      seedBase, cases, resultsJson, reportMarkdown: rep, reportPath, waveHooks: uvmRes.waveHooks,
      ...(uvmRes.ok ? {} : { error: uvmRes.error }),
    }
  }

  // cocotb lane (iverilog | verilator): iron-rule gate ONCE for the whole regression.
  const gate = requireCocotbVenv(undefined, exec)
  const probe = probeBackend(backend, config)
  if (!probe.present) throw new VerifError("VERIF_E_NO_BACKEND", `backend '${backend}' not found`, `install it or set MPD_DSH_VERIF_${backend.toUpperCase()}`)
  const expanded = expandCases(args)
  if (expanded.names.length === 0) throw new VerifError("VERIF_E_RUN", "no regression cases matched", "pass cases[] or a glob that matches tb modules")
  if (!args.sim?.top) throw new VerifError("VERIF_E_RUN", "regression needs sim.top (hdl_toplevel)", "pass sim.top=<toplevel-module>")
  if (!args.sim?.sources || args.sim.sources.length === 0) throw new VerifError("VERIF_E_RUN", "regression needs sim.sources", "pass sim.sources=[RTL files]")

  // Every refusal above happened BEFORE this point (R1): only a regression that
  // is certain to run creates its work directory.
  const regressDir = createRegressDir(exec)

  const cases: RegressCase[] = []
  const waveHooks: WaveHookResult[] = []
  let stop = false
  const maxFailures = args.maxFailures ?? 0
  for (let idx = 0; idx < expanded.names.length && !stop; idx++) {
    const name = expanded.names[idx]
    const seed = String(seedBase + idx)
    try {
      const r = await verifSim({
        backend,
        top: args.sim.top,
        tbModules: args.sim.tbModules,
        sources: args.sim.sources,
        includes: args.sim.includes,
        defines: args.sim.defines,
        testFilter: name === "all" ? undefined : name,
        seed,
        waves: args.sim.waves ?? true,
        traceFst: args.sim.traceFst ?? true,
        coverage: args.sim.coverage ?? false,
        timeoutSec: args.timeoutSec,
        waveHook: false,
      }, {}, exec, config)
      const status: RegressCase["status"] = r.ok && r.cases.length > 0 && r.cases.every((c: SimCase) => c.status === "pass") ? "pass" : "fail"
      const wave = r.wavesfiles[0] ? { file: r.wavesfiles[0].file, fmt: r.wavesfiles[0].fmt } : null
      cases.push({ backend, test: name, seed, status, timeMs: r.cases.reduce((s2, c) => s2 + c.timeMs, 0), wave, failureMsg: r.error?.message ?? null })
      if (args.waveHook !== false && wave) {
        waveHooks.push(...await runWaveHooks(tools ?? {}, { wavefile: { file: wave.file, fmt: wave.fmt as "fst" | "vcd" | "fsdb" }, top: args.sim.top, sessionDir: waveSessionDir(join(workDir(exec), "sim")), caseDir: r.caseDir, lane: "oss" }))
      }
    } catch (e) {
      const re = refusalOfLike(e)
      cases.push({ backend, test: name, seed, status: "fail", timeMs: 0, wave: null, failureMsg: re.message })
      waveHooks.push({ status: "failed", server: "wave_mcp", tool: null, message: re.message })
    }
    const failed = cases.filter((c) => c.status === "fail").length
    if (maxFailures > 0 && failed >= maxFailures) stop = true
    if (args.stopOnError && failed > 0) stop = true
  }
  void gate
  const passed = cases.filter((c) => c.status === "pass").length
  const failedN = cases.filter((c) => c.status === "fail").length
  const skipped = cases.filter((c) => c.status === "skip").length
  const rep = buildReport(backend, cases, seedBase)
  const resultsJson = join(regressDir, "results.json")
  writeFileSync(resultsJson, JSON.stringify({ backend: backend, seedBase, total: cases.length, passed, failed: failedN, skipped, cases: cases.map(({ wave, ...rest }) => rest) }, null, 2))
  const reportPath = join(regressDir, "results.md")
  writeFileSync(reportPath, rep)
  return {
    ok: failedN === 0 && cases.length > 0,
    backend, total: cases.length, passed, failed: failedN, skipped,
    seedBase, cases, resultsJson, reportMarkdown: rep, reportPath, waveHooks,
    ...(failedN === 0 ? {} : { error: { code: "VERIF_E_RUN", message: `${failedN} of ${cases.length} regression case(s) failed`, hint: `read ${reportPath} and the per-case logs under ${regressDir}/../sim` } }),
  }
}

function refusalOfLike(e: unknown): { code: string; message: string; hint: string } {
  if (e instanceof VerifError) return { code: e.code, message: e.message, hint: e.hint }
  return { code: "VERIF_E_RUN", message: String(e), hint: "inspect the per-case log" }
}

function buildReport(backend: BackendId, cases: RegressCase[], seedBase: number): string {
  const lines = [
    `# RTL regression report (${backend})`,
    "",
    `- seedBase: ${seedBase}`,
    `- cases: ${cases.length}, passed: ${cases.filter((c) => c.status === "pass").length}, failed: ${cases.filter((c) => c.status === "fail").length}, skipped: ${cases.filter((c) => c.status === "skip").length}`,
    "",
    "| case | seed | status | time(ms) | wave | notes |",
    "| --- | --- | --- | --- | --- | --- |",
  ]
  for (const c of cases) {
    lines.push(`| ${c.test} | ${c.seed} | ${c.status} | ${Math.round(c.timeMs)} | ${c.wave ? c.wave.fmt : "-"} | ${esc(c.failureMsg ?? "")} |`)
  }
  return lines.join("\n") + "\n"
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160)
}