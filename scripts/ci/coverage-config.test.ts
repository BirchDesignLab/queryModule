import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

// #295: coverage pins for the root vitest config (gate tier).
const coverage = config.test?.coverage as {
  include: string[];
  exclude: string[];
  thresholds: Record<string, { lines?: number; branches?: number }>;
};

describe("root coverage config (#295)", () => {
  it("enforces 95% lines and branches on packages/core/src/terminal/** on its own", () => {
    expect(coverage.thresholds["packages/core/src/terminal/**"]).toEqual({
      lines: 95,
      branches: 95,
    });
  });

  it("does not count test-only __fixtures__ as covered source", () => {
    expect(coverage.exclude).toContain("**/__fixtures__/**");
  });

  it("does not try to parse shell scripts under scripts/ci as JavaScript", () => {
    expect(coverage.include).toContain("scripts/ci/**");
    expect(coverage.exclude).toContain("**/*.sh");
  });
});
