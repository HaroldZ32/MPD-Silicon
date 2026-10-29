// Test helpers: fake tool binaries (fake-vcs / fake-iverilog / fake-verilator
// argv capture), fake project venvs for the iron-rule gate, env save/restore,
// and an isolated workspace sandbox. Everything lives in a per-test tmpdir —
// the real ~/.dsh and the real PATH tools are never touched.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createDshAdapter } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"

/**
 * Attach mpd's REAL adapter as `mpdDsh`.
 *
 * The plugin no longer builds a fallback adapter: `apply` reads `ctx.mpdDsh`, so every
 * harness must provide it. createDshAdapter (rather than a hand-written stub) keeps the
 * tests on the same seam implementation the bundle mounts, so the registration path
 * under test is the production one.
 */
export function mpdCtx<T extends object>(raw: T): T & { mpdDsh: any } {
  return { ...raw, mpdDsh: createDshAdapter(raw as any) }
}

export interface EnvGuard {
  restore(): void
}

const MANAGED_ENV = [
  "PATH",
  "DSH_WORKSPACE_ROOT",
  "DSH_HOME",
  "MPD_DSH_VERIF_IVERILOG",
  "MPD_DSH_VERIF_VERILATOR",
  "MPD_DSH_VERIF_VCS",
  "MPD_DSH_VERIF_VENV",
  "MPD_DSH_VERIF_WORK",
  "MPD_SILICON_CONFIG",
  "MPD_SILICON_LIBRELANE",
  "MPD_SILICON_LIBRELANE_APPIMAGE",
  "APPIMAGE_EXTRACT_AND_RUN",
  "MPD_DSH_VERIF_PYTHON3_CMD",
  "MPD_DSH_VERIF_URG",
  "VCS_HOME",
  "VERDI_HOME",
  "NOVAS_HOME",
  "LM_LICENSE_FILE",
  "SNPSLMD_LICENSE_FILE",
  "FAKE_CAPTURE",
  "FAKE_EXIT",
  "FAKE_COCOTB_VERSION",
  "FAKE_PY_CAPTURE",
  "FAKE_RESULTS_XML_FILE",
  "FAKE_WAVE",
  "FAKE_RUNNER_EXIT",
  "FAKE_VCS_EXIT",
  "FAKE_VCS_OUTPUT",
  "FAKE_SIMV_EXIT",
  "FAKE_UVM_ERRORS",
  "FAKE_MAKE_EXIT",
  "PYTHONHOME",
  "PYTHONPATH",
]

export function guardEnv(): EnvGuard {
  const saved = new Map<string, string | undefined>()
  for (const k of MANAGED_ENV) saved.set(k, process.env[k])
  return {
    restore() {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    },
  }
}

export function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "mpd-verif-test-"))
  for (const d of ["work", "ws", "dsh-home"]) mkdirSync(join(dir, d), { recursive: true })
  return dir
}

// Set an isolated workspace + work dir and (optionally) a venv path.
export function withSandboxEnv(sandbox: string, opts: { venv?: string } = {}): void {
  process.env.DSH_WORKSPACE_ROOT = join(sandbox, "ws")
  process.env.DSH_HOME = join(sandbox, "dsh-home")
  process.env.MPD_DSH_VERIF_WORK = join(sandbox, "work")
  if (opts.venv) process.env.MPD_DSH_VERIF_VENV = opts.venv
}

export function writeText(p: string, content: string): string {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
  return p
}

export function writeBin(dir: string, name: string, script: string): string {
  const p = writeText(join(dir, name), script)
  chmodSync(p, 0o755)
  return p
}

// Generic argv-capture fake: appends "$0 $*" (one line) to a capture log and
// exits with $FAKE_EXIT. `marker` argv triggers the version reply instead.
export function fakeToolScript(opts: { marker: string; versionLine: string; capturePath: string }): string {
  return `#!/bin/sh
if [ "$1" = "${opts.marker}" ]; then echo "${opts.versionLine}"; exit 0; fi
echo "$0 $*" >> "${opts.capturePath}"
exit \${FAKE_EXIT:-0}
`
}

export function captureLines(capturePath: string): string[] {
  if (!existsSync(capturePath)) return []
  return readFileSync(capturePath, "utf8").split("\n").filter((l) => l.length > 0)
}

