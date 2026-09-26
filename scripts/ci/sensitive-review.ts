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
