// cocotb venv iron rule implementation.
// 1) Venv = <workspace>/.venv-rtl or MPD_DSH_VERIF_VENV (workspace-local only).
// 2) Creation ONLY via `python3 -m venv` — the single legal use of the system interpreter.
// 3) EVERY pip install = `<venv>/bin/pip install ...` (never system pip, never --user/--system).
// 4) EVERY cocotb execution = `<venv>/bin/python runner.py`.
// 5) mpd_verif_sim REFUSES (VERIF_E_NO_VENV / VERIF_E_COCOTB_ABSENT) unless the venv
//    exists AND cocotb imports inside it.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { venvPath } from "./env"
import { run } from "./run"
import { VerifError } from "./errors"

export type VenvVerdict = "ok" | "missing" | "setup-required"

export interface VenvStatus {
  ok: boolean
  verdict: VenvVerdict
  venv: string
  python: string
  pythonVersion: string | null
  cocotbVersion: string | null
  message: string
  envOverride: string | null
}

export interface CreateStep { step: string; args: string[]; status: number | null; log: string }
export interface VenvCreate {
  ok: boolean
  venv: string
  steps: CreateStep[]
  message: string
}

export function venvPython(v: string): string {
  return join(v, "bin", "python")
}

export function venvPip(v: string): string {
  return join(v, "bin", "pip")
}

const SETUP_COMMAND = `python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"`

export function venvRefusal(v: string, cocotbVersion: string | null): { ok: false; error: { code: string; message: string; hint: string } } {
  if (!existsSync(venvPython(v))) {
    return {
      ok: false,
      error: {
        code: "VERIF_E_NO_VENV",
        message: `cocotb venv missing at ${v} (iron rule: project-local venv required, system python is never used)`,
        hint: `run: ${SETUP_COMMAND} — or call mpd_verif_venv with action "create", or set MPD_DSH_VERIF_VENV to an existing project venv`,
      },
    }
  }
  return {
    ok: false,
    error: {
      code: "VERIF_E_COCOTB_ABSENT",
      message: `venv exists at ${v} but 'import cocotb' failed${cocotbVersion ? " (cocotb " + cocotbVersion + ")" : ""}`,
      hint: `install inside the venv only: ${v}/bin/pip install "cocotb>=2.0" (never --user, never system pip)`,
    },
  }
}

// Probe the venv: existence + python version + cocotb import. The cocotb
// probe itself runs `<venv>/bin/python -c ...` — never a bare python.
export function venvStatus(override?: string, exec?: any): VenvStatus {
  const v = venvPath(override, exec)
  const py = venvPython(v)
  const envOverride = process.env.MPD_DSH_VERIF_VENV ?? null
  if (!existsSync(py)) {
    return {
      ok: false, verdict: "missing", venv: v, python: py, pythonVersion: null, cocotbVersion: null,
      message: `venv missing at ${v} — run: ${SETUP_COMMAND} or mpd_verif_venv(action:"create")`, envOverride,
    }
  }
  const pv = run(py, ["--version"], { timeoutMs: 30_000 })
  const pythonVersion = pv.spawnError === null ? (pv.combined.split("\n")[0] ?? "").trim().slice(0, 120) : null
  const cv = run(py, ["-c", "import cocotb, json; print(json.dumps({\"v\": cocotb.__version__, \"ok\": True}))"], { timeoutMs: 60_000 })
  let cocotbVersion: string | null = null
  if (cv.spawnError === null && cv.status === 0) {
    try {
      const parsed = JSON.parse(cv.combined.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}") as { v?: string }
      cocotbVersion = parsed.v ?? null
    } catch { cocotbVersion = null }
  }
  const verdict: VenvVerdict = cocotbVersion ? "ok" : pythonVersion ? "setup-required" : "missing"
  return {
    ok: cocotbVersion !== null,
    verdict,
    venv: v,
    python: py,
    pythonVersion,
    cocotbVersion,
    envOverride,
    message: cocotbVersion
      ? `venv ready: python ${pythonVersion ?? "?"} with cocotb ${cocotbVersion}`
      : `venv incomplete: ${SETUP_COMMAND}`,
  }
}

// Create the venv (the ONLY sanctioned use of system python3) and install
// cocotb via the venv's own pip. The installer argv is fully assertable in QA
// (fake-python3 capture): ["-m","venv",<path>] then [<venv>/bin/pip,"install","cocotb>=2.0"].
export function venvCreate(override?: string, _configureTimeoutMs = 600_000, exec?: any): VenvCreate {
  const v = venvPath(override, exec)
  const steps: CreateStep[] = []
  const python3 = process.env.MPD_DSH_VERIF_PYTHON3_CMD ?? "python3"
  const r1 = run(python3, ["-m", "venv", v], { timeoutMs: 120_000 })
  steps.push({ step: "venv", args: ["-m", "venv", v], status: r1.status, log: r1.combined })
  if (r1.status !== 0 || !existsSync(venvPython(v))) {
    return {
      ok: false, venv: v, steps,
      message: `venv bootstrap via '${python3} -m venv ${v}' failed (status ${r1.status}): ${tailOf(r1.combined)} — hint: install python3-venv/ensurepip (Debian: apt install python3-venv) and rerun mpd_verif_venv(action:"create")`,
    }
  }
  const pip = venvPip(v)
  if (!existsSync(pip)) {
    return { ok: false, venv: v, steps, message: `venv created at ${v} but ${pip} is missing (ensurepip unavailable?) — hint: recreate with 'python3 -m venv ${v}' after installing python3-venv` }
  }
  const r2 = run(pip, ["install", "cocotb>=2.0"], { timeoutMs: _configureTimeoutMs })
  steps.push({ step: "pip-install-cocotb", args: ["install", "cocotb>=2.0"], status: r2.status, log: r2.combined })
  if (r2.status !== 0) {
    return { ok: false, venv: v, steps, message: `pip install inside ${v} failed (status ${r2.status}): ${tailOf(r2.combined)} — rerun mpd_verif_venv(action:"create") or check network/proxy` }
  }
  const st = venvStatus(override, exec)
  return { ok: st.ok, venv: v, steps, message: `venv ready at ${v} — cocotb ${st.cocotbVersion ?? "unknown"}` }
}

function tailOf(s: string, n = 400): string {
  const t = s.trim()
  return t.length <= n ? t : "..." + t.slice(t.length - n)
}

// Require the iron-rule gate, throwing a structured VerifError (converted to a
// structured refusal at the tool boundary, never across the DSH seam).
// `exec` carries the CALLING SESSION, so the gate probes <session>/.venv-rtl (mpd_verif_sim /
// mpd_verif_regress run it before any other work; without exec it would probe the dsh process cwd).
export function requireCocotbVenv(override?: string, exec?: any): { venv: string; cocotbVersion: string } {
  const st = venvStatus(override, exec)
  if (!st.ok) {
    const r = venvRefusal(st.venv, st.cocotbVersion)
    throw new VerifError(r.error.code as "VERIF_E_NO_VENV" | "VERIF_E_COCOTB_ABSENT", r.error.message, r.error.hint)
  }
  return { venv: st.venv, cocotbVersion: st.cocotbVersion ?? "unknown" }
}