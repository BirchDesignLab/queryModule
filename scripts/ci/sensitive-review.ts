import picomatch from "picomatch";

/** Flat glob list: every non-exempt glob, section headers skipped. */
export function parseSensitiveGlobs(text: string): string[] {
  const t = parseSensitiveTiers(text);
  return [...t.critical, ...t.gate, ...t.deps];
}

export function sensitiveFiles(files: string[], globs: string[]): string[] {
  const isMatch = picomatch(globs, { dot: true });
  return files.filter((f) => isMatch(f));
}

/**
 * Review tiers (ADR-0007). critical: Opus 5.5 at effort xhigh or max. gate: Opus 5.5 at
 * effort high or above. deps: automated checks only, no artifact. exempt: never reviewed.
 */
export type Tier = "critical" | "gate" | "deps";
const RANK: Record<Tier, number> = { deps: 1, gate: 2, critical: 3 };
const SECTIONS = ["critical", "gate", "deps", "exempt"] as const;
type Section = (typeof SECTIONS)[number];
export type TierGlobs = Record<Section, string[]>;

/** Parses `[critical]`, `[gate]`, `[deps]`, `[exempt]` sections; lines before any section are critical. */
export function parseSensitiveTiers(text: string): TierGlobs {
  const t: TierGlobs = { critical: [], gate: [], deps: [], exempt: [] };
  let current: Section = "critical";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      if (!(SECTIONS as readonly string[]).includes(header[1]))
        throw new Error(`unknown section [${header[1]}]`);
      current = header[1] as Section;
      continue;
    }
    t[current].push(line);
  }
  return t;
}

function classifyOne(file: string, t: TierGlobs): Tier | null {
  const hit = (globs: string[]) => globs.length > 0 && picomatch(globs, { dot: true })(file);
  if (hit(t.critical)) return "critical";
  if (hit(t.exempt)) return null;
  if (hit(t.deps)) return "deps";
  if (hit(t.gate)) return "gate";
  return null;
}

/** Highest tier over every list (base and head), so a PR cannot lower the tier that judges it. */
export function tierOf(file: string, lists: TierGlobs[]): Tier | null {
  let best: Tier | null = null;
  for (const t of lists) {
    const c = classifyOne(file, t);
    if (c && (best === null || RANK[c] > RANK[best])) best = c;
  }
  return best;
}

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** True when two package.json texts differ only in dependency fields (a Dependabot bump). */
export function packageJsonDepsOnly(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  try {
    const strip = (text: string) => {
      const o = JSON.parse(text) as Record<string, unknown>;
      for (const k of DEP_FIELDS) delete o[k];
      return JSON.stringify(o);
    };
    return strip(before) === strip(after);
  } catch {
    return false;
  }
}

/** True when every changed line of a `git diff -U0` of a workflow is a `uses:` line. */
export function workflowDiffUsesOnly(diff: string): boolean {
  const changed = diff.split(/\r?\n/).filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  return changed.length > 0 && changed.every((l) => /^[+-]\s*(-\s+)?uses:\s*\S+@\S+\s*$/.test(l));
}

/**
 * A full commit sha (40 hex, or 64 in a SHA-256 repository); checked before any
 * sha reaches git argv. Abbreviated names are refused: git resolves refs before
 * short object names, so a hex-like tag could stand in for the commit.
 */
export const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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
  /** tier of a file, or null when it needs no review */
  classify: (file: string) => Tier | null;
  prNumber: number;
  artifactText: string | undefined;
  /** undefined when reviewedSha is not an ancestor of the PR head */
  filesChangedAfterReviewedSha: string[] | undefined;
}

const EFFORTS: Record<"critical" | "gate", { allowed: string[]; text: string }> = {
  critical: { allowed: ["xhigh", "max"], text: "xhigh or max" },
  gate: { allowed: ["high", "xhigh", "max"], text: "high, xhigh or max" },
};

