import { describe, expect, it } from "vitest";
import { systemMonotonic } from "../src/clock";

describe("spec 4.7 monotonic clock", () => {
  it("systemMonotonic.nowMs() is non-decreasing across 1000 reads", () => {
    let prev = systemMonotonic.nowMs();
    for (let i = 0; i < 1000; i++) {
      const next = systemMonotonic.nowMs();
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});
