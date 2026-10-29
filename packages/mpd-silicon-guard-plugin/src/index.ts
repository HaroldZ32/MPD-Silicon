// silicon-require-mpd: refuse to boot without @mpd-dsh/mpd.
//
// This row exists BECAUSE a consumer row cannot express the refusal itself. The
// harness's patch layers compose sequentially, but fiber apply is concurrent: a row
// declaring `inject: ["mpdDsh"]` applies only once the provider is ACTIVE and, when
// the provider is absent, simply stays PENDING with a warning. That is a silent
// no-tools boot, which is exactly the failure this bundle must not ship.
//
// A separate, inject-FREE row can be loud: poll the service and, when the deadline
// passes, throw from a timer callback. The CLI's fail-loud handler turns an uncaught
// exception into `dsh: fatal uncaught exception: …` and exits 1, so a silicon-only
// profile without @mpd-dsh/mpd stops instead of serving an empty tool surface.
//
// There is deliberately NO fallback adapter anywhere in this bundle: the consumers
// (verif/bootstrap) inject `mpdDsh`, and this row turns the missing provider into a
// startup failure.

/** Cordis plugin name; unique process-wide. */
export const name = "silicon-require-mpd"
/** Inject-free by design: it must apply in any composition, including a broken one. */
export const inject: string[] = []

/** Default grace period for the provider row to become ACTIVE. */
export const DEFAULT_TIMEOUT_MS = 15000
/** Poll cadence while waiting for the provider. */
export const POLL_INTERVAL_MS = 100
/** The actionable refusal; the install hint names the pinned dependency. */
export const GUARD_MESSAGE =
  "silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row"

/** Row config; `timeoutMs` is the only knob. */
export type GuardConfig = { timeoutMs?: number }
/** Timer seam, injected so the wait helper is unit-testable without real time. */
export type Schedule = (run: () => void, delayMs: number) => unknown

export interface WaitForServiceOptions {
  /** Returns the service when it is available, `undefined` while it is not. */
  probe: () => unknown
  /** Monotonic-enough clock (ms); injected by tests. */
  now: () => number
  /** Schedules the next poll; injected by tests. */
  schedule: Schedule
  /** Total time allowed before the wait rejects. */
  timeoutMs: number
  /** Poll cadence; defaults to {@link POLL_INTERVAL_MS}. */
  intervalMs?: number
}

/**
 * Poll until `probe()` answers or the deadline passes.
 *
 * Pure with respect to time and scheduling: every effect is injected, so the two
 * outcomes (resolve on availability, reject at the deadline) are testable without
 * sleeping. Rejection carries {@link GUARD_MESSAGE}.
 */
export function waitForService(options: WaitForServiceOptions): Promise<void> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const deadline = options.now() + options.timeoutMs
  return new Promise<void>((resolve, reject) => {
    const tick = (): void => {
      if (options.probe() !== undefined) {
        resolve()
        return
      }
      if (options.now() >= deadline) {
        reject(new Error(GUARD_MESSAGE))
        return
      }
      options.schedule(tick, intervalMs)
    }
    tick()
  })
}

/**
 * Strict service probe: `ctx.get(name, true)` answers only an ACTIVE provider and
 * throws when the service is unregistered or registered-but-not-ACTIVE yet. Both
 * misses are the same answer here — "not ready" — so the throw is absorbed and the
 * probe returns `undefined`. It MUST return the service (or undefined), never a
 * boolean: `waitForService` treats any non-undefined answer as success.
 */
function probeMpdDsh(ctx: { get?: (serviceName: string, strict?: boolean) => unknown }): unknown {
  try {
    if (typeof ctx.get !== "function") return undefined
    return ctx.get("mpdDsh", true)
  } catch {
    return undefined
  }
}

/**
 * Plugin entry: return immediately when the provider is ACTIVE, otherwise arm the
 * poll and, on timeout, throw from a timer (never from `apply` itself — an
 * apply-time throw races the concurrent fiber and is not reliably fatal).
 */
export function apply(ctx: { get?: (serviceName: string, strict?: boolean) => unknown }, config: GuardConfig = {}): void {
  if (probeMpdDsh(ctx) !== undefined) return
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  void waitForService({
    probe: () => probeMpdDsh(ctx),
    now: () => Date.now(),
    schedule: (run, delayMs) => setTimeout(run, delayMs),
    timeoutMs,
  }).catch(() => {
    setTimeout(() => {
      throw new Error(GUARD_MESSAGE)
    }, 0)
  })
}
