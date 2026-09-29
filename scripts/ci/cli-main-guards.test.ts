import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// #220 M2 (#280): a gate CLI whose main guard compares import.meta.url with the raw argv[1]
// skips main() when it is started through another spelling of its own path (a symlinked
// checkout, or a different drive-letter case on Windows) and exits 0 with no output: fail open.
// Each CLI here is started through such a path and must still run and fail on a bad input.

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const temps: string[] = [];
const links: string[] = [];
/** Removes the link itself (never its target), so no cleanup can walk through it into scripts/ci. */
const removeLink = (link: string) => {
  if (process.platform === "win32") rmdirSync(link);
  else unlinkSync(link);
};
// One hook, links first: the guarantee does not depend on vitest's hook order (#279 G-m2).
afterAll(() => {
  for (const l of links.splice(0)) removeLink(l);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};

/**
 * Another spelling of the same file: the scripts/ci directory reached through a directory link
 * (a junction on win32, which needs no elevation; a symlink elsewhere), as in a symlinked checkout.
 * Node resolves the main module to its real path, so import.meta.url and argv[1] differ.
 */
const linkedCi = (() => {
  const link = join(temp("qm-cli-link-"), "ci");
  symlinkSync(here, link, process.platform === "win32" ? "junction" : "dir");
  links.push(link);
  return link;
})();

function run(cli: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const entry = join(linkedCi, cli);
  const argv = cli.endsWith(".ts") ? [tsxCli, entry, ...args] : [entry, ...args];
  return spawnSync(process.execPath, argv, {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, ...env },
  });
}

describe("#220 M2 every gate CLI runs main through isMainModule", () => {
  it("isMainModule: check-audit-migrations fails a DROP TABLE audit_event", () => {
    const dir = temp("qm-cli-mig-");
    writeFileSync(join(dir, "0099_bad.sql"), "DROP TABLE audit_event;\n");
    const r = run("check-audit-migrations.ts", [dir]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/violation/);
  });

  it("isMainModule: check-schema-writes fails a writable_schema token", () => {
    const dir = temp("qm-cli-src-");
    mkdirSync(join(dir, "db"));
    writeFileSync(join(dir, "db", "bad.ts"), "export const p = 'writable_schema';\n");
    const r = run("check-schema-writes.ts", [dir]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/violation/);
  });

  it("isMainModule: lockfile-guard fails a missing lockfile", () => {
    const r = run("lockfile-guard.mjs", [join(temp("qm-cli-lock-"), "missing.yaml")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/missing\.yaml/);
  });

  it("isMainModule: changed-paths prints its areas", () => {
    const r = run("changed-paths.mjs", [], { EVENT_NAME: "push", BASE_SHA: "", HEAD_SHA: "HEAD" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/=true/);
  });
});
