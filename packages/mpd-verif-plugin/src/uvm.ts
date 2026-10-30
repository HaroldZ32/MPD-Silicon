// mpd_verif_uvm core — the UVM methodology lane, GATED TO VCS ONLY (owner
// decision: cocotb owns iverilog/verilator; UVM exclusively rides VCS).
// Methodology grounded in gen-tb-skill's STRUCTURE (makefile contract: UVM_VER
// 1.2, seed default, per-case work/work_<case>_ dirs, -cm line+cond+tgl with
// urg merge, capped compile-fix attempts writing unresolved.md) and
// raysalemi/uvmprimer METHODOLOGY patterns (env/agent/sequence layering) —
// methodology reference ONLY: no code is copied from either repository.
// The plugin ships NO template content: it validates the layout contract and
// orchestrates user-scaffolded UVM trees (rich skeletons live in the
// skills/rtl-verif corpus, t5).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runStamp, workDir } from "./env"
import { probeBackend } from "./backends"
import { resolveEdaTool, runFsdbreport, FSDBREPORT_HINT } from "./eda-tools"
import { run, writeLog, DEFAULT_TIMEOUT_MS } from "./run"
import { VerifError } from "./errors"
import { collectWaves } from "./sim"
import { runWaveHooks, waveSessionDir, type WaveHookResult, type WaveTools } from "./wave"

export type UvmAction = "compile" | "run" | "regress" | "wave" | "merge-cov" | "clean"

export interface VerifUvmArgs {
  action: UvmAction
  top: string
  filelist?: string
  includes?: string[]
  defines?: string[]
  test?: string
  uvmVer?: string
  seed?: number | string
  coverage?: boolean
  waveFmt?: "fsdb" | "vcd"
  verbosity?: string
  timeoutSec?: number
  waveHook?: boolean
}

export interface UvmCaseResult {
  test: string
  seed: string
  status: "pass" | "fail"
  exitCode: number | null
  logPath: string
  uvmErrors: number | null
  wavefile?: { file: string; fmt: string } | null
}

export interface FsdbreportHook {
  status: "ok" | "failed" | "unavailable"
  binary: string | null
  args: string[]
  exitCode: number | null
  logPath: string
  message: string
}

export interface VerifUvmResult {
  ok: boolean
  action: UvmAction
  backend: "vcs"
  binary: string
  verbosity: string
  uvmVer: string
  args: string[]
  exitCode: number | null
  logPath: string
  simv: string
  root: string
  cases: UvmCaseResult[]
  wavesfiles: { file: string; fmt: string }[]
  waveHooks: WaveHookResult[]
  fsdbReports?: FsdbreportHook[]
  attempts: number
  maxAttempts: number
  unresolved: boolean
  covReport?: string
  layoutErrors: string[]
  error?: { code: string; message: string; hint: string }
}

// Percent-expand a template path holding <ip> (e.g. "<ip>/rtl") into the
// concrete tree paths; all paths stay under the given root (no escapes).
export function ipDir(root: string, p: string): string {
  return join(root, p.replace(/^<ip>\/?/, ""))
}

export const LAYOUT_DIRS = ["rtl", "script", "tb", "top", "test", "work"]
export const LAYOUT_REQUIRED_FILES = ["tb_api_primitives.svh"]
export const LAYOUT_MANDATORY_TESTS = ["sanity_test", "reg_access_test"]
export const MAX_COMPILE_ATTEMPTS = 3

const DEFAULT_VERBOSITY = "UVM_MEDIUM"

// Template-layout contract: tree <ip>/{rtl,script,tb,top,test,work/},
// tb_api_primitives.svh single-BFM source of truth, <test>/*_test.sv naming,
// mandatory sanity_test + reg_access_test. Missing pieces -> VERIF_E_TEMPLATE.
export function layoutCheck(ipRoot: string): { ok: boolean; errors: string[]; tests: string[] } {
  const errors: string[] = []
  if (!existsSync(ipRoot)) {
    return { ok: false, errors: [`missing ip root: <ip> (${ipRoot})`], tests: [] }
  }
  for (const d of LAYOUT_DIRS) {
    if (!existsSync(join(ipRoot, d))) errors.push(`missing dir: ${d}/`)
  }
  for (const f of LAYOUT_REQUIRED_FILES) {
    if (!existsSync(join(ipRoot, "tb", f)) && !findFile(ipRoot, f)) errors.push(`missing shared BFM source of truth: ${f} (expected under <ip>/tb/)`)
  }
  const testDir = join(ipRoot, "test")
  const tests: string[] = []
  if (existsSync(testDir)) {
    for (const e of readdirSync(testDir)) {
      if (e.endsWith("_test.sv")) tests.push(e.slice(0, -3))
    }
  }
  if (tests.length === 0) errors.push("no *_test.sv cases found in test/ (naming contract: <case>_test.sv)")
  for (const t of LAYOUT_MANDATORY_TESTS) {
    if (!tests.includes(t)) errors.push(`mandatory test missing: ${t}_test.sv (sanity_test + reg_access_test are required by the UVM contract)`)
  }
  return { ok: errors.length === 0, errors, tests }
}

