import { describe, expect, it } from "vitest";
import { checkLicences, isAllowedExpression } from "./licences";

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
