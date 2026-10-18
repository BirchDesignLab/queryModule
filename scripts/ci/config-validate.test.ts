import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigUnreadableError } from "./config-files";
import {
  configIo,
  diffLines,
  parseValidateArgs,
  tagIo,
  toPosixRel,
  VALIDATE_USAGE,
} from "./config-validate";

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

describe("config:validate --diff <tag> (spec 7, 9.5, D-M2P2-8)", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const site = join(repo, "packages/config/sites/default.json");

  it("parses a tag after --diff", () => {
    expect(parseValidateArgs(["--diff", "m1"])).toEqual({
      ok: true,
      resolved: false,
      files: [],
      diff: "m1",
    });
    expect(parseValidateArgs(["--diff", "release/v1.2_rc-1", "a.json"])).toMatchObject({
      ok: true,
      diff: "release/v1.2_rc-1",
      files: ["a.json"],
    });
  });

  it("rejects a missing tag, a bad tag and an option-like tag before any git call", () => {
    for (const args of [
      ["--diff"],
      ["--diff", "a b"],
      ["--diff", "v1;rm"],
      ["--diff", "$(x)"],
      ["--diff", "-p"],
      ["--diff", "--resolved"],
      ["--diff", "x".repeat(101)],
    ]) {
      const r = parseValidateArgs(args);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain(VALIDATE_USAGE);
    }
  });

  // A fake git reader: the tag's copy of default.json has one feature on and a longer session.
  const show = (spec: string): string | undefined => {
    const rel = spec.slice(spec.indexOf(":") + 1);
    const text = readFileSync(join(repo, rel), "utf8");
    if (!rel.endsWith("sites/default.json")) return text;
    const j = JSON.parse(text);
    delete j.features.adminAudit;
    j.auth.session.idleMinutes = 45;
    return JSON.stringify(j);
  };

  it("tagIo reads <tag>:<repo-relative posix path> and maps a missing file to undefined", () => {
    const asked: string[] = [];
    const io = tagIo("m1", repo, (spec) => {
      asked.push(spec);
      return spec.endsWith("nope.json") ? undefined : '{"x":1}';
    });
    expect(io.readJson(join(repo, "packages", "config", "sites", "a.json"))).toEqual({ x: 1 });
    expect(io.readJson(join(repo, "nope.json"))).toBeUndefined();
    expect(asked[0]).toBe("m1:packages/config/sites/a.json");
  });

  it("prints the added feature key and the changed session limit", () => {
    const lines = diffLines("m1", [site], repo, show);
    const text = lines.join("\n");
    expect(lines.some((l) => l.startsWith("+ ") && l.includes("/features/adminAudit"))).toBe(true);
    expect(lines.some((l) => l.startsWith("~ ") && l.includes("/auth/session/idleMinutes"))).toBe(
      true,
    );
    expect(text).toContain("45");
    expect(text).toContain("30");
  });

  it("prints 'new file' for a target absent at the tag and nothing else for it", () => {
    const lines = diffLines("m1", [site], repo, () => undefined);
    expect(lines).toEqual(["packages/config/sites/default.json: new file"]);
  });

  it("prints no changes when both sides are equal", () => {
    const same = (spec: string) =>
      readFileSync(join(repo, spec.slice(spec.indexOf(":") + 1)), "utf8");
    expect(diffLines("m1", [site], repo, same)).toEqual([
      "packages/config/sites/default.json: no changes",
    ]);
  });

  it("--resolved with --diff is a usage error (it would be ignored)", () => {
    const r = parseValidateArgs(["--resolved", "--diff", "m1"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("--resolved");
  });

  it("a target that is invalid JSON at the tag reports config.invalidJson, not a throw", () => {
    const lines = diffLines("m1", [site], repo, () => "{ not json");
    expect(lines.some((l) => l.startsWith("ERROR ") && l.includes("config.invalidJson"))).toBe(
      true,
    );
    expect(lines.join("\n")).not.toContain("not json");
  });

  it("a new file is still validated on the head side", () => {
    const dir = mkdtempSync(join(tmpdir(), "qm-cfgdiff-"));
    try {
      mkdirSync(join(dir, "sites"));
      const bad = join(dir, "sites", "bad.json");
      writeFileSync(bad, "{}");
      const lines = diffLines("m1", [bad], dir, () => undefined);
      expect(lines.some((l) => l.endsWith(": new file"))).toBe(true);
      expect(lines.some((l) => l.startsWith("ERROR ") && l.includes(" head "))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a target outside the repo is an error line, never 'new file'", () => {
    const outside = join(repo, "..", "elsewhere.json");
    const lines = diffLines("m1", [outside], repo, () => undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ERROR .*config.targetOutsideRepo/);
  });
});
