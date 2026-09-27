import { describe, expect, it } from "vitest";
import { compareSemver, isClientSupported } from "./version.js";

describe("minClientVersion check precedes login (spec 5.1, 6.7)", () => {
  it.each([
    ["1.2.3", "1.2.3", 0],
    ["1.2.4", "1.2.3", 1],
    ["1.10.0", "1.9.9", 1],
    ["0.9.0", "1.0.0", -1],
    ["1.0.0-rc.1", "1.0.0", 0],
    ["1", "1.0.0", 0],
  ] as const)("compareSemver(%s, %s) = %s", (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });
  it("no minimum means supported", () => {
    expect(isClientSupported("0.1.0", null)).toBe(true);
    expect(isClientSupported("0.1.0", undefined)).toBe(true);
    expect(isClientSupported("0.1.0", "")).toBe(true);
  });
  it("below the minimum is unsupported", () => {
    expect(isClientSupported("0.1.0", "0.2.0")).toBe(false);
    expect(isClientSupported("0.2.0", "0.2.0")).toBe(true);
  });
});
