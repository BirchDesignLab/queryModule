import { describe, expect, it } from "vitest";
import { readJsonFile, toPosixRel } from "./cli-io";

describe("cli-io toPosixRel (item 2, shared per Q1/C6)", () => {
  it("normalizes both separator styles to forward slashes", () => {
    expect(toPosixRel("packages\\config\\sites\\x.json")).toBe("packages/config/sites/x.json");
    expect(toPosixRel("packages/config/sites/x.json")).toBe("packages/config/sites/x.json");
  });
});

describe("cli-io readJsonFile (item 3, shared per Q1/C6)", () => {
  it("reports a missing file cleanly, no stack trace", () => {
    const enoent = Object.assign(new Error("boom"), { code: "ENOENT" });
    const r = readJsonFile(() => {
      throw enoent;
    }, "x.json");
    expect(r).toEqual({ ok: false, reason: "file not found" });
  });

  it("reports another read failure cleanly", () => {
    const eacces = Object.assign(new Error("boom"), { code: "EACCES" });
    const r = readJsonFile(() => {
      throw eacces;
    }, "x.json");
    expect(r).toEqual({ ok: false, reason: "cannot read file" });
  });

  it("reports invalid JSON without quoting file content", () => {
    const r = readJsonFile(() => '{"secret": "sh0uldNotAppear"', "x.json");
    expect(r).toEqual({ ok: false, reason: "invalid JSON" });
  });

  it("returns the parsed value on success", () => {
    expect(readJsonFile(() => '{"a":1}', "x.json")).toEqual({ ok: true, value: { a: 1 } });
  });
});
