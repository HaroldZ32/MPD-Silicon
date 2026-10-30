// B3 host output contract: every tool result must be LOSSLESS JSON.
// The harness snapshots a tool's value BEFORE schema validation and rejects any
// property whose value is `undefined` (dsh-tools snapshotToolValue ->
// "value is not lossless JSON"). `toEqual` is blind to exactly those keys, which
// is how two lossy results shipped:
//   - probeBackend(): `licenseHint: undefined` for PRESENT non-vcs backends
//     (vcs builds an array; absent backends build the install hint array), and
//   - verifCompile(): `filelistPath`/`outBinary` assigned from an optional plan
//     field, undefined for every lint lane and for the non-vcs compile lanes.
// Machine-independent by construction: every backend is a fake shell binary
// reached through the MPD_DSH_VERIF_* env override, so this suite is meaningful
// on a machine with no EDA tool installed and FAILS against the pre-fix source.
import { test, expect } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { probeBackend } from "../src/backends"
import { verifCompile } from "../src/compile"
import { apply } from "../src/index"
import { guardEnv, makeSandbox, mpdCtx, undefinedPaths, withSandboxEnv, writeBin } from "./helpers"

const BACKENDS = ["iverilog", "verilator", "vcs"] as const
type Backend = (typeof BACKENDS)[number]

const ENV_KEY: Record<Backend, string> = {
  iverilog: "MPD_DSH_VERIF_IVERILOG",
  verilator: "MPD_DSH_VERIF_VERILATOR",
  vcs: "MPD_DSH_VERIF_VCS",
}

// Fake backend binary: answers the version-probe argv (-V / --version / -ID) and
// exits 0 for every lint/compile invocation. No real simulator is involved.
function fakeBackend(sandbox: string, backend: Backend): string {
  const dir = join(sandbox, "fakebin-" + backend)
  mkdirSync(dir, { recursive: true })
  return writeBin(dir, backend, `#!/bin/sh
case "$1" in
  -V|--version|-ID) echo "fake ${backend} 1.0"; exit 0 ;;
esac
echo "fake ${backend} invocation"
exit 0
`)
}

function fakeToolchain(sandbox: string): void {
  for (const b of BACKENDS) process.env[ENV_KEY[b]] = fakeBackend(sandbox, b)
}

// The strict host contract: no undefined-valued property anywhere, and a JSON
// round trip that keeps every key (`toStrictEqual` distinguishes an absent key
// from a key present with value undefined; `toEqual` does not).
function expectLossless(value: unknown): void {
  expect(undefinedPaths(value)).toEqual([])
  expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
}

test("probeBackend is lossless for a PRESENT backend of every kind (the B3 trigger)", () => {
  const g = guardEnv()
  const s = makeSandbox()
  try {
    withSandboxEnv(s)
    fakeToolchain(s)
    for (const b of BACKENDS) {
      const probe = probeBackend(b)
      expect(probe.present).toBe(true)
      expectLossless(probe)
      // present non-vcs has no environment checklist: null, never undefined
      if (b === "vcs") expect(Array.isArray(probe.licenseHint)).toBe(true)
      else expect(probe.licenseHint).toBeNull()
    }
  } finally {
    g.restore()
  }
})

test("probeBackend is lossless for an ABSENT backend of every kind", () => {
  const g = guardEnv()
  const s = makeSandbox()
  try {
    withSandboxEnv(s)
    const emptyPath = join(s, "empty-path")
    mkdirSync(emptyPath, { recursive: true })
    process.env.PATH = emptyPath
    for (const b of BACKENDS) {
      delete process.env[ENV_KEY[b]]
      const probe = probeBackend(b)
      expect(probe.present).toBe(false)
      expect(Array.isArray(probe.licenseHint)).toBe(true)
      expectLossless(probe)
    }
  } finally {
    g.restore()
  }
})

test("mpd_verif_backends tool result is lossless for every backend selector", async () => {
  const g = guardEnv()
  const s = makeSandbox()
  try {
    withSandboxEnv(s)
    fakeToolchain(s)
    const regs: any[] = []
    apply(mpdCtx({ tools: { register: (d: any) => regs.push(d) } }) as any)
    const tool = regs.find((r) => r.name === "mpd_verif_backends")!
    for (const selector of ["all", "iverilog", "verilator", "vcs"] as const) {
      const res = await tool.execute({ backend: selector })
      expect(res.ok).toBe(true)
      expect(res.backends.length).toBe(selector === "all" ? BACKENDS.length : 1)
      expectLossless(res)
      // the render runs on the same value and must not throw
      expect(tool.output.render({}, res)[0].type).toBe("text")
    }
  } finally {
    g.restore()
  }
})

test("verifCompile lint/compile results are lossless for all three backends", () => {
  const g = guardEnv()
  const s = makeSandbox()
  try {
    withSandboxEnv(s)
    fakeToolchain(s)
    const src = join(s, "ws", "dut.v")
    writeFileSync(src, "module dut; endmodule\n")
    for (const b of BACKENDS) {
      for (const target of ["lint", "compile"] as const) {
        const res = verifCompile({ backend: b, sources: [src], target })
        expect(res.ok).toBe(true)
        expectLossless(res)
      }
    }
  } finally {
    g.restore()
  }
})

test("the lane truth table is preserved: optional keys appear only when real", () => {
  const g = guardEnv()
  const s = makeSandbox()
  try {
    withSandboxEnv(s)
    fakeToolchain(s)
    const src = join(s, "ws", "dut.v")
    writeFileSync(src, "module dut; endmodule\n")
    const lintIvl = verifCompile({ backend: "iverilog", sources: [src], target: "lint" })
    const lintVcs = verifCompile({ backend: "vcs", sources: [src], target: "lint" })
    const compIvl = verifCompile({ backend: "iverilog", sources: [src], target: "compile" })
    const compVcs = verifCompile({ backend: "vcs", sources: [src], target: "compile" })
    // lint never has a binary; only the vcs lint writes a filelist
    expect("outBinary" in lintIvl).toBe(false)
    expect("outBinary" in lintVcs).toBe(false)
    expect(typeof lintVcs.filelistPath).toBe("string")
    expect("filelistPath" in lintIvl).toBe(false)
    // compile always has a binary; only the vcs compile writes a filelist
    expect(typeof compIvl.outBinary).toBe("string")
    expect("filelistPath" in compIvl).toBe(false)
    expect(typeof compVcs.outBinary).toBe("string")
    expect(typeof compVcs.filelistPath).toBe("string")
  } finally {
    g.restore()
  }
})
