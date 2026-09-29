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
  // Best-effort teardown: win32 can hold git handles briefly (EBUSY, EPERM).
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
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

// Each case spawns several git processes; the 5s default flakes on Windows under load.
describe("selectBase", { timeout: 30_000 }, () => {
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

  it("on a PR merge-ref checkout, diffs from the merge base of the PR head, not the base tip", () => {
    const r = repo();
    r.commit('{"v":1}', "base");
    const cut = r.git("rev-parse", "main");
    r.git("checkout", "-q", "-b", "feature");
    r.commit(null, "feature work");
    r.git("checkout", "-q", "main");
    r.commit('{"v":2}', "main adds a route");
    r.git("update-ref", "refs/remotes/origin/main", "main");
    // Actions checks out refs/pull/N/merge: HEAD is a merge of the PR head into the base tip.
    r.git("checkout", "-q", "--detach", "main");
    // Both sides touch the helper's n.txt; -X theirs keeps the merge automatic.
    r.git("merge", "-q", "--no-ff", "-X", "theirs", "-m", "merge", "feature");
    const head = r.git("rev-parse", "feature");
    expect(selectBase(r.runner, "origin/main", head)).toEqual({
      kind: "base",
      content: '{"v":1}',
      sha: cut,
    });
  });

  it("passes the head ref to merge-base, HEAD by default", () => {
    const seen: string[][] = [];
    const g: Git = (args) => {
      seen.push(args);
      return { status: 128, stdout: "" };
    };
    selectBase(g, "origin/main", "abc123");
    selectBase(g, "origin/main");
    expect(seen).toEqual([
      ["merge-base", "origin/main", "abc123"],
      ["merge-base", "origin/main", "HEAD"],
    ]);
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

  it("with a head ref, writes the head spec from that ref, not the working tree", () => {
    const r = repo();
    r.commit('{"v":1}', "base");
    r.git("update-ref", "refs/remotes/origin/main", "main");
    r.git("checkout", "-q", "-b", "feature");
    r.commit('{"v":3}', "feature changes the spec");
    const head = r.git("rev-parse", "feature");
    writeFileSync(join(r.dir, SPEC), '{"v":"worktree"}');
    const res = run(r.dir, ["origin/main", "base.json", head, "head.json"]);
    expect(res.status).toBe(0);
    expect(readFileSync(join(r.dir, "base.json"), "utf8")).toBe('{"v":1}');
    expect(readFileSync(join(r.dir, "head.json"), "utf8")).toBe('{"v":3}');
  }, 60_000);

  it("exits 2 when a head ref is given without a head output path", () => {
    const r = repo();
    r.commit('{"v":1}', "c");
    expect(run(r.dir, ["origin/main", "base.json", "HEAD"]).status).toBe(2);
  }, 60_000);

  it("exits 1 when the base ref does not exist, and 2 on bad usage", () => {
    const r = repo();
    r.commit('{"v":1}', "c");
    expect(run(r.dir, ["origin/nope", "out.json"]).status).toBe(1);
    expect(run(r.dir, []).status).toBe(2);
    expect(existsSync(join(r.dir, "out.json"))).toBe(false);
  }, 60_000);
});
