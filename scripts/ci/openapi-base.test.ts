import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
