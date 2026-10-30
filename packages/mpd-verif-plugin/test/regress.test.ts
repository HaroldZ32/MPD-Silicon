// Regression tests (cocotb lane): deterministic per-case seeds (seedBase+idx),
// per-case work dirs, results.json + markdown report on disk, failure
// aggregation, stopOnError; plus the vcs-lane delegation path.
import { test, expect } from "bun:test"
import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { verifRegress } from "../src/regress"
import { captureLines, guardEnv, fakeMakeScript, makeFakeVenv, makeSandbox, PASS_XML, withSandboxEnv, writeBin, writeText } from "./helpers"

function setupCocotbLane(s: string): { venv: string } {
  const { venv } = makeFakeVenv(s)
  withSandboxEnv(s, { venv })
  process.env.FAKE_COCOTB_VERSION = "2.0.1"
  process.env.FAKE_RESULTS_XML_FILE = writeText(join(s, "pass.xml"), PASS_XML)
  process.env.FAKE_WAVE = "1"
  writeText(join(s, "ws", "adder.v"), "module adder; endmodule")
  const capture = join(s, "iverilog.log")
  writeBin(join(s, "fakebin"), "iverilog", `#!/bin/sh
if [ "$1" = "-V" ]; then echo "Icarus Verilog version 12.0"; exit 0; fi
echo "$0 $*" >> "${capture}"
exit 0
`)
  process.env.MPD_DSH_VERIF_IVERILOG = join(s, "fakebin", "iverilog")
  writeBin(join(s, "fakebin"), "make", fakeMakeScript({ capture: join(s, "fake-make.log") }))
  process.env.PATH = join(s, "fakebin") + ":" + (process.env.PATH ?? "")
  return { venv }
}

test("cocotb regression: 2 cases, seedBase+idx seeds, results.json + results.md on disk", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = setupCocotbLane(s)
    const base = 20260831
    const r = await verifRegress({ backend: "iverilog", cases: ["case_a", "case_b"], seedBase: base, sim: { top: "adder", sources: ["adder.v"], tbModules: ["adder_tb"] } })
    expect(r.ok).toBe(true)
    expect(r.total).toBe(2)
    expect(r.passed).toBe(2)
    expect(r.failed).toBe(0)
    expect(r.cases.map((c) => c.seed)).toEqual([String(base), String(base + 1)])
    expect(r.cases.every((c) => c.status === "pass")).toBe(true)
    expect(r.cases.every((c) => c.wave?.fmt === "fst")).toBe(true)
    expect(r.resultsJson).toBeTruthy()
    const json = JSON.parse(readFileSync(r.resultsJson!, "utf8"))
    expect(json.total).toBe(2)
    expect(json.cases[0].seed).toBe(String(base))
    expect(existsSync(r.reportPath)).toBe(true)
    expect(r.reportMarkdown).toContain("| case | seed | status |")
    expect(r.reportMarkdown).toContain("case_a")
    // fake make ran exactly twice (per-case isolation, Makefile flow)
    const makeLog = readFileSync(join(s, "fake-make.log"), "utf8")
    expect(makeLog.split("argv:").length - 1).toBe(2)
    expect(makeLog).toContain("cocotb-results:")
  } finally {
    g.restore()
  }
})

test("cocotb regression: missing venv refuses with the iron-rule code", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s, { venv: join(s, "no-venv") })
    let code = ""
    try { await verifRegress({ backend: "iverilog", cases: ["a"], sim: { top: "t", sources: ["t.v"] } }) } catch (e) { code = (e as { code: string }).code }
    expect(code).toBe("VERIF_E_NO_VENV")
  } finally {
    g.restore()
  }
})

test("cocotb regression: stopOnError halts after the first failing case", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    setupCocotbLane(s)
    // first case fails (every case's fake make exits non-zero → sim fails)
    process.env.FAKE_MAKE_EXIT = "1"
    const r = await verifRegress({ backend: "iverilog", cases: ["a", "b", "c"], stopOnError: true, sim: { top: "adder", sources: ["adder.v"] } })
    expect(r.failed).toBe(1)
    expect(r.total).toBe(1) // stopped after first failure
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe("VERIF_E_RUN")
  } finally {
    g.restore()
  }
})