export function evaluateSensitiveReview(input: ReviewInput): { ok: boolean; messages: string[] } {
  const reviewed = (f: string) => {
    const t = input.classify(f);
    return t === "critical" || t === "gate";
  };
  const touched = input.changedFiles.filter(reviewed);
  const deps = input.changedFiles.filter((f) => input.classify(f) === "deps");
  if (touched.length === 0)
    return {
      ok: true,
      messages: [
        deps.length > 0
          ? `deps tier only (${deps.join(", ")}): automated checks cover it`
          : "no sensitive paths touched",
      ],
    };
  const tier = touched.some((f) => input.classify(f) === "critical") ? "critical" : "gate";
  const artifactPath = `docs/reviews/pr-${input.prNumber}.md`;
  const fail = (m: string) => ({ ok: false, messages: [m] });
  if (input.artifactText === undefined)
    return fail(`${tier} paths touched (${touched.join(", ")}); ${artifactPath} is missing`);
  const fm = parseReviewFrontMatter(input.artifactText);
  if (!fm)
    return fail(`${artifactPath}: front matter needs reviewer, effort, reviewedSha, verdict`);
  if (fm.reviewer !== "opus-5.5")
    return fail(`${artifactPath}: reviewer must be opus-5.5, got ${fm.reviewer}`);
  if (!EFFORTS[tier].allowed.includes(fm.effort))
    return fail(
      `${artifactPath}: ${tier} paths need effort ${EFFORTS[tier].text}, got ${fm.effort}`,
    );
  if (fm.verdict !== "approve")
    return fail(`${artifactPath}: verdict must be approve, got ${fm.verdict}`);
  if (!SHA_RE.test(fm.reviewedSha)) return fail(`${artifactPath}: reviewedSha is not a commit sha`);
  if (input.filesChangedAfterReviewedSha === undefined)
    return fail(`${artifactPath}: reviewedSha ${fm.reviewedSha} is not an ancestor of the PR head`);
  const late = input.filesChangedAfterReviewedSha.filter(reviewed);
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

const GLOB_FILE = ".github/sensitive-paths";
/** git -z output: NUL-terminated paths, never quoted or escaped (core.quotePath) */
const nulList = (s: string) => s.split("\0").filter((p) => p !== "");
/** --no-renames lists both sides of a rename, so a move out of a sensitive path is seen */
const nameDiff = ["diff", "--name-only", "-z", "--no-renames"];

class GitFailure extends Error {}

function gitOut(runGit: RunDeps["runGit"], args: string[]): string {
  const r = runGit(args);
  if (r.status !== 0 || r.stdout === null)
    throw new GitFailure(
      `git ${args.join(" ")} failed (status ${r.status}): ${r.stderr ?? ""}`.trim(),
    );
  return r.stdout;
}

/**
 * Changed files between base and head, and a classifier over the head and base tier
 * lists (the base list judges the PR too, so a PR cannot lower the tier that covers
 * its change; a base without the file contributes nothing). A gate-tier package.json
 * whose diff touches only dependency fields, or a workflow whose diff touches only
 * `uses:` lines, counts as deps.
 */
function diffAndTiers(
  deps: RunDeps,
  base: string,
  head: string,
): { changedFiles: string[]; classify: (file: string) => Tier | null } | string {
  const changedFiles = nulList(gitOut(deps.runGit, [...nameDiff, `${base}...${head}`]));
  const headText = deps.readFile(GLOB_FILE);
  if (headText === undefined) return `${GLOB_FILE} is missing`;
  let headTiers: TierGlobs;
  try {
    headTiers = parseSensitiveTiers(headText);
  } catch (e) {
    return `${GLOB_FILE}: ${(e as Error).message}`;
  }
  if (headTiers.critical.length + headTiers.gate.length + headTiers.deps.length === 0)
    return `${GLOB_FILE} lists no globs`;
  const baseHasFile =
    nulList(gitOut(deps.runGit, ["ls-tree", "--name-only", "-z", base, "--", GLOB_FILE])).length >
    0;
  let baseTiers: TierGlobs[] = [];
  if (baseHasFile) {
    try {
      baseTiers = [parseSensitiveTiers(gitOut(deps.runGit, ["show", `${base}:${GLOB_FILE}`]))];
    } catch (e) {
      if (e instanceof GitFailure) throw e;
      return `${GLOB_FILE} on the base: ${(e as Error).message}`;
    }
  }
  const lists = [...baseTiers, headTiers];
  const show = (rev: string, file: string) => {
    const r = deps.runGit(["show", `${rev}:${file}`]);
    return r.status === 0 && r.stdout !== null ? r.stdout : undefined;
  };
  const cache = new Map<string, Tier | null>();
  const classify = (file: string): Tier | null => {
    if (cache.has(file)) return cache.get(file) ?? null;
    let t = tierOf(file, lists);
    if (t === "gate" && /(^|\/)package\.json$/.test(file)) {
      if (packageJsonDepsOnly(show(base, file), show(head, file))) t = "deps";
    } else if (t === "gate" && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) {
      const diff = gitOut(deps.runGit, [
        "diff",
        "-U0",
        "--no-color",
        `${base}...${head}`,
        "--",
        file,
      ]);
      if (workflowDiffUsesOnly(diff)) t = "deps";
    }
    cache.set(file, t);
    return t;
  };
  return { changedFiles, classify };
}

/** Files a PR touches that need a review (the `sensitive` label). Code 2 on bad input or git failure. */
export function listSensitiveChanges(
  env: Record<string, string | undefined>,
  deps: RunDeps,
): { code: 0 | 2; files: string[]; messages: string[] } {
  const base = env.BASE_SHA ?? "";
  const head = env.HEAD_SHA ?? "";
  const bad = (m: string) => ({ code: 2 as const, files: [], messages: [`list-sensitive: ${m}`] });
  if (!SHA_RE.test(base)) return bad("BASE_SHA is not a commit sha");
  if (!SHA_RE.test(head)) return bad("HEAD_SHA is not a commit sha");
  try {
    const d = diffAndTiers(deps, base, head);
    if (typeof d === "string") return bad(d);
    const files = d.changedFiles.filter((f) => {
      const t = d.classify(f);
      return t === "critical" || t === "gate";
    });
    return { code: 0, files, messages: [] };
  } catch (e) {
    if (e instanceof GitFailure) return bad(e.message);
    throw e;
  }
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
  const head = env.HEAD_SHA ?? "";
  const prNumber = Number(env.PR_NUMBER);
  const bad = (m: string): RunResult => ({ code: 2, messages: [`sensitive-review: ${m}`] });
  if (base === "") return bad("BASE_SHA is empty");
  if (head === "") return bad("HEAD_SHA is empty");
  // Hex only, so a value can never reach git as an option (a leading "-") or a moving ref.
  if (!SHA_RE.test(base)) return bad("BASE_SHA is not a commit sha");
  if (!SHA_RE.test(head)) return bad("HEAD_SHA is not a commit sha");
  if (!env.PR_NUMBER || !Number.isInteger(prNumber) || prNumber <= 0)
    return bad("PR_NUMBER must be a positive integer");
  try {
    const d = diffAndTiers(deps, base, head);
    if (typeof d === "string") return bad(d);
    const { changedFiles, classify } = d;
    const artifactText = deps.readFile(`docs/reviews/pr-${prNumber}.md`);
    let filesChangedAfterReviewedSha: string[] | undefined = [];
    const fm = artifactText ? parseReviewFrontMatter(artifactText) : null;
    // A malformed reviewedSha never reaches git; evaluateSensitiveReview rejects it (code 1).
    if (fm && SHA_RE.test(fm.reviewedSha)) {
      const anc = deps.runGit(["merge-base", "--is-ancestor", fm.reviewedSha, head]);
      if (anc.status === 0)
        filesChangedAfterReviewedSha = nulList(
          gitOut(deps.runGit, [...nameDiff, fm.reviewedSha, head]),
        );
      else if (anc.status === 1) filesChangedAfterReviewedSha = undefined;
      else
        return bad(
          `git merge-base --is-ancestor failed (status ${anc.status}): ${anc.stderr ?? ""}`.trim(),
        );
    }
    const result = evaluateSensitiveReview({
      changedFiles,
      classify,
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
