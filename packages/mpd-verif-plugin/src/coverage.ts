// mpd_verif_coverage core — standalone coverage merge/report across lanes
// (owner decision DP-4 adds it as a first-class tool; DP-11 requires the lane
// to be FULLY implemented, not stubbed because the QA box lacks VCS):
//   vcs       : urg merge+report over per-case cov dirs (-cm line+cond+tgl
//               collected by the UVM lane compile/run/regress).
//   verilator : merge Verilator coverage .dat files (verilator_coverage
//               --write merged.dat <files>) and annotate them into a report dir
//               (verilator_coverage --annotate-all <reportDir> <merged.dat>).
//                --all is NOT a verilator_coverage flag (5.053: "%Error: Invalid option: --all").
//   iverilog  : VERIF_E_UNSUPPORTED — Icarus ships no native code coverage;
//               use the verilator lane (sim coverage:true → --coverage) or VCS.
// All refusals ride the unified VERIF_E_* taxonomy; all binaries resolve via
// MPD_DSH_VERIF_* / VCS_HOME / VERDI_HOME / NOVAS_HOME / PATH — never vendored.
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { workDir } from "./env"
import type { SiliconConfig } from "./silicon/config"
import { configBinCandidates, findOnPath } from "./silicon/config"
import { run, writeLog, DEFAULT_TIMEOUT_MS } from "./run"
import { VerifError } from "./errors"
import { resolveEdaTool, urgMergeArgv, collectCovDirs, collectDatFiles, URG_HINT } from "./eda-tools"

export interface VerifCoverageArgs {
  backend: "iverilog" | "verilator" | "vcs"
  action?: "merge" | "report"
  dir?: string
  reportDir?: string
  mergedDat?: string
  timeoutSec?: number
}

export interface VerifCoverageResult {
  ok: boolean
  backend: "iverilog" | "verilator" | "vcs"
  action: "merge" | "report"
  binary: string | null
  args: string[]
  exitCode: number | null
  datFiles: string[]
  covDirs: string[]
  mergedDat?: string
  reportDir?: string
  logPath: string
  messages: string[]
  error?: { code: string; message: string; hint: string }
}

const VERILATOR_COVERAGE_HINT =
  "verilator_coverage not found — it ships with Verilator (oss-cad-suite on PATH or MPD_DSH_VERIF_VERILATOR_COVERAGE)"

export function resolveVerilatorCoverage(config?: SiliconConfig | null): { binary: string; source: string } {
  const envVal = process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE
  if (envVal && envVal.trim().length > 0) return { binary: envVal.trim(), source: "env:MPD_DSH_VERIF_VERILATOR_COVERAGE" }
  // Config is the middle tier: ossCadSuite.bin / ossCadSuite.home/bin.
  for (const candidate of configBinCandidates("verilator_coverage", config)) {
    if (existsSync(candidate)) return { binary: candidate, source: "config" }
  }
  const onPath = findOnPath("verilator_coverage")
  if (onPath !== null) return { binary: onPath, source: "path" }
  throw new VerifError("VERIF_E_NO_BACKEND", "verilator_coverage not resolvable", VERILATOR_COVERAGE_HINT)
}

export function verifCoverage(a: VerifCoverageArgs, exec?: any, config?: SiliconConfig | null): VerifCoverageResult {
  const scanRoot = a.dir ?? workDir(exec)
  const reportDir = a.reportDir ?? join(workDir(exec), "cov_report")
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000
  mkdirSync(reportDir, { recursive: true })
  const action: "merge" | "report" = a.action === "report" ? "report" : "merge"

  if (a.backend === "iverilog") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "iverilog has no native code coverage", "use the verilator lane (mpd_verif_sim coverage:true adds --coverage) or the VCS/urg lane; icarus coverage is deliberately refused")
  }

  if (a.backend === "vcs") {
    const urg = resolveEdaTool("urg")
    if (!urg) throw new VerifError("VERIF_E_NO_BACKEND", "urg not resolvable", URG_HINT)
    const covDirs = collectCovDirs(scanRoot)
    if (covDirs.length === 0) {
      throw new VerifError("VERIF_E_RUN", "no coverage data dirs under " + scanRoot, "enable coverage on the UVM lane (coverage:true on compile/run/regress writes -cm_dir payloads) then re-run coverage")
    }
    const argv = urgMergeArgv(covDirs, reportDir, "both")
    const logPath = join(reportDir, "urg.log")
    const r = run(urg.binary, argv.slice(1), { timeoutMs })
    writeLog(logPath, r.combined)
    return {
      ok: r.status === 0, backend: "vcs", action, binary: urg.binary, args: argv, exitCode: r.status,
      datFiles: [], covDirs, reportDir, logPath,
      messages: r.status === 0 ? [`urg merged ${covDirs.length} coverage dir(s) into ${reportDir}`] : [],
      ...(r.status === 0 ? {} : { error: { code: "VERIF_E_ENV", message: "urg merge failed", hint: `read ${logPath}; verify the license environment` } }),
    }
  }

  // verilator lane: merge of .dat files, or annotate report of a merged dataset
  const tool = resolveVerilatorCoverage(config)
  const dats = collectDatFiles(scanRoot)
  const logPath = join(reportDir, "verilator_coverage.log")
  if (a.action === "report") {
    const merged = a.mergedDat ?? join(reportDir, "merged.dat")
    if (!existsSync(merged)) {
      throw new VerifError("VERIF_E_RUN", "no merged coverage dataset at " + merged, "run mpd_verif_coverage with action=merge first (verilator), or pass mergedDat")
    }
    // `--annotate <dir>` is the ACTION; `--annotate-all` is the "show all files"
    // FLAG. Passing `--annotate-all <dir> <dat>` makes verilator_coverage treat
    // the directory as an input and publish an empty report ("annotate failed").
    const argv = [tool.binary, "--annotate", reportDir, "--annotate-all", merged]
    const r = run(argv[0], argv.slice(1), { timeoutMs })
    writeLog(logPath, r.combined)
    return {
      ok: r.status === 0, backend: "verilator", action, binary: tool.binary, args: argv, exitCode: r.status,
      datFiles: dats, covDirs: [], mergedDat: merged, reportDir, logPath,
      messages: r.status === 0 ? [`annotated coverage report under ${reportDir}`] : [],
      ...(r.status === 0 ? {} : { error: { code: "VERIF_E_RUN", message: "verilator_coverage annotate failed", hint: `read ${logPath}; annotate needs the merged dataset` } }),
    }
  }
  if (dats.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no Verilator coverage .dat files under " + scanRoot, "run mpd_verif_sim with coverage:true (COMPILE_ARGS += --coverage) on the verilator lane, then re-run coverage")
  }
  const mergeDat = join(reportDir, "merged.dat")
  const argv = [tool.binary, "--write", mergeDat, ...dats]
  const r = run(argv[0], argv.slice(1), { timeoutMs })
  writeLog(logPath, r.combined)
  return {
    ok: r.status === 0, backend: "verilator", action, binary: tool.binary, args: argv, exitCode: r.status,
    datFiles: dats, covDirs: [], mergedDat: mergeDat, reportDir, logPath,
    messages: r.status === 0 ? [`merged ${dats.length} coverage file(s) into ${mergeDat}`] : [],
    ...(r.status === 0 ? {} : { error: { code: "VERIF_E_RUN", message: "verilator_coverage merge failed", hint: `read ${logPath}` } }),
  }
}