function findFile(dir: string, name: string): boolean {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory() && !e.name.startsWith(".")) {
      if (findFile(p, name)) return true
    } else if (e.name === name) return true
  }
  return false
}

// Default thread-random seed per the gen-tb makefile contract (date+1%N —
// structure reference only): here the date seed base plus process variation.
export function defaultUvmSeed(): number {
  const base = Number(String(Date.now()).slice(0, 10)) // epoch seconds
  return base % 1_000_000
}

function resolveVcsBinary(): string {
  const probe = probeBackend("vcs")
  if (!probe.present || !probe.binary) {
    throw new VerifError("VERIF_E_NO_BACKEND", "vcs is not resolvable on this machine", "set MPD_DSH_VERIF_VCS or add $VCS_HOME/bin to PATH; license vars: VCS_HOME, LM_LICENSE_FILE, SNPSLMD_LICENSE_FILE")
  }
  return probe.binary
}

function envGate(needs: string[], reason: string): void {
  const missing = needs.filter((k) => !process.env[k] || process.env[k]!.trim().length === 0)
  if (missing.length > 0) {
    throw new VerifError("VERIF_E_ENV", `${reason} requires: ${needs.join(", ")} — missing: ${missing.join(", ")}`, "export the listed variables in the launching shell (VERDI_HOME/NOVAS_HOME/VCS_HOME + license vars), then retry")
  }
}

function resolveFilelist(args: VerifUvmArgs, ipRoot: string): string {
  if (args.filelist && existsSync(args.filelist)) return args.filelist
  const auto = join(ipRoot, "script", "filelist.f")
  if (existsSync(auto)) return auto
  throw new VerifError("VERIF_E_TEMPLATE", `no filelist: neither the filelist argument nor <ip>/script/filelist.f exists`, `create ${auto} (rtl files + tb_api_primitives.svh + testbench sources) or pass filelist=<path>`)
}

interface CompileEntry { args: string[]; logPath: string; simv: string; covDir: string | null }

function compileArgs(vcs: string, args: VerifUvmArgs, ipRoot: string, wdir: string): CompileEntry {
  const uvmVer = args.uvmVer ?? "1.2"
  const filelist = resolveFilelist(args, ipRoot)
  const covDir = args.coverage ? join(wdir, "cov", "compile") : null
  const withDebug = args.action === "wave" || args.action === "regress" && args.coverage
  const argv = [vcs, "-sverilog", "+v2k", "-ntb_opts", `uvm-${uvmVer}`]
  if (withDebug || args.action === "wave") argv.push("-debug_access+all")
  if (args.action === "wave") argv.push("-kdb")
  if (covDir) argv.push("-cm", "line+cond+tgl", "-cm_dir", covDir)
  for (const i of args.includes ?? []) argv.push("+incdir+" + i)
  for (const d of args.defines ?? []) argv.push("+define+" + d)
  argv.push("-f", filelist, "-l", join(wdir, "vcs_compile.log"), "-o", join(wdir, "simv"))
  return { args: argv, logPath: join(wdir, "vcs_compile.log"), simv: join(wdir, "simv"), covDir }
}

function runArgs(simv: string, args: VerifUvmArgs, test: string, caseDir: string, covDir: string | null): string[] {
  const argv = [simv, "+UVM_TESTNAME=" + test, "+UVM_VERBOSITY=" + (args.verbosity ?? DEFAULT_VERBOSITY)]
  if (args.seed !== undefined) argv.push("+ntb_random_seed=" + String(args.seed))
  if (covDir) argv.push("-cm", "line+cond+tgl", "-cm_dir", covDir)
  argv.push("-l", join(caseDir, "run.log"))
  return argv
}

function countUvmErrors(logText: string): number | null {
  const m = logText.match(/UVM_ERROR\s*:\s*(\d+)/)
  return m ? Number(m[1]) : logText.includes("UVM_ERROR") ? 1 : 0
}

