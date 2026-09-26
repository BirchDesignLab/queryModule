import { describe, expect, it } from "vitest";
import { DiagnosticSchema, DiagnosticSink } from "./diagnostic";

describe("BR-001 DiagnosticSink (spec 4.1 Validation)", () => {
  it("collects errors and warnings with default empty params", () => {
    const sink = new DiagnosticSink();
    sink.error("/sources/0/kind", "config.unknownAdapter", { kind: "mock2" });
    sink.warn("/theme", "config.unusedToken");
    expect(sink.result()).toEqual({
      errors: [
        {
          level: "error",
          path: "/sources/0/kind",
          key: "config.unknownAdapter",
          params: { kind: "mock2" },
        },
      ],
      warnings: [{ level: "warning", path: "/theme", key: "config.unusedToken", params: {} }],
    });
    for (const d of [...sink.errors, ...sink.warnings])
      expect(DiagnosticSchema.parse(d)).toEqual(d);
  });

  it("DiagnosticSchema rejects an unknown level, an empty key, extra keys and object params", () => {
    const ok = { level: "error", path: "", key: "config.notAnObject", params: {} };
    expect(DiagnosticSchema.safeParse(ok).success).toBe(true);
    expect(DiagnosticSchema.safeParse({ ...ok, level: "info" }).success).toBe(false);
    expect(DiagnosticSchema.safeParse({ ...ok, key: "" }).success).toBe(false);
    expect(DiagnosticSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(DiagnosticSchema.safeParse({ ...ok, params: { a: { b: 1 } } }).success).toBe(false);
  });
});
