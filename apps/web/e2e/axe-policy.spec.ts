// The axe policy is pure, so its checks need no browser. They live here, not in Vitest: the e2e
// tsconfig roots at this folder and cannot import from src (the web unit include).
import { expect, test } from "@playwright/test";
import { shouldRunAxe } from "./axe-policy.js";

const BASE = "http://localhost:3000";

test.describe("shouldRunAxe: axe runs after every e2e scenario (spec 10.6, 12.7 M1 row)", () => {
  test("runs on an app URL with no annotation", () => {
    expect(shouldRunAxe(`${BASE}/`, [], BASE)).toBe(true);
    expect(shouldRunAxe(`${BASE}/admin/config`, [], BASE)).toBe(true);
  });

  test("does not run on a blank page or another origin", () => {
    expect(shouldRunAxe("about:blank", [], BASE)).toBe(false);
    expect(shouldRunAxe("https://example.test/", [], BASE)).toBe(false);
  });

  test("does not run when the test opted out with a reason", () => {
    const skip = { type: "axe-skip", description: "asserts a raw response" };
    expect(shouldRunAxe(`${BASE}/`, [skip], BASE)).toBe(false);
  });

  test("throws for an opt-out without a reason", () => {
    expect(() => shouldRunAxe(`${BASE}/`, [{ type: "axe-skip" }], BASE)).toThrow(/reason/);
    const blank = { type: "axe-skip", description: "  " };
    expect(() => shouldRunAxe(`${BASE}/`, [blank], BASE)).toThrow(/reason/);
  });

  test("ignores other annotations", () => {
    expect(shouldRunAxe(`${BASE}/`, [{ type: "fixme", description: "later" }], BASE)).toBe(true);
  });
});
