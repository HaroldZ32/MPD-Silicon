// Backend resolution tiers: env (wins even when the file is missing) -> silicon
// config -> PATH. No config must be behaviourally identical to the pre-config
// resolution. VCS and the EDA tools keep their old resolution untouched.
import { test, expect } from "bun:test"
import { join } from "node:path"
import { apply } from "../src/index"
import { resolveBackendBinary } from "../src/env"
import { probeAll, probeBackend } from "../src/backends"
import { resolveVerilatorCoverage } from "../src/coverage"
import type { SiliconConfig } from "../src/silicon/config"
import { guardEnv, makeSandbox, mpdCtx, withSandboxEnv, writeBin, writeText } from "./helpers"

const FAKE = "#!/bin/sh\nif [ \"$1\" = \"-V\" ] || [ \"$1\" = \"--version\" ] || [ \"$1\" = \"-ID\" ]; then echo 'fake 1.0'; exit 0; fi\nexit 0\n"

function setup(): { binDir: string; config: SiliconConfig; ws: string; project: string; restore: () => void } {
  const g = guardEnv()
  const s = makeSandbox()
  withSandboxEnv(s)
  delete process.env.MPD_SILICON_CONFIG
  delete process.env.MPD_DSH_VERIF_IVERILOG
  delete process.env.MPD_DSH_VERIF_VERILATOR
  delete process.env.MPD_DSH_VERIF_VCS
  delete process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE
  process.env.PATH = ""
  const binDir = join(s, "suite", "bin")
  for (const name of ["iverilog", "verilator", "verilator_coverage", "vcs"]) writeBin(binDir, name, FAKE)
  return {
    binDir,
    config: { ossCadSuite: { bin: binDir } },
    ws: join(s, "ws"),
    project: join(s, "ws", ".mpd", "silicon.jsonc"),
    restore: () => g.restore(),
  }
}

test("env override wins over config AND is returned even when the file is missing", () => {
  const s = setup()
  try {
    process.env.MPD_DSH_VERIF_IVERILOG = "/nope/iverilog"
    const r = resolveBackendBinary("iverilog", s.config)!
    expect(r.source).toBe("env")
    expect(r.binary).toBe("/nope/iverilog")
  } finally {
    s.restore()
  }
})

test("config resolves iverilog and verilator when env is unset", () => {
  const s = setup()
  try {
    const iv = resolveBackendBinary("iverilog", s.config)!
    expect(iv.source).toBe("config")
    expect(iv.binary).toBe(join(s.binDir, "iverilog"))
    const vl = resolveBackendBinary("verilator", s.config)!
    expect(vl.source).toBe("config")
    expect(vl.binary).toBe(join(s.binDir, "verilator"))
  } finally {
    s.restore()
  }
})

test("ossCadSuite.home implies <home>/bin as the config candidate", () => {
  const s = setup()
  try {
    const home = join(s.binDir, "..")
    const r = resolveBackendBinary("iverilog", { ossCadSuite: { home } })!
    expect(r.source).toBe("config")
    expect(r.binary).toBe(join(s.binDir, "iverilog"))
  } finally {
    s.restore()
  }
})

test("no config: PATH remains the last tier (and a missing binary stays null)", () => {
  const s = setup()
  try {
    // Nothing on PATH and no config -> unresolved, exactly as before the feature.
    expect(resolveBackendBinary("iverilog")).toBeNull()
    process.env.PATH = s.binDir
    const r = resolveBackendBinary("iverilog")
    expect(r).toEqual({ binary: join(s.binDir, "iverilog"), source: "path" })
    // A config whose candidate does not exist falls through to PATH, never breaks.
    const r2 = resolveBackendBinary("verilator", { ossCadSuite: { bin: join(s.ws, "missing") } })
    expect(r2).toEqual({ binary: join(s.binDir, "verilator"), source: "path" })
  } finally {
    s.restore()
  }
})

test("a single-file ossCadSuite.bin only resolves the tool it is named after", () => {
  const s = setup()
  try {
    const exe = join(s.binDir, "iverilog")
    expect(resolveBackendBinary("iverilog", { ossCadSuite: { bin: exe } })?.binary).toBe(exe)
    // A missing basename match falls through to PATH (empty here) instead of misresolving.
    expect(resolveBackendBinary("verilator", { ossCadSuite: { bin: exe } })).toBeNull()
  } finally {
    s.restore()
  }
})

test("VCS resolution is deliberately NOT config-aware", () => {  const s = setup()
  try {
    expect(resolveBackendBinary("vcs", s.config)).toBeNull()
    process.env.PATH = s.binDir
    expect(resolveBackendBinary("vcs", s.config)?.source).toBe("path")
  } finally {
    s.restore()
  }
})

test("resolveVerilatorCoverage: env -> config -> PATH", () => {
  const s = setup()
  try {
    process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE = "/nope/verilator_coverage"
    expect(resolveVerilatorCoverage(s.config)).toEqual({ binary: "/nope/verilator_coverage", source: "env:MPD_DSH_VERIF_VERILATOR_COVERAGE" })
    delete process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE
    expect(resolveVerilatorCoverage(s.config)).toEqual({ binary: join(s.binDir, "verilator_coverage"), source: "config" })
    process.env.PATH = s.binDir
    expect(resolveVerilatorCoverage(null)).toEqual({ binary: join(s.binDir, "verilator_coverage"), source: "path" })
  } finally {
    s.restore()
  }
})

test("probeBackend/probeAll report source=config and the resolved path", () => {
  const s = setup()
  try {
    const iv = probeBackend("iverilog", s.config)
    expect(iv.source).toBe("config")
    expect(iv.binary).toBe(join(s.binDir, "iverilog"))
    expect(iv.present).toBe(true)
    expect(iv.version).toBe("fake 1.0")
    const all = probeAll(s.config)
    expect(all).toHaveLength(3)
    expect(all.find((p) => p.backend === "iverilog")?.source).toBe("config")
  } finally {
    s.restore()
  }
})

test("mpd_verif_backends threads the loaded config into its probes", async () => {
  const s = setup()
  try {
    writeText(s.project, JSON.stringify({ ossCadSuite: { bin: s.binDir } }))
    const regs: any[] = []
    apply(mpdCtx({ tools: { register: (d: any) => regs.push(d) } }) as any)
    const tool = regs.find((d) => d.name === "mpd_verif_backends")
    const res = await tool.execute({ backend: "iverilog" })
    expect(res.ok).toBe(true)
    expect(res.backends[0].source).toBe("config")
    expect(res.backends[0].binary).toBe(join(s.binDir, "iverilog"))
  } finally {
    s.restore()
  }
})
