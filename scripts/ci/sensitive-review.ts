import picomatch from "picomatch";

export function parseSensitiveGlobs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

export function sensitiveFiles(files: string[], globs: string[]): string[] {
  const isMatch = picomatch(globs, { dot: true });
  return files.filter((f) => isMatch(f));
}

export interface ReviewFrontMatter {
  reviewer: string;
  effort: string;
  reviewedSha: string;
  verdict: string;
}

export function parseReviewFrontMatter(text: string): ReviewFrontMatter | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block?.[1]) return null;
  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*"?([^"]*)"?\s*$/.exec(line);
    if (kv?.[1] && kv[2] !== undefined) fields[kv[1]] = kv[2];
  }
  const { reviewer, effort, reviewedSha, verdict } = fields;
  if (!reviewer || !effort || !reviewedSha || !verdict) return null;
  return { reviewer, effort, reviewedSha, verdict };
}

export interface ReviewInput {
  changedFiles: string[];
  globs: string[];
  prNumber: number;
  artifactText: string | undefined;
  /** undefined when reviewedSha is not an ancestor of the PR head */
  filesChangedAfterReviewedSha: string[] | undefined;
}

export function evaluateSensitiveReview(input: ReviewInput): { ok: boolean; messages: string[] } {
  const touched = sensitiveFiles(input.changedFiles, input.globs);
  if (touched.length === 0) return { ok: true, messages: ["no sensitive paths touched"] };
  const artifactPath = `docs/reviews/pr-${input.prNumber}.md`;
  const fail = (m: string) => ({ ok: false, messages: [m] });
  if (input.artifactText === undefined)
    return fail(`sensitive paths touched (${touched.join(", ")}); ${artifactPath} is missing`);
  const fm = parseReviewFrontMatter(input.artifactText);
  if (!fm)
    return fail(`${artifactPath}: front matter needs reviewer, effort, reviewedSha, verdict`);
  if (fm.reviewer !== "opus-5.5")
    return fail(`${artifactPath}: reviewer must be opus-5.5, got ${fm.reviewer}`);
  if (fm.verdict !== "approve")
    return fail(`${artifactPath}: verdict must be approve, got ${fm.verdict}`);
  if (!/^[0-9a-f]{7,40}$/.test(fm.reviewedSha))
    return fail(`${artifactPath}: reviewedSha is not a commit sha`);
  if (input.filesChangedAfterReviewedSha === undefined)
    return fail(`${artifactPath}: reviewedSha ${fm.reviewedSha} is not an ancestor of the PR head`);
  const late = sensitiveFiles(input.filesChangedAfterReviewedSha, input.globs);
  if (late.length > 0) return fail(`sensitive files changed after reviewedSha: ${late.join(", ")}`);
  return { ok: true, messages: [`sensitive review recorded for ${touched.join(", ")}`] };
}

export type GitResult = { status: number | null; stdout: string | null; stderr: string | null };
export interface RunDeps {
  runGit: (args: string[]) => GitResult;
  /** repo-relative path; undefined when the file does not exist */
  readFile: (path: string) => string | undefined;
}
export interface RunResult {
  /** 0 pass, 1 review missing or invalid, 2 bad input or git failure (fail closed) */
  code: 0 | 1 | 2;
  messages: string[];
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

class GitFailure extends Error {}

function gitLines(runGit: RunDeps["runGit"], args: string[]): string[] {
  const r = runGit(args);
  if (r.status !== 0 || r.stdout === null)
    throw new GitFailure(
      `git ${args.join(" ")} failed (status ${r.status}): ${r.stderr ?? ""}`.trim(),
    );
  return lines(r.stdout);
}

export function runSensitiveReview(
  env: Record<string, string | undefined>,
  deps: RunDeps,
): RunResult {
  if (env.EVENT_NAME !== "pull_request")
    return {
      code: 0,
      messages: [
        `sensitive-review: ${env.EVENT_NAME ?? "local"} event, enforced on pull requests only`,
      ],
    };
  const base = env.BASE_SHA ?? "";
  const head = env.HEAD_SHA ?? "HEAD";
  const prNumber = Number(env.PR_NUMBER);
  const bad = (m: string): RunResult => ({ code: 2, messages: [`sensitive-review: ${m}`] });
  if (base === "") return bad("BASE_SHA is empty");
  if (head === "") return bad("HEAD_SHA is empty");
  if (!env.PR_NUMBER || !Number.isInteger(prNumber) || prNumber <= 0)
    return bad("PR_NUMBER must be a positive integer");
  try {
    const changedFiles = gitLines(deps.runGit, ["diff", "--name-only", `${base}...${head}`]);
    const globs = parseSensitiveGlobs(deps.readFile(".github/sensitive-paths") ?? "");
    const artifactText = deps.readFile(`docs/reviews/pr-${prNumber}.md`);
    let filesChangedAfterReviewedSha: string[] | undefined = [];
    const fm = artifactText ? parseReviewFrontMatter(artifactText) : null;
    if (fm) {
      const anc = deps.runGit(["merge-base", "--is-ancestor", fm.reviewedSha, head]);
      if (anc.status === 0)
        filesChangedAfterReviewedSha = gitLines(deps.runGit, [
          "diff",
          "--name-only",
          fm.reviewedSha,
          head,
        ]);
      else if (anc.status === 1) filesChangedAfterReviewedSha = undefined;
      else
        return bad(
          `git merge-base --is-ancestor failed (status ${anc.status}): ${anc.stderr ?? ""}`.trim(),
        );
    }
    const result = evaluateSensitiveReview({
      changedFiles,
      globs,
      prNumber,
      artifactText,
      filesChangedAfterReviewedSha,
    });
    return { code: result.ok ? 0 : 1, messages: result.messages };
  } catch (e) {
    if (e instanceof GitFailure) return bad(e.message);
    throw e;
  }
}
