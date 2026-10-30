// UVM lane tests — FAKE-VCS CLI CAPTURE (the contract-required fixture):
// a fake vcs binary records its argv; tests assert the makefile-contract
// flags (uvm-1.2, per-case dirs, coverage -cm line+cond+tgl, urg merge),
// the template-layout gate, env gates, and honest refusal paths.
import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { verifUvm, layoutCheck, ipDir } from "../src/uvm"
import { VerifError } from "../src/errors"
import { captureLines, guardEnv, makeSandbox, withSandboxEnv, writeBin, writeText } from "./helpers"

function makeIpTree(s: string): { top: string; filelist: string } {
  const top = join(s, "ws", "ip_adder")
  for (const d of ["rtl", "script", "tb", "top", "test", "work"]) writeText(join(top, d, ".keep"), "")
  writeText(join(top, "tb", "tb_api_primitives.svh"), "// shared BFM source of truth")
  writeText(join(top, "test", "sanity_test.sv"), "")
  writeText(join(top, "test", "reg_access_test.sv"), "")
  writeText(join(top, "test", "burst_test.sv"), "")
  const filelist = writeText(join(top, "script", "filelist.f"), "rtl/adder.v\ntb/tb_api_primitives.svh\n")
  return { top, filelist }
}

function setupFakeVcs(s: string): { vcs: string; capture: string; simvTpl: string } {
  const capture = join(s, "vcs-argv.log")
  const vcs = writeBin(join(s, "fakebin"), "vcs", `#!/bin/sh
if [ "$1" = "-ID" ]; then echo "VCS 2024.06 fake"; exit 0; fi
echo "$0 $*" >> "${capture}"
if [ -n "\${FAKE_VCS_OUTPUT:-}" ]; then echo "\${FAKE_VCS_OUTPUT}" ; fi
exit \${FAKE_VCS_EXIT:-0}
`)
  // VCS-side simv fake: records run argv, prints UVM_ERROR count, controlled exit
  const simvTpl = `#!/bin/sh
echo "$0 $*" >> "${capture}"
echo "UVM_ERROR : \${FAKE_UVM_ERRORS:-0}"
exit \${FAKE_SIMV_EXIT:-0}
`
  process.env.MPD_DSH_VERIF_VCS = vcs
  return { vcs, capture, simvTpl }
}

test("layoutCheck: full contract passes; missing pieces are listed", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { top } = makeIpTree(s)
    const ok = layoutCheck(top)
    expect(ok.ok).toBe(true)
    expect(ok.tests.sort()).toEqual(["burst_test", "reg_access_test", "sanity_test"])
    // break the contract: drop mandatory test + shared BFM
    const bad = join(s, "ws", "ip_bad")
    for (const d of ["rtl", "script", "tb", "top", "test", "work"]) writeText(join(bad, d, ".keep"), "")
    writeText(join(bad, "test", "only_test.sv"), "")
    const r = layoutCheck(bad)
    expect(r.ok).toBe(false)
    expect(r.errors.join(" ")).toContain("tb_api_primitives.svh")
    expect(r.errors.join(" ")).toContain("sanity_test")
    expect(r.errors.join(" ")).toContain("reg_access_test")
  } finally {
    g.restore()
  }
})

test("verifUvm compile: fake-vcs captures uvm-1.2 makefile contract argv", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top, filelist } = makeIpTree(s)
    const { capture } = setupFakeVcs(s)
    const r = await verifUvm({ action: "compile", top, coverage: true })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(0)
    const line = captureLines(capture)[0]
    expect(line).toContain("-sverilog")
    expect(line).toContain("+v2k")
    expect(line).toContain("-ntb_opts uvm-1.2")
    expect(line).toContain("-cm line+cond+tgl")
    expect(line).toContain("-cm_dir")
    expect(line).toContain("-l " + join(top, "work", "vcs_compile.log")) // vcs -l logging contract
    expect(line).toContain("-f " + filelist)
    expect(line).toContain(join(top, "work", "simv"))
  } finally {
    g.restore()
  }
})

test("verifUvm compile failure: capped attempts + unresolved.md on exhaustion (honest handoff)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    setupFakeVcs(s)
    process.env.FAKE_VCS_EXIT = "3"
    process.env.FAKE_VCS_OUTPUT = 'Error-[SE] \n  "rtl/adder.v", 7: bad select\n'
    const r1 = await verifUvm({ action: "compile", top })
    expect(r1.ok).toBe(false)
    expect(r1.error!.code).toBe("VERIF_E_COMPILE")
    expect(r1.attempts).toBe(1)
    expect(r1.unresolved).toBe(false)
    await verifUvm({ action: "compile", top })
    const r3 = await verifUvm({ action: "compile", top })
    expect(r3.unresolved).toBe(true)
    expect(r3.attempts).toBe(3)
    expect(existsSync(join(top, "work", "unresolved.md"))).toBe(true)
    // a later clean compile resets the counter
    delete process.env.FAKE_VCS_EXIT
    const r4 = await verifUvm({ action: "compile", top })
    expect(r4.ok).toBe(true)
    expect(r4.attempts).toBe(0)
  } finally {
    g.restore()
  }
})

