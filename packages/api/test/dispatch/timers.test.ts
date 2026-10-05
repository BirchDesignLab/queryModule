import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemTimers } from "../../src/dispatch/timers";

// Task 6 manager ruling: AdapterFactory.create takes Timers; sleep resolves after ms and rejects
// with an AbortError (clearing its timer) when the signal aborts.
describe("systemTimers.sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after ms and leaves no timer behind", async () => {
    const ac = new AbortController();
    let done = false;
    const p = systemTimers.sleep(100, ac.signal).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    ac.abort(); // a later abort is a no-op
  });

  it("rejects with an AbortError and clears its timer when the signal aborts mid-wait", async () => {
    const ac = new AbortController();
    const p = systemTimers.sleep(1000, ac.signal);
    expect(vi.getTimerCount()).toBe(1);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects at once with an AbortError, scheduling nothing, when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const p = systemTimers.sleep(1000, ac.signal);
    expect(vi.getTimerCount()).toBe(0);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
