import { performance } from "node:perf_hooks";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Durations for audit details come from a monotonic clock (spec 4.7). */
export interface MonotonicClock {
  nowMs(): number;
}

export const systemMonotonic: MonotonicClock = { nowMs: () => performance.now() };