// fsdbreport non-GUI verification hook (owner DP-11): reports FSDB dump
// integrity/warnings without opening Verdi. Binary resolution: env seam,
// VCS_HOME/VERDI_HOME/NOVAS_HOME/bin, PATH — degrades with an actionable hint.
export function runFsdbreportHooks(wavesfiles: { file: string; fmt: string }[], reportDir: string): FsdbreportHook[] {
  const out: FsdbreportHook[] = []
  const tool = resolveEdaTool("fsdbreport")
  for (const w of wavesfiles.filter((f) => f.fmt === "fsdb")) {
    if (!tool) {
      out.push({ status: "unavailable", binary: null, args: [], exitCode: null, logPath: "", message: "fsdbreport not wired — " + FSDBREPORT_HINT })
      continue
    }
    const logPath = join(reportDir, "fsdbreport.log")
    const r = runFsdbreport(tool.binary, w.file, 120_000)
    writeLog(logPath, r.combined)
    out.push(r.status === 0
      ? { status: "ok", binary: tool.binary, args: [w.file], exitCode: r.status, logPath, message: "FSDB report clean for " + w.file }
      : { status: "failed", binary: tool.binary, args: [w.file], exitCode: r.status, logPath, message: "fsdbreport flagged issues in " + w.file + (r.combined ? ": " + r.combined.slice(0, 200) : "") })
  }
  return out
}

function runCase(vcs: string, args: VerifUvmArgs, simv: string, test: string, caseDir: string, covBase: string | null, timeoutMs: number): UvmCaseResult {
  mkdirSync(caseDir, { recursive: true })
  const seed = args.seed !== undefined ? String(args.seed) : String(defaultUvmSeed())
  const covDir = covBase ? join(covBase, `work_${test}_`) : null
  const argv = runArgs(simv, { ...args, seed }, test, caseDir, covDir)
  const logPath = join(caseDir, "run.log")
  const r = run(argv[0], argv.slice(1), { cwd: caseDir, timeoutMs })
  // VCS writes its run log via -l; the captured stream is supplementary.
  if (r.combined.trim().length > 0) writeLog(logPath, r.combined)
  const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
  const uvmErrors = countUvmErrors(logText.trim().length > 0 ? logText : r.combined)
  const waves = collectWaves(caseDir)
  return {
    test,
    seed,
    status: r.status === 0 && uvmErrors === 0 ? "pass" : "fail",
    exitCode: r.status,
    logPath,
    uvmErrors,
    wavefile: waves[0] ? { file: waves[0].file, fmt: waves[0].fmt } : null,
  }
}

export interface CompileState { attempts: number; maxAttempts: number; unresolved: boolean }

function readCompileState(wdir: string): CompileState {
  const p = join(wdir, "compile-state.json")
  try { return { ...{ attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false }, ...JSON.parse(readFileSync(p, "utf8")) } } catch { return { attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false } }
}

function writeCompileState(wdir: string, s: CompileState): void {
  try { writeFileSync(join(wdir, "compile-state.json"), JSON.stringify(s)) } catch { /* state is best-effort */ }
}

