import { MILESTONES, type Milestone } from "@querymodule/core/contracts";
import { z } from "zod";
import { stripComments } from "./strip-comments";

/**
 * True when `path` stays inside the repo: no POSIX absolute path, no Windows
 * drive-absolute path (`C:\x` or `C:/x`), no UNC path (`\\server\share`), and
 * no `..` segment on either separator (item 6).
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.startsWith("/")) return false;
  if (path.startsWith("\\\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false;
  return path.split(/[\\/]/).every((segment) => segment !== "..");
}

export const StoryRowSchema = z.strictObject({
  story: z.string().regex(/^[ABC]\d$/),
  milestone: z.union([z.enum(MILESTONES), z.literal("later")]),
  files: z
    .array(
      z.string().min(1).refine(isSafeRelativePath, {
        message: "path must stay inside the repo (no absolute path or .. segment)",
      }),
    )
    .min(1),
});
export type StoryRow = z.infer<typeof StoryRowSchema>;
/** Non-empty with unique stories, so an emptied or duplicated stories.json fails closed. */
export const StoriesFileSchema = z
  .array(StoryRowSchema)
  .min(1)
  .refine((rows) => new Set(rows.map((r) => r.story)).size === rows.length, {
    message: "duplicate story",
  });

export function highestMilestoneTag(tags: string[]): Milestone | null {
  let best = -1;
  for (const t of tags) {
    const i = (MILESTONES as readonly string[]).indexOf(t);
    if (i > best) best = i;
  }
  return best < 0 ? null : (MILESTONES[best] ?? null);
}

export function storiesInScope(
  rows: StoryRow[],
  opts: { highestTag: Milestone | null; milestone?: Milestone },
): StoryRow[] {
  return rows.filter((r) => {
    if (r.milestone === "later") return false;
    if (opts.milestone) return r.milestone === opts.milestone;
    if (opts.highestTag === null) return false;
    return MILESTONES.indexOf(r.milestone) <= MILESTONES.indexOf(opts.highestTag);
  });
}

/**
 * True when `text` holds a test that runs and whose title carries `[story]`.
 * Commented-out tests and .skip/.todo/.fixme variants never run, so they
 * never count (spec 10.2 "green on main", spec 12.7). .only and .each count.
 * Known limit: the regex does not track nesting, so a tagged it() inside
 * describe.skip or describe.todo still counts. At M1, check reporter JSON for
 * passed tests carrying the tag instead.
 */
export function hasTaggedTest(text: string, story: string): boolean {
  const live = stripComments(text);
  const title = new RegExp(
    `\\b(?:it|test|describe)(?:\\.(?!skip\\b|todo\\b|fixme\\b)\\w+)*\\(\\s*["'\`][^"'\`\\n]*\\[${story}\\]`,
  );
  return title.test(live);
}

export const USAGE = "usage: check-story-tags [--milestone <m0|m1|m2|m3|m4>]";

export type ParsedArgs = { ok: true; milestone?: Milestone } | { ok: false; message: string };

/** Strict CLI parse: [] or one --milestone with a known value, nothing else. */
export function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0) return { ok: true };
  let value: string | undefined;
  if (args.length === 1 && args[0]?.startsWith("--milestone=")) {
    value = args[0].slice("--milestone=".length);
  } else if (args.length === 2 && args[0] === "--milestone") {
    value = args[1];
  } else {
    return { ok: false, message: USAGE };
  }
  const i = (MILESTONES as readonly string[]).indexOf(value ?? "");
  const milestone = MILESTONES[i];
  if (milestone === undefined) return { ok: false, message: `unknown milestone; ${USAGE}` };
  return { ok: true, milestone };
}

export type GitResult = { status: number | null; stdout: string | null };
export type TagReadResult =
  | { ok: true; tags: string[] }
  | { ok: false; reason: "git-failed" | "shallow" };

/**
 * Read the milestone tags. Fails closed: a git call that fails or cannot
 * start is a failure, and so is a shallow clone (its tag list cannot be
 * trusted), never an empty tag list (spec 10.2 bullet 1).
 */
export function readMilestoneTags(runGit: (args: string[]) => GitResult): TagReadResult {
  const tags = runGit(["tag", "--list", "m*"]);
  if (tags.status !== 0 || tags.stdout === null) return { ok: false, reason: "git-failed" };
  const shallow = runGit(["rev-parse", "--is-shallow-repository"]);
  if (shallow.status !== 0 || shallow.stdout?.trim() !== "false")
    return { ok: false, reason: "shallow" };
  return {
    ok: true,
    tags: tags.stdout
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t !== ""),
  };
}

export type ReadStoriesResult = { ok: true; rows: StoryRow[] } | { ok: false; message: string };

/**
 * Reads and validates the stories file. Any failure (missing file, invalid
 * JSON, schema mismatch) becomes one short `<path>: <reason>` line: no raw
 * stack, no file excerpt (JSON.parse messages can quote file content), and no
 * zod dump - just the first issue's path and message (item 8).
 */
export function readStoriesFile(
  readFile: (path: string) => string,
  path: string,
): ReadStoriesResult {
  let text: string;
  try {
    text = readFile(path);
  } catch (e) {
    const reason =
      (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
        ? "file not found"
        : "cannot read file";
    return { ok: false, message: `${path}: ${reason}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: `${path}: invalid JSON` };
  }
  const parsed = StoriesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return { ok: false, message: `${path}: ${issue?.message ?? "invalid stories file"}${at}` };
  }
  return { ok: true, rows: parsed.data };
}

export function checkStoryTags(
  rows: StoryRow[],
  opts: { highestTag: Milestone | null; milestone?: Milestone },
  readFile: (path: string) => string | undefined,
): string[] {
  const failures: string[] = [];
  for (const row of storiesInScope(rows, opts)) {
    const found = row.files.some((f) => {
      const text = readFile(f);
      return text !== undefined && hasTaggedTest(text, row.story);
    });
    if (!found)
      failures.push(
        `${row.story} (${row.milestone}): no test titled with [${row.story}] in ${row.files.join(", ")}`,
      );
  }
  return failures;
}
