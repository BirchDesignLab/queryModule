import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonFile, toPosixRel, writeConfigFile } from "./config-migrate";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = resolve(root, "scripts", "ci", "config-migrate.ts");
const tsxCli = require.resolve("tsx/cli");

afterEach(() => vi.restoreAllMocks());

// The behaviour of these helpers is tested in cli-io.test.ts; this only proves the re-export.
describe("config:migrate re-exports the shared cli-io helpers (#220 G-M-c)", () => {
  it("re-exports readJsonFile and toPosixRel", () => {
    expect(readJsonFile(() => '{"a":1}', "x.json")).toEqual({ ok: true, value: { a: 1 } });
    expect(toPosixRel(String.raw`packages\config\x.json`)).toBe("packages/config/x.json");
  });
});

describe("config:migrate write guard (#220 M1)", () => {
  it("a failed write prints '<path>: cannot write file', no raw error, and returns false", () => {
    const dir = mkdtempSync(join(tmpdir(), "qm-migrate-"));
    try {
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((m: unknown) => {
        errors.push(String(m));
      });
      // A directory as the target cannot be written on any OS.
      expect(writeConfigFile(dir, "x/site.json", { a: 1 })).toBe(false);
      expect(errors).toEqual(["x/site.json: cannot write file"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a successful write returns true", () => {
    const dir = mkdtempSync(join(tmpdir(), "qm-migrate-"));
    try {
      expect(writeConfigFile(join(dir, "ok.json"), "ok.json", { a: 1 })).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("config:migrate CLI (#220 G-M-b)", () => {
  it("no args exits 2 with the usage line", { timeout: 20000 }, () => {
    const r = spawnSync(process.execPath, [tsxCli, cli], { encoding: "utf8", cwd: root });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage: pnpm config:migrate <file>");
  });
});
