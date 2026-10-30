// Core unit tests: env resolution, backend argv plans, diagnostics parsing,
// error taxonomy shapes (plus fenced fake-binary executions).
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveBackendBinary, dateSeedBase, BACKEND_ENV } from "../src/env"
import { lintPlan, compilePlan, parseDiagnostics, writeVcsFilelist } from "../src/backends"
import { verifCompile } from "../src/compile"
import { refusalOf, VerifError, type VerifErrorShape } from "../src/errors"
import { guardEnv, makeSandbox, withSandboxEnv, writeBin } from "./helpers"

test("resolveBackendBinary: MPD_DSH_* env override wins over PATH", () => {
  const g = guardEnv()
  try {
    process.env.MPD_DSH_VERIF_IVERILOG = "/opt/custom/iverilog"
    delete process.env.MPD_DSH_VERIF_VCS
    const iv = resolveBackendBinary("iverilog")
    expect(iv?.binary).toBe("/opt/custom/iverilog")
    expect(iv?.source).toBe("env")
    expect(BACKEND_ENV.vcs).toBe("MPD_DSH_VERIF_VCS")
    // env source is returned even if the file does not exist (QA can assert the exact attempt path)
    const r = resolveBackendBinary("iverilog")!
    expect(r.binary).toBe("/opt/custom/iverilog")
  } finally {
    g.restore()
  }
})

test("resolveBackendBinary: PATH fallback finds real tooling or null", () => {
  const g = guardEnv()
  try {
    delete process.env.MPD_DSH_VERIF_IVERILOG
    delete process.env.MPD_DSH_VERIF_VERILATOR
    delete process.env.MPD_DSH_VERIF_VCS
    // real machine may have iverilog; either way shape is stable
    const r = resolveBackendBinary("iverilog")
    expect(r === null || r.source === "path").toBe(true)
  } finally {
    g.restore()
  }
})

test("dateSeedBase is an 8-digit YYYYMMDD int (deterministic per calendar day)", () => {
  expect(dateSeedBase(new Date(2026, 7, 31))).toBe(20260831)
  expect(String(dateSeedBase(new Date(2026, 7, 31))).length).toBe(8)
})

test("D1 regress: compilePlan creates the build dir BEFORE the tool would spawn (preflight-backed)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    // direct plan check: the output dir exists as soon as the plan is built
    const plan = compilePlan("iverilog", { sources: ["a.v"], top: "t" }, join(s, "work"), "s1")
    expect(existsSync(join(plan.outBinary, ".."))).toBe(true)
    // fuse it through the full compile tool with a fake binary that FAILS (exit
    // 255, the reviewer's D1 repro) unless the -o parent dir already exists at
    // spawn time — proving the mkdir happens before spawn, not after.
    const wk = join(s, "work2")
    writeBin(join(s, "fakebin"), "iverilog", `#!/bin/sh
d=$(dirname "$3")  # args: -g2012 -o <out> ...
if [ ! -d "$d" ]; then echo "ENOENT: missing -o dir $d"; exit 255; fi
touch "$d/.preflight-dir-ok"
exit 0
`)
    process.env.MPD_DSH_VERIF_IVERILOG = join(s, "fakebin", "iverilog")
    process.env.MPD_DSH_VERIF_WORK = wk
    const r = verifCompile({ backend: "iverilog", sources: [join(s, "ws", "a.v")], top: "t", target: "compile" })
    expect(r.ok).toBe(true)
    expect(r.exitCode).toBe(0)
    expect(existsSync(join(r.outBinary!, "..", ".preflight-dir-ok"))).toBe(true)
  } finally {
    g.restore()
  }
})

test("D1 regress: verilator compile target also pre-creates the build dir", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const plan = compilePlan("verilator", { sources: ["a.v"], top: "t" }, join(s, "work3"), "s2")
    expect(existsSync(join(plan.outBinary, ".."))).toBe(true)
  } finally {
    g.restore()
  }
})

