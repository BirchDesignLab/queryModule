import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateSensitiveReview,
  parseReviewFrontMatter,
  parseSensitiveGlobs,
} from "./sensitive-review";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = process.env;
if (env.EVENT_NAME !== "pull_request") {
  console.log(
    `sensitive-review: ${env.EVENT_NAME ?? "local"} event, enforced on pull requests only`,
  );
  process.exit(0);
}
const base = env.BASE_SHA ?? "";
const head = env.HEAD_SHA ?? "HEAD";
const prNumber = Number(env.PR_NUMBER);
const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const changedFiles = lines(git(["diff", "--name-only", `${base}...${head}`]).stdout);
const globs = parseSensitiveGlobs(readFileSync(resolve(root, ".github/sensitive-paths"), "utf8"));
const artifactPath = resolve(root, `docs/reviews/pr-${prNumber}.md`);
const artifactText = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : undefined;

let filesChangedAfterReviewedSha: string[] | undefined = [];
const fm = artifactText ? parseReviewFrontMatter(artifactText) : null;
if (fm) {
  const ancestor = git(["merge-base", "--is-ancestor", fm.reviewedSha, head]).status === 0;
  filesChangedAfterReviewedSha = ancestor
    ? lines(git(["diff", "--name-only", fm.reviewedSha, head]).stdout)
    : undefined;
}

const result = evaluateSensitiveReview({
  changedFiles,
  globs,
  prNumber,
  artifactText,
  filesChangedAfterReviewedSha,
});
for (const m of result.messages) (result.ok ? console.log : console.error)(m);
process.exit(result.ok ? 0 : 1);
