// mpd_verif_sim core — the cocotb lane (iverilog | verilator ONLY).
// Flow (owner decision DP-6, cocotb MAKEFILE flow): (1) IRON GATE — venv
// exists AND cocotb imports inside it, else refuse with the exact setup
// command; (2) backend resolve; (3) generate <work>/sim/<top>-<stamp>/Makefile
// (SIM/TOPLEVEL_LANG/VERILOG_SOURCES/COMPILE_ARGS/WAVES contract, verilator
// +--trace-fst for FST); (4) exec `make -f <Makefile> sim` with $VENV/bin FIRST,
// then the resolved backend tool dir (bare iverilog/vvp/verilator for cocotb),
// then the inherited PATH; (5) parse COCOTB_RESULTS_FILE results.xml into per-case statuses; (6) collect
// waveforms and (optionally) hand them to the user-wired wave-mcp MCP tool.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { run, writeLog, DEFAULT_TIMEOUT_MS } from "./run"
import { workspaceRoot, workDir, runStamp, resolveBackendBinary } from "./env"
import { probeBackend, normalizeDefines } from "./backends"
import { requireCocotbVenv } from "./venv"
import { VerifError } from "./errors"
import type { SiliconConfig } from "./silicon/config"
import { runWaveHooks, waveSessionDir, type Wavefile, type WaveHookResult, type WaveTools } from "./wave"

export interface VerifSimArgs {
  backend: "iverilog" | "verilator" | "vcs"
  top: string
  tbModules?: string[]
  sources: string[]
  includes?: string[]
  defines?: Record<string, string | number> | string[]
  testFilter?: string
  seed?: number | string
  waves?: boolean
  traceFst?: boolean
  coverage?: boolean
  timeoutSec?: number
  waveHook?: boolean
}

export interface SimCase {
  name: string
  status: "pass" | "fail" | "error" | "skip"
  timeMs: number
  failureMsg: string | null
}

export interface VerifSimResult {
  ok: boolean
  backend: "iverilog" | "verilator"
  top: string
  venv: string
  cocotbVersion: string
  seed: string | null
  cases: SimCase[]
  resultsXml: string | null
  simLog: string
  makefilePath: string
  caseDir: string
  wavesfiles: Wavefile[]
  waveHooks: WaveHookResult[]
  exitCode: number | null
  error?: { code: string; message: string; hint: string }
}

export interface SimDeps {
  /** DSH ToolRuntime-ish handle for waveform MCP tool calls (may be partial/missing) */
  tools?: WaveTools
}

// JSON value -> python literal (safe, no shell interpolation ever involved).
export function py(v: unknown): string {
  if (v === null || v === undefined) return "None"
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "True" : "False"
  if (Array.isArray(v)) return "[" + v.map(py).join(", ") + "]"
  if (typeof v === "object") return "{" + Object.entries(v as Record<string, unknown>).map(([k, val]) => JSON.stringify(k) + ": " + py(val)).join(", ") + "}"
  return JSON.stringify(String(v))
}

/** POSIX single-quote one word for a generated #!/bin/sh shim. */
function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

/**
 * Neutralize a simulator WRAPPER that breaks cocotb's embedded Python.
 *
 * MEASURED (`/opt/openictool/oss-cad-suite/bin/vvp`): the oss-cad-suite vvp is a
 * bash wrapper that UNCONDITIONALLY `export PYTHONHOME="<oss root>"`. The cocotb
 * VPI embeds libpython, which then initializes against that home and dies with
 * "failed to get the Python codec of the filesystem encoding". Removing the
 * variable from the make environment cannot help — the wrapper re-adds it — so
 * when the wrapper AND its bundled-loader layout are detected, emit a two-file
 * shim dir (cocotb's ICARUS_BIN_DIR contract): `iverilog` is forwarded unchanged,
 * `vvp` runs the real `libexec/vvp` through the same loader with PYTHONHOME unset.
 *
 * Returns null (no shim, no behaviour change) for a normal vvp binary.
 */
