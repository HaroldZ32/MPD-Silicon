// Waveform-read integration hooks. The plugin does NOT vendor wave-mcp or
// TraceWeave: it calls the user-wired MCP tools when their registrations are
// present (dsh-mcp-client registers them as mcp__<serverName>__<tool>), and
// degrades gracefully with an actionable message otherwise.
//
// Lanes (per A2 §5): cocotb/OSS waves (.fst/.vcd) -> wave-mcp
// `prepare_session(out_dir, wave_path, ...)`; VCS/UVM lane (fsdb/logs) ->
// TraceWeave `get_sim_paths(verif_root, case_name, sim_log, wave_file, ...)`.
import { join } from "node:path"

export interface Wavefile {
  file: string
  fmt: "fst" | "vcd" | "fsdb"
}

export interface WaveHookResult {
  status: "ok" | "failed" | "unavailable"
  server: "wave_mcp" | "traceweave"
  tool: string | null
  message: string
  /** pass-through summary returned by the MCP tool when the call succeeded */
  session?: Record<string, unknown>
}

export interface WaveHookRequest {
  wavefile: Wavefile | null
  top: string
  sessionDir: string
  caseDir: string
  /** VCS lane extras */
  simLog?: string
  verifRoot?: string
  caseName?: string
  lane?: "oss" | "vcs"
}

// Minimal structural view of the DSH ToolRuntime pieces we use (feature-detected).
export interface WaveTools {
  get?(name: string): unknown
  // The adapter's toolRuntime() types its result as `unknown` (the harness normalizes
  // it at the seam); invokeTool already narrows it structurally, so this stays honest.
  execute?(input: { name: string; arguments: unknown; callId: string; signal: AbortSignal }): Promise<unknown>
}

const WAVE_MCP_PREPARE = "mcp__wave_mcp__prepare_session"
const TRACEWEAVE_GET_PATHS = "mcp__traceweave__get_sim_paths"

const WAVE_MCP_INSTALL_HINT =
  "install wave-mcp with pipx or any Python (NO venv required — pipx install wave-mcp, or pip install wave-mcp), then wire the dsh-mcp-client row (command: wave-mcp/<bin>, serverName: wave_mcp) or set MPD_DSH_WAVE_MCP_BIN"
const TRACEWEAVE_INSTALL_HINT =
  "install traceweave-mcp with pipx or any Python (NO venv required; pipx keeps each tool isolated if the MCP SDK versions ever conflict), export VERDI_HOME/NOVAS_HOME/VCS_HOME + license vars, then wire the dsh-mcp-client row (serverName: traceweave) or set MPD_DSH_TRACEWEAVE_BIN"

export async function runWaveHooks(tools: WaveTools, req: WaveHookRequest): Promise<WaveHookResult[]> {
  const out: WaveHookResult[] = []
  const lane: "oss" | "vcs" = req.lane ?? inferLane(req)
  if (lane === "vcs") {
    out.push(await traceweaveHook(tools, req))
    return out
  }
  if (!req.wavefile) {
    out.push({ status: "unavailable", server: "wave_mcp", tool: WAVE_MCP_PREPARE, message: "no waveform file produced by the run (waves on?) — nothing to hand to wave-mcp" })
    return out
  }
  out.push(await waveMcpHook(tools, req))
  return out
}

function inferLane(req: WaveHookRequest): "oss" | "vcs" {
  if (req.wavefile?.fmt === "fsdb") return "vcs"
  return "oss"
}

async function waveMcpHook(tools: WaveTools, req: WaveHookRequest): Promise<WaveHookResult> {
  const tool = WAVE_MCP_PREPARE
  if (!hasTool(tools, tool)) {
    return { status: "unavailable", server: "wave_mcp", tool, message: "wave-mcp MCP tool is not wired in this session — " + WAVE_MCP_INSTALL_HINT }
  }
  const args = {
    out_dir: req.sessionDir,
    wave_path: req.wavefile!.file,
    top: req.top,
    mode: "speed",
  }
  const res = await invokeTool(tools, tool, args)
  if (res.error !== undefined) return { status: "failed", server: "wave_mcp", tool, message: `wave-mcp call failed: ${String(res.error)} — sessions degrade to manual inspection; ${WAVE_MCP_INSTALL_HINT}` }
  if (res.value === undefined) return { status: "failed", server: "wave_mcp", tool, message: "wave-mcp returned no structured value; check the MCP row config" }
  return { status: "ok", server: "wave_mcp", tool, message: "wave-mcp session opened for " + req.wavefile!.file, session: safeObject(res.value) }
}

async function traceweaveHook(tools: WaveTools, req: WaveHookRequest): Promise<WaveHookResult> {
  const tool = TRACEWEAVE_GET_PATHS
  if (!hasTool(tools, tool)) {
    return { status: "unavailable", server: "traceweave", tool, message: "TraceWeave MCP tool is not wired in this session — " + TRACEWEAVE_INSTALL_HINT }
  }
  const args: Record<string, unknown> = { verif_root: req.verifRoot ?? req.caseDir }
  if (req.caseName) args.case_name = req.caseName
  if (req.simLog) args.sim_log = req.simLog
  if (req.wavefile) args.wave_file = req.wavefile.file
  const res = await invokeTool(tools, tool, args)
  if (res.error !== undefined) return { status: "failed", server: "traceweave", tool, message: `TraceWeave call failed: ${String(res.error)}; ${TRACEWEAVE_INSTALL_HINT}` }
  if (res.value === undefined) return { status: "failed", server: "traceweave", tool, message: "TraceWeave returned no structured value; check the MCP row config" }
  return { status: "ok", server: "traceweave", tool, message: "TraceWeave path discovery completed", session: safeObject(res.value) }
}

function hasTool(tools: WaveTools, name: string): boolean {
  try {
    return typeof tools.get === "function" && tools.get(name) !== undefined
  } catch {
    return false
  }
}

async function invokeTool(tools: WaveTools, name: string, args: Record<string, unknown>): Promise<{ value?: unknown; error?: unknown }> {
  if (typeof tools.execute !== "function") return { error: "tool runtime has no execute()" }
  let signal: AbortSignal
  try {
    signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(120_000) : new AbortController().signal
  } catch {
    signal = new AbortController().signal
  }
  try {
    const r = await tools.execute({ name, arguments: args, callId: "mpd-verif-wave-" + Date.now(), signal })
    if (r && typeof r === "object" && "isError" in r && (r as { isError?: boolean }).isError === true) {
      return { error: (r as { error?: unknown }).error ?? "tool error" }
    }
    return { value: (r as { value?: unknown })?.value }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function safeObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return { summary: String(v) }
}

/**
 * Owner decision DP-8: the wave-mcp session home is $DSH_HOME/wave-mcp
 * (override: MPD_DSH_WAVE_MCP_SESSION), so sessions survive per-case scratch
 * dirs and stay reachable for follow-up queries. Falls back to a per-case
 * dir only when no DSH_HOME is resolvable at all.
 */
export function waveSessionDir(caseDir: string): string {
  const override = process.env.MPD_DSH_WAVE_MCP_SESSION
  if (override && override.trim().length > 0) return override
  const dshHome = process.env.DSH_HOME
  if (dshHome && dshHome.trim().length > 0) return join(dshHome, "wave-mcp")
  return join(caseDir, "wave-mcp")
}
