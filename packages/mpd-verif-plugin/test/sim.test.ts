// sim (cocotb lane) tests: lane gating, iron-rule refusals, runner.py
// generation, run via <venv>/bin/python runner.py (argv captured), results.xml
// parsing, wave collection, and wave-hook degradation.
import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { verifSim, buildSimMakefile, parseResultsXml, collectWaves, writeIcarusShimDir, type SimCase } from "../src/sim"
import { VerifError } from "../src/errors"
import { captureLines, FAIL_XML, fakeMakeScript, guardEnv, makeFakeVenv, makeSandbox, PASS_XML, withSandboxEnv, writeBin, writeText } from "./helpers"

const SRCS = ["adder.v"]

test("parseResultsXml: pass xml -> per-case statuses + summary", () => {
  const parsed = parseResultsXml(PASS_XML)
  expect(parsed.summary).toMatchObject({ tests: 2, failures: 0 })
  expect(parsed.cases.map((c) => c.status)).toEqual(["pass", "pass"])
  expect(parsed.cases[0].name).toBe("smoke_add")
})

test("D2 regress: self-closing <failure .../> (cocotb 2.0.1 xUnit) — 3/4 failures must NOT parse as pass", () => {
  const xml = readFileSync(join(__dirname, "fixtures", "cnt8-failures.xml"), "utf8")
  const parsed = parseResultsXml(xml)
  expect(parsed.cases.map((c) => c.status)).toEqual(["pass", "fail", "fail", "fail"])
  expect(parsed.cases[1].failureMsg).toBe("AssertionError: q=0 after 1 cycles, want 1")
  expect(parsed.cases[2].failureMsg).toBe("AssertionError: q=0 after load, want 0xAB")
})