test("lintPlan argv contracts per backend (t2 design)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const src = { sources: ["a.v", "b.v"], top: "tb_top", includes: ["inc"], defines: { W: 8, FLAG: 1 } }
    const iv = lintPlan("iverilog", src, join(s, "logs"), "s")
    expect(iv.args.slice(0, 3)).toEqual(["-g2012", "-tnull", "-Wall"])
    expect(iv.args).toContain("-s")
    expect(iv.args).toContain("tb_top")
    expect(iv.args).toContain("-Iinc")
    expect(iv.args).toContain("-DW=8")
    const vl = lintPlan("verilator", src, join(s, "logs"), "s")
    expect(vl.args.slice(0, 2)).toEqual(["--lint-only", "-Wall"])
    expect(vl.args).toContain("--top-module")
    const vcs = lintPlan("vcs", src, join(s, "logs"), "s")
    expect(vcs.args).toEqual(["-lca", "-sverilog", "+lint=all", "-f", vcs.filelistPath!, "-top", "tb_top", "-l", vcs.logPath!])
    // vcs filelist carries incdir/define lines + sources (vcs-native -f format)
    const fl = readFileSync(vcs.filelistPath!, "utf8")
    expect(fl).toContain("+incdir+inc")
    expect(fl).toContain("+define+W=8")
    expect(fl).toContain("a.v")
  } finally {
    g.restore()
  }
})

test("compilePlan argv contracts and vcs simv output", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    const src = { sources: ["a.v"], top: "dut" }
    const iv = compilePlan("iverilog", src, join(s, "work"), "s")
    expect(iv.args[0]).toBe("-g2012")
    expect(iv.args).toContain("-o")
    expect(iv.outBinary.endsWith("simv_iverilog")).toBe(true)
    const vl = compilePlan("verilator", src, join(s, "work"), "s")
    expect(vl.args[0]).toBe("--binary")
    const vcs = compilePlan("vcs", src, join(s, "work"), "s")
    expect(vcs.args).toContain("-sverilog")
    expect(vcs.args).toContain("+v2k")
    expect(vcs.outBinary.endsWith("simv")).toBe(true)
  } finally {
    g.restore()
  }
})

test("parseDiagnostics: iverilog / verilator / vcs dialects", () => {
  const iv = parseDiagnostics("iverilog", "adder.v:12: error: syntax error\nadder.v:14: warning: unused\n")
  expect(iv[0]).toMatchObject({ file: "adder.v", line: 12, severity: "error" })
  expect(iv[1]).toMatchObject({ severity: "warning" })
  const vl = parseDiagnostics("verilator", "%Error: bad.v:3:3: Undefined variable\n%Warning-BLKSEQ: x.v:5:1: blocking\n")
  expect(vl[0]).toMatchObject({ file: "bad.v", line: 3, severity: "error", code: "Error" })
  expect(vl[1]).toMatchObject({ file: "x.v", severity: "warning", code: "BLKSEQ" })
  const vcsLog = 'Error-[SE] \n  "top.v", 7: bad select\nWarning-[LCA] \n  "m.v", 2: lint\n'
  const vc = parseDiagnostics("vcs", vcsLog)
  expect(vc[0]).toMatchObject({ file: "top.v", line: 7, severity: "error", code: "SE" })
  expect(vc[1]).toMatchObject({ file: "m.v", line: 2, severity: "warning", code: "LCA" })
})

test("writeVcsFilelist emits the vcs-native -f file format", () => {
  const s = makeSandbox()
  const p = join(s, "f.f")
  writeVcsFilelist(p, ["r/adder.v"], ["r/inc"], { WD: 8, EN: 1 })
  const txt = readFileSync(p, "utf8")
  expect(txt).toContain("+incdir+r/inc")
  expect(txt).toContain("+define+WD=8")
  expect(txt).toContain("+define+EN")
  expect(txt).toContain("r/adder.v")
})

test("refusalOf: VerifError keeps code/message/hint; unknown becomes VERIF_E_RUN", () => {
  const r1 = refusalOf(new VerifError("VERIF_E_NO_VENV", "m", "h"))
  expect((r1.error as VerifErrorShape).code).toBe("VERIF_E_NO_VENV")
  expect((r1.error as VerifErrorShape).hint).toBe("h")
  const r2 = refusalOf("boom")
  expect((r2.error as VerifErrorShape).code).toBe("VERIF_E_RUN")
  expect(JSON.parse(JSON.stringify(r2))).toEqual(r2) // lossless JSON (host contract)
})