test("cocotb regression: maxFailures bound also stops the loop", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    setupCocotbLane(s)
    process.env.FAKE_MAKE_EXIT = "1"
    const r = await verifRegress({ backend: "iverilog", cases: ["a", "b", "c", "d"], maxFailures: 2, sim: { top: "adder", sources: ["adder.v"] } })
    expect(r.total).toBe(2)
    expect(r.failed).toBe(2)
  } finally {
    g.restore()
  }
})

test("vcs regression delegates to the UVM lane (layout-driven case discovery)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const top = join(s, "ws", "ip_adder")
    for (const d of ["rtl", "script", "tb", "top", "test", "work"]) writeText(join(top, d, ".keep"), "")
    writeText(join(top, "tb", "tb_api_primitives.svh"), "")
    writeText(join(top, "test", "sanity_test.sv"), "")
    writeText(join(top, "test", "reg_access_test.sv"), "")
    writeText(join(top, "script", "filelist.f"), "rtl/adder.v\n")
    const capture = join(s, "vcs-argv.log")
    const simv = writeText(join(s, "simv-tpl"), `#!/bin/sh
echo "$0 $*" >> "${capture}"
echo "UVM_ERROR : 0"
exit 0
`)
    const vcs = writeBin(join(s, "fakebin"), "vcs", `#!/bin/sh
if [ "$1" = "-ID" ]; then echo "VCS 2024.06 fake"; exit 0; fi
echo "$0 $*" >> "${capture}"
mkdir -p "${join(top, "work")}"
cp "${simv}" "${join(top, "work", "simv")}"
chmod +x "${join(top, "work", "simv")}"
exit 0
`)
    process.env.MPD_DSH_VERIF_VCS = vcs
    const r = await verifRegress({ backend: "vcs", sim: { top } })
    expect(r.ok).toBe(true)
    expect(r.total).toBe(2)
    expect(r.passed).toBe(2)
    expect(r.cases.every((c) => c.backend === "vcs")).toBe(true)
    expect(captureLines(capture).some((l) => l.includes("+UVM_TESTNAME=sanity_test"))).toBe(true)
  } finally {
    g.restore()
  }
})

test("regress: bad backend id refuses with VERIF_E_UNSUPPORTED", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    let code = ""
    try { await verifRegress({ backend: "xrun" as never, cases: ["a"] }) } catch (e) { code = (e as { code: string }).code }
    expect(code).toBe("VERIF_E_UNSUPPORTED")
  } finally {
    g.restore()
  }
})

// R1 ordering (negative control). Pre-fix, verifRegress ran runStamp()/mkdirSync
// BEFORE the iron gate, so the two tests below would fail: the first escapes as
// a raw ENOTDIR filesystem error instead of VERIF_E_NO_VENV, the second leaves a
// stray regress work dir behind. Both are asserted directly, so the ordering —
// not merely the message — is pinned.
test("R1 ordering: with NO session the iron gate refuses BEFORE any work-dir creation (blocked work root)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s, { venv: join(s, "no-venv") })
    // Block the work root with a REGULAR FILE: any pre-gate mkdirSync of
    // <work>/regress/<stamp> throws ENOTDIR, which is exactly the opaque
    // host-root filesystem failure R1 reported in the field.
    const blockedWork = join(s, "blocked-work")
    writeText(blockedWork, "regular file, not a directory")
    process.env.MPD_DSH_VERIF_WORK = blockedWork
    // Sanity: the blocker really blocks the pre-fix code path.
    expect(() => mkdirSync(join(blockedWork, "regress", "x"))).toThrow()
    let code = ""
    let message = ""
    try {
      await verifRegress({ backend: "iverilog", cases: ["a"], sim: { top: "t", sources: ["t.v"] } })
    } catch (e) {
      code = (e as { code: string }).code
      message = String((e as Error).message)
    }
    expect(code).toBe("VERIF_E_NO_VENV")
    expect(message).toContain("iron rule")
  } finally {
    g.restore()
  }
})

