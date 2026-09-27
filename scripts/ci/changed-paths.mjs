import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Docs-only fast path (master plan 11). Files under docs/testing/ are gate inputs
 * (check-story-tags reads docs/testing/stories.json, spec 9.3 step 6), and docs/board/ is data
 * with its own schema test (#96 G-M1), so neither ever counts as docs.
 * @param {string[]} files
 */
export function isDocsOnly(files) {
  return (
    files.length > 0 &&
    files.every(
      (f) =>
        !f.startsWith("docs/testing/") &&
        !f.startsWith("docs/board/") &&
        (f.startsWith("docs/") || f.endsWith(".md")),
    )
  );
}

/** @param {string[]} args */
function gitOut(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * Changed paths between base and head. Rename detection is off so a move out of a
 * source path lists the old path too (same reason as sensitive-review.ts). -z keeps
 * non-ASCII paths verbatim instead of C-quoted, so they still match their area (#96 C-M2).
 * @param {string} base
 * @param {string} head
 * @param {(args: string[]) => string} [runGit]
 * @returns {string[]}
 */
export function changedFiles(base, head, runGit = gitOut) {
  return runGit(["diff", "--name-only", "-z", "--no-renames", `${base}...${head}`])
    .split("\0")
    .filter(Boolean);
}

// ADR-0008: root files shared by the web and mobile jobs (a build, install or
// CI config change can affect either app regardless of where else it lands).
const ROOT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  ".nvmrc",
  ".npmrc",
  ".github/workflows/ci.yml",
  "scripts/ci/changed-paths.mjs",
];

/**
 * Per-area outputs for the path-scoped CI jobs (ADR-0008). Pure function of
 * the changed file list.
 * @param {string[]} files
 * @returns {{ docs_only: boolean, web: boolean, mobile: boolean }}
 */
export function areas(files) {
  const touchesRoot = files.some((f) => ROOT_FILES.includes(f));
  const web =
    touchesRoot || files.some((f) => f.startsWith("apps/web/") || f.startsWith("packages/"));
  const mobile =
    touchesRoot || files.some((f) => f.startsWith("apps/mobile/") || f.startsWith("packages/"));
  return { docs_only: isDocsOnly(files), web, mobile };
}

/** Fail-closed default: every job runs, docs_only stays false so nothing is skipped. */
const ALL_TRUE = { docs_only: false, web: true, mobile: true };

/** @param {(line: string) => void} write */
function printAreas(write, a) {
  write(`docs_only=${a.docs_only}`);
  write(`web=${a.web}`);
  write(`mobile=${a.mobile}`);
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   runGit?: (args: string[]) => string,
 *   write?: (line: string) => void,
 *   warn?: (line: string) => void,
 * }} [deps]
 */
export function main({
  env = process.env,
  runGit = gitOut,
  write = (line) => console.log(line),
  warn = (line) => console.error(line),
} = {}) {
  const base = env.BASE_SHA ?? "";
  const head = env.HEAD_SHA ?? "HEAD";
  const eventName = env.EVENT_NAME ?? "";

  // Push to a new branch (no base to diff against), or a push to main: run everything.
  if (base === "" || /^0+$/.test(base) || eventName === "push") {
    printAreas(write, ALL_TRUE);
    return;
  }

  try {
    printAreas(write, areas(changedFiles(base, head, runGit)));
  } catch (err) {
    // Goes to the warn sink (stderr), never the output sink: ci.yml pipes this
    // script's stdout straight into $GITHUB_OUTPUT, which the runner rejects
    // as an invalid line if it isn't key=value or a key<<EOF block (critic:C1).
    const message = (err instanceof Error ? err.message : String(err))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
    warn(`::warning::changed-paths: ${message}`);
    printAreas(write, ALL_TRUE);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
