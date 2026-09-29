import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// #295: coverage pins for the root vitest config (gate tier).
// Loaded at run time so tsc does not pull the root config into the scripts project.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const url = pathToFileURL(resolve(root, "vitest.config.ts")).href;
const config = (await import(url)).default as { test?: { coverage?: unknown } };
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
