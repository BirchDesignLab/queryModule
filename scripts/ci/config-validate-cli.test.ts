import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = resolve(root, "scripts", "ci", "config-validate.ts");
const tsxCli = require.resolve("tsx/cli");
const run = (args: string[]) =>
  spawnSync(process.execPath, [tsxCli, cli, ...args], { encoding: "utf8", cwd: root });

// Review CV1: "byte-identical to base" cannot literally hold (base printed
// native separators; item 2 deliberately makes head always print forward
// slashes, so base and head output differ by design on Windows). The
// invariant that actually matters, and that this CLI-level run proves
// directly against the real Node fs/path APIs on whichever OS runs this
// test (not just the pure `toPosixRel` function in config-validate.test.ts):
// head's own output never contains a backslash, on any host OS, so a
// PowerShell run and a Git Bash run of the same head commit are
// byte-identical to each other.
describe("config:validate CLI output has no backslashes (master plan 9, review CV1)", () => {
  it("prints only forward-slash paths for the shipped configs", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok packages/config/sites/default.json");
    expect(r.stdout).not.toContain("\\");
    expect(r.stderr).not.toContain("\\");
  });
});