export async function verifUvm(a: VerifUvmArgs, tools?: WaveTools, exec?: any): Promise<VerifUvmResult> {
  const vcs = resolveVcsBinary()
  if (a.action === "wave") envGate(["VERDI_HOME", "NOVAS_HOME"].filter((k) => k && k.length > 0), "wave dumping (fsdb)")
  const ipRoot = a.top
  const wdir = join(ipRoot, "work")
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000

  if (a.action === "clean") {
    try { rmSync(wdir, { recursive: true, force: true }) } catch { /* best-effort */ }
    return { ok: true, action: "clean", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2", args: ["rm", "-rf", wdir], exitCode: 0, logPath: "", simv: join(wdir, "simv"), root: ipRoot, cases: [], wavesfiles: [], waveHooks: [], attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: [] }
  }

  const layout = a.action === "merge-cov" ? { ok: true, errors: [], tests: [] } : layoutCheck(ipRoot)
  if (!layout.ok) {
    throw new VerifError("VERIF_E_TEMPLATE", "UVM template layout contract violated under " + ipRoot, "expected tree <ip>/{rtl,script,tb,top,test,work/}, tb/tb_api_primitives.svh, test/<case>_test.sv with mandatory sanity_test + reg_access_test — missing: " + layout.errors.join("; "))
  }
  if (a.uvmVer && a.uvmVer !== "1.2" && a.uvmVer !== "1.1") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "unsupported UVM version " + a.uvmVer, "UVM contract targets uvmVer 1.2 (1.1 accepted for legacy benches)")
  }

  mkdirSync(wdir, { recursive: true })
  const stamp = runStamp()

  if (a.action === "compile") {
    const plan = compileArgs(vcs, a, ipRoot, wdir)
    const r = run(plan.args[0], plan.args.slice(1), { timeoutMs })
    writeLog(plan.logPath, r.combined)
    const state = readCompileState(wdir)
    if (r.status !== 0) {
      state.attempts += 1
      state.unresolved = state.attempts >= state.maxAttempts
      writeCompileState(wdir, state)
      // honest capped-attempts handoff (gen-tb makefile contract, structure only)
      if (state.unresolved) writeLog(join(wdir, "unresolved.md"), "# unresolved compile issues (attempts exhausted)\n\n" + r.combined.slice(-8000))
      return {
        ok: false, action: "compile", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2",
        args: plan.args, exitCode: r.status, logPath: plan.logPath, simv: plan.simv, root: ipRoot, cases: [], wavesfiles: [], waveHooks: [],
        attempts: state.attempts, maxAttempts: state.maxAttempts, unresolved: state.unresolved, layoutErrors: layout.errors,
        error: { code: "VERIF_E_COMPILE", message: `vcs compile failed (exit ${r.status}); attempt ${state.attempts}/${state.maxAttempts}`, hint: state.unresolved ? `attempt cap reached — fix issues recorded in ${join(wdir, "unresolved.md")}, then rerun` : `read ${plan.logPath}, fix the first error, then re-run compile (attempts are tracked)` },
      }
    }
    writeCompileState(wdir, { attempts: 0, maxAttempts: state.maxAttempts, unresolved: false })
    return {
      ok: true, action: "compile", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2",
      args: plan.args, exitCode: r.status, logPath: plan.logPath, simv: plan.simv, root: ipRoot, cases: [], wavesfiles: [], waveHooks: [],
      attempts: 0, maxAttempts: state.maxAttempts, unresolved: false, layoutErrors: layout.errors,
    }
  }

  const simvExists = existsSync(join(wdir, "simv"))
  if (!simvExists && a.action !== "regress" && a.action !== "merge-cov") {
    throw new VerifError("VERIF_E_RUN", `no compiled simv under ${wdir}; run action:"compile" first`, "call mpd_verif_uvm with action compile, then retry")
  }
  const simv = join(wdir, "simv")

  if (a.action === "run") {
    const test = a.test ?? "sanity_test"
    if (!layout.tests.includes(test) && !test.endsWith("_test")) {
      throw new VerifError("VERIF_E_TEMPLATE", `test '${test}' is not listed in test/ (*_test.sv contract)`, "pass test=<case> matching a *_test.sv file, or scaffold it under test/")
    }
    const caseDir = join(wdir, `work_${test}_`)
    const c = runCase(vcs, a, simv, test, caseDir, a.coverage ? join(wdir, "cov") : null, timeoutMs)
    const wavesfiles = collectWaves(caseDir)
    const waveHooks = a.waveHook === false ? [] : await safeHooks(tools, { wavefile: wavesfiles[0] ?? null, top: test, sessionDir: waveSessionDir(caseDir), caseDir, simLog: c.logPath, verifRoot: ipRoot, caseName: test, lane: "vcs" })
    return {
      ok: c.status === "pass", action: "run", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2",
      args: runArgs(simv, a, test, caseDir, null), exitCode: c.exitCode, logPath: c.logPath, simv, root: ipRoot,
      cases: [c], wavesfiles, waveHooks, fsdbReports: runFsdbreportHooks(wavesfiles, caseDir), attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: layout.errors,
      ...(c.status === "pass" ? {} : { error: { code: "VERIF_E_RUN", message: `UV M test '${test}' failed (uvm_errors=${c.uvmErrors ?? "?"})`, hint: `read ${c.logPath}; wave via wave-mcp/TraceWeave if wired` } }),
    }
  }

  if (a.action === "wave") {
    const test = a.test ?? "sanity_test"
    const caseDir = join(wdir, `work_${test}_wave`)
    const c = runCase(vcs, a, simv, test, caseDir, null, timeoutMs)
    const wavesfiles = collectWaves(caseDir)
    const waveHooks = a.waveHook === false ? [] : await safeHooks(tools, { wavefile: wavesfiles[0] ?? null, top: test, sessionDir: waveSessionDir(caseDir), caseDir, simLog: c.logPath, verifRoot: ipRoot, caseName: test, lane: "vcs" })
    return {
      ok: c.status === "pass", action: "wave", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2",
      args: runArgs(simv, a, test, caseDir, null), exitCode: c.exitCode, logPath: c.logPath, simv, root: ipRoot,
      cases: [c], wavesfiles, waveHooks, fsdbReports: runFsdbreportHooks(wavesfiles, caseDir), attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: layout.errors,
      ...(wavesfiles.length === 0 ? { error: { code: "VERIF_E_RUN", message: "wave run produced no fsdb/vcd", hint: "dump $fsdbDumpfile inside the TB (FSDB contract) and retry wave" } } : {}),
    }
  }

  if (a.action === "regress") {
    const covSeed = a.coverage ? join(wdir, "cov") : null
    const cases: UvmCaseResult[] = []
    const simvNow = existsSync(simv) ? simv : (() => {
      const plan = compileArgs(vcs, a, ipRoot, wdir)
      const rc = run(plan.args[0], plan.args.slice(1), { timeoutMs })
      writeLog(plan.logPath, rc.combined)
      if (rc.status !== 0) throw new VerifError("VERIF_E_COMPILE", `regress pre-compile failed (exit ${rc.status})`, `read ${plan.logPath} and rerun`)
      return plan.simv
    })()
    for (const t of layout.tests) {
      const caseDir = join(wdir, `work_${t}_`, stamp)
      cases.push(runCase(vcs, a, simvNow, t, caseDir, covSeed, timeoutMs))
    }
    const ok = cases.every((c) => c.status === "pass")
    const wavesfiles = cases.map((c) => c.wavefile).filter((w): w is { file: string; fmt: string } => Boolean(w))
    const regHooks: WaveHookResult[] = []
    if (a.waveHook !== false) {
      for (const c of cases) {
        if (!c.wavefile || regHooks.length >= 10) continue
        regHooks.push(...await safeHooks(tools, { wavefile: { file: c.wavefile.file, fmt: c.wavefile.fmt as "fst" | "vcd" | "fsdb" }, top: c.test, sessionDir: waveSessionDir(wdir), caseDir: wdir, simLog: c.logPath, verifRoot: ipRoot, caseName: c.test, lane: "vcs" }))
      }
    }
    return {
      ok, action: "regress", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2",
      args: [], exitCode: ok ? 0 : 1, logPath: join(wdir, `regress-${stamp}.md`), simv: simvNow, root: ipRoot,
      cases, wavesfiles, waveHooks: regHooks, fsdbReports: runFsdbreportHooks(wavesfiles, wdir),
      attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: layout.errors,
      ...(ok ? {} : { error: { code: "VERIF_E_RUN", message: `${cases.filter((c) => c.status !== "pass").length} of ${cases.length} UVM case(s) failed`, hint: "read the per-case run logs under work/work_<case>_/" } }),
    }
  }

  // merge-cov
  const covRoot = join(wdir, "cov")
  if (!existsSync(covRoot)) {
    throw new VerifError("VERIF_E_RUN", "no coverage data: " + covRoot, "run compile/regress with coverage:true before merging")
  }
  const urg = process.env.MPD_DSH_VERIF_URG ?? join(process.env.VCS_HOME ?? "/usr", "bin", "urg")
  const dirs = readdirSync(covRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(covRoot, e.name))
  if (dirs.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no coverage directory content under " + covRoot, "enable coverage on compile/run and re-run the regression")
  }
  const reportDir = join(wdir, "cov_report")
  const argv = [urg, ...dirs.flatMap((d) => ["-dir", d]), "-report", reportDir, "-format", "both"]
  const r = run(argv[0], argv.slice(1), { timeoutMs })
  return {
    ok: r.status === 0, action: "merge-cov", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2",
    args: argv, exitCode: r.status, logPath: join(wdir, "urg.log"), simv, root: ipRoot,
    cases: [], wavesfiles: [], waveHooks: [], attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: layout.errors,
    covReport: reportDir,
    ...(r.status === 0 ? {} : { error: { code: "VERIF_E_ENV", message: "urg merge failed", hint: "ensure urg is available (VCS_HOME/bin or MPD_DSH_VERIF_URG)" } }),
  }
}

async function safeHooks(tools: WaveTools | undefined, req: Parameters<typeof runWaveHooks>[1]): Promise<WaveHookResult[]> {
  try {
    return await runWaveHooks(tools ?? {}, req)
  } catch (e) {
    return [{ status: "failed", server: "traceweave", tool: null, message: "wave hook error: " + String(e) }]
  }
}