export function writeIcarusShimDir(caseDir: string, iverilogBinary: string, vvpBinary: string): string | null {
  if (!existsSync(vvpBinary)) return null
  let text = ""
  try { text = readFileSync(vvpBinary, "utf8") } catch { return null }
  if (!text.includes("PYTHONHOME") || !/^\s*exec\s/m.test(text)) return null
  const top = dirname(dirname(vvpBinary))
  const loader = join(top, "lib", "ld-linux-x86-64.so.2")
  const inner = join(top, "libexec", "vvp")
  if (!existsSync(loader) || !existsSync(inner)) return null
  const shimDir = join(caseDir, "toolshim")
  mkdirSync(shimDir, { recursive: true })
  const iverilogShim = join(shimDir, "iverilog")
  const vvpShim = join(shimDir, "vvp")
  writeFileSync(iverilogShim, "#!/bin/sh\nexec " + shellQuote(iverilogBinary) + " \"$@\"\n")
  writeFileSync(
    vvpShim,
    "#!/bin/sh\n" +
      "# oss-cad-suite's vvp wrapper exports PYTHONHOME; run the real binary without it.\n" +
      "exec env -u PYTHONHOME " + shellQuote(loader) + " --inhibit-cache --inhibit-rpath \"\" --library-path " + shellQuote(join(top, "lib")) + " " + shellQuote(inner) + " \"$@\"\n",
  )
  chmodSync(iverilogShim, 0o755)
  chmodSync(vvpShim, 0o755)
  return shimDir
}

// Generate the cocotb standard Makefile (cocotb 2.0.1 makefiles live under
// cocotb_tools/makefiles; SIM/SIM_BUILD/COCOTB_* variables are the official
// contract). Execution drives `make -f <case>/Makefile sim` with $VENV/bin
// PREPENDED to PATH, so cocotb-config and every nested python resolve to the
// venv python (iron rule, DP-6 Makefile flow per owner decision).
export function buildSimMakefile(a: {
  backend: "iverilog" | "verilator"
  top: string
  sources: string[]
  includes: string[]
  defines: Record<string, string | number>
  waves: boolean
  traceFst?: boolean
  coverage?: boolean
  /** Shim dir for a wrapper-based iverilog install; cocotb uses <dir>/iverilog and <dir>/vvp. */
  icarusBinDir?: string
}): string {
  const lines: string[] = [
    "# Generated by mpd_verif_sim (cocotb Makefile flow). Regenerated on every run — do not edit.",
    "",
  ]
  lines.push(
    "SIM := " + (a.backend === "iverilog" ? "icarus" : "verilator"), // cocotb's simulator name: icarus, not iverilog
    "TOPLEVEL_LANG := verilog",
    "COCOTB_TOPLEVEL := " + a.top,
  )
  // Makefile.icarus derives CMD from ICARUS_BIN_DIR and runs <dir>/vvp; the shim
  // dir exists only when the resolved vvp wrapper needed neutralizing.
  if (a.backend === "iverilog" && a.icarusBinDir !== undefined) lines.push("ICARUS_BIN_DIR := " + a.icarusBinDir)
  lines.push("VERILOG_SOURCES =" + (a.sources.length > 0 ? " \\" : "") )
  for (const f of a.sources) lines.push("    " + f + (f !== a.sources[a.sources.length - 1] ? " \\" : ""))
  if (a.includes.length > 0) {
    lines.push("VERILOG_INCLUDE_DIRS =" + (a.includes.length > 0 ? " \\" : ""))
    for (const d of a.includes) lines.push("    " + d + (d !== a.includes[a.includes.length - 1] ? " \\" : ""))
  }
  for (const [k, v] of Object.entries(a.defines)) lines.push("COMPILE_ARGS += +define+" + k + (v === 1 ? "" : "=" + v))
  if (a.backend === "verilator") {
    if (a.coverage) lines.push("COMPILE_ARGS += --coverage")
    if (a.waves) {
      // owner decision DP-6: verilator waves emit FST via +--trace-fst
      lines.push(a.traceFst === false
        ? "COMPILE_ARGS += --trace --trace-structs\nSIM_ARGS += --trace\n"
        : "COMPILE_ARGS += --trace-fst --trace-structs")
    }
  } else {
    lines.push("COMPILE_ARGS += -g2012")
    if (a.waves) lines.push("WAVES := 1  # icarus FST via -fst + dump module")
  }
  // env-driven contract (COCOTB_*), supplied by the make invocation environment:
  // COCOTB_TEST_MODULES, COCOTB_TESTCASE, COCOTB_RANDOM_SEED, COCOTB_RESULTS_FILE
  lines.push("", "include $(shell cocotb-config --makefiles)/Makefile.sim", "")
  return lines.join("\n")
}

