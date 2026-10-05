/** Timer seam for adapters and the dispatcher, so tests drive time (spec 5.2 step 5, 5.4). */
export interface Timers {
  /** Runs fn once after ms; the handle goes to clearTimeout. */
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  /** Resolves after ms; rejects with an AbortError, clearing its timer, when signal aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** The AbortError every timer and adapter wait rejects with when its signal aborts. */
export function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};
