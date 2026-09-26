import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateSensitiveReview,
  parseReviewFrontMatter,
  parseSensitiveGlobs,
  runSensitiveReview,
  sensitiveFiles,
} from "./sensitive-review";

const globs = parseSensitiveGlobs(
  "# comment\npackages/api/src/audit/**\n\n.github/**\nscripts/ci/**\n",
);
const sha = "0123456789abcdef0123456789abcdef01234567";
const artifact = `---\nreviewer: "opus-5.5"\neffort: "xhigh"\nreviewedSha: "${sha}"\nverdict: "approve"\n---\n\nFindings: none.\n`;

describe("sensitive-review (spec 9.1)", () => {
  it("parses globs, skipping comments and blanks", () => {
    expect(globs).toEqual(["packages/api/src/audit/**", ".github/**", "scripts/ci/**"]);
  });

  it("matches dotfiles and nested paths", () => {
    expect(
      sensitiveFiles(
        [".github/workflows/ci.yml", "docs/a.md", "packages/api/src/audit/service.ts"],
        globs,
      ),
    ).toEqual([".github/workflows/ci.yml", "packages/api/src/audit/service.ts"]);
  });

  it("parses front matter and rejects missing fields", () => {
    expect(parseReviewFrontMatter(artifact)).toEqual({
      reviewer: "opus-5.5",
      effort: "xhigh",
      reviewedSha: sha,
      verdict: "approve",
    });
    expect(parseReviewFrontMatter("---\nreviewer: opus-5.5\n---\n")).toBeNull();
    expect(parseReviewFrontMatter("no front matter")).toBeNull();
  });

  const base = { globs, prNumber: 7, filesChangedAfterReviewedSha: [] as string[] | undefined };

  it("passes when no sensitive path is touched", () => {
    expect(
      evaluateSensitiveReview({ ...base, changedFiles: ["docs/x.md"], artifactText: undefined }).ok,
    ).toBe(true);
  });

  it("fails without the artifact", () => {
    const r = evaluateSensitiveReview({
      ...base,
      changedFiles: ["scripts/ci/x.ts"],
      artifactText: undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toContain("docs/reviews/pr-7.md is missing");
  });

  it("fails on a wrong reviewer, a low effort, a non-approve verdict or a bad sha", () => {
    for (const text of [
      artifact.replace("opus-5.5", "sonnet-5"),
      artifact.replace('"xhigh"', '"low"'),
      artifact.replace('"approve"', '"changes"'),
      artifact.replace(sha, "not-a-sha"),
    ]) {
      expect(
        evaluateSensitiveReview({ ...base, changedFiles: ["scripts/ci/x.ts"], artifactText: text })
          .ok,
      ).toBe(false);
    }
  });

  it("accepts effort xhigh or max and names a bad effort", () => {
    const run = (text: string) =>
      evaluateSensitiveReview({ ...base, changedFiles: ["scripts/ci/x.ts"], artifactText: text });
    expect(run(artifact.replace('"xhigh"', '"max"')).ok).toBe(true);
    expect(run(artifact.replace('"xhigh"', '"low"')).messages[0]).toContain(
      "effort must be xhigh or max, got low",
    );
  });

  it("fails when reviewedSha is not an ancestor or sensitive files changed after it", () => {
    expect(
      evaluateSensitiveReview({
        ...base,
        changedFiles: ["scripts/ci/x.ts"],
        artifactText: artifact,
        filesChangedAfterReviewedSha: undefined,
      }).ok,
    ).toBe(false);
    const late = evaluateSensitiveReview({
      ...base,
      changedFiles: ["scripts/ci/x.ts"],
      artifactText: artifact,
      filesChangedAfterReviewedSha: ["docs/reviews/pr-7.md", "scripts/ci/x.ts"],
    });
    expect(late.ok).toBe(false);
    expect(late.messages[0]).toContain("scripts/ci/x.ts");
  });

  it("passes with a valid artifact and only non-sensitive changes after reviewedSha", () => {
    const r = evaluateSensitiveReview({
      ...base,
      changedFiles: ["scripts/ci/x.ts"],
      artifactText: artifact,
      filesChangedAfterReviewedSha: ["docs/reviews/pr-7.md"],
    });
    expect(r).toEqual({ ok: true, messages: ["sensitive review recorded for scripts/ci/x.ts"] });
  });
});

describe("runSensitiveReview (spec 9.1, fails closed)", () => {
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const env = {
    EVENT_NAME: "pull_request",
    BASE_SHA: "abc1234",
    HEAD_SHA: "def5678",
    PR_NUMBER: "7",
  };
  const files: Record<string, string> = { ".github/sensitive-paths": "scripts/ci/**\n" };
  const readFile = (p: string) => files[p];
  const calls: string[][] = [];
  const gitWith =
    (answers: Record<string, { status: number | null; stdout: string | null; stderr: string }>) =>
    (args: string[]) => {
      calls.push(args);
      return answers[args.slice(0, 2).join(" ")] ?? ok();
    };

  it("skips non pull_request events with exit 0", () => {
    const r = runSensitiveReview({ EVENT_NAME: "push" }, { runGit: gitWith({}), readFile });
    expect(r.code).toBe(0);
    expect(runSensitiveReview({}, { runGit: gitWith({}), readFile }).messages[0]).toContain(
      "local",
    );
  });

  it("exits 2 when BASE_SHA is empty or unset", () => {
    for (const BASE_SHA of ["", undefined]) {
      const r = runSensitiveReview({ ...env, BASE_SHA }, { runGit: gitWith({}), readFile });
      expect(r.code).toBe(2);
    }
  });

  it("exits 2 when HEAD_SHA is empty", () => {
    expect(
      runSensitiveReview({ ...env, HEAD_SHA: "" }, { runGit: gitWith({}), readFile }).code,
    ).toBe(2);
  });

  it("exits 2 when PR_NUMBER is unset, NaN, zero or fractional", () => {
    for (const PR_NUMBER of [undefined, "", "abc", "0", "-3", "1.5"]) {
      const r = runSensitiveReview({ ...env, PR_NUMBER }, { runGit: gitWith({}), readFile });
      expect(r.code, String(PR_NUMBER)).toBe(2);
    }
  });

  it("exits 2 when git diff base...head fails (bad BASE_SHA)", () => {
    const runGit = gitWith({
      "diff --name-only": { status: 128, stdout: "", stderr: "fatal: bad revision" },
    });
    const r = runSensitiveReview(env, { runGit, readFile });
    expect(r.code).toBe(2);
    expect(r.messages.join("\n")).toContain("fatal: bad revision");
  });

  it("exits 2 when git cannot be spawned", () => {
    const runGit = gitWith({ "diff --name-only": { status: null, stdout: null, stderr: "" } });
    expect(runSensitiveReview(env, { runGit, readFile }).code).toBe(2);
  });

  it("passes with exit 0 when no sensitive path is touched", () => {
    const runGit = gitWith({ "diff --name-only": ok("docs/a.md\0") });
    expect(runSensitiveReview(env, { runGit, readFile })).toEqual({
      code: 0,
      messages: ["no sensitive paths touched"],
    });
  });

  it("exits 1 when a sensitive path is touched and the artifact is missing", () => {
    const runGit = gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") });
    const r = runSensitiveReview(env, { runGit, readFile });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("docs/reviews/pr-7.md is missing");
  });

  const withArtifact = (p: string) => (p === "docs/reviews/pr-7.md" ? artifact : readFile(p));

  it("exits 0 with a valid artifact whose reviewedSha is an ancestor", () => {
    calls.length = 0;
    const runGit = (args: string[]) => {
      calls.push(args);
      if (args[0] === "diff" && args.at(-1) === "abc1234...def5678") return ok("scripts/ci/x.ts\0");
      return ok();
    };
    const r = runSensitiveReview(env, { runGit, readFile: withArtifact });
    expect(r.code).toBe(0);
    expect(calls).toContainEqual(["merge-base", "--is-ancestor", sha, "def5678"]);
    expect(calls).toContainEqual([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "abc1234...def5678",
    ]);
    expect(calls).toContainEqual(["diff", "--name-only", "-z", "--no-renames", sha, "def5678"]);
  });

  it("exits 1 when reviewedSha is not an ancestor (merge-base status 1)", () => {
    const runGit = gitWith({
      "diff --name-only": ok("scripts/ci/x.ts\0"),
      "merge-base --is-ancestor": { status: 1, stdout: "", stderr: "" },
    });
    const r = runSensitiveReview(env, { runGit, readFile: withArtifact });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("not an ancestor");
  });

  it("exits 2 when merge-base fails (status other than 0 or 1)", () => {
    const runGit = gitWith({
      "diff --name-only": ok("scripts/ci/x.ts\0"),
      "merge-base --is-ancestor": { status: 128, stdout: "", stderr: "fatal: not a valid commit" },
    });
    expect(runSensitiveReview(env, { runGit, readFile: withArtifact }).code).toBe(2);
  });

  it("exits 2 when git diff reviewedSha head fails", () => {
    const runGit = (args: string[]) =>
      args[0] === "diff" && args.includes(sha)
        ? { status: 128, stdout: "", stderr: "fatal: bad object" }
        : args[0] === "diff"
          ? ok("scripts/ci/x.ts\0")
          : ok();
    expect(runSensitiveReview(env, { runGit, readFile: withArtifact }).code).toBe(2);
  });

  it("exits 1 on a malformed reviewedSha without calling merge-base", () => {
    calls.length = 0;
    const badSha = artifact.replace(sha, "not-a-sha");
    const r = runSensitiveReview(env, {
      runGit: gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") }),
      readFile: (p) => (p === "docs/reviews/pr-7.md" ? badSha : readFile(p)),
    });
    expect(r).toEqual({
      code: 1,
      messages: ["docs/reviews/pr-7.md: reviewedSha is not a commit sha"],
    });
    expect(calls.some((c) => c[0] === "merge-base")).toBe(false);
  });

  it("exits 2 when .github/sensitive-paths is missing", () => {
    const runGit = gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") });
    const r = runSensitiveReview(env, { runGit, readFile: () => undefined });
    expect(r.code).toBe(2);
    expect(r.messages[0]).toContain(".github/sensitive-paths is missing");
  });

  it("exits 2 when .github/sensitive-paths lists no globs", () => {
    const runGit = gitWith({ "diff --name-only": ok("docs/a.md\0") });
    const r = runSensitiveReview(env, { runGit, readFile: () => "# only a comment\n\n" });
    expect(r.code).toBe(2);
    expect(r.messages[0]).toContain(".github/sensitive-paths lists no globs");
  });

  it("matches the base globs too, so a PR cannot drop the glob that judges it", () => {
    calls.length = 0;
    const runGit = gitWith({
      "diff --name-only": ok(".github/sensitive-paths\0packages/api/src/audit/a.ts\0"),
      "ls-tree --name-only": ok(".github/sensitive-paths\0"),
      "show abc1234:.github/sensitive-paths": ok(".github/**\npackages/api/src/audit/**\n"),
    });
    const readHead = (p: string) => (p === ".github/sensitive-paths" ? "docs/**\n" : undefined);
    const r = runSensitiveReview(env, { runGit, readFile: readHead });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("packages/api/src/audit/a.ts");
    expect(calls).toContainEqual([
      "ls-tree",
      "--name-only",
      "-z",
      "abc1234",
      "--",
      ".github/sensitive-paths",
    ]);
  });

  it("exits 2 when the base glob file cannot be read", () => {
    for (const failing of ["ls-tree --name-only", "show abc1234:.github/sensitive-paths"]) {
      const runGit = gitWith({
        "diff --name-only": ok("docs/a.md\0"),
        "ls-tree --name-only": ok(".github/sensitive-paths\0"),
        [failing]: { status: 128, stdout: "", stderr: "fatal: bad object" },
      });
      expect(runSensitiveReview(env, { runGit, readFile }).code, failing).toBe(2);
    }
  });
});

describe("runSensitiveReview against a real git repo", () => {
  const git = (cwd: string, args: string[]) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(cwd, ".gitcfg") },
    });
    return { status: r.status, stdout: r.stdout ?? null, stderr: r.stderr ?? null };
  };
  const inRepo = (change: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "sensitive-review-"));
    try {
      const write = (p: string, t: string) => {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), t);
      };
      const commit = () => {
        git(dir, ["add", "-A"]);
        git(dir, [
          "-c",
          "user.name=Testerson",
          "-c",
          "user.email=t@example.test",
          "commit",
          "-qm",
          "c",
        ]);
        return (git(dir, ["rev-parse", "HEAD"]).stdout ?? "").trim();
      };
      writeFileSync(join(dir, ".gitcfg"), "");
      git(dir, ["init", "-q"]);
      write(".gitignore", ".gitcfg\n");
      write(".github/sensitive-paths", "scripts/ci/**\n");
      write("scripts/ci/x.ts", "export const x = 1;\n".repeat(20));
      const base = commit();
      change(dir);
      const head = commit();
      return runSensitiveReview(
        { EVENT_NAME: "pull_request", BASE_SHA: base, HEAD_SHA: head, PR_NUMBER: "7" },
        {
          runGit: (args) => git(dir, args),
          readFile: (p) => (p === ".github/sensitive-paths" ? "scripts/ci/**\n" : undefined),
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("catches a file renamed out of a sensitive path", () => {
    const r = inRepo((dir) => git(dir, ["mv", "scripts/ci/x.ts", "moved-x.ts"]));
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("scripts/ci/x.ts");
  });

  it("catches a sensitive path with non-ASCII characters", () => {
    const r = inRepo((dir) => writeFileSync(join(dir, "scripts/ci/é.ts"), "export {};\n"));
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("scripts/ci/é.ts");
  });
});