// Parse cocotb xUnit results.xml without dependencies. Handles both
// self-closing <testcase .../> and explicit <testcase>...</testcase> forms.
export function parseResultsXml(xml: string): { cases: SimCase[]; summary: { tests: number | null; failures: number | null; errors: number | null; skipped: number | null } } {
  const cases: SimCase[] = []
  let tests: number | null = null
  let failures: number | null = null
  let errors: number | null = null
  let skipped: number | null = null
  for (const sm of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const attrs = sm[1] ?? ""
    const num = (k: string): number | null => { const m = attrs.match(new RegExp(k + '="(\\d+)"')); return m ? Number(m[1]) : null }
    tests ??= num("tests"); failures ??= num("failures"); errors ??= num("errors"); skipped ??= num("skipped")
  }
  const caseRe = /<testcase\b([^>]*?)\/?>/g
  const openTags: { index: number; end: number; attrs: string }[] = []
  for (const m of xml.matchAll(caseRe)) {
    openTags.push({ index: m.index, end: m.index + m[0].length, attrs: m[1] ?? "" })
  }
  for (let i = 0; i < openTags.length; i++) {
    const tag = openTags[i]
    const nextIdx = i + 1 < openTags.length ? openTags[i + 1].index : xml.indexOf("</testsuite>", tag.end)
    const body = nextIdx >= 0 ? xml.slice(tag.end, nextIdx) : ""
    const get = (k: string): string | null => { const m = tag.attrs.match(new RegExp(k + '="([^"]*)"')); return m ? m[1] : null }
    const timeMs = Number(get("time") ?? "0") * 1000
    const failFull = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/)
    const errFull = body.match(/<error\b[^>]*>([\s\S]*?)<\/error>/)
    // Self-closing variants (cocotb 2.0.1 xUnit): <failure error_type="..." error_msg="..." />
    const failSelf = body.match(/<failure\b([^>]*)\/>/)
    const errSelf = body.match(/<error\b([^>]*)\/>/)
    const selfMsg = (tagBody: string, tagName: string): string | null => {
      const g = (k: string): string | null => { const m = tagBody.match(new RegExp(k + '="([^"]*)"')); return m ? m[1] : null }
      const msg = g("error_msg") ?? g("message")
      const type = g("error_type") ?? g("type")
      if (msg && type) return `${type}: ${msg}`
      return msg ?? type ?? `${tagName} (no message)`
    }
    const fail = failFull ?? failSelf
    const err = errFull ?? errSelf
    const skip = body.includes("<skipped")
    const status: SimCase["status"] = skip ? "skip" : err ? "error" : fail ? "fail" : "pass"
    const fm = fail
      ? (fail[1] && fail[1].includes("=") ? selfMsg(fail[1], "failure") : ((fail[1] ?? "").trim() || null))
      : err
        ? (err[1] && err[1].includes("=") ? selfMsg(err[1], "error") : ((err[1] ?? "").trim() || null))
        : null
    cases.push({ name: get("name") ?? "?", status, timeMs, failureMsg: fm ? fm.slice(0, 500) : null })
  }
  return { cases, summary: { tests, failures, errors, skipped } }
}

// Collect waveform files produced under the case dir (.fst/.vcd/.fsdb).
export function collectWaves(caseDir: string): Wavefile[] {
  const out: Wavefile[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(fst|vcd|fsdb)$/i.test(e.name) && statSync(p).size > 0) {
        out.push({ file: p, fmt: e.name.toLowerCase().endsWith(".fst") ? "fst" : e.name.toLowerCase().endsWith(".fsdb") ? "fsdb" : "vcd" })
      }
    }
  }
  walk(caseDir)
  return out.slice(0, 50)
}

