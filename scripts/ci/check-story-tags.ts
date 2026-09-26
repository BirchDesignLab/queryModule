import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MILESTONES, type Milestone } from "@querymodule/core/contracts";
import { checkStoryTags, highestMilestoneTag, StoriesFileSchema } from "./story-tags";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = args.indexOf("--milestone");
const milestoneArg = flag >= 0 ? args[flag + 1] : undefined;
if (milestoneArg !== undefined && !(MILESTONES as readonly string[]).includes(milestoneArg)) {
  console.error(`unknown milestone ${milestoneArg}`);
  process.exit(2);
}
const rows = StoriesFileSchema.parse(
  JSON.parse(readFileSync(resolve(root, "docs/testing/stories.json"), "utf8")),
);
const tags = spawnSync("git", ["tag", "--list", "m*"], { cwd: root, encoding: "utf8" })
  .stdout.split("\n")
  .map((t) => t.trim());
const opts = {
  highestTag: highestMilestoneTag(tags),
  ...(milestoneArg ? { milestone: milestoneArg as Milestone } : {}),
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
  `story tags ok (highest tag: ${opts.highestTag ?? "none"}${milestoneArg ? `, milestone ${milestoneArg}` : ""})`,
);