test("D2 regress: self-closing <error .../> and body-form failure/error variants", () => {
  const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="all">
  <testcase name="self_err" time="0.1"><error error_type="SIGSEGV" error_msg="stack overflow" /></testcase>
  <testcase name="body_fail" time="0.1"><failure message="boom">AssertionError text body</failure></testcase>
  <testcase name="body_err" time="0.1"><error>hard error body</error></testcase>
  <testcase name="ok" time="0.1" />
</testsuite></testsuites>`
  const parsed = parseResultsXml(xml)
  expect(parsed.cases.map((c) => [c.name, c.status])).toEqual([
    ["self_err", "error"],
    ["body_fail", "fail"],
    ["body_err", "error"],
    ["ok", "pass"],
  ])
  expect(parsed.cases[0].failureMsg).toBe("SIGSEGV: stack overflow")
  expect(parsed.cases[1].failureMsg).toBe("AssertionError text body")
})

test("parseResultsXml: failure block -> fail status + failure message", () => {
  const parsed = parseResultsXml(FAIL_XML)
  const f = parsed.cases[1]
  expect(f.status).toBe("fail")
  expect(f.failureMsg).toContain("sum mismatch")
})

test("verifSim: vcs backend is refused (VERIF_E_UNSUPPORTED -> use mpd_verif_uvm)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    let err: VerifError | null = null
    try { await verifSim({ backend: "vcs", top: "t", sources: SRCS }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_UNSUPPORTED")
    expect(err!.hint).toContain("mpd_verif_uvm")
  } finally {
    g.restore()
  }
})

test("verifSim: missing venv -> VERIF_E_NO_VENV with exact setup command (iron rule)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s, { venv: join(s, "no-venv") })
    let err: VerifError | null = null
    try { await verifSim({ backend: "iverilog", top: "t", sources: SRCS }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_NO_VENV")
    expect(err!.hint).toContain("python3 -m venv .venv-rtl")
  } finally {
    g.restore()
  }
})

test("verifSim: venv without cocotb -> VERIF_E_COCOTB_ABSENT", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    delete process.env.FAKE_COCOTB_VERSION
    let err: VerifError | null = null
    try { await verifSim({ backend: "iverilog", top: "t", sources: SRCS }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_COCOTB_ABSENT")
    expect(err!.hint).toContain("/bin/pip install")
  } finally {
    g.restore()
  }
})

function setupHappy(s: string): { venv: string; capture: string } {
  const { venv, pyCapture } = makeFakeVenv(s)
  withSandboxEnv(s, { venv })
  process.env.FAKE_COCOTB_VERSION = "2.0.1"
  process.env.FAKE_RESULTS_XML_FILE = writeText(join(s, "results-fixture.xml"), PASS_XML)
  process.env.FAKE_WAVE = "1"
  writeText(join(s, "ws", "adder.v"), "module adder; endmodule")
  const capture = join(s, "fake-iverilog.log")
  writeBin(join(s, "fakebin"), "iverilog", `#!/bin/sh
if [ "$1" = "-V" ]; then echo "Icarus Verilog version 12.0 (devel fake)"; exit 0; fi
echo "$0 $*" >> "${capture}"
exit 0
`)
  writeBin(join(s, "fakebin"), "vvp", "#!/bin/sh\nexit 0\n")
  process.env.MPD_DSH_VERIF_IVERILOG = join(s, "fakebin", "iverilog")
  writeBin(join(s, "fakebin"), "make", fakeMakeScript({ capture: join(s, "fake-make.log") }))
  process.env.PATH = join(s, "fakebin") + ":" + (process.env.PATH ?? "")
  return { venv, capture }
}

test("verifSim happy path: runner.py generated, executed via <venv>/bin/python, results parsed, waves collected", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = setupHappy(s)
    // The measured /opt failure: the session exports PYTHONHOME=<oss-cad-suite>,
    // which redirects the venv Python and kills the cocotb VPI in Py_Initialize.
    // The make child must NOT see it (and an empty value is not enough).
    process.env.PYTHONHOME = "/opt/openictool/oss-cad-suite"
    const r = await verifSim({ backend: "iverilog", top: "adder", sources: ["adder.v"], seed: 7, tbModules: ["adder_tb"] })
    expect(r.ok).toBe(true)
    expect(r.backend).toBe("iverilog")
    expect(r.venv).toBe(venv)
    expect(r.cocotbVersion).toBe("2.0.1")
    expect(r.cases.map((c: SimCase) => c.status)).toEqual(["pass", "pass"])
    expect(r.seed).toBe("7")
    expect(r.wavesfiles.length).toBe(1)
    expect(r.wavesfiles[0].fmt).toBe("fst")
    expect(r.waveHooks.length).toBe(1)
    expect(r.waveHooks[0].status).toBe("unavailable") // wave-mcp not wired -> graceful degrade
    // DP-6 iron rule: make runs with $VENV/bin PREPENDED to PATH; the fake
    // make records PATH head + COCOTB_* env evidence.
    const makeLog = readFileSync(join(s, "fake-make.log"), "utf8")
    expect(makeLog).toContain("argv: -f " + join(r.caseDir, "Makefile") + " sim")
    expect(makeLog).toContain("path-head: " + join(venv, "bin"))
    expect(makeLog).toContain("cocotb-results: " + join(r.caseDir, "results.xml"))
    expect(makeLog).toContain("cocotb-modules: adder_tb")
    expect(makeLog).toContain("cocotb-seed: 7")
    expect(makeLog).toContain("pythonhome: unset") // inherited PYTHONHOME removed from the make env
    // The make PATH is $VENV/bin FIRST, then the resolved tool dir, then the
    // inherited PATH; that is what lets cocotb's bare iverilog/vvp calls resolve.
    const simLogText = readFileSync(r.simLog, "utf8")
    const pathLine = simLogText.split("\n").find((line) => line.includes("(PATH="))!
    const makePath = pathLine.slice(pathLine.indexOf("(PATH=") + 6, -1)
    const pathParts = makePath.split(":")
    expect(pathParts[0]).toBe(join(venv, "bin"))
    expect(pathParts[1]).toBe(join(s, "fakebin"))
    const which = spawnSync("sh", ["-c", "command -v iverilog; command -v vvp"], { env: { ...process.env, PATH: makePath }, encoding: "utf8" })
    expect(which.status).toBe(0)
    expect(which.stdout.trim().split("\n")).toEqual([join(s, "fakebin", "iverilog"), join(s, "fakebin", "vvp")])
    // generated Makefile mirrors the cocotb makefile contract (cocotb names the
    // Icarus simulator `icarus`; `iverilog` is not a cocotb SIM value)
    const mk = readFileSync(join(r.caseDir, "Makefile"), "utf8")
    expect(mk).toContain("SIM := icarus")
    expect(mk).not.toContain("SIM := iverilog")
    expect(mk).toContain("TOPLEVEL_LANG := verilog")
    expect(mk).toContain("COCOTB_TOPLEVEL := adder")
    expect(mk).toContain("WAVES := 1")
    expect(mk).toContain("include $(shell cocotb-config --makefiles)/Makefile.sim")
  } finally {
    g.restore()
  }
})

test("verifSim: failing case -> ok=false with VERIF_E_RUN details", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    setupHappy(s)
    process.env.FAKE_RESULTS_XML_FILE = writeText(join(s, "results-fixture-fail.xml"), FAIL_XML)
    const r = await verifSim({ backend: "iverilog", top: "adder", sources: ["adder.v"], timeoutSec: 30 })
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe("VERIF_E_RUN")
    expect(r.cases[1].status).toBe("fail")
    expect((r.cases[1] as SimCase).failureMsg).toContain("sum mismatch")
  } finally {
    g.restore()
  }
})

test("verifSim: vvp/runner non-zero exit WITHOUT results.xml -> VERIF_E_RUN with actionable hint", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    setupHappy(s)
    delete process.env.FAKE_RESULTS_XML_FILE // runner produces nothing
    let err: VerifError | null = null
    try { await verifSim({ backend: "iverilog", top: "adder", sources: ["adder.v"], timeoutSec: 30 }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_RUN")
    expect(err!.message).toContain("no results.xml")
  } finally {
    g.restore()
  }
})

test("verifSim: backend binary absent (env pinned to missing path) -> VERIF_E_NO_BACKEND", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    process.env.FAKE_COCOTB_VERSION = "2.0.1"
    process.env.MPD_DSH_VERIF_IVERILOG = join(s, "no-such-iverilog")
    process.env.PATH = join(s, "empty-bin") // nothing resolves on PATH either
    let err: VerifError | null = null
    try { await verifSim({ backend: "iverilog", top: "adder", sources: ["adder.v"] }) } catch (e) { err = e as VerifError }
    expect(err!.code).toBe("VERIF_E_NO_BACKEND")
    expect(err!.hint).toContain("MPD_DSH_VERIF_IVERILOG")
  } finally {
    g.restore()
  }
})

test("buildSimMakefile: DP-6 Makefile contract (SIM/COCOTB_TOPLEVEL/FST/defines)", () => {
  const base = { backend: "verilator" as const, top: "t", sources: ["/w/t.v"], includes: [], defines: { W: 8, EN: 1 }, waves: true, traceFst: true, coverage: false }
  const fst = buildSimMakefile(base)
  expect(fst).toContain("SIM := verilator")
  expect(fst).toContain("COCOTB_TOPLEVEL := t")
  expect(fst).toContain("COMPILE_ARGS += --trace-fst --trace-structs") // owner DP-6: FST via +--trace-fst
  expect(fst).toContain("+define+W=8")
  expect(fst).toContain("+define+EN")
  expect(fst).toContain("VERILOG_SOURCES")
  const vcd = buildSimMakefile({ ...base, traceFst: false })
  expect(vcd).toContain("COMPILE_ARGS += --trace --trace-structs") // VCD fallback lane
  expect(vcd).toContain("SIM_ARGS += --trace")
  const cov = buildSimMakefile({ ...base, coverage: true })
  expect(cov).toContain("COMPILE_ARGS += --coverage")
  const ic = buildSimMakefile({ ...base, backend: "iverilog" })
  expect(ic).toContain("SIM := icarus") // cocotb's simulator NAME, not the backend id
  expect(ic).not.toContain("SIM := iverilog")
  expect(ic).toContain("WAVES := 1  # icarus FST via -fst + dump module")
  expect(ic).toContain("Makefile.sim")
  expect(ic).not.toContain("ICARUS_BIN_DIR") // no shim needed by default
  const shimmed = buildSimMakefile({ ...base, backend: "iverilog", icarusBinDir: "/tmp/shim" })
  expect(shimmed).toContain("ICARUS_BIN_DIR := /tmp/shim")
})

test("writeIcarusShimDir: a vvp wrapper that exports PYTHONHOME is bypassed via its loader", () => {
  const s = makeSandbox()
  const top = join(s, "oss")
  const iverilog = writeBin(join(top, "bin"), "iverilog", "#!/bin/sh\nexit 0\n")
  writeText(join(top, "lib", "ld-linux-x86-64.so.2"), "loader")
  writeText(join(top, "libexec", "vvp"), "inner")
  const vvp = writeBin(join(top, "bin"), "vvp", `#!/bin/sh\nexport PYTHONHOME="${top}"\nexec "${top}/lib/ld-linux-x86-64.so.2" "${top}/libexec/vvp" "$@"\n`)

  const shimDir = writeIcarusShimDir(join(s, "case"), iverilog, vvp)
  expect(shimDir).toBe(join(s, "case", "toolshim"))
  const vvpShim = readFileSync(join(shimDir!, "vvp"), "utf8")
  expect(vvpShim).toContain("env -u PYTHONHOME")
  expect(vvpShim).toContain(join(top, "libexec", "vvp"))
  expect(vvpShim).toContain("--library-path")
  expect(readFileSync(join(shimDir!, "iverilog"), "utf8")).toContain(iverilog)
  expect((statSync(join(shimDir!, "vvp")).mode & 0o111) !== 0).toBe(true)
})