export async function verifSim(a: VerifSimArgs, deps: SimDeps = {}, exec?: any, config?: SiliconConfig | null): Promise<VerifSimResult> {
  // Lane gate: cocotb lane owns iverilog/verilator; vcs is the UVM lane.
  if (a.backend === "vcs") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "mpd_verif_sim is the cocotb lane (iverilog|verilator); vcs is handled by mpd_verif_uvm", "call mpd_verif_uvm for the VCS/UVM flow")
  }
  if (!a.sources || a.sources.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no sources given", "pass sources[] (RTL files) for the simulation")
  }
  // IRON GATE (refusal lists the exact setup command).
  const gate = requireCocotbVenv(undefined, exec)
  const probe = probeBackend(a.backend, config)
  if (!probe.present) {
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${a.backend}' not found on this machine`, `install it or set MPD_DSH_VERIF_${a.backend.toUpperCase()} to the tool path`)
  }
  const backend = a.backend
  const waves = a.waves ?? true
  const stamp = runStamp()
  const caseDir = join(workDir(exec), "sim", `${a.top}-${stamp}`)
  mkdirSync(caseDir, { recursive: true })
  const resultsXml = join(caseDir, "results.xml")
  const resolvedBackend = resolveBackendBinary(backend, config ?? undefined)
  // Null unless the resolved vvp is a wrapper that re-adds PYTHONHOME.
  const icarusShimDir = backend === "iverilog" && resolvedBackend !== null
    ? writeIcarusShimDir(caseDir, resolvedBackend.binary, join(dirname(resolvedBackend.binary), "vvp"))
    : null
  const tbModules = a.tbModules && a.tbModules.length > 0 ? a.tbModules : [a.top + "_tb"]
  const tbPathDirs = resolveTbPathDirs(tbModules, a.sources, workspaceRoot(exec))
  const makePy = buildSimMakefile({
    backend,
    top: a.top,
    sources: a.sources.map((s) => (isAbsolute(s) ? s : join(workspaceRoot(exec), s))),
    includes: (a.includes ?? []).map((i) => (isAbsolute(i) ? i : join(workspaceRoot(exec), i))),
    defines: normalizeDefines(a.defines),
    waves,
    traceFst: a.traceFst,
    coverage: a.coverage,
    icarusBinDir: icarusShimDir ?? undefined,
  })
  const makefilePath = join(caseDir, "Makefile")
  writeFileSync(makefilePath, makePy)
  const simLog = join(caseDir, "sim.log")
  // DP-6 iron rule under the Makefile flow: `make` runs with $VENV/bin FIRST in
  // PATH (cocotb-config / every nested python / the cocotb runtime resolve to the
  // venv), then the RESOLVED backend tool dir, then the inherited PATH. The tool
  // dir is what makes the cocotb makefiles' bare `iverilog` / `vvp` / `verilator`
  // calls resolve even when the toolchain is only named in silicon.jsonc (not on
  // PATH). Resolution is env -> config -> PATH via resolveBackendBinary.
  const venvBin = join(gate.venv, "bin")
  const makePathParts = [venvBin]
  if (resolvedBackend !== null) {
    const toolDir = dirname(resolvedBackend.binary)
    if (toolDir !== venvBin) makePathParts.push(toolDir)
  }
  if (typeof process.env.PATH === "string" && process.env.PATH.length > 0) makePathParts.push(process.env.PATH)
  const makeEnv = {
    PATH: makePathParts.join(":"),
    COCOTB_RESULTS_FILE: resultsXml,
    COCOTB_TEST_MODULES: tbModules.join(","),
    COCOTB_TOPLEVEL: a.top,
    PYTHONPATH: tbPathDirs.join(":"),
    ...(a.testFilter ? { COCOTB_TESTCASE: a.testFilter } : {}),
    ...(a.seed !== undefined ? { COCOTB_RANDOM_SEED: String(a.seed) } : {}),
  }
  // A session-level PYTHONHOME (measured: /opt/openictool/oss-cad-suite) redirects
  // the venv Python to the oss-suite stdlib and the cocotb VPI dies in
  // Py_Initialize ("failed to get the Python codec of the filesystem encoding").
  // The venv must own its prefix, so the key is REMOVED from the child env; an
  // empty value is not enough (Python still treats it as a prefix).
  const r = run("make", ["-f", makefilePath, "sim"], { cwd: caseDir, env: makeEnv, unsetEnv: ["PYTHONHOME"], timeoutMs: (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000 })
  writeLog(simLog, "== argv: make -f " + makefilePath + " sim (PATH=" + makeEnv.PATH + ")\n" + r.combined + "\nEXIT: " + String(r.status))
  if (r.timedOut) {
    throw new VerifError("VERIF_E_TIMEOUT", `simulation of '${a.top}' timed out`, `increase timeoutSec or narrow the test set; log: ${simLog}`)
  }
  if (r.spawnError) {
    throw new VerifError("VERIF_E_RUN", `make failed to start: ${r.spawnError}`, `ensure make is installed and the venv is healthy (mpd_verif_venv action:"status") — venv at ${gate.venv}`)
  }
  const xmlText = existsSync(resultsXml) ? readFileSync(resultsXml, "utf8") : null
  if (!xmlText) {
    throw new VerifError("VERIF_E_RUN", `sim exited (status ${r.status}) but no results.xml was produced by cocotb`, `read ${simLog}; typically a build-stage failure, or a TB import error in ${tbModules.join(", ")} (place the <tb>.py next to an RTL source, in the workspace root, or add it via PYTHONPATH)`)
  }
  const parsed = parseResultsXml(xmlText)
  const failed = parsed.cases.filter((c) => c.status !== "pass").length
  const ok = r.status === 0 && failed === 0
  const wavs = collectWaves(caseDir)
  const waveHooks = a.waveHook === false ? [] : await runWaveHooksSafe(deps.tools, wavs, a.top, caseDir)
  return {
    ok,
    backend,
    top: a.top,
    venv: gate.venv,
    cocotbVersion: gate.cocotbVersion,
    seed: a.seed !== undefined ? String(a.seed) : null,
    cases: parsed.cases,
    resultsXml,
    simLog,
    makefilePath,
    caseDir,
    wavesfiles: wavs,
    waveHooks,
    exitCode: r.status,
    ...(ok ? {} : {
      error: {
        code: "VERIF_E_RUN",
        message: `simulation failed: ${parsed.cases.filter((c) => c.status !== "pass").length} of ${parsed.cases.length} case(s) not passing (exit ${r.status})`,
        hint: `read ${simLog} and the failure blocks in result.cases; fix the TB/DUT and rerun`,
      },
    }),
  }
}

