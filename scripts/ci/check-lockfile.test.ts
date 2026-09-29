import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const tsxCli = require.resolve("tsx/cli");

function run(path: string): { status: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [tsxCli, "scripts/ci/check-lockfile.ts", path], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

// Each step spawns a tsx CLI (cold start); the 5s default flakes under full-suite load on Windows.
describe("check-lockfile CLI: exit 2 on unparsable YAML (critic:I2)", { timeout: 20_000 }, () => {
  it("exits 2 with a path: message line and no stack trace", () => {
    dir = mkdtempSync(join(tmpdir(), "lockfile-test-"));
    const path = join(dir, "bad-lock.yaml");
    writeFileSync(path, "packages:\n  foo@1.0.0:\n    resolution: [1,2\n", "utf8");
    const { status, stderr } = run(path);
    expect(status).toBe(2);
    expect(stderr).toMatch(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `));
    expect(stderr).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});
