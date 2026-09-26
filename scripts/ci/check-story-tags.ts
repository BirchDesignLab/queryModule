// Usage: node scripts/ci/check-story-tags.ts [--milestone mN]   (also runs under tsx)
// Exit 0 ok, 1 story without a tagged test, 2 bad arguments, git failure or shallow clone.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

// Plain node (promote.yml) strips this file's types but cannot resolve the
// extensionless TS imports behind ./story-tags and @querymodule/core. Register
// the tsx loader first, then load them.
register();
const { checkStoryTags, highestMilestoneTag, parseArgs, readMilestoneTags, StoriesFileSchema } =
  await import("./story-tags");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(2);
}
const read = readMilestoneTags((args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { status: r.error ? null : r.status, stdout: r.error ? null : (r.stdout ?? null) };
});
if (!read.ok) {
  console.error(
    read.reason === "shallow"
      ? "shallow clone: fetch tags (fetch-depth: 0)"
      : "git tag list failed; cannot check story tags",
  );
  process.exit(2);
}
const rows = StoriesFileSchema.parse(
  JSON.parse(readFileSync(resolve(root, "docs/testing/stories.json"), "utf8")),
);
const opts = {
  highestTag: highestMilestoneTag(read.tags),
  ...(parsed.milestone ? { milestone: parsed.milestone } : {}),
};
const failures = checkStoryTags(rows, opts, (p) => {
  const abs = resolve(root, p);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
});
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(
  `story tags ok (highest tag: ${opts.highestTag ?? "none"}${parsed.milestone ? `, milestone ${parsed.milestone}` : ""})`,
);