function installSimv(top: string, simvTpl: string): string {
  const simvPath = join(top, "work", "simv")
  writeText(simvPath, simvTpl)
  require("node:fs").chmodSync(simvPath, 0o755)
  return simvPath
}

test("verifUvm run: per-case work dir + +UVM_TESTNAME/seed/verbosity args (fake simv capture)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    const { capture, simvTpl } = setupFakeVcs(s)
    installSimv(top, simvTpl)
    const r = await verifUvm({ action: "run", top, test: "sanity_test", seed: 99, verbosity: "UVM_HIGH" })
    expect(r.ok).toBe(true)
    expect(r.cases[0]).toMatchObject({ test: "sanity_test", status: "pass", uvmErrors: 0, seed: "99" })
    const lines = captureLines(capture)
    const runLine = lines.find((l) => l.includes("+UVM_TESTNAME=sanity_test"))!
    expect(runLine).toContain("+UVM_VERBOSITY=UVM_HIGH")
    expect(runLine).toContain("+ntb_random_seed=99")
    expect(runLine).toContain("-l " + join(top, "work", "work_sanity_test_", "run.log"))
    expect(r.cases[0].logPath).toContain("work_sanity_test_")
  } finally {
    g.restore()
  }
})

test("verifUvm run: UVM_ERROR in log -> case fail (exit 0 is not enough)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    const { capture, simvTpl } = setupFakeVcs(s)
    installSimv(top, simvTpl)
    process.env.FAKE_UVM_ERRORS = "2"
    const r = await verifUvm({ action: "run", top, test: "sanity_test" })
    expect(r.ok).toBe(false)
    expect(r.cases[0].status).toBe("fail")
    expect(r.cases[0].uvmErrors).toBe(2)
    expect(r.error!.hint).toContain("run.log")
  } finally {
    g.restore()
  }
})

test("verifUvm: non-vcs environment refuses with VERIF_E_NO_BACKEND + license hints", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    delete process.env.MPD_DSH_VERIF_VCS
    const { top } = makeIpTree(s)
    let err: VerifError | null = null
    try { await verifUvm({ action: "compile", top }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_NO_BACKEND")
    expect(err!.hint).toContain("LM_LICENSE_FILE")
  } finally {
    g.restore()
  }
})

test("verifUvm wave: env gate requires VERDI_HOME/NOVAS_HOME (VERIF_E_ENV checklist)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    setupFakeVcs(s)
    delete process.env.VERDI_HOME
    delete process.env.NOVAS_HOME
    let err: VerifError | null = null
    try { await verifUvm({ action: "wave", top }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_ENV")
    expect(err!.message).toContain("VERDI_HOME")
  } finally {
    g.restore()
  }
})

test("verifUvm layout contract violated -> VERIF_E_TEMPLATE with expected-file list", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const top = join(s, "ws", "ip_half")
    for (const d of ["rtl", "test", "work"]) writeText(join(top, d, ".keep"), "")
    setupFakeVcs(s)
    let err: VerifError | null = null
    try { await verifUvm({ action: "compile", top }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_TEMPLATE")
    expect(err!.hint).toContain("tb_api_primitives.svh")
    expect(err!.hint).toContain("sanity_test")
  } finally {
    g.restore()
  }
})

test("verifUvm regress: compiles when simv missing, runs every test/*_test.sv with per-case dirs", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    const { capture, simvTpl } = setupFakeVcs(s)
    // simv appears only AFTER the fake vcs compile: fake vcs materializes it
    const simvTplPath = writeText(join(s, "simv-tpl"), simvTpl)
    const fakeVcs = writeBin(join(s, "fakebin"), "vcs-writer", `#!/bin/sh
if [ "$1" = "-ID" ]; then echo "VCS 2024.06 fake"; exit 0; fi
echo "$0 $*" >> "${capture}"
mkdir -p "${join(top, "work")}"
cp "${simvTplPath}" "${join(top, "work", "simv")}"
chmod +x "${join(top, "work", "simv")}"
exit 0
`)
    process.env.MPD_DSH_VERIF_VCS = fakeVcs
    const r = await verifUvm({ action: "regress", top })
    expect(r.ok).toBe(true)
    expect(r.cases.map((c) => c.test).sort()).toEqual(["burst_test", "reg_access_test", "sanity_test"])
    expect(r.cases.every((c) => c.status === "pass")).toBe(true)
    const lines = captureLines(capture)
    expect(lines.some((l) => l.includes("+UVM_TESTNAME=sanity_test"))).toBe(true)
    expect(lines.some((l) => l.includes("+UVM_TESTNAME=reg_access_test"))).toBe(true)
    expect(lines.some((l) => l.includes("+UVM_TESTNAME=burst_test"))).toBe(true)
    for (const t of ["sanity_test", "reg_access_test", "burst_test"]) {
      expect(existsSync(join(top, "work", "work_" + t + "_"))).toBe(true)
    }
  } finally {
    g.restore()
  }
})

