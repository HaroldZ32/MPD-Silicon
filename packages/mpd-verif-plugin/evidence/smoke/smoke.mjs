#!/usr/bin/env bun
// Self-contained tool-surface smoke: proves the mpd_verif_* tools work on THIS
// machine using only this repo's built dist, with no source project present.
//
//   bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs
//
// Checks: the backend probe, the project-venv status, a real lint through the
// first available open-source backend, and — only when a cocotb venv satisfies
// the project-venv rule — a real cocotb simulation whose verdict is read from
// the parsed results.xml, never from "it ran". A check that cannot run prints
// SKIP with the exact reason and the command that would enable it; a VCS-only
// lane without VCS on PATH is an evidenced skip, never a silent pass.
//
// Isolation: every artifact lands in a throwaway work dir ($MPD_SMOKE_WORK, or a
// fresh mkdtemp), DSH_HOME is redirected inside it, and nothing is written into
// this repository or the real ~/.dsh.
//
// Exit codes: 0 = no FAIL (skips allowed), 1 = a check failed, 2 = usage error.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { probeAll, venvStatus, verifCompile, verifSim } from "../../dist/index.js"

const args = process.argv.slice(2)
if (args.some((arg) => arg !== "--json")) {
  console.error("[smoke] usage: bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs [--json]")
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const work = process.env.MPD_SMOKE_WORK || mkdtempSync(join(tmpdir(), "mpd-verif-smoke-"))
const rtl = join(work, "rtl")
mkdirSync(rtl, { recursive: true })
process.env.DSH_WORKSPACE_ROOT = work
process.env.DSH_HOME = join(work, "dsh-home")
process.env.MPD_DSH_VERIF_WORK = join(work, ".mpd", "verif")

const results = { stamp: new Date().toISOString(), dist: join(here, "..", "..", "dist", "index.js"), work, backends: [], venv: {}, checks: [], skipped: [] }
const check = (name, ok, detail) => results.checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) })

const backends = probeAll()
results.backends = backends.map((entry) => ({ backend: entry.backend, present: entry.present, version: entry.version ?? null, source: entry.source ?? null }))
check(
  "mpd_verif_backends probes the toolchain",
  Array.isArray(backends) && backends.length >= 3 && backends.every((entry) => typeof entry.backend === "string" && typeof entry.present === "boolean"),
  backends.map((entry) => `${entry.backend}=${entry.present ? (entry.version ?? "present") : "absent"}`).join("; "),
)

const venv = venvStatus()
results.venv = { ok: Boolean(venv.ok), verdict: venv.verdict ?? null, cocotbVersion: venv.cocotbVersion ?? null, path: venv.path ?? null }
check("mpd_verif_venv status answers", typeof venv.verdict === "string" && venv.verdict.length > 0, `verdict=${venv.verdict}`)

const openBackend = ["verilator", "iverilog"].find((name) => backends.some((entry) => entry.backend === name && entry.present))
const good = join(rtl, "good.v")
writeFileSync(good, "module good(input wire clk); always @(posedge clk) ; endmodule\n")

if (!openBackend) {
  results.skipped.push("mpd_verif_lint: no open-source backend on PATH (set MPD_DSH_VERIF_IVERILOG or MPD_DSH_VERIF_VERILATOR)")
} else {
  const lint = verifCompile({ backend: openBackend, sources: [good], target: "lint" })
  check(`mpd_verif_lint via ${openBackend}`, lint.ok, `exit ${lint.exitCode}, diagnostics=${JSON.stringify(lint.diagnostics ?? [])}`)
}

if (!openBackend) {
  results.skipped.push("mpd_verif_sim: no open-source backend on PATH")
} else if (!venv.ok) {
  results.skipped.push(`mpd_verif_sim: no project venv carrying cocotb (verdict=${venv.verdict}); create one with the mpd_verif_venv tool (action=create) or point MPD_DSH_VERIF_VENV at an existing one`)
} else {
  writeFileSync(join(rtl, "adder.v"), "module adder (\n  input  logic [7:0] i_a,\n  input  logic [7:0] i_b,\n  output logic [8:0] o_sum\n);\n  assign o_sum = i_a + i_b;\nendmodule\n")
  writeFileSync(join(rtl, "adder_tb.py"), "import cocotb\nfrom cocotb.triggers import Timer\n\n\n@cocotb.test()\nasync def smoke_add(dut):\n    dut.i_a.value = 3\n    dut.i_b.value = 4\n    await Timer(10, units=\"ns\")\n    assert dut.o_sum.value == 7, f\"got {dut.o_sum.value}\"\n")
  const sim = await verifSim({ backend: openBackend, top: "adder", sources: ["rtl/adder.v"], tbModules: ["adder_tb"], seed: 4242, waves: false, timeoutSec: 300 }, {})
  const cases = (sim.cases ?? []).map((entry) => `${entry.name}:${entry.status}`).join(", ")
  check(`mpd_verif_sim cocotb roundtrip via ${openBackend}`, sim.ok && (sim.cases ?? []).some((entry) => entry.status === "pass"), `exit ${sim.exitCode}, cases=[${cases}]`)
}

const vcs = backends.find((entry) => entry.backend === "vcs")
if (!vcs?.present) {
  results.skipped.push("mpd_verif_uvm / vcs-coverage lane: no VCS on PATH (command -v vcs is empty) — evidenced skip, not a pass")
}

const failed = results.checks.filter((entry) => !entry.ok)
const summary = { ...results, failed: failed.length }
writeFileSync(join(work, "results.json"), JSON.stringify(summary, null, 2) + "\n")

if (args.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  for (const entry of results.checks) console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.name} — ${entry.detail}`)
  for (const entry of results.skipped) console.log(`SKIP ${entry}`)
  console.log(`[smoke] ${failed.length === 0 ? "PASS" : "FAIL"} — ${results.checks.length} check(s), ${results.skipped.length} skip(s) | results: ${join(work, "results.json")}`)
}
process.exit(failed.length === 0 ? 0 : 1)
