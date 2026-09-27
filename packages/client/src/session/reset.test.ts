import { describe, expect, it, vi } from "vitest";
import { createResetController } from "./reset.js";

describe("SEC-006 resetAll isolates a throwing reset (spec 6.7)", () => {
  it("runs every reset even when an earlier one throws, then surfaces the error", () => {
    const reset = createResetController();
    const second = vi.fn();
    reset.register(() => {
      throw new Error("boom");
    });
    reset.register(second);
    expect(() => reset.resetAll()).toThrow(AggregateError);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
