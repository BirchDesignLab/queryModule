import picomatch from "picomatch";

/**
 * Review tiers (ADR-0007, amended by #92). critical: Opus 5.5 at effort high or above.
 * gate: Opus 5.5 at effort medium or above. deps: automated checks only, no artifact.
 * exempt: never reviewed.
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
    if (header?.[1] === undefined && line.startsWith("["))
      throw new Error(`malformed section header ${line}`);
    // picomatch matches an array when any pattern matches, so a "!" glob would match nearly everything.
    if (line.startsWith("!")) throw new Error(`negated glob ${line} is not supported`);
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
/** A plain registry version or caret/tilde range; rejects npm:, workspace:, link:, file:, git, URLs, tags. */
const VERSION_RE = /^[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * True when two package.json texts differ only in the versions of existing packages
 * (a Dependabot bump): every other field is equal, each dependency field has the same
 * presence and package names, and every changed value, old and new, is a plain version.
 */
export function packageJsonDepsOnly(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch {
    return false;
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const rest = (o: Record<string, unknown>) =>
    JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !DEP_FIELDS.includes(k))));
  if (rest(a) !== rest(b)) return false;
  for (const field of DEP_FIELDS) {
    if (!(field in a) && !(field in b)) continue;
    const x = a[field];
    const y = b[field];
    if (!isRecord(x) || !isRecord(y)) return false;
    const names = Object.keys(x).sort();
    if (names.join("\0") !== Object.keys(y).sort().join("\0")) return false;
    for (const name of names) {
      const v = x[name];
      const w = y[name];
      if (v === w) continue;
      if (typeof v !== "string" || typeof w !== "string") return false;
      if (!VERSION_RE.test(v) || !VERSION_RE.test(w)) return false;
    }
  }
  return true;
}

/** An existing `uses:` line up to and including "@" (indent, "- " marker, spacing, action path). */
const USES_PREFIX_RE = /^\s*(?:-\s+)?uses:\s*[^\s@#]+@/;
/** The new ref (a tag, branch-like name or sha), then at most an inert version comment. */
const NEW_REF_RE = /^(?:[0-9a-f]{40}|[A-Za-z0-9._-]+)(?:\s+#[ A-Za-z0-9._-]*)?$/;

/**
 * True when a `git diff -U0` of a workflow only moves the ref of existing `uses:` lines.
 * Structural, not textual: each hunk must remove and add the same number of lines, paired
 * in order; each pair keeps its text up to and including "@" byte for byte, and only the
 * ref after it changes, to a tag or sha charset. Pure additions or removals, a swapped
 * action, and code in a run: or script: block shaped like a uses: line all fail.
 */
export function workflowDiffUsesOnly(diff: string): boolean {
  const hunks: Array<{ minus: string[]; plus: string[] }> = [];
  let current: { minus: string[]; plus: string[] } | undefined;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      current = { minus: [], plus: [] };
      hunks.push(current);
    } else if (current === undefined) {
      // File header: only these lines, and never a created or deleted file.
      if (line === "") continue;
      if (!/^(diff --git |index |--- |\+\+\+ )/.test(line)) return false;
    } else if (line.startsWith("-")) current.minus.push(line.slice(1));
    else if (line.startsWith("+")) current.plus.push(line.slice(1));
    else if (line === "" || line.startsWith("\\")) continue;
    else return false;
  }
  if (hunks.length === 0) return false;
  for (const { minus, plus } of hunks) {
    if (minus.length === 0 || minus.length !== plus.length) return false;
    for (const [i, old] of minus.entries()) {
      const next = plus[i] ?? "";
      const prefix = USES_PREFIX_RE.exec(old)?.[0];
      if (prefix === undefined || !next.startsWith(prefix)) return false;
      if (!NEW_REF_RE.test(next.slice(prefix.length))) return false;
    }
  }
  return true;
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
  /** "fast": the small-diff fast path (#92), one reviewer; the check counts the diff itself */
  mode?: string;
}

export function parseReviewFrontMatter(text: string): ReviewFrontMatter | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block?.[1]) return null;
  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*"?([^"]*)"?\s*$/.exec(line);
    if (kv?.[1] && kv[2] !== undefined) fields[kv[1]] = kv[2];
  }
  const { reviewer, effort, reviewedSha, verdict, mode } = fields;
  if (!reviewer || !effort || !reviewedSha || !verdict) return null;
  return mode === undefined
    ? { reviewer, effort, reviewedSha, verdict }
    : { reviewer, effort, reviewedSha, verdict, mode };
}

/** Most changed lines (added plus deleted, over critical and gate files) a fast-path review may cover. */
export const FAST_PATH_MAX_LINES = 50;