test("writeIcarusShimDir: a normal vvp binary gets NO shim (behaviour unchanged)", () => {
  const s = makeSandbox()
  const top = join(s, "plain")
  const iverilog = writeBin(join(top, "bin"), "iverilog", "#!/bin/sh\nexit 0\n")
  const vvp = writeBin(join(top, "bin"), "vvp", "#!/bin/sh\nexit 0\n")
  expect(writeIcarusShimDir(join(s, "case"), iverilog, vvp)).toBeNull()
})

test("verifSim: a config-resolved backend dir is prepended after the venv, before the inherited PATH", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    process.env.FAKE_COCOTB_VERSION = "2.0.1"
    process.env.FAKE_RESULTS_XML_FILE = writeText(join(s, "results-fixture.xml"), PASS_XML)
    writeText(join(s, "ws", "adder.v"), "module adder; endmodule")
    const toolBin = join(s, "config-bin")
    writeBin(toolBin, "iverilog", `#!/bin/sh
if [ "$1" = "-V" ]; then echo "Icarus Verilog version 12.0 (config fake)"; exit 0; fi
exit 0
`)
    writeBin(toolBin, "vvp", "#!/bin/sh\nexit 0\n")
    delete process.env.MPD_DSH_VERIF_IVERILOG
    writeBin(join(s, "fakebin"), "make", fakeMakeScript({ capture: join(s, "fake-make.log") }))
    process.env.PATH = join(s, "fakebin") + ":" + (process.env.PATH ?? "")

    // Mirrors the tool layer: index.ts loads silicon.jsonc and passes the config
    // as the fourth argument (verifSim itself does no config I/O).
    const r = await verifSim(
      { backend: "iverilog", top: "adder", sources: ["adder.v"], waves: false, waveHook: false },
      {},
      undefined,
      { ossCadSuite: { bin: toolBin } },
    )
    expect(r.ok).toBe(true)
    expect(readFileSync(r.makefilePath, "utf8")).toContain("SIM := icarus")

    const pathLine = readFileSync(r.simLog, "utf8").split("\n").find((line) => line.includes("(PATH="))!
    const makePath = pathLine.slice(pathLine.indexOf("(PATH=") + 6, -1)
    const pathParts = makePath.split(":")
    expect(pathParts[0]).toBe(join(venv, "bin"))
    expect(pathParts[1]).toBe(toolBin) // resolved from ossCadSuite.bin, not from the inherited PATH
    const which = spawnSync("sh", ["-c", "command -v iverilog; command -v vvp"], { env: { ...process.env, PATH: makePath }, encoding: "utf8" })
    expect(which.status).toBe(0)
    expect(which.stdout.trim().split("\n")).toEqual([join(toolBin, "iverilog"), join(toolBin, "vvp")])
  } finally {
    g.restore()
  }
})

test("collectWaves finds fst/vcd recursively and classifies fmt", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    const w1 = writeText(join(s, "w", "a.fst"), "x")
    const w2 = writeText(join(s, "w", "b.vcd"), "x")
    const waves = collectWaves(join(s, "w"))
    const byFmt = Object.fromEntries(waves.map((wf) => [wf.file, wf.fmt]))
    expect(byFmt[w1]).toBe("fst")
    expect(byFmt[w2]).toBe("vcd")
  } finally {
    g.restore()
  }
})

test("verifSim leaves ALL state under workspace work dir (never ~/.dsh)", async () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    setupHappy(s)
    const r = await verifSim({ backend: "iverilog", top: "adder", sources: ["adder.v"] })
    expect(r.caseDir.startsWith(join(s, "work"))).toBe(true)
    expect(readdirSync(join(s, "dsh-home")).length).toBe(0) // DSH_HOME touched nowhere
    expect(r.resultsXml!.startsWith(join(s, "work"))).toBe(true)
  } finally {
    g.restore()
  }
})
