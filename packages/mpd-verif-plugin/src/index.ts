// mpd-verif: unified RTL verification plugin (Plan A, verification side).
// One backend abstraction (iverilog | verilator | vcs; MPD_DSH_* env first, then
// the silicon toolchain config for the open-source backends, then PATH; never
// vendored), a cocotb lane for open-source backends under the VENV IRON
// RULE (project-local venv; every pip install via <venv>/bin/pip; every
// cocotb run via <venv>/bin/python runner.py), a VCS-only UVM methodology lane
// (layout contract + makefile-style command contract, methodology grounded in
// gen-tb-skill structure + raysalemi/uvmprimer patterns — no code reuse), and
// waveform-read hooks that call user-wired wave-mcp / TraceWeave MCP tools
// with graceful degradation.
// The ninth tool (mpd_verif_toolchain) exposes the config layer itself; the tenth
// (mpd_verif_librelane) resolves and runs LibreLane (binary / AppImage / devshell).
// Zero runtime dependencies. English comments. Never touches ~/.dsh.
import { verifCompile } from "./compile"
import { verifCoverage } from "./coverage"
import { probeAll, type BackendProbe } from "./backends"
import { paths, venvPath, workDir, BACKEND_IDS, workspaceRoot, type BackendId } from "./env"
import { venvCreate, venvStatus } from "./venv"
import { verifSim } from "./sim"
import { verifUvm } from "./uvm"
import { verifRegress } from "./regress"
import { refusalOf } from "./errors"
import { loadSiliconConfig } from "./silicon/config"
import { toolchainToolDefinition } from "./silicon/tool"
import { librelaneToolDefinition } from "./silicon/librelane"
import { dshSeamInject, DSH_SEAM_TOOLS } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import type { DshAdapter } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"

export const name = "mpd-verif"
// The tool registry is a host-plane service. The id comes from mpd's seam vocabulary so
// a harness rename lands in ONE place; `dshSeamInject` returns the ids verbatim, so this
// array is byte-identical to the literal it replaces. The second entry is the HARD
// dependency: this row only applies once mpd's adapter (`mpdDsh`) is ACTIVE, so there is
// no fallback path — a composition without the provider leaves this row PENDING and the
// `silicon-require-mpd` guard refuses startup.
export const inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]

type Ctx = { tools?: any; mpdDsh?: DshAdapter; [k: string]: any }

function textBlock(text: string): { type: "text"; text: string }[] {
  return [{ type: "text", text }]
}

const scalar = (desc: string) => ({ type: "string", description: desc })

