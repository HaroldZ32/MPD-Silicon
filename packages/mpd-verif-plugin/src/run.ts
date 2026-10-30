// Subprocess core: argv-array spawn (never shell-string concatenation),
// bounded timeout, merged output capture, and log-file sink for evidence.
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export interface RunResult {
  status: number | null
  signal: string | null
  timedOut: boolean
  /** spawn-level failure (e.g. ENOENT for a missing binary) */
  spawnError: string | null
  stdout: string
  stderr: string
  combined: string
}

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  /**
   * Variables to REMOVE from the inherited environment, applied AFTER the merge.
   * A parent shell can export a value the child must not see (the measured case:
   * `PYTHONHOME=/opt/openictool/oss-cad-suite` redirects a venv Python to the
   * oss-suite stdlib and the cocotb VPI dies in `Py_Initialize`). An empty value
   * is not enough — Python still treats a set-but-empty PYTHONHOME as a prefix —
   * so the key must be absent.
   */
  unsetEnv?: readonly string[]
}

export const DEFAULT_TIMEOUT_MS = 600_000
const MAX_BUFFER = 32 * 1024 * 1024

export function run(binary: string, args: string[], opts: RunOptions = {}): RunResult {
  const env: NodeJS.ProcessEnv = opts.env ? { ...process.env, ...opts.env } : { ...process.env }
  if (opts.unsetEnv !== undefined) for (const key of opts.unsetEnv) delete env[key]
  const res = spawnSync(binary, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  })
  const stderr = (res.stderr ?? "").trim()
  const stdout = (res.stdout ?? "").trim()
  const spawnError = res.error && !(res.error as NodeJS.ErrnoException).code ? String(res.error) : (res.error ? (res.error as NodeJS.ErrnoException).code ?? String(res.error) : null)
  return {
    status: res.status,
    signal: res.signal ?? null,
    timedOut: Boolean(res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT"),
    spawnError,
    stdout,
    stderr,
    combined: [stdout, stderr].filter((s) => s.length > 0).join("\n"),
  }
}

// Append a capture to a log path (creating parent dirs); used for compile/sim
// evidence logs under <work>/... so QA can assert content on disk.
export function writeLog(logPath: string, content: string): string {
  if (logPath) {
    mkdirSync(dirname(logPath), { recursive: true })
    writeFileSync(logPath, content + "\n")
  }
  return logPath
}
