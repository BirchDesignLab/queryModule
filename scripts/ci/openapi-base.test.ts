import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { type Git, selectBase } from "./openapi-base";

const SPEC = "packages/api/openapi.json";
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "oasbase-"));
  dirs.push(dir);
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...a], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  git("init", "-q", "-b", "main");
  const commit = (spec: string | null, msg: string) => {
    mkdirSync(join(dir, "packages/api"), { recursive: true });
    if (spec !== null) writeFileSync(join(dir, SPEC), spec);
    writeFileSync(join(dir, "n.txt"), msg);
    git("add", "-A");
    git("commit", "-q", "-m", msg);
  };
  const runner: Git = (args) => {
    try {
      return {
        status: 0,
        stdout: execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" }),
      };
    } catch (e) {
      return { status: (e as { status?: number }).status ?? null, stdout: "" };
    }
  };
  return { dir, git, commit, runner };
}

describe("selectBase", () => {
  it("diffs against the merge base, so a route added on main after the branch was cut is not a removal", () => {
    const r = repo();
    r.commit('{"v":1}', "base");
    r.git("checkout", "-q", "-b", "feature");
    r.git("checkout", "-q", "main");
    r.commit('{"v":2}', "main adds a route");
    r.git("update-ref", "refs/remotes/origin/main", "main");
    r.git("checkout", "-q", "feature");
    r.commit(null, "feature work");
    const out = selectBase(r.runner, "origin/main");
    expect(out).toEqual({ kind: "base", content: '{"v":1}', sha: r.git("rev-parse", "main~1") });
  });

  it("skips when the merge base lists no openapi.json", () => {
    const r = repo();
    r.commit(null, "no spec yet");
    r.git("update-ref", "refs/remotes/origin/main", "main");
    r.commit('{"v":1}', "head adds spec");
    expect(selectBase(r.runner, "origin/main")).toEqual({ kind: "skip" });
  });

  it("fails closed when the base ref does not exist", () => {
    const r = repo();
    r.commit('{"v":1}', "c");
    expect(selectBase(r.runner, "origin/nope")).toEqual({ kind: "fail", reason: "merge-base" });
  });

  it("fails closed when ls-tree fails", () => {
    const g: Git = (args) =>
      args[0] === "merge-base" ? { status: 0, stdout: "abc123\n" } : { status: 128, stdout: "" };
    expect(selectBase(g, "origin/main")).toEqual({ kind: "fail", reason: "ls-tree" });
  });

  it("fails closed when git show fails or git cannot spawn", () => {
    const g: Git = (args) =>
      args[0] === "merge-base"
        ? { status: 0, stdout: "abc123\n" }
        : args[0] === "ls-tree"
          ? { status: 0, stdout: `${SPEC}\n` }
          : { status: null, stdout: "" };
    expect(selectBase(g, "origin/main")).toEqual({ kind: "fail", reason: "show" });
  });
});

describe("openapi-base CLI contract", () => {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const script = fileURLToPath(new URL("./openapi-base.ts", import.meta.url));
  const run = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [tsxCli, script, ...args], { cwd, encoding: "utf8" });

  it("exits 0, prints the base sha and writes the file when a base exists", () => {
    const r = repo();
    r.commit('{"v":1}', "base");
    r.git("update-ref", "refs/remotes/origin/main", "main");
    r.commit(null, "head");
    const res = run(r.dir, ["origin/main", "out.json"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^base: [0-9a-f]{40}$/m);
    expect(readFileSync(join(r.dir, "out.json"), "utf8")).toBe('{"v":1}');
  }, 60_000);

  it("exits 3 with a skip line and no file when the merge base has no openapi.json", () => {
    const r = repo();
    r.commit(null, "no spec yet");
    r.git("update-ref", "refs/remotes/origin/main", "main");
    r.commit('{"v":1}', "head adds spec");
    const res = run(r.dir, ["origin/main", "out.json"]);
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/^skip:/m);
    expect(existsSync(join(r.dir, "out.json"))).toBe(false);
  }, 60_000);

  it("exits 1 when the base ref does not exist, and 2 on bad usage", () => {
    const r = repo();
    r.commit('{"v":1}', "c");
    expect(run(r.dir, ["origin/nope", "out.json"]).status).toBe(1);
    expect(run(r.dir, []).status).toBe(2);
    expect(existsSync(join(r.dir, "out.json"))).toBe(false);
  }, 60_000);
});
