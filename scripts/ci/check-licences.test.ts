import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = resolve(root, "scripts", "ci", "check-licences.ts");
const tsxCli = require.resolve("tsx/cli");
const run = (args: string[]) =>
  spawnSync(process.execPath, [tsxCli, cli, ...args], { encoding: "utf8", cwd: root });

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("check-licences CLI error output (item 8)", () => {
  it("prints usage and exits 2 with no report path", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
  });

  it("reports a missing report file cleanly, no stack trace, repo-relative posix path", () => {
    const r = run(["does/not/exist.json"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does/not/exist.json:");
    expect(r.stderr).not.toContain("\\");
    expect(r.stderr).not.toContain("\n    at ");
  });

  it("reports an unparseable report file cleanly, no file excerpt", () => {
    dir = mkdtempSync(join(tmpdir(), "licences-"));
    const bad = join(dir, "report.json");
    writeFileSync(bad, "{not json, secretMarker123");
    const r = run([bad]);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("secretMarker123");
    expect(r.stderr).not.toContain("\n    at ");
  });
});
