import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeTempDirs, sweepStaleTempDirs } from "./temp-dirs";

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("removeTempDirs", () => {
  it("removes every dir it is given", () => {
    const a = mkdtempSync(join(tmpdir(), "qm-rm-test-"));
    const b = mkdtempSync(join(tmpdir(), "qm-rm-test-"));
    removeTempDirs([a, b], "test");
    expect(() => statSync(a)).toThrow();
    expect(() => statSync(b)).toThrow();
  });

  it("on win32 leaves an EPERM or EBUSY dir in place with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const rm = (d: string) => {
      seen.push(d);
      if (d === "a") throw errno("EPERM");
      if (d === "b") throw errno("EBUSY");
    };
    expect(() =>
      removeTempDirs(["a", "b", "c"], "startup", { platform: "win32", rm }),
    ).not.toThrow();
    expect(seen).toEqual(["a", "b", "c"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/\[startup\] 2 temp dir\(s\) left/);
    warn.mockRestore();
  });

  it("rethrows EPERM on every other platform", () => {
    const rm = () => {
      throw errno("EPERM");
    };
    expect(() => removeTempDirs(["a"], "t", { platform: "linux", rm })).toThrow("EPERM");
  });

  it("rethrows any other error on win32", () => {
    const rm = () => {
      throw errno("ENOTDIR");
    };
    expect(() => removeTempDirs(["a"], "t", { platform: "win32", rm })).toThrow("ENOTDIR");
  });
});

describe("sweepStaleTempDirs with prefixes", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "qm-sweep-prefix-test-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("removes old dirs of every given prefix and nothing else", () => {
    const old = new Date(Date.now() - 20 * 60 * 1000);
    const data = mkdtempSync(join(root, "qm-data-"));
    const sec = mkdtempSync(join(root, "qm-sec-"));
    const other = mkdtempSync(join(root, "other-"));
    for (const d of [data, sec, other]) utimesSync(d, old, old);

    sweepStaleTempDirs(root, 10 * 60 * 1000, ["qm-data-", "qm-sec-"]);

    expect(() => statSync(data)).toThrow();
    expect(() => statSync(sec)).toThrow();
    expect(statSync(other).isDirectory()).toBe(true);
  });
});
