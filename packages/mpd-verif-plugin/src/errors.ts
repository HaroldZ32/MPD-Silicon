// mpd-verif error taxonomy. All structured refusals carry
// { code, message (1-line cause), hint (exact remediation) } so the model
// and QA can assert on stable codes. Internal VerifError is converted to a
// structured refusal at tool boundaries (never thrown across the DSH seam).
// English-only comments per repo language policy.

export type VerifErrorCode =
  | "VERIF_E_NO_BACKEND" // requested backend binary not resolvable (env + PATH) or absent
  | "VERIF_E_NO_VENV" // cocotb lane: project venv missing (iron rule)
  | "VERIF_E_COCOTB_ABSENT" // venv exists but cocotb is not importable inside it
  | "VERIF_E_UNSUPPORTED" // requested lane/backend/tool combination is out of scope
  | "VERIF_E_LICENSE" // VCS lane: license environment incomplete
  | "VERIF_E_ENV" // missing EDA environment pieces (VERDI_HOME/NOVAS_HOME/VCS_HOME/urg)
  | "VERIF_E_COMPILE" // compile/lint failed (diagnostics attached)
  | "VERIF_E_RUN" // simulation/run failed
  | "VERIF_E_TIMEOUT" // command exceeded timeoutSec
  | "VERIF_E_TEMPLATE" // UVM template-layout contract violated
  | "VERIF_E_CONFIG" // silicon toolchain config: invalid key/value, malformed/ambiguous document, refused write

export interface VerifErrorShape {
  readonly code: VerifErrorCode
  readonly message: string
  readonly hint: string
}

export class VerifError extends Error {
  readonly code: VerifErrorCode
  readonly hint: string
  constructor(code: VerifErrorCode, message: string, hint: string) {
    super(message)
    this.name = "VerifError"
    this.code = code
    this.hint = hint
  }
}

export function refusal(code: VerifErrorCode, message: string, hint: string): { ok: false; error: VerifErrorShape } {
  return { ok: false, error: { code, message, hint: hint || "see the message" } }
}

export function refusalOf(e: unknown): { ok: false; error: VerifErrorShape } {
  if (e instanceof VerifError) return { ok: false, error: { code: e.code, message: e.message, hint: e.hint } }
  return refusal("VERIF_E_RUN", "unexpected internal error: " + String(e), "check the plugin log or retry with a narrower request")
}