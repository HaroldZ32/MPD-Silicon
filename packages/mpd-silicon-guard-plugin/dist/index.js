// src/index.ts
var name = "silicon-require-mpd";
var inject = [];
var DEFAULT_TIMEOUT_MS = 15000;
var POLL_INTERVAL_MS = 100;
var GUARD_MESSAGE = "silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row";
function waitForService(options) {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = options.now() + options.timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (options.probe() !== undefined) {
        resolve();
        return;
      }
      if (options.now() >= deadline) {
        reject(new Error(GUARD_MESSAGE));
        return;
      }
      options.schedule(tick, intervalMs);
    };
    tick();
  });
}
function probeMpdDsh(ctx) {
  try {
    if (typeof ctx.get !== "function")
      return;
    return ctx.get("mpdDsh", true);
  } catch {
    return;
  }
}
function apply(ctx, config = {}) {
  if (probeMpdDsh(ctx) !== undefined)
    return;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  waitForService({
    probe: () => probeMpdDsh(ctx),
    now: () => Date.now(),
    schedule: (run, delayMs) => setTimeout(run, delayMs),
    timeoutMs
  }).catch(() => {
    setTimeout(() => {
      throw new Error(GUARD_MESSAGE);
    }, 0);
  });
}
export {
  DEFAULT_TIMEOUT_MS,
  GUARD_MESSAGE,
  POLL_INTERVAL_MS,
  apply,
  inject,
  name,
  waitForService
};