/** One plain branch-name segment: no leading ".", "-", no "..", no separators or spaces. */
const REF_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * The branch-keyed artifact path (#92): `docs/reviews/<branch>.md` with "/" turned to "-",
 * so the review can land before the PR (and its number) exists. Null for a name that is
 * not a plain branch name, so no ref can reach outside docs/reviews.
 */
export function branchArtifactPath(ref: string): string | null {
  const segments = ref.split("/");
  if (!segments.every((seg) => REF_SEGMENT_RE.test(seg) && !seg.includes(".."))) return null;
  return `docs/reviews/${segments.join("-")}.md`;
}

export interface ReviewInput {
  changedFiles: string[];
  /** tier of a file, or null when it needs no review */
  classify: (file: string) => Tier | null;
  prNumber: number;
  /** branch-keyed artifact path, looked up before docs/reviews/pr-<n>.md */
  branchPath?: string;
  artifactText: string | undefined;
  /** the path artifactText was read from; defaults to docs/reviews/pr-<n>.md */
  artifactPath?: string;
  /** undefined when reviewedSha is not an ancestor of the PR head */
  filesChangedAfterReviewedSha: string[] | undefined;
  /** added plus deleted lines in critical and gate files; needed only for mode "fast" */
  reviewedLineCount?: number;
}

const EFFORTS: Record<"critical" | "gate", { allowed: string[]; text: string }> = {
  critical: { allowed: ["high", "xhigh", "max"], text: "high, xhigh or max" },
  gate: { allowed: ["medium", "high", "xhigh", "max"], text: "medium, high, xhigh or max" },
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
  const prPath = `docs/reviews/pr-${input.prNumber}.md`;
  const artifactPath = input.artifactPath ?? prPath;
  const fail = (m: string) => ({ ok: false, messages: [m] });
  if (input.artifactText === undefined) {
    const wanted = input.branchPath ? `${input.branchPath} or ${prPath}` : prPath;
    return fail(`${tier} paths touched (${touched.join(", ")}); ${wanted} is missing`);
  }
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
  if (fm.mode !== undefined) {
    if (fm.mode !== "fast")
      return fail(`${artifactPath}: mode must be "fast" when set, got ${fm.mode}`);
    const n = input.reviewedLineCount;
    if (n === undefined || n > FAST_PATH_MAX_LINES)
      return fail(
        `${artifactPath}: fast path allows at most ${FAST_PATH_MAX_LINES} changed lines in reviewed paths, got ${n ?? "an uncountable diff"}`,
      );
  }
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

/**
 * Added plus deleted lines over the files `counted` accepts, from `git diff --numstat -z`
 * (records "added TAB deleted TAB path NUL"). A binary file ("-") counts as Infinity, so it
 * never fits the fast path; a record that does not parse throws a GitFailure (fail closed).
 */
function countLines(numstat: string, counted: (file: string) => boolean): number {
  let total = 0;
  for (const rec of nulList(numstat)) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(rec);
    if (!m?.[1] || !m[2] || !m[3]) throw new GitFailure(`git diff --numstat: cannot parse ${rec}`);
    if (!counted(m[3])) continue;
    total += m[1] === "-" || m[2] === "-" ? Number.POSITIVE_INFINITY : Number(m[1]) + Number(m[2]);
  }
  return total;
}

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
  let branchPath: string | undefined;
  if (env.HEAD_REF !== undefined && env.HEAD_REF !== "") {
    const p = branchArtifactPath(env.HEAD_REF);
    if (p === null) return bad("HEAD_REF is not a plain branch name");
    branchPath = p;
  }
  try {
    const d = diffAndTiers(deps, base, head);
    if (typeof d === "string") return bad(d);
    const { changedFiles, classify } = d;
    const prPath = `docs/reviews/pr-${prNumber}.md`;
    const branchText = branchPath === undefined ? undefined : deps.readFile(branchPath);
    const artifactPath = branchText !== undefined && branchPath ? branchPath : prPath;
    const artifactText = branchText ?? deps.readFile(prPath);
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
    let reviewedLineCount: number | undefined;
    if (fm?.mode === "fast") {
      const reviewedTier = (f: string) => {
        const t = classify(f);
        return t === "critical" || t === "gate";
      };
      const numstat = gitOut(deps.runGit, [
        "diff",
        "--numstat",
        "-z",
        "--no-renames",
        `${base}...${head}`,
      ]);
      reviewedLineCount = countLines(numstat, reviewedTier);
    }
    const result = evaluateSensitiveReview({
      changedFiles,
      classify,
      prNumber,
      ...(branchPath === undefined ? {} : { branchPath }),
      artifactText,
      artifactPath,
      filesChangedAfterReviewedSha,
      ...(reviewedLineCount === undefined ? {} : { reviewedLineCount }),
    });
    return { code: result.ok ? 0 : 1, messages: result.messages };
  } catch (e) {
    if (e instanceof GitFailure) return bad(e.message);
    throw e;
  }
}
