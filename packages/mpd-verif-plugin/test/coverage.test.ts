// mpd_verif_coverage tests (owner DP-4/DP-11): verilator_coverage merge/report
// argv + dataset discovery, urg merge argv over per-case cov dirs, icarus
// hard refusal, and the unified error taxonomy.
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { verifCoverage } from "../src/coverage"
import { VerifError } from "../src/errors"
import { captureLines, guardEnv, makeSandbox, withSandboxEnv, writeBin, writeText } from "./helpers"

test("iverilog coverage is refused (VERIF_E_UNSUPPORTED with lane hint)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    let err: VerifError | null = null
    try { verifCoverage({ backend: "iverilog" }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_UNSUPPORTED")
    expect(err!.hint).toContain("verilator")
  } finally {
    g.restore()
  }
})

test("verilator merge: verilator_coverage --write merged.dat over discovered .dat files", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    writeText(join(s, "work", "sim", "case1", "sim_build", "coverage.dat"), "dat1")
    writeText(join(s, "work", "sim", "case1", "sim_build", "Vtop__verFiles.dat"), "verilator build metadata, not coverage")
    writeText(join(s, "work", "sim", "case2", "sim_build", "coverage.dat"), "dat2")
    const cap = join(s, "vcoverage.log")
    const bin = writeBin(join(s, "fakebin"), "verilator_coverage", `#!/bin/sh\necho "$0 $*" >> "${cap}"\nexit 0\n`)
    process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE = bin
    const r = verifCoverage({ backend: "verilator", dir: join(s, "work"), reportDir: join(s, "cov_report") })
    expect(r.ok).toBe(true)
    expect(r.datFiles.length).toBe(2) // the __verFiles.dat decoy is NOT collected
    expect(r.datFiles.some((file) => file.endsWith("__verFiles.dat"))).toBe(false)
    expect(r.action).toBe("merge")
    const line = captureLines(cap)[0]
    expect(line).toContain("--write")
    expect(line).not.toContain("__verFiles.dat")
    expect(line).toContain(join(s, "cov_report", "merged.dat"))
    expect(r.mergedDat).toContain("merged.dat")
  } finally {
    g.restore()
  }
})

test("verilator merge ignores a tree with only __verFiles.dat (no malformed-point merge)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    writeText(join(s, "work", "sim", "case1", "sim_build", "Vtop__verFiles.dat"), "verilator build metadata, not coverage")
    const bin = writeBin(join(s, "fakebin"), "verilator_coverage", "#!/bin/sh\nexit 0\n")
    process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE = bin
    let err: VerifError | null = null
    try { verifCoverage({ backend: "verilator", dir: join(s, "work"), reportDir: join(s, "cov_report") }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_RUN")
    expect(err!.message).toContain("no Verilator coverage .dat")
  } finally {
    g.restore()
  }
})

test("verilator merge without datasets refuses with VERIF_E_RUN + actionable hint", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    writeBin(join(s, "fakebin"), "verilator_coverage", "#!/bin/sh\nexit 0\n")
    process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE = join(s, "fakebin", "verilator_coverage")
    let err: VerifError | null = null
    try { verifCoverage({ backend: "verilator", dir: join(s, "work") }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_RUN")
    expect(err!.hint).toContain("coverage:true")
  } finally {
    g.restore()
  }
})

test("verilator report: action=report annotates with --annotate <dir> --annotate-all <dat>", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const merged = writeText(join(s, "cov_report", "merged.dat"), "merged-dat")
    const cap = join(s, "vcoverage-report.log")
    const bin = writeBin(join(s, "fakebin"), "verilator_coverage", `#!/bin/sh\necho "$0 $*" >> "${cap}"\nexit 0\n`)
    process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE = bin
    const r = verifCoverage({ backend: "verilator", action: "report", mergedDat: merged, reportDir: join(s, "cov_report") })
    expect(r.ok).toBe(true)
    expect(r.action).toBe("report")
    expect(r.mergedDat).toBe(merged)
    const line = captureLines(cap)[0]
    // --annotate <dir> is the action; --annotate-all is the flag (5.053).
    expect(r.args).toEqual([bin, "--annotate", join(s, "cov_report"), "--annotate-all", merged])
    expect(r.args).not.toContain("--all") // the bare --all flag is not accepted by 5.053
    expect(line).toContain(merged)
  } finally {
    g.restore()
  }
})

test("verilator report without a merged dataset refuses with VERIF_E_RUN + action=merge hint", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    writeBin(join(s, "fakebin"), "verilator_coverage", "#!/bin/sh\nexit 0\n")
    process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE = join(s, "fakebin", "verilator_coverage")
    let err: VerifError | null = null
    try { verifCoverage({ backend: "verilator", action: "report", reportDir: join(s, "cov_report") }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_RUN")
    expect(err!.hint).toContain("action=merge")
  } finally {
    g.restore()
  }
})

test("vcs coverage: urg merge argv over discovered cov dirs (fake urg capture)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    writeText(join(s, "ip", "work", "cov", "compile", ".keep"), "")
    writeText(join(s, "ip", "work", "cov", "work_sanity_test_", ".keep"), "")
    writeText(join(s, "ip", "work", "cov", "work_reg_access_test_", ".keep"), "")
    const cap = join(s, "urg.log")
    const urg = writeBin(join(s, "fakebin"), "urg", `#!/bin/sh\necho "$0 $*" >> "${cap}"\nexit 0\n`)
    process.env.MPD_DSH_VERIF_URG = urg
    const r = verifCoverage({ backend: "vcs", dir: join(s, "ip", "work"), reportDir: join(s, "cov_report") })
    expect(r.ok).toBe(true)
    expect(r.action).toBe("merge")
    expect(r.covDirs).toEqual([join(s, "ip", "work", "cov")]) // one urg -dir root (walks children recursively)
    const line = captureLines(cap)[0]
    expect((line.match(/-dir/g) ?? []).length).toBe(1)
    expect(line).toContain("-report " + join(s, "cov_report"))
    expect(line).toContain("-format both")
    const jsonText = JSON.stringify(r)
    expect(jsonText).not.toContain("undefined") // lossless JSON contract
    const asReport = verifCoverage({ backend: "vcs", action: "report", dir: join(s, "ip", "work"), reportDir: join(s, "cov_report") })
    expect(asReport.action).toBe("report")
  } finally {
    g.restore()
  }
})

test("vcs coverage: missing urg resolves to VERIF_E_NO_BACKEND with hint", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    writeText(join(s, "work", "cov", "compile", ".keep"), "")
    delete process.env.MPD_DSH_VERIF_URG
    delete process.env.VCS_HOME
    delete process.env.VERDI_HOME
    delete process.env.NOVAS_HOME
    process.env.PATH = join(s, "empty")
    let err: VerifError | null = null
    try { verifCoverage({ backend: "vcs", dir: join(s, "work") }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_NO_BACKEND")
    expect(err!.hint).toContain("MPD_DSH_VERIF_URG")
  } finally {
    g.restore()
  }
})

test("vcs coverage: no cov payloads refuses with VERIF_E_RUN", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const urg = writeBin(join(s, "fakebin"), "urg", "#!/bin/sh\nexit 0\n")
    process.env.MPD_DSH_VERIF_URG = urg
    let err: VerifError | null = null
    try { verifCoverage({ backend: "vcs", dir: join(s, "work") }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_RUN")
    expect(err!.message).toContain("coverage")
  } finally {
    g.restore()
  }
})
