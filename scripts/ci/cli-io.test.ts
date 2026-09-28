import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isMainModule, readJsonFile, toPosixRel } from "./cli-io";

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

describe("cli-io isMainModule (fail-closed main guard)", () => {
  const same = (p: string) => p;
  it("matches a win32 path that differs from the module URL only in drive-letter and case", () => {
    // The old guard (import.meta.url === pathToFileURL(argv1).href) returned false here, so the
    // gate CLI skipped main() and exited 0 with no output.
    const metaUrl = "file:///C:/git/Repo/scripts/ci/config-validate.ts";
    const argv1 = "c:\\git\\repo\\scripts\\ci\\config-validate.ts";
    expect(metaUrl === pathToFileURL(argv1).href).toBe(false);
    expect(isMainModule(metaUrl, argv1, { platform: "win32", realpath: same })).toBe(true);
  });
  it("matches when argv[1] is a symlink to the module file", () => {
    const real = (p: string) => (p === "/link/ci/x.ts" ? "/repo/scripts/ci/x.ts" : p);
    expect(
      isMainModule("file:///repo/scripts/ci/x.ts", "/link/ci/x.ts", {
        platform: "linux",
        realpath: real,
      }),
    ).toBe(true);
  });
  it("is false when imported from another entry or with no argv[1]", () => {
    expect(
      isMainModule("file:///repo/scripts/ci/x.ts", "/repo/node_modules/vitest/cli.js", {
        platform: "linux",
        realpath: same,
      }),
    ).toBe(false);
    expect(isMainModule("file:///repo/scripts/ci/x.ts", undefined)).toBe(false);
  });
  it("keeps case significant off win32", () => {
    expect(
      isMainModule("file:///repo/X.ts", "/repo/x.ts", { platform: "linux", realpath: same }),
    ).toBe(false);
  });
});
