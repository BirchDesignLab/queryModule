import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Docs-only fast path (master plan 11). Files under docs/testing/ are gate inputs
 * (check-story-tags reads docs/testing/stories.json, spec 9.3 step 6), so they never count as docs.
 * @param {string[]} files
 */
export function isDocsOnly(files) {
  return (
    files.length > 0 &&
    files.every(
      (f) => !f.startsWith("docs/testing/") && (f.startsWith("docs/") || f.endsWith(".md")),
    )
  );
}

/** @param {string[]} args */
function gitOut(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * Changed paths between base and head. Rename detection is off so a move out of a
 * source path lists the old path too (same reason as sensitive-review.ts).
 * @param {string} base
 * @param {string} head
 * @param {(args: string[]) => string} [runGit]
 * @returns {string[]}
 */
export function changedFiles(base, head, runGit = gitOut) {
  return runGit(["diff", "--name-only", "--no-renames", `${base}...${head}`])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "HEAD";
  if (base === "" || /^0+$/.test(base)) {
    console.log("docs_only=false");
    return;
  }
  console.log(`docs_only=${isDocsOnly(changedFiles(base, head))}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
