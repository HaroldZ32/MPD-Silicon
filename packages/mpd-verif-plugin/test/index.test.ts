// Plugin surface tests: exactly ten mpd_verif_* tool registrations, parameter
// + output schemas + renders present, structured refusals (not exceptions)
// across the DSH seam, and lossless-JSON host contract.
import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { apply } from "../src/index"
import { guardEnv, makeSandbox, mpdCtx, undefinedPaths, withSandboxEnv, writeBin } from "./helpers"

function registerAll(): { name: string; definition: any }[] {
  const regs: any[] = []
  apply(mpdCtx({ tools: { register: (d: any) => regs.push(d) } }) as any)
  return regs.map((d) => ({ name: d.name, definition: d }))
}

const EXPECTED_TOOLS = ["mpd_verif_venv", "mpd_verif_backends", "mpd_verif_compile", "mpd_verif_lint", "mpd_verif_sim", "mpd_verif_coverage", "mpd_verif_uvm", "mpd_verif_regress", "mpd_verif_toolchain", "mpd_verif_librelane"]

test('exactly the ten-tool surface (the DP-4 eight + toolchain + librelane) is registered', () => {
  const regs = registerAll()
  expect(regs.map((r) => r.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
})

test("every tool carries parameters + output schema + render + execute", () => {
  for (const r of registerAll()) {
    expect(r.definition.parameters?.type).toBe("object")
    expect(r.definition.output?.schema?.type).toBe("object")
    expect(typeof r.definition.output?.render).toBe("function")
    expect(typeof r.definition.execute).toBe("function")
    expect(r.definition.name.startsWith("mpd_verif_")).toBe(true)
  }
})

const HDL_BACKENDS = ["iverilog", "verilator", "vcs"] as const
const APT_HINT_BACKENDS = ["iverilog", "verilator"] as const

// Environment gate: mirror the tool's resolution order (MPD_DSH_VERIF_* pin
// first, then PATH) without pinning a machine path. A pinned env value counts
// as "expected present" so a broken pin fails the strong branch instead of
// silently falling into the refusal branch.
function detectedHdlBackends(): (typeof HDL_BACKENDS)[number][] {
  return HDL_BACKENDS.filter((backend) => {
    if ((process.env[`MPD_DSH_VERIF_${backend.toUpperCase()}`] ?? "").trim().length > 0) return true
    const probe = spawnSync("sh", ["-c", `command -v ${backend} >/dev/null 2>&1`], { stdio: "ignore" })
    return probe.status === 0
  })
}

test("mpd_verif_backends renders and returns structured probes", async () => {
  const regs = registerAll()
  const t = regs.find((r) => r.name === "mpd_verif_backends")!
  const detected = detectedHdlBackends()
  const res = await t.definition.execute({ backend: "all" })
  expect(Array.isArray(res.backends)).toBe(true)
  expect(res.backends.every((b: any) => typeof b.present === "boolean" && typeof b.backend === "string")).toBe(true)
  const rendered = t.definition.output.render({}, res)
  expect(rendered[0].type).toBe("text")
  expect(rendered[0].text).toContain("iverilog=")
  // lossless JSON host contract: `toEqual` ignores undefined-valued keys, so
  // assert the strict invariant instead (see test/lossless.test.ts).
  expect(undefinedPaths(res)).toEqual([])
  expect(JSON.parse(JSON.stringify(res))).toStrictEqual(res)

  if (detected.length > 0) {
    // Falsifiable strong branch: a host with ANY backend must get ok=true.
    expect(res.ok).toBe(true)
    return
  }

  // No HDL backend (iverilog/verilator/vcs) on this host: the tool must answer
  // with a structured refusal (ok=false, per-backend hints), never throw.
  console.log("ENV-GATED: no HDL backend (iverilog/verilator) — install with apt install iverilog verilator")
  expect(res.ok).toBe(false)
  const probes = res.backends as Array<{ backend: string; present: boolean; licenseHint: string[] | null }>
  expect(probes.every((b) => b.present === false)).toBe(true)
  const note = String(res.note ?? "")
  for (const backend of APT_HINT_BACKENDS) {
    expect(note).toContain(backend)
    const hint = (probes.find((b) => b.backend === backend)?.licenseHint ?? []).join(" ")
    expect(hint).toContain(backend)
    expect(hint).toContain("apt install")
  }
})

test("tool failures cross the seam as structured refusals (never exceptions)", async () => {
  const regs = registerAll()
  const sim = regs.find((r) => r.name === "mpd_verif_sim")!
  const res = await sim.definition.execute({ backend: "vcs", top: "t", sources: ["t.v"] })
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe("VERIF_E_UNSUPPORTED")
  expect(res.error.hint.length).toBeGreaterThan(0)
  const g = guardEnv()
  const s = makeSandbox()
  try {
    withSandboxEnv(s)
    process.env.MPD_DSH_VERIF_VCS = writeBin(join(s, "fakebin"), "vcs", "#!/bin/sh\nif [ \"$1\" = \"-ID\" ]; then echo \"fake vcs\"; exit 0; fi\nexit 0\n")
    const uvm = regs.find((r) => r.name === "mpd_verif_uvm")!
    const res2 = await uvm.definition.execute({ action: "compile", top: join(s, "ws", "no-ip-root") })
    expect(res2.ok).toBe(false)
    expect(res2.error.code).toBe("VERIF_E_TEMPLATE")
    expect(JSON.parse(JSON.stringify(res2))).toEqual(res2)
  } finally {
    g.restore()
  }
})

test("mpd_verif_venv execute: status action returns verdict without exceptions", async () => {
  const regs = registerAll()
  const t = regs.find((r) => r.name === "mpd_verif_venv")!
  const res = await t.definition.execute({ action: "status" })
  expect(["ok", "missing", "setup-required"]).toContain(typeof res.verdict === "string" ? res.verdict : "missing")
  expect(typeof res.message).toBe("string")
  const info = await t.definition.execute({ action: "info" })
  expect(info.workspace.length).toBeGreaterThan(0)
  expect(info.venv.endsWith(".venv-rtl")).toBe(true)
})