// Deep-scan a tool result for JSON-lossy properties: every property whose value
// is `undefined` (JSON drops it) and every sparse array slot. The harness
// snapshots a tool's value before schema validation and rejects such results
// with "value is not lossless JSON", so tests assert [] here. Do NOT use
// `toEqual` for this invariant: it ignores undefined-valued keys, which is
// exactly how a lossy result can pass a test and still fail in the host.
export function undefinedPaths(value: unknown, path = "value"): string[] {
  const found: string[] = []
  const walk = (v: unknown, p: string): void => {
    if (v === undefined) { found.push(p); return }
    if (v === null || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], `${p}[${i}]`)
      return
    }
    for (const key of Object.keys(v as Record<string, unknown>)) walk((v as Record<string, unknown>)[key], `${p}.${key}`)
  }
  walk(value, path)
  return found
}

// Fake make (DP-6 Makefile flow): records argv + the iron-rule env evidence
// (PATH head must be the venv bin; COCOTB_RESULTS_FILE etc.) and fabricates the
// sim outputs that real cocotb make would produce.
export function fakeMakeScript(opts: { capture: string }): string {
  return `#!/bin/sh
{
  echo "argv: $*"
  echo "path-head: \${PATH%%:*}"
  echo "cocotb-results: \${COCOTB_RESULTS_FILE:-}"
  echo "cocotb-modules: \${COCOTB_TEST_MODULES:-}"
  echo "cocotb-case: \${COCOTB_TESTCASE:-}"
  echo "cocotb-seed: \${COCOTB_RANDOM_SEED:-}"
  echo "pythonhome: \${PYTHONHOME:-unset}"
} >> "${opts.capture}"
if [ -n "\${FAKE_RESULTS_XML_FILE:-}" ] && [ -f "\${FAKE_RESULTS_XML_FILE}" ]; then
  mkdir -p sim_build
  cp "\${FAKE_RESULTS_XML_FILE}" "\${COCOTB_RESULTS_FILE:-results.xml}"
  if [ "\${FAKE_WAVE:-0}" = "1" ]; then echo "wave" > sim_build/dump.fst; fi
fi
exit \${FAKE_MAKE_EXIT:-0}
`
}

// Fake venv python: answers --version; answers the cocotb import probe from
// $FAKE_COCOTB_VERSION; for "runner.py" invocations fabricates results.xml
// (optionally a wave file) in the invocation cwd — mirroring what real cocotb
// produces without touching a real simulator or python install.
export function fakeVenvPythonScript(pyCapture: string, shouldRecord: boolean): string {
  const record = shouldRecord ? `echo "$0 $* cwd=$(pwd)" >> "${pyCapture}"\n` : ""
  return `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.12.1 (fake)"; exit 0; fi
if [ "$1" = "-c" ]; then
  if [ -n "\${FAKE_COCOTB_VERSION:-}" ]; then echo "{\\"v\\": \\"\${FAKE_COCOTB_VERSION}\\", \\"ok\\": true}"; exit 0; fi
  echo "ModuleNotFoundError: No module named 'cocotb'"; exit 1
fi
${record}exit 0
`
}

// Build a minimal fake venv (the iron-rule probe passes while FAKE_COCOTB_VERSION
// is set in the test env and fails otherwise).
export function makeFakeVenv(sandbox: string, opts: { name?: string; pipCapture?: string; recordPy?: boolean } = {}): { venv: string; pyCapture: string } {
  const venv = join(sandbox, opts.name ?? "venv")
  const pyCapture = join(sandbox, "py-argv.log")
  writeBin(join(venv, "bin"), "python", fakeVenvPythonScript(pyCapture, opts.recordPy ?? true))
  writeBin(join(venv, "bin"), "pip", `#!/bin/sh\necho "$0 $*" >> "${opts.pipCapture ?? join(sandbox, "pip-argv.log")}"\nexit 0\n`)
  return { venv, pyCapture }
}

export const PASS_XML = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="results">
  <testsuite name="all" package="all" tests="2" failures="0" errors="0" skipped="0">
    <property name="random_seed" value="424242" />
    <testcase name="smoke_add" classname="adder_tb" time="0.0006666" />
    <testcase name="overflow_check" classname="adder_tb" time="0.0012" />
  </testsuite>
</testsuites>
`

export const FAIL_XML = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="results">
  <testsuite name="all" package="all" tests="2" failures="1" errors="0" skipped="0">
    <testcase name="smoke_add" classname="adder_tb" time="0.0005" />
    <testcase name="overflow_check" classname="adder_tb" time="0.0009">
      <failure message="assert failed">AssertionError: sum mismatch: got 9 expected 8</failure>
    </testcase>
  </testsuite>
</testsuites>
`
