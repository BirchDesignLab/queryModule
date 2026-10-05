/** Timer seam for adapters and the dispatcher, so tests drive time (spec 5.4). */
export interface Timers {
  /** Resolves after ms; rejects with an AbortError, clearing its timer, when signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export const systemTimers: Timers = {
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    }),
};
