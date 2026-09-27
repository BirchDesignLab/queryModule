import { describe, expect, it } from "vitest";
import { systemClock } from "../src/clock";
import { uuidv7 } from "../src/ids";

describe("uuidv7 and clock", () => {
  it("has version 7 and variant bits", () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("sorts by time", () => {
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
  it("systemClock returns epoch ms", () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(50);
  });
});
