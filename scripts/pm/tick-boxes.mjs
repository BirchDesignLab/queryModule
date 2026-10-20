#!/usr/bin/env node
// Tick issue checkboxes whose text starts with given prefixes (M2 Manager 10, 10-20-26).
//   node scripts/pm/tick-boxes.mjs <issue> "<prefix>" ["<prefix>" ...] [--apply]
// Dry run prints the lines it would tick; --apply PATCHes the body with the active gh token.
import { execFileSync } from "node:child_process";

const REPO = "BirchDesignLab/queryModule";
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const [issue, ...prefixes] = argv.filter((a) => a !== "--apply");
const body = execFileSync(
  "gh",
  ["issue", "view", issue, "--repo", REPO, "--json", "body", "-q", ".body"],
  {
    encoding: "utf8",
  },
).replace(/\n$/, "");
let hits = 0;
const next = body
  .split("\n")
  .map((line) => {
    const m = line.match(/^(\s*- )\[ \] (.*)$/);
    if (m && prefixes.some((p) => m[2].startsWith(p))) {
      hits++;
      console.log(`tick #${issue}: ${m[2].slice(0, 90)}`);
      return `${m[1]}[x] ${m[2]}`;
    }
    return line;
  })
  .join("\n");
if (hits !== prefixes.length)
  console.error(`warning: ${hits} ticks for ${prefixes.length} prefixes`);
if (apply && hits > 0) {
  execFileSync(
    "gh",
    ["api", "-X", "PATCH", `repos/${REPO}/issues/${issue}`, "-f", `body=${next}`],
    { stdio: "ignore" },
  );
  console.log(`applied #${issue}`);
}
