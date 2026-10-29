// Waveform-read hook tests: probe user-wired MCP tools by exact registry name
// (mcp__wave_mcp__prepare_session / mcp__traceweave__get_sim_paths), call them
// with correct args, and degrade gracefully with actionable messages when the
// rows are not wired (the shipped-by-default state until Lead wires the rows).
import { test, expect } from "bun:test"
import { runWaveHooks, waveSessionDir, type WaveTools } from "../src/wave"

function mockTools(registry: Record<string, { args?: Record<string, unknown>; fail?: boolean; noValue?: boolean }>, calls: { name: string; arguments: Record<string, unknown> }[]): WaveTools {
  return {
    get: (name: string) => (name in registry ? { name } : undefined),
    execute: async (input) => {
      calls.push({ name: input.name, arguments: input.arguments as Record<string, unknown> })
      const def = registry[input.name]
      if (!def) return { isError: true, error: "tool error" }
      if (def.fail) throw new Error("boom")
      if (def.noValue) return { isError: false }
      return { isError: false, value: { session_id: "s1", status: "connected" } }
    },
  }
}

test("wave-mcp not wired -> unavailable with the exact install/wire hint (graceful degrade)", async () => {
  const res = await runWaveHooks({}, { wavefile: { file: "/w/dump.fst", fmt: "fst" }, top: "adder", sessionDir: "/s", caseDir: "/c" })
  expect(res.length).toBe(1)
  expect(res[0].status).toBe("unavailable")
  expect(res[0].server).toBe("wave_mcp")
  expect(res[0].message).toContain("pipx install wave-mcp")
  expect(res[0].message).toContain("serverName: wave_mcp")
})

test("no wave file produced -> unavailable with a 'waves on?' message", async () => {
  const res = await runWaveHooks({}, { wavefile: null, top: "t", sessionDir: "/s", caseDir: "/c" })
  expect(res[0].status).toBe("unavailable")
  expect(res[0].message).toContain("waves")
})

test("wired wave-mcp -> calls mcp__wave_mcp__prepare_session with out_dir/wave_path/top", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = []
  const tools = mockTools({ "mcp__wave_mcp__prepare_session": {} }, calls)
  const res = await runWaveHooks(tools, { wavefile: { file: "/w/dump.fst", fmt: "fst" }, top: "adder", sessionDir: "/sess", caseDir: "/c" })
  expect(res[0].status).toBe("ok")
  expect(res[0].session).toMatchObject({ session_id: "s1" })
  expect(calls.length).toBe(1)
  expect(calls[0].name).toBe("mcp__wave_mcp__prepare_session")
  expect(calls[0].arguments).toMatchObject({ out_dir: "/sess", wave_path: "/w/dump.fst", top: "adder" })
})

test("wired vcs lane -> TraceWeave get_sim_paths with verif_root/case_name/sim_log/wave_file", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = []
  const tools = mockTools({ "mcp__traceweave__get_sim_paths": {} }, calls)
  const res = await runWaveHooks(tools, { wavefile: { file: "/w/x.fsdb", fmt: "fsdb" }, top: "sanity_test", sessionDir: "/s", caseDir: "/c", simLog: "/c/run.log", verifRoot: "/ip", caseName: "sanity_test", lane: "vcs" })
  expect(res[0].status).toBe("ok")
  expect(calls[0].name).toBe("mcp__traceweave__get_sim_paths")
  expect(calls[0].arguments).toMatchObject({ verif_root: "/ip", case_name: "sanity_test", sim_log: "/c/run.log", wave_file: "/w/x.fsdb" })
})

test("TraceWeave not wired -> unavailable with the no-venv install hint", async () => {
  const res = await runWaveHooks({}, { wavefile: null, top: "t", sessionDir: "/s", caseDir: "/c", lane: "vcs" })
  expect(res[0].status).toBe("unavailable")
  expect(res[0].message).toContain("NO venv required")
  expect(res[0].message).toContain("traceweave")
})

test("MCP call throws / returns no value -> failed (still graceful, never an exception)", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = []
  const throwing = mockTools({ "mcp__wave_mcp__prepare_session": { fail: true } }, calls)
  const r1 = await runWaveHooks(throwing, { wavefile: { file: "/w/a.vcd", fmt: "vcd" }, top: "t", sessionDir: "/s", caseDir: "/c" })
  expect(r1[0].status).toBe("failed")
  expect(r1[0].message).toContain("wave-mcp call failed")
  const empty = mockTools({ "mcp__wave_mcp__prepare_session": { noValue: true } }, calls)
  const r2 = await runWaveHooks(empty, { wavefile: { file: "/w/a.vcd", fmt: "vcd" }, top: "t", sessionDir: "/s", caseDir: "/c" })
  expect(r2[0].status).toBe("failed")
})

test("DP-8: wave session dir defaults to $DSH_HOME/wave-mcp (MPD_DSH_WAVE_MCP_SESSION wins)", () => {
  const prevHome = process.env.DSH_HOME
  const prevSess = process.env.MPD_DSH_WAVE_MCP_SESSION
  try {
    process.env.DSH_HOME = "/sandbox/dsh-home"
    delete process.env.MPD_DSH_WAVE_MCP_SESSION
    expect(waveSessionDir("/case")).toBe("/sandbox/dsh-home/wave-mcp")
    process.env.MPD_DSH_WAVE_MCP_SESSION = "/custom/session"
    expect(waveSessionDir("/case")).toBe("/custom/session")
    delete process.env.DSH_HOME
    expect(waveSessionDir("/case")).toBe("/custom/session")
    delete process.env.MPD_DSH_WAVE_MCP_SESSION
    expect(waveSessionDir("/case")).toBe("/case/wave-mcp") // no DSH_HOME → per-case fallback
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
    if (prevSess === undefined) delete process.env.MPD_DSH_WAVE_MCP_SESSION; else process.env.MPD_DSH_WAVE_MCP_SESSION = prevSess
  }
})

test("partial tool runtime (no get/execute) degrades like absent wiring", async () => {
  const res = await runWaveHooks({ execute: undefined } as WaveTools, { wavefile: { file: "/w/a.fst", fmt: "fst" }, top: "t", sessionDir: "/s", caseDir: "/c" })
  expect(res[0].status).toBe("unavailable")
})