// TB python modules must be importable by cocotb's embedded interpreter:
// collect the dirs that actually hold <tbModule>.py (workspace root, a tb/
// subdir, or next to any RTL source) and export them via PYTHONPATH.
export function resolveTbPathDirs(tbModules: string[], sources: string[], wsRoot: string): string[] {
  const dirs = new Set<string>([wsRoot])
  const candidates = new Set<string>([wsRoot, join(wsRoot, "tb")])
  for (const src of sources) {
    const base = dirname(isAbsolute(src) ? src : join(wsRoot, src))
    candidates.add(base)
    candidates.add(join(base, "tb"))
  }
  for (const tb of tbModules) {
    const flat = tb.split(".")[0]
    for (const d of candidates) {
      if (existsSync(join(d, flat + ".py"))) { dirs.add(d); break }
    }
  }
  return [...dirs]
}

function vasv(binary: string, args: string[]): string {
  return [binary, ...args].join(" ")
}

// Hook wrapper: wave-MCP probing/calls are best-effort and MUST degrade
// gracefully (never throw out of the sim result).
async function runWaveHooksSafe(tools: WaveTools | undefined, waves: Wavefile[], top: string, caseDir: string): Promise<WaveHookResult[]> {
  try {
    return await runWaveHooks(tools ?? {}, { wavefile: waves[0] ?? null, top, sessionDir: waveSessionDir(caseDir), caseDir })
  } catch (e) {
    return [{ status: "failed", server: "wave_mcp", tool: null, message: "wave hook error: " + String(e) }]
  }
}