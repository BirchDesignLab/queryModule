import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigUnreadableError } from "./config-files";
import { configIo, parseValidateArgs, toPosixRel, VALIDATE_USAGE } from "./config-validate";

describe("config:validate argument parsing (item 1)", () => {
  it("accepts --resolved and bare file arguments", () => {
    expect(parseValidateArgs([])).toEqual({ ok: true, resolved: false, files: [] });
    expect(parseValidateArgs(["--resolved"])).toEqual({ ok: true, resolved: true, files: [] });
    expect(parseValidateArgs(["a.json", "b.json"])).toEqual({
      ok: true,
      resolved: false,
      files: ["a.json", "b.json"],
    });
    expect(parseValidateArgs(["--resolved", "a.json"])).toEqual({
      ok: true,
      resolved: true,
      files: ["a.json"],
    });
  });

  it("rejects an unknown -- flag with a usage line, before any file is read", () => {
    expect(parseValidateArgs(["--bogus"])).toEqual({
      ok: false,
      message: `unknown option --bogus\n${VALIDATE_USAGE}`,
    });
    expect(parseValidateArgs(["a.json", "--nope"])).toEqual({
      ok: false,
      message: `unknown option --nope\n${VALIDATE_USAGE}`,
    });
  });
});

describe("config:validate posix path formatting (item 2)", () => {
  it("normalizes both separator styles to forward slashes, as a pure function", () => {
    expect(toPosixRel("packages\\config\\sites\\default.json")).toBe(
      "packages/config/sites/default.json",
    );
    expect(toPosixRel("packages/config/sites/default.json")).toBe(
      "packages/config/sites/default.json",
    );
  });
});

describe("config:validate io: only ENOENT reads as missing (wave review G-M1, Task 7 ruling)", () => {
  const errno = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };

  it("a file that does not exist is undefined; one that exists parses", () => {
    const dir = mkdtempSync(join(tmpdir(), "qm-cfgio-"));
    try {
      writeFileSync(join(dir, "a.json"), '{"x":1}');
      expect(configIo().readJson(join(dir, "missing.json"))).toBeUndefined();
      expect(configIo().readJson(join(dir, "a.json"))).toEqual({ x: 1 });
      expect(() => configIo().readJson(dir)).toThrow(ConfigUnreadableError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a stat or read error other than ENOENT is ConfigUnreadableError, not missing", () => {
    expect(configIo(errno("ENOENT")).readJson("x.json")).toBeUndefined();
    for (const code of ["EACCES", "ENOTDIR", "EPERM", "EMFILE"])
      expect(() => configIo(errno(code)).readJson("x.json")).toThrow(ConfigUnreadableError);
    // A path existsSync reports false for without ENOENT (invalid argument) is unreadable too.
    expect(() => configIo().readJson("bad\u0000name.json")).toThrow(ConfigUnreadableError);
  });
});
