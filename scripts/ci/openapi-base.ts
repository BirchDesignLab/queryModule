/**
 * Picks the OpenAPI document the oasdiff breaking step diffs against (#171): the merge base of
 * the base branch and HEAD, not the base-branch tip, so a route added on main after the branch
 * was cut is not read as a removal. Fail closed: any git failure fails; skip only when the merge
 * base lists no openapi.json.
 *
 * CLI: pnpm tsx scripts/ci/openapi-base.ts <base-ref> <out>
 * Exit 0 with <out> written and a "base: <sha>" line; exit 3 with no <out> (prints "skip:") when
 * the merge base has no openapi.json; exit 1 on any git failure; exit 2 on bad usage. The
 * workflow treats only 3 as skip, so a silent no-op cannot pass as a skip.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isMainModule } from "./cli-io";

export const EXIT_SKIP = 3;

export const SPEC_PATH = "packages/api/openapi.json";

export type GitResult = { status: number | null; stdout: string };
export type Git = (args: string[]) => GitResult;
export type BaseSelection =
  | { kind: "skip" }
  | { kind: "base"; sha: string; content: string }
  | { kind: "fail"; reason: "merge-base" | "ls-tree" | "show" };

export function selectBase(git: Git, baseRef: string, headRef = "HEAD"): BaseSelection {
  const mb = git(["merge-base", baseRef, headRef]);
  const sha = mb.stdout.trim();
  if (mb.status !== 0 || sha === "") return { kind: "fail", reason: "merge-base" };
  const ls = git(["ls-tree", "--name-only", sha, "--", SPEC_PATH]);
  if (ls.status !== 0) return { kind: "fail", reason: "ls-tree" };
  if (ls.stdout.trim() === "") return { kind: "skip" };
  const show = git(["show", `${sha}:${SPEC_PATH}`]);
  if (show.status !== 0) return { kind: "fail", reason: "show" };
  return { kind: "base", sha, content: show.stdout };
}

function main(argv: string[]): number {
  const [baseRef, out, headRef, headOut] = argv;
  if (!baseRef || !out || (headRef !== undefined && !headOut)) {
    console.error("usage: openapi-base.ts <base-ref> <out> [<head-ref> <head-out>]");
    return 2;
  }
  const git: Git = (args) => {
    const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
  };
  const sel = selectBase(git, baseRef, headRef);
  if (sel.kind === "fail") {
    console.error(`git ${sel.reason} failed; cannot pick the oasdiff base`);
    return 1;
  }
  if (sel.kind === "skip") {
    console.log("skip: no openapi.json at the merge base yet; nothing to diff.");
    return EXIT_SKIP;
  }
  let headContent: string | undefined;
  if (headRef !== undefined) {
    const show = git(["show", `${headRef}:${SPEC_PATH}`]);
    if (show.status !== 0) {
      console.error("git show failed; cannot read the head openapi.json");
      return 1;
    }
    headContent = show.stdout;
  }
  writeFileSync(out, sel.content);
  if (headOut !== undefined && headContent !== undefined) writeFileSync(headOut, headContent);
  console.log(`base: ${sel.sha}`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) process.exit(main(process.argv.slice(2)));
