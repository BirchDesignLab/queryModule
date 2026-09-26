import { describe, expect, it } from "vitest";
import {
  checkLicences,
  isAllowedExpression,
  parseLicenceExceptions,
  parseLicenceReport,
} from "./licences";

describe("BR-006 licence allowlist (spec 9.3 step 4)", () => {
  it("accepts allowlisted identifiers and SPDX expressions", () => {
    for (const ok of [
      "MIT",
      "ISC",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "(MIT OR GPL-3.0)",
      "MIT AND ISC",
    ]) {
      expect(isAllowedExpression(ok), ok).toBe(true);
    }
    for (const bad of ["GPL-3.0", "UNKNOWN", "MIT AND GPL-3.0", "BlueOak-1.0.0"]) {
      expect(isAllowedExpression(bad), bad).toBe(false);
    }
  });

  it("gives AND tighter binding than OR and honours parentheses", () => {
    expect(isAllowedExpression("MIT OR Apache-2.0 AND GPL-3.0")).toBe(true);
    expect(isAllowedExpression("(MIT OR GPL-3.0) AND GPL-2.0")).toBe(false);
    expect(isAllowedExpression("GPL-3.0 AND (MIT OR ISC)")).toBe(false);
    expect(isAllowedExpression("(MIT AND ISC) OR GPL-3.0")).toBe(true);
  });

  it("rejects malformed expressions", () => {
    for (const bad of ["(MIT OR", "MIT OR", "MIT)", "", "()", "MIT ISC", "AND MIT"]) {
      expect(isAllowedExpression(bad), bad).toBe(false);
    }
  });

  it("reports each package outside the allowlist unless excepted", () => {
    const report = {
      MIT: [{ name: "zod", versions: ["4.0.0"] }],
      "GPL-3.0": [
        { name: "copyleft-lib", versions: ["1.0.0"] },
        { name: "reviewed-lib", versions: ["2.0.0"] },
      ],
    };
    const exceptions = [
      {
        package: "reviewed-lib",
        licence: "GPL-3.0",
        reason: "build-time only",
        reviewed: "09-25-26",
      },
    ];
    expect(checkLicences(report, exceptions)).toEqual(["copyleft-lib@1.0.0: GPL-3.0"]);
  });
});

describe("parseLicenceReport fails closed (spec 9.3 step 4)", () => {
  // Trimmed from real `pnpm licenses list --prod --json` output (pnpm 12.6.0).
  const realSample = {
    MIT: [
      {
        name: "zod",
        versions: ["4.6.5"],
        paths: ["node_modules/zod"],
        license: "MIT",
        author: "Colin McDonnell",
        homepage: "https://zod.dev",
        description: "TypeScript-first schema declaration and validation library",
      },
    ],
  };

  it("parses the trimmed real sample", () => {
    const report = parseLicenceReport(realSample);
    expect(report.MIT?.[0]?.name).toBe("zod");
    expect(checkLicences(report, [])).toEqual([]);
  });

  it("throws on an empty report", () => {
    expect(() => parseLicenceReport({})).toThrow();
  });

  it("throws on a report whose lists are all empty", () => {
    expect(() => parseLicenceReport({ MIT: [] })).toThrow();
  });

  it("throws on a malformed report", () => {
    for (const bad of [{ MIT: [{}] }, { MIT: "x" }, { MIT: [{ name: "" }] }, [], null, "x"]) {
      expect(() => parseLicenceReport(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("parseLicenceExceptions", () => {
  it("accepts the shipped empty list and well-formed entries", () => {
    expect(parseLicenceExceptions([])).toEqual([]);
    const e = [{ package: "p", licence: "GPL-3.0", reason: "r", reviewed: "09-25-26" }];
    expect(parseLicenceExceptions(e)).toEqual(e);
  });

  it("throws when reviewed is not an MM-DD-YY date", () => {
    for (const reviewed of ["2026-09-25", "9-25-26", "09/25/26", "13-01-26", "x"]) {
      const e = [{ package: "p", licence: "GPL-3.0", reason: "build-time only", reviewed }];
      expect(() => parseLicenceExceptions(e), reviewed).toThrow();
    }
  });

  it("throws on malformed entries", () => {
    for (const bad of [{}, [{ package: "p" }], [{ package: "p", licence: "x", reason: "r" }]]) {
      expect(() => parseLicenceExceptions(bad), JSON.stringify(bad)).toThrow();
    }
  });
});
