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

  it("fails on a wrong reviewer, a non-approve verdict or a bad sha", () => {
    for (const text of [
      artifact.replace("opus-5.5", "sonnet-5"),
      artifact.replace('"approve"', '"changes"'),
      artifact.replace(sha, "not-a-sha"),
    ]) {
      expect(
        evaluateSensitiveReview({ ...base, changedFiles: ["scripts/ci/x.ts"], artifactText: text })
          .ok,
      ).toBe(false);
    }
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
    const runGit = gitWith({ "diff --name-only": ok("docs/a.md\n") });
    expect(runSensitiveReview(env, { runGit, readFile })).toEqual({
      code: 0,
      messages: ["no sensitive paths touched"],
    });
  });

  it("exits 1 when a sensitive path is touched and the artifact is missing", () => {
    const runGit = gitWith({ "diff --name-only": ok("scripts/ci/x.ts\n") });
    const r = runSensitiveReview(env, { runGit, readFile });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("docs/reviews/pr-7.md is missing");
  });

  const withArtifact = (p: string) => (p === "docs/reviews/pr-7.md" ? artifact : readFile(p));

  it("exits 0 with a valid artifact whose reviewedSha is an ancestor", () => {
    calls.length = 0;
    const runGit = (args: string[]) => {
      calls.push(args);
      if (args[0] === "diff" && args[2] === "abc1234...def5678") return ok("scripts/ci/x.ts\n");
      return ok();
    };
    const r = runSensitiveReview(env, { runGit, readFile: withArtifact });
    expect(r.code).toBe(0);
    expect(calls).toContainEqual(["merge-base", "--is-ancestor", sha, "def5678"]);
    expect(calls).toContainEqual(["diff", "--name-only", sha, "def5678"]);
  });

  it("exits 1 when reviewedSha is not an ancestor (merge-base status 1)", () => {
    const runGit = gitWith({
      "diff --name-only": ok("scripts/ci/x.ts\n"),
      "merge-base --is-ancestor": { status: 1, stdout: "", stderr: "" },
    });
    const r = runSensitiveReview(env, { runGit, readFile: withArtifact });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("not an ancestor");
  });

  it("exits 2 when merge-base fails (status other than 0 or 1)", () => {
    const runGit = gitWith({
      "diff --name-only": ok("scripts/ci/x.ts\n"),
      "merge-base --is-ancestor": { status: 128, stdout: "", stderr: "fatal: not a valid commit" },
    });
    expect(runSensitiveReview(env, { runGit, readFile: withArtifact }).code).toBe(2);
  });

  it("exits 2 when git diff reviewedSha head fails", () => {
    const runGit = (args: string[]) =>
      args[0] === "diff" && args[2] === sha
        ? { status: 128, stdout: "", stderr: "fatal: bad object" }
        : args[0] === "diff"
          ? ok("scripts/ci/x.ts\n")
          : ok();
    expect(runSensitiveReview(env, { runGit, readFile: withArtifact }).code).toBe(2);
  });
});
