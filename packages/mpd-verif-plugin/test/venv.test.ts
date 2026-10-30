// venv iron-rule tests: status verdicts, refusal messages carry the exact
// setup command, and create() runs ONLY `python3 -m venv` + `<venv>/bin/pip
// install cocotb>=2.0` (argv-captured; no --user/--system ever).
import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { venvStatus, venvCreate, requireCocotbVenv } from "../src/venv"
import { VerifError } from "../src/errors"
import { captureLines, guardEnv, makeSandbox, makeFakeVenv, withSandboxEnv, writeBin, writeText } from "./helpers"

test("venvStatus: missing venv -> verdict missing with exact setup command", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s, { venv: join(s, "no-venv-here") })
    const st = venvStatus()
    expect(st.verdict).toBe("missing")
    expect(st.ok).toBe(false)
    expect(st.message).toContain("python3 -m venv .venv-rtl")
    expect(st.message).toContain("cocotb>=2.0")
  } finally {
    g.restore()
  }
})

test("venvStatus: venv present but cocotb absent -> setup-required (iron rule)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    delete process.env.FAKE_COCOTB_VERSION
    const st = venvStatus()
    expect(st.verdict).toBe("setup-required")
    expect(st.pythonVersion).toBe("Python 3.12.1 (fake)")
  } finally {
    g.restore()
  }
})

test("venvStatus: cocotb importable inside venv -> ok + version", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    const { venv } = makeFakeVenv(s)
    withSandboxEnv(s, { venv })
    process.env.FAKE_COCOTB_VERSION = "2.0.1"
    const st = venvStatus()
    expect(st.ok).toBe(true)
    expect(st.verdict).toBe("ok")
    expect(st.cocotbVersion).toBe("2.0.1")
  } finally {
    g.restore()
  }
})

test("venvCreate: python3 -m venv + <venv>/bin/pip install cocotb>=2.0 (argv captured, no --user/--system)", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s)
    // pre-made venv member templates (copied by the fake python3 below)
    const tmplPy = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.12.1 (fake)"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
exit 0
`
    const tmplPip = `#!/bin/sh
echo "$0 $*" >> "${join(s, "pip-argv.log")}"
exit 0
`
    writeText(join(s, "fakebin", "tpl-python"), tmplPy)
    writeText(join(s, "fakebin", "tpl-pip"), tmplPip)
    // fake python3: on '-m venv <dir>' materializes the venv from the templates
    const fakePython3 = writeBin(join(s, "fakebin"), "python3", `#!/bin/sh
echo "$0 $*" >> "${join(s, "py3-argv.log")}"
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  mkdir -p "$3/bin"
  cp "${join(s, "fakebin", "tpl-python")}" "$3/bin/python"; chmod +x "$3/bin/python"
  cp "${join(s, "fakebin", "tpl-pip")}" "$3/bin/pip"; chmod +x "$3/bin/pip"
fi
exit 0
`)
    process.env.MPD_DSH_VERIF_PYTHON3_CMD = fakePython3
    const res = venvCreate(join(s, "fresh-venv"))
    expect(res.ok).toBe(true)
    expect(res.steps[0].args).toEqual(["-m", "venv", join(s, "fresh-venv")])
    expect(res.steps[1].args).toEqual(["install", "cocotb>=2.0"])
    // The ONLY pip invocation runs through the freshly created venv's pip.
    const pipLines = captureLines(join(s, "pip-argv.log"))
    expect(pipLines.length).toBe(1)
    expect(pipLines[0]).toContain(join("fresh-venv", "bin", "pip"))
    expect(pipLines[0]).toContain("install cocotb>=2.0")
    expect(pipLines.join(" ")).not.toContain("--user")
    expect(pipLines.join(" ")).not.toContain("--system")
    expect(existsSync(join(s, "fresh-venv", "bin", "python"))).toBe(true)
    // and the venv bootstrap used exactly the 'python3' seam, nothing else
    const py3 = captureLines(join(s, "py3-argv.log"))
    expect(py3.some((l) => l.includes("-m venv " + join(s, "fresh-venv")))).toBe(true)
  } finally {
    g.restore()
  }
})

test("requireCocotbVenv throws VERIF_E_NO_VENV with the setup command in the hint", () => {
  const s = makeSandbox()
  const g = guardEnv()
  try {
    withSandboxEnv(s, { venv: join(s, "absent") })
    let err: VerifError | null = null
    try { requireCocotbVenv() } catch (e) { err = e as VerifError }
    expect(err).not.toBeNull()
    expect(err!.code).toBe("VERIF_E_NO_VENV")
    expect(err!.hint).toContain(".venv-rtl/bin/pip install")
    expect(err!.hint).toContain('action "create"')
  } finally {
    g.restore()
  }
})
