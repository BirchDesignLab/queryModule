import type { MonotonicClock } from "../../src/clock";
import { abortError, type Timers } from "../../src/dispatch/timers";
import type { TestClock } from "./fixture";

/** Lets every queued promise callback run (real setImmediate; manual time owns no macrotask). */
export const settle = () => new Promise<void>((r) => setImmediate(r));

/**
 * Manual time for an assembled app: the clock, the monotonic clock and Timers all read one `now`.
 * No timer fires until run(ms) moves time; clock.advance moves it without firing anything.
 */
export function manualTime(t0 = Date.now()) {
  let now = t0;
  let nextId = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      nextId += 1;
      pending.set(nextId, { at: now + Math.max(0, ms), fn });
      return nextId;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        let id: unknown;
        const onAbort = () => {
          timers.clearTimeout(id);
          reject(abortError());
        };
        id = timers.setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
  const clock: TestClock = {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
  const monotonic: MonotonicClock = { nowMs: () => now - t0 };
  /** Fires every timer due within ms, earliest first, letting callbacks run after each. */
  async function run(ms: number): Promise<void> {
    const target = now + ms;
    for (;;) {
      await settle();
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const e of pending) if (e[1].at <= target && (!due || e[1].at < due[1].at)) due = e;
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
    await settle();
  }
  return { clock, monotonic, timers, run, timerCount: () => pending.size };
}
