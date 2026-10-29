// Guard suite: the wait helper's two outcomes plus the plugin-entry contract.
//
// Time and scheduling are injected everywhere, so no test sleeps and no test leaves a
// real 15 s timer behind. The plugin entry's production scheduler is exercised through
// a patched global setTimeout, which is restored in a finally block.
import { describe, expect, test } from "bun:test"
import {
  apply,
  DEFAULT_TIMEOUT_MS,
  GUARD_MESSAGE,
  inject,
  name,
  POLL_INTERVAL_MS,
  waitForService,
} from "../src/index"

/** Injected clock/timer pair; `runNext()` advances time to the next scheduled poll. */
function fakeTimers() {
  let clock = 0
  const pending: Array<{ at: number; run: () => void }> = []
  return {
    now: () => clock,
    schedule: (run: () => void, delayMs: number) => {
      pending.push({ at: clock + delayMs, run })
    },
    runNext: () => {
      const next = pending.shift()
      if (next === undefined) throw new Error("no scheduled timer")
      clock = next.at
      next.run()
    },
    pending: () => pending.length,
  }
}

describe("guard contract", () => {
  test("is inject-free and named for the refusal it performs", () => {
    expect(name).toBe("silicon-require-mpd")
    expect(inject).toEqual([])
    expect(POLL_INTERVAL_MS).toBe(100)
    expect(DEFAULT_TIMEOUT_MS).toBe(15000)
  })

  test("the refusal names the pinned dependency and the row to enable", () => {
    expect(GUARD_MESSAGE).toContain("@mpd-dsh/mpd@0.15.1")
    expect(GUARD_MESSAGE).toContain("mpdDsh")
    expect(GUARD_MESSAGE).toContain("enable the mpd-dsh-adapter row")
  })
})

describe("waitForService", () => {
  test("resolves on the first poll when the service is already present", async () => {
    const timers = fakeTimers()
    let calls = 0
    await waitForService({
      probe: () => {
        calls += 1
        return { active: true }
      },
      now: timers.now,
      schedule: timers.schedule,
      timeoutMs: 1000,
    })
    expect(calls).toBe(1)
    expect(timers.pending()).toBe(0)
  })

  test("keeps polling and resolves as soon as the service appears", async () => {
    const timers = fakeTimers()
    let present = false
    const wait = waitForService({
      probe: () => (present ? { active: true } : undefined),
      now: timers.now,
      schedule: timers.schedule,
      timeoutMs: 1000,
    })
    // First tick ran synchronously and armed exactly one 100 ms poll.
    expect(timers.pending()).toBe(1)
    timers.runNext()
    timers.runNext()
    present = true
    timers.runNext()
    await expect(wait).resolves.toBeUndefined()
  })

  test("rejects with the actionable guard message once the deadline passes", async () => {
    const timers = fakeTimers()
    const wait = waitForService({
      probe: () => undefined,
      now: timers.now,
      schedule: timers.schedule,
      timeoutMs: 300,
    })
    // 0 -> poll at 100 -> poll at 200 -> poll at 300, where now >= deadline.
    timers.runNext()
    timers.runNext()
    timers.runNext()
    await expect(wait).rejects.toThrow(GUARD_MESSAGE)
  })

  test("a zero timeout rejects without scheduling a poll", async () => {
    const timers = fakeTimers()
    const wait = waitForService({
      probe: () => undefined,
      now: timers.now,
      schedule: timers.schedule,
      timeoutMs: 0,
    })
    expect(timers.pending()).toBe(0)
    await expect(wait).rejects.toThrow(GUARD_MESSAGE)
  })
})

describe("apply", () => {
  test("returns without arming a timer when the provider is ACTIVE", () => {
    const original = globalThis.setTimeout
    let armed = 0
    ;(globalThis as { setTimeout: unknown }).setTimeout = () => {
      armed += 1
      return 0
    }
    try {
      const ctx = { get: (serviceName: string, _strict?: boolean) => (serviceName === "mpdDsh" ? { registerTool: () => () => {} } : undefined) }
      apply(ctx)
      expect(armed).toBe(0)
    } finally {
      globalThis.setTimeout = original
    }
  })

  test("arms the poll when the strict probe throws (provider absent or not ACTIVE)", () => {
    const original = globalThis.setTimeout
    let armed = 0
    ;(globalThis as { setTimeout: unknown }).setTimeout = () => {
      armed += 1
      return 0
    }
    try {
      const ctx = {
        get: () => {
          throw new Error('cannot get service "mpdDsh" without provider')
        },
      }
      expect(() => apply(ctx, { timeoutMs: 10 })).not.toThrow()
      expect(armed).toBe(1)
    } finally {
      globalThis.setTimeout = original
    }
  })
})