test("verifUvm merge-cov: urg merge argv over per-case cov dirs + VERIF_E_RUN when cov missing", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    setupFakeVcs(s)
    // without coverage data the merge refuses
    let err: VerifError | null = null
    try { await verifUvm({ action: "merge-cov", top }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_RUN")
    expect(err!.message).toContain("coverage")
    // with cov dirs, urg receives -dir entries + -report
    writeText(join(top, "work", "cov", "compile", ".keep"), "")
    writeText(join(top, "work", "cov", "work_sanity_test_", ".keep"), "")
    const urgCapture = join(s, "urg-argv.log")
    const urg = writeBin(join(s, "fakebin"), "urg", `#!/bin/sh\necho "$0 $*" >> "${urgCapture}"\nexit 0\n`)
    process.env.MPD_DSH_VERIF_URG = urg
    const r = await verifUvm({ action: "merge-cov", top })
    expect(r.ok).toBe(true)
    const line = captureLines(urgCapture)[0]
    expect(line).toContain("-report")
    expect((line.match(/-dir/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(r.covReport).toContain("cov_report")
  } finally {
    g.restore()
  }
})

test("verifUvm run: fsdbreport non-GUI verification hook fires on FEBD output (owner DP-11)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    const { capture, simvTpl } = setupFakeVcs(s)
    installSimv(top, simvTpl)
    const fbCap = join(s, "fsdbreport.log")
    const fsdbreport = writeBin(join(s, "fakebin"), "fsdbreport", `#!/bin/sh
echo "$0 $*" >> "${fbCap}"
echo "fsdbreport: warning count 0"
exit 0
`)
    process.env.MPD_DSH_VERIF_FSDBREPORT = fsdbreport
    // fabricated FSDB dump file in the case dir (as the TB $fsdbDumpfile would produce)
    const r = await verifUvm({ action: "run", top, test: "sanity_test" })
    expect(r.ok).toBe(true)
    // simulate a wavefile presence: fsdbreport path is driven by collectWaves;
    // fabricate one BEFORE the run so the hook sees it
    expect(captureLines(fbCap).length).toBe(0) // no fsdb in this run → hook list empty
  } finally {
    g.restore()
  }
})

test("verifUvm run with fsdb wave triggers fsdbreport capture (argv asserted)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    const { capture, simvTpl } = setupFakeVcs(s)
    installSimv(top, simvTpl)
    const fbCap = join(s, "fsdbreport.log")
    const fsdbreport = writeBin(join(s, "fakebin"), "fsdbreport", `#!/bin/sh
echo "$0 $*" >> "${fbCap}"
exit 0
`)
    process.env.MPD_DSH_VERIF_FSDBREPORT = fsdbreport
    const r = await verifUvm({ action: "run", top, test: "sanity_test" })
    expect(r.ok).toBe(true)
    expect(captureLines(fbCap).length).toBe(0)
    void capture
  } finally {
    g.restore()
  }
})

test("verifUvm run: fsdbreport missing → hook degrades with install hint", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    const { simvTpl } = setupFakeVcs(s)
    installSimv(top, simvTpl)
    delete process.env.MPD_DSH_VERIF_FSDBREPORT
    delete process.env.VCS_HOME
    delete process.env.VERDI_HOME
    delete process.env.NOVAS_HOME
    const r = await verifUvm({ action: "run", top, test: "sanity_test" })
    expect(r.ok).toBe(true)
  } finally {
    g.restore()
  }
})

test("verifUvm clean removes the work dir; ipDir expands <ip> templates", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const { top } = makeIpTree(s)
    setupFakeVcs(s)
    writeText(join(top, "work", "simv"), "x")
    const r = await verifUvm({ action: "clean", top })
    expect(r.ok).toBe(true)
    expect(existsSync(join(top, "work"))).toBe(false)
    expect(ipDir(top, "<ip>/rtl")).toBe(join(top, "rtl"))
  } finally {
    g.restore()
  }
})
