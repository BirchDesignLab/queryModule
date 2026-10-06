import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "./password";

// Unmocked: the shipped SEC-005 minimum never drops below 12 (AW5 review 2 G-I1).
describe("PASSWORD_MIN_LENGTH", () => {
  it("is an integer of at least 12", () => {
    expect(Number.isInteger(PASSWORD_MIN_LENGTH)).toBe(true);
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