test("R1 ordering: a session-scoped call passes the gate, stops at backend resolution, and creates no work dir", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    process.env.FAKE_COCOTB_VERSION = "2.0.1"
    // Unresolvable backend: no env override and an empty PATH entry list.
    delete process.env.MPD_DSH_VERIF_IVERILOG
    process.env.PATH = join(s, "empty-bin")
    let code = ""
    try {
      await verifRegress({ backend: "iverilog", cases: ["a"], sim: { top: "t", sources: ["t.v"] } })
    } catch (e) {
      code = (e as { code: string }).code
    }
    expect(code).toBe("VERIF_E_NO_BACKEND")
    expect(existsSync(join(s, "work", "regress"))).toBe(false)
  } finally {
    g.restore()
  }
})

test("R1 ordering: the vcs lane also refuses before any work-dir creation", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    let code = ""
    try {
      await verifRegress({ backend: "vcs" })
    } catch (e) {
      code = (e as { code: string }).code
    }
    expect(code).toBe("VERIF_E_RUN")
    expect(existsSync(join(s, "work", "regress"))).toBe(false)
  } finally {
    g.restore()
  }
})

// R1-F1 (argument pinning, NOT message matching). The session workspace holds the
// venv while DSH_WORKSPACE_ROOT points at a DIFFERENT directory with no venv, and
// the fake venv python records EVERY invocation. The pre-fix call shape
// (`verifSim({...}, {})`, exec not forwarded) makes the per-case iron gate resolve
// DSH_WORKSPACE_ROOT -> missing -> the case fails with the venv refusal, and the
// session python is never executed. With `exec` forwarded, the gate resolves the
// session cwd: the session python IS executed (recorded) and the case runs to
// completion. Both assertions therefore pin the forwarded argument.
test("R1-F1: verifRegress forwards exec so the per-case sim gates on the SESSION venv, not DSH_WORKSPACE_ROOT", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const sessionWs = join(s, "ws")
    const sessionVenv = join(sessionWs, ".venv-rtl")
    const sessionPy = join(sessionVenv, "bin", "python")
    const pyCapture = join(s, "session-py.log")
    writeBin(join(sessionVenv, "bin"), "python", `#!/bin/sh
echo "$0 $*" >> "${pyCapture}"
if [ "$1" = "--version" ]; then echo "Python 3.12.1 (fake)"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
exit 0
`)
    // The session workspace and DSH_WORKSPACE_ROOT DISAGREE on purpose.
    process.env.DSH_WORKSPACE_ROOT = join(s, "other")
    process.env.MPD_DSH_VERIF_WORK = join(s, "work")
    delete process.env.MPD_DSH_VERIF_VENV
    // A resolvable backend, so the REGRESS-level probe does not stop the lane
    // before the per-case sim (the defect lives in that per-case call).
    process.env.MPD_DSH_VERIF_IVERILOG = writeBin(join(s, "fakebin"), "iverilog", `#!/bin/sh
if [ "$1" = "-V" ]; then echo "Icarus Verilog version 12.0"; exit 0; fi
exit 0
`)
    writeBin(join(s, "fakebin"), "make", fakeMakeScript({ capture: join(s, "fake-make.log") }))
    process.env.PATH = join(s, "fakebin") + ":" + (process.env.PATH ?? "")
    process.env.FAKE_COCOTB_VERSION = "2.0.1"
    process.env.FAKE_RESULTS_XML_FILE = writeText(join(s, "pass.xml"), PASS_XML)
    writeText(join(sessionWs, "adder.v"), "module adder; endmodule")
    const exec = { agent: { session: { header: { cwd: sessionWs } } } }

    const r = await verifRegress({ backend: "iverilog", cases: ["case_a"], sim: { top: "adder", sources: ["adder.v"], tbModules: ["adder_tb"] } }, undefined, exec)

    // Direct proof that the exec-derived path was probed by the per-case sim.
    expect(existsSync(pyCapture)).toBe(true)
    const probed = readFileSync(pyCapture, "utf8")
    expect(probed).toContain(sessionPy)
    expect(probed).not.toContain(join(s, "other"))
    // ... and the per-case sim got past its gate and ran to completion.
    expect(r.cases).toHaveLength(1)
    expect(r.cases[0].status).toBe("pass")
    expect(r.cases[0].failureMsg).toBeNull()
    expect(r.passed).toBe(1)
    expect(r.ok).toBe(true)
  } finally {
    g.restore()
  }
})
