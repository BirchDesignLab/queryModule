import { describe, expect, it } from "vitest";
import { parseValidateArgs, toPosixRel, VALIDATE_USAGE } from "./config-validate";

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