export function apply(ctx: Ctx): void {
  // Every harness seam goes through mpd's adapter, a HARD dependency: `mpdDsh` is
  // injected, so a composition without the provider never applies this row. There is
  // deliberately NO fallback adapter here.
  const dsh = ctx.mpdDsh as DshAdapter
  // --- 1. mpd_verif_venv: cocotb venv iron-rule manager ---
  dsh.registerTool({
    name: "mpd_verif_venv",
    description: "Manage the project-local cocotb venv (iron rule: default <workspace>/.venv-rtl or MPD_DSH_VERIF_VENV). action=status reports {ok, verdict, cocotbVersion}; action=create bootstraps via 'python3 -m venv' and installs cocotb>=2.0 with the venv's own pip (system python/pip are NEVER used).",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["status", "create", "info"], description: "status (default) | create the venv + install cocotb | info about resolved paths/env" }, path: { type: "string", description: "optional venv path override" } },
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, verdict: { type: "string" }, venv: { type: "string" }, something: {} } },
      render: (_a: unknown, v: any) => textBlock("mpd_verif_venv: " + v.message + (v.error ? "\nERROR(" + v.error.code + "): " + v.error.hint : "")),
    },
    execute: async (args: any, exec: any) => {
      try {
        const action = (args?.action ?? "status") === "create" ? "create" : (args?.action ?? "status") === "info" ? "info" : "status"
        if (action === "info") {
          const p = paths(args?.path ? String(args.path) : undefined, exec)
          const envKeys = Object.fromEntries(BACKEND_IDS.map((b) => ["MPD_DSH_VERIF_" + b.toUpperCase(), process.env["MPD_DSH_VERIF_" + b.toUpperCase()] ?? null]))
          return {
            ok: true,
            action: "info",
            workspace: p.workspace,
            venv: p.venv,
            work: p.work,
            message: `verif env: workspace ${p.workspace}; venv ${p.venv}; work ${p.work}`,
            env: { ...envKeys, MPD_DSH_VERIF_VENV: process.env.MPD_DSH_VERIF_VENV ?? null, MPD_DSH_VERIF_WORK: process.env.MPD_DSH_VERIF_WORK ?? null },
          }
        }
        if (action === "create") {
          const res = venvCreate(args?.path ? String(args.path) : undefined, undefined, exec)
          return { ...res, action: "create" }
        }
        const st = venvStatus(args?.path ? String(args.path) : undefined, exec)
        return { ...st, action: "status" }
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 2. mpd_verif_backends: probe surface (auto-detect + QA probe) ---
  dsh.registerTool({
    name: "mpd_verif_backends",
    description: "Probe RTL backend availability: for iverilog|verilator|vcs (or all) resolves the effective binary via MPD_DSH_VERIF_* env, then the silicon toolchain config (ossCadSuite.bin / ossCadSuite.home/bin, iverilog+verilator only), then PATH; reports presence/version, the resolution source (env|config|path) and the exact binary path, plus (vcs) license env hints.",
    parameters: {
      type: "object",
      properties: { backend: { type: "string", enum: [...BACKEND_IDS, "all"], description: "backend id or 'all' (default)" } },
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backends: { type: "array" } } },
      render: (_a: unknown, v: any) => textBlock("mpd_verif_backends: " + (v.backends ?? []).map((b: BackendProbe) => `${b.backend}=${b.present ? "present(" + (b.version ?? "?") + ")" : "absent"} @${b.binary ?? "-"}`).join("; ") + (v.note ? "\n" + v.note : "")),
    },
    execute: async (args: any, exec: any) => {
      try {
        const want = String(args?.backend ?? "all")
        // One config load per tool call (never module-level caching: one process
        // serves many sessions with different workspaces).
        const all = probeAll(loadSiliconConfig(exec).config)
        const list = want === "all" ? all : all.filter((p) => p.backend === want)
        const missing = list.filter((b) => !b.present).map((b) => b.backend)
        return {
          ok: list.some((b) => b.present),
          backends: list,
          note: missing.length > 0 ? `missing: ${missing.join(", ")} — install, pin MPD_DSH_VERIF_<BACKEND>, or set ossCadSuite.bin via mpd_verif_toolchain` : "all requested backends present",
        }
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 3. mpd_verif_compile: full compile (builds a sim binary) ---
  dsh.registerTool({
    name: "mpd_verif_compile",
    description: "Compile RTL to a sim binary with one backend: iverilog (-g2012 -o simv_iverilog) | verilator (--binary) | vcs (-sverilog +v2k -f filelist -o simv). iverilog/verilator resolve via MPD_DSH_VERIF_* env, then the silicon toolchain config (ossCadSuite), then PATH. Returns structured diagnostics {file,line,severity,code,message} parsed from the log on failure (VERIF_E_COMPILE).",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "backend to use" },
        sources: { type: "array", items: { type: "string" }, description: "RTL source files" },
        top: scalar("top module (optional)"),
        includes: { type: "array", items: { type: "string" }, description: "include dirs" },
        defines: { description: "macro defines: object {MACRO: value} or array ['MACRO', 'MACRO=value']" },
        timeoutSec: { type: "number" },
      },
      required: ["backend", "sources"],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, diagnostics: { type: "array" }, something: {} } },
      render: (_a: unknown, v: any) => textBlock(v.ok ? `mpd_verif_compile OK — ${v.backend} → ${v.outBinary ?? "binary"}\nlog: ${v.logPath}` : `mpd_verif_compile FAILED (${v.backend}, exit ${v.exitCode}) — ${(v.diagnostics ?? []).length} diagnostics\nlog: ${v.logPath}\nfirst errors:\n` + (v.diagnostics ?? []).slice(0, 8).map((d: any) => `  ${d.file}:${d.line ?? "?"} [${d.severity}] ${d.message}`).join("\n")),
    },
    execute: async (args: any, exec: any) => {
      try {
        return verifCompile({
          backend: String(args?.backend) as BackendId,
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          top: args?.top ? String(args.top) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          target: "compile",
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
        }, exec, loadSiliconConfig(exec).config)
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 3b. mpd_verif_lint: lint-only pass (owner DP-4 eight-tool surface) ---
  dsh.registerTool({
    name: "mpd_verif_lint",
    description: "Lint RTL with one backend (auto-resolved via env, the silicon toolchain config, then PATH): iverilog -g2012 -tnull -Wall | verilator --lint-only -Wall | vcs -lca -sverilog +lint=all -f <filelist>. Returns structured diagnostics {file,line,severity,code,message} parsed from the log (VERIF_E_COMPILE on failure).",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "backend to use" },
        sources: { type: "array", items: { type: "string" }, description: "RTL source files" },
        top: scalar("top module (optional)"),
        includes: { type: "array", items: { type: "string" }, description: "include dirs" },
        defines: { description: "macro defines: object {MACRO: value} or array ['MACRO', 'MACRO=value']" },
        timeoutSec: { type: "number" },
      },
      required: ["backend", "sources"],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, diagnostics: { type: "array" }, something: {} } },
      render: (_a: unknown, v: any) => textBlock(v.ok ? `mpd_verif_lint OK (${v.backend}) — log: ${v.logPath}` : `mpd_verif_lint FAILED (${v.backend}, exit ${v.exitCode}) — ${(v.diagnostics ?? []).length} diagnostics\nlog: ${v.logPath}\nfirst errors:\n` + (v.diagnostics ?? []).slice(0, 8).map((d: any) => `  ${d.file}:${d.line ?? "?"} [${d.severity}] ${d.message}`).join("\n")),
    },
    execute: async (args: any, exec: any) => {
      try {
        return verifCompile({
          backend: String(args?.backend) as BackendId,
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          top: args?.top ? String(args.top) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          target: "lint",
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
        }, exec, loadSiliconConfig(exec).config)
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 3c. mpd_verif_coverage: coverage merge/report across lanes (owner DP-4) ---
  dsh.registerTool({
    name: "mpd_verif_coverage",
    description: "Merge/report code coverage across lanes (owner DP-4): verilator — merge Verilator coverage .dat files (verilator_coverage --write merged.dat) or annotate a report (--annotate-all <dir> <merged.dat>); vcs — urg merge+report over per-case -cm_dir payloads (urg -dir ... -report ...); iverilog regions refused (VERIF_E_UNSUPPORTED, no native coverage). Binaries resolve via MPD_DSH_VERIF_* / the silicon toolchain config (verilator_coverage via ossCadSuite) / VCS_HOME / VERDI_HOME / NOVAS_HOME / PATH.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "coverage lane" },
        action: { type: "string", enum: ["merge", "report"], description: "merge datasets into <reportDir>/merged.dat (default) or annotate a report (verilator)" },
        dir: scalar("scan root for coverage payloads (default <work>/.mpd/verif)"),
        reportDir: scalar("report directory (default <work>/.mpd/verif/cov_report)"),
        mergedDat: scalar("existing merged dataset path (action=report)"),
        timeoutSec: { type: "number" },
      },
      required: ["backend"],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, reportDir: { type: "string" }, something: {} } },
      render: (_a: unknown, v: any) => textBlock(v.error ? `mpd_verif_coverage FAILED: ${v.error.message}\nhint: ${v.error.hint}` : `mpd_verif_coverage OK (${v.backend}) — ${(v.messages ?? []).join("; ") || "done"}\nreport: ${v.reportDir ?? "-"}`),
    },
    execute: async (args: any, exec: any) => {
      try {
        return verifCoverage({
          backend: String(args?.backend) as "iverilog" | "verilator" | "vcs",
          action: String(args?.action ?? "merge") as "merge" | "report",
          dir: args?.dir ? String(args.dir) : undefined,
          reportDir: args?.reportDir ? String(args.reportDir) : undefined,
          mergedDat: args?.mergedDat ? String(args.mergedDat) : undefined,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
        }, exec, loadSiliconConfig(exec).config)
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 4. mpd_verif_sim: cocotb lane (iverilog | verilator ONLY) ---
  dsh.registerTool({
    name: "mpd_verif_sim",
    description: "Run a cocotb simulation on iverilog or verilator. IRON RULE: refuses (VERIF_E_NO_VENV) unless the project venv exists AND cocotb imports inside it — the refusal carries the exact setup command; every run uses <venv>/bin/python runner.py. Generates a cocotb.runner script, executes it, parses results.xml into per-case statuses, collects waves (.fst/.vcd), and optionally hands the waveform to the wired wave-mcp MCP tool.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["iverilog", "verilator", "vcs"], description: "backend (vcs refused: use mpd_verif_uvm)" },
        top: scalar("hdl_toplevel module"),
        tbModules: { type: "array", items: { type: "string" }, description: "python test modules (default: [top + '_tb'])" },
        sources: { type: "array", items: { type: "string" }, description: "RTL sources" },
        includes: { type: "array", items: { type: "string" } },
        defines: { description: "macro defines (object or array of MACRO[=value])" },
        testFilter: scalar("cocotb testcase filter (optional)"),
        seed: { description: "seed (number or string)" },
        waves: { type: "boolean", description: "dump waves (default true)" },
        traceFst: { type: "boolean", description: "verilator: use +--trace-fst for FST (owner DP-6 default; needs liblz4 headers; false → VCD)" },
        coverage: { type: "boolean", description: "verilator lane: compile with --coverage (payload for mpd_verif_coverage)" },
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean", description: "hand the wave to wave-mcp if wired (default true)" },
      },
      required: ["backend", "top", "sources"],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, cases: { type: "array" } } },
      render: (_a: unknown, v: any) => {
        if (v.error) return textBlock(`mpd_verif_sim FAILED: ${v.error.message}\nhint: ${v.error.hint}`)
        const cases = v.cases ?? []
        const body = cases.map((c: any) => `  ${c.status.toUpperCase()} ${c.name} (${Math.round(c.timeMs)}ms)${c.failureMsg ? " — " + c.failureMsg.slice(0, 200) : ""}`).join("\n")
        const waves = (v.wavesfiles ?? []).map((w: any) => `  ${w.file} (${w.fmt})`).join("\n")
        const hook = (v.waveHooks ?? []).map((h: any) => `  [${h.status}] ${h.server}: ${h.message.slice(0, 160)}`).join("\n")
        return textBlock(`mpd_verif_sim ${v.ok ? "PASS" : "FAIL"} (${v.backend}, ${v.top}, seed ${v.seed ?? "auto"}) — ${cases.length} case(s)\n${body}${waves ? "\nwaves:\n" + waves : ""}${hook ? "\nwave hooks:\n" + hook : ""}\nlog: ${v.simLog}`)
      },
    },
    execute: async (args: any, exec: any) => {
      try {
        return await verifSim(
          {
            backend: String(args?.backend) as "iverilog" | "verilator" | "vcs",
            top: String(args?.top ?? ""),
            tbModules: Array.isArray(args?.tbModules) ? args.tbModules.map(String) : undefined,
            sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
            includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
            defines: args?.defines ?? undefined,
            testFilter: args?.testFilter ? String(args.testFilter) : undefined,
            seed: args?.seed ?? undefined,
            waves: args?.waves ?? true,
            traceFst: args?.traceFst ?? true,
            coverage: args?.coverage ?? false,
            timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
            waveHook: args?.waveHook ?? true,
          },
          { tools: dsh.toolRuntime() },
          exec,
          loadSiliconConfig(exec).config,
        )
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 5. mpd_verif_uvm: UVM methodology lane, VCS ONLY ---
  dsh.registerTool({
    name: "mpd_verif_uvm",
    description: "UVM methodology lane FOR VCS ONLY (owner decision; cocotb owns the open-source backends). Orchestrates a user-scaffolded UVM tree (<ip>/{rtl,script,tb,top,test,work}) — the plugin ships no template content, it validates the layout contract (tb_api_primitives.svh shared BFM, *_test.sv naming, mandatory sanity_test + reg_access_test) and drives the makefile-style contract: uvm-1.2, seed control, per-case work dirs, coverage -cm line+cond+tgl with urg merge, capped compile-fix attempts with unresolved.md. Methodology grounded in gen-tb-skill (structure) + raysalemi/uvmprimer (patterns) — no code reused from either.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["compile", "run", "regress", "wave", "merge-cov", "clean"], description: "lane action" },
        top: scalar("<ip> project root holding the UVM tree"),
        filelist: scalar("explicit filelist (default <ip>/script/filelist.f)"),
        includes: { type: "array", items: { type: "string" } },
        defines: { type: "array", items: { type: "string" } },
        test: scalar("test case name (default sanity_test)"),
        uvmVer: scalar("UVM version (default 1.2)"),
        seed: { description: "seed (default: date-derived)" },
        coverage: { type: "boolean", description: "enable -cm line+cond+tgl" },
        waveFmt: { type: "string", enum: ["fsdb", "vcd"] },
        verbosity: scalar("UVM verbosity (default UVM_MEDIUM)"),
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean", description: "hand logs/waves to TraceWeave if wired (default true)" },
      },
      required: ["action", "top"],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, action: { type: "string" }, cases: { type: "array" }, something: {} } },
      render: (_a: unknown, v: any) => {
        if (v.error) return textBlock(`mpd_verif_uvm ${v.action} FAILED: ${v.error.message}\nhint: ${v.error.hint}`)
        const cases = (v.cases ?? []).map((c: any) => `  ${c.test}: ${c.status} (seed ${c.seed}, uvm_errors=${c.uvmErrors ?? "-"})`).join("\n")
        const cov = v.covReport ? `\ncoverage report: ${v.covReport}` : ""
        const fsdb = (v.fsdbReports ?? []).map((h: any) => `  [${h.status}] fsdbreport: ${h.message.slice(0, 120)}`).join("\n")
        const attempt = v.action === "compile" ? ` (attempt ${v.attempts}/${v.maxAttempts}${v.unresolved ? ", UNRESOLVED see work/unresolved.md" : ""})` : ""
        return textBlock(`mpd_verif_uvm ${v.action} ${v.ok ? "OK" : "FAILED"}${attempt}\n${cases}${fsdb ? "\nfsdb reports:\n" + fsdb : ""}${cov}${v.logPath ? "\nlog: " + v.logPath : ""}`)
      },
    },
    execute: async (args: any, exec: any) => {
      try {
        return await verifUvm(
          {
            action: String(args?.action ?? "compile") as any,
            top: String(args?.top ?? ""),
            filelist: args?.filelist ? String(args.filelist) : undefined,
            includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
            defines: Array.isArray(args?.defines) ? args.defines.map(String) : undefined,
            test: args?.test ? String(args.test) : undefined,
            uvmVer: args?.uvmVer ? String(args.uvmVer) : "1.2",
            seed: args?.seed ?? undefined,
            coverage: args?.coverage ?? false,
            waveFmt: args?.waveFmt === "vcd" ? "vcd" : "fsdb",
            verbosity: args?.verbosity ? String(args.verbosity) : undefined,
            timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
            waveHook: args?.waveHook ?? true,
          },
          dsh.toolRuntime(),
          exec,
        )
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 6. mpd_verif_regress: multi-case regression + report ---
  dsh.registerTool({
    name: "mpd_verif_regress",
    description: "Run a regression across cases on one backend: cocotb lane (iverilog|verilator, per-case seed = seedBase+idx, results aggregated from results.xml) or the UVM lane (vcs, per-case work dirs). Writes <work>/regress/<stamp>/results.json + results.md report; waves can be handed to wave-mcp/TraceWeave when wired.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "regression backend" },
        cases: { type: "array", items: { type: "string" }, description: "case names (cocotb testcase filters; default: ['all']); vcs lane discovers test/*_test.sv" },
        glob: scalar("tb-file glob alternative to cases[]"),
        seedBase: { type: "number", description: "seed base (default: date-based)" },
        maxFailures: { type: "number", description: "stop after N failures (0 = unlimited)" },
        stopOnError: { type: "boolean" },
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean" },
        sim: {
          type: "object",
          properties: {
            top: scalar("hdl_toplevel (cocotb lane) or <ip> root (vcs lane)"),
            sources: { type: "array", items: { type: "string" } },
            tbModules: { type: "array", items: { type: "string" } },
            includes: { type: "array", items: { type: "string" } },
            defines: { description: "macro defines" },
            waves: { type: "boolean", description: "dump waves per case (default true)" },
            traceFst: { type: "boolean", description: "verilator: +--trace-fst FST (default true; false → VCD)" },
            coverage: { type: "boolean", description: "verilator: compile with --coverage" },
          },
          description: "shared sim plan",
        },
      },
      required: ["backend"],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, total: { type: "number" }, passed: { type: "number" }, failed: { type: "number" }, reportMarkdown: { type: "string" } } },
      render: (_a: unknown, v: any) => textBlock(v.error ? `mpd_verif_regress FAILED: ${v.error.message}\nhint: ${v.error.hint}` : `mpd_verif_regress (${v.backend}): ${v.passed}/${v.total} passed, ${v.failed} failed, ${v.skipped} skipped (seedBase ${v.seedBase})\nreport: ${v.reportPath}\n` + (v.cases ?? []).map((c: any) => `  ${c.test} [${c.status}] seed ${c.seed}${c.wave ? " wave:" + c.wave.fmt : ""}`).join("\n")),
    },
    execute: async (args: any, exec: any) => {
      try {
        return await verifRegress(
          {
            backend: String(args?.backend) as BackendId,
            cases: Array.isArray(args?.cases) ? args.cases.map(String) : undefined,
            glob: args?.glob ? String(args.glob) : undefined,
            seedBase: typeof args?.seedBase === "number" ? args.seedBase : undefined,
            maxFailures: typeof args?.maxFailures === "number" ? args.maxFailures : undefined,
            stopOnError: args?.stopOnError ?? false,
            timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
            waveHook: args?.waveHook ?? true,
            sim: args?.sim && typeof args.sim === "object" ? {
              top: args.sim.top ? String(args.sim.top) : undefined,
              sources: Array.isArray(args.sim.sources) ? args.sim.sources.map(String) : undefined,
              tbModules: Array.isArray(args.sim.tbModules) ? args.sim.tbModules.map(String) : undefined,
              includes: Array.isArray(args.sim.includes) ? args.sim.includes.map(String) : undefined,
              defines: args.sim.defines ?? undefined,
              waves: args.sim.waves ?? true,
              traceFst: args.sim.traceFst ?? true,
              coverage: args.sim.coverage ?? false,
            } : undefined,
          },
          dsh.toolRuntime(),
          exec,
          loadSiliconConfig(exec).config,
        )
      } catch (e) {
        return refusalOf(e)
      }
    },
  })

  // --- 9. mpd_verif_toolchain: the silicon toolchain config (user + project) ---
  // The implementation lives in ./silicon/tool.ts; this row only registers it so
  // the registration list above stays a readable inventory.
  dsh.registerTool(toolchainToolDefinition())

  // --- 10. mpd_verif_librelane: resolve + run LibreLane (binary/AppImage/devshell) ---
  // The implementation lives in ./silicon/librelane.ts; like row 9 this is only a
  // registration so the inventory above stays readable.
  dsh.registerTool(librelaneToolDefinition())

  // Prompt section: tell the agent the toolchain is configurable and that this
  // tool is the way to persist "oss-cad-suite lives at X". Wrapped in try/catch
  // so a composition without the systemPrompt seam never breaks the boot.
  try {
    dsh.registerPromptSection({
      name: "silicon-toolchain",
      order: 30,
      text: "Silicon toolchain paths are configurable: user layer $DSH_HOME/silicon.jsonc, project layer <workspace>/.mpd/silicon.jsonc (project wins). When the user states where oss-cad-suite, verible or librelane live, call mpd_verif_toolchain (action=detect to probe, action=set to persist; show reports the effective config and resolved binaries). Run LibreLane with mpd_verif_librelane (action=status resolves binary/AppImage/devshell and previews the command; action=run executes inside the workspace and logs to .mpd/librelane/). MPD_DSH_VERIF_* env still wins at run time; PATH is the last tier.",
    })
  } catch {
    // The seam is optional here: a missing systemPrompt service must not abort the plugin.
  }
}

// Re-exports for the package test suite.
export {
  verifCompile,
  verifCoverage,
  verifSim,
  verifUvm,
  verifRegress,
  venvStatus,
  venvCreate,
  venvPath,
  workDir,
  workspaceRoot,
  probeAll,
}
export type { BackendId }