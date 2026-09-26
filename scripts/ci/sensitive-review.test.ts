import { describe, expect, it } from "vitest";
import {
  evaluateSensitiveReview,
  parseReviewFrontMatter,
  parseSensitiveGlobs,
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
