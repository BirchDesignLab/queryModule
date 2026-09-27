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
  it("carries the 48-bit ms timestamp in its first 12 hex digits", () => {
    expect(uuidv7(0x0123456789ab).slice(0, 13)).toBe("01234567-89ab");
    expect(uuidv7(0).slice(0, 13)).toBe("00000000-0000");
  });
  it("throws on a timestamp outside 48 bits", () => {
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(-1)).toThrow(RangeError);
  });
  it("systemClock returns epoch ms", () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(50);
  });
});
