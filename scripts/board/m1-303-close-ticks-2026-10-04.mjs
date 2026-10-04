// m1-303-close-ticks-2026-10-04.mjs: after PR #515 closed #303, tick its boxes with a short note
// and add the #515 review's optional minor to #511 as a next-touch watch item, as BirchDesignLab
// (session "M1 finish 3").
//
// Why: #330, #340 and #500 fixed most #303 boxes without ticking them (verified 10-03-26 by a
// read-only check against main); #515 did the two #513 review minors. Every open box is ticked,
// so a rerun is a no-op; the #511 line is added once.
// Usage (repo root): node scripts/board/m1-303-close-ticks-2026-10-04.mjs [--apply]
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const tok = spawnSync("gh", ["auth", "token", "-u", "BirchDesignLab"], { encoding: "utf8" });
if (tok.status !== 0) throw new Error("no gh token for BirchDesignLab");
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
const getBody = (n) => JSON.parse(gh(["api", `repos/${REPO}/issues/${n}`])).body ?? "";
const setBody = (n, body) =>
  gh(
    ["api", `repos/${REPO}/issues/${n}`, "--method", "PATCH", "--input", "-"],
    JSON.stringify({ body }),
  );

let changes = 0;

// #303: every open box. The two #513 review minors were done in #515; the rest were verified done
// on main (fixed by #330, #340 or #500).
const before = getBody(303);
const lines = before.split("\n").map((l) => {
  if (!l.startsWith("- [ ] ")) return l;
  changes += 1;
  const note = /^- \[ \] (G-M1|C-M1) /.test(l)
    ? "done in #515"
    : "already done on main (#330, #340 or #500), verified 10-03-26";
  console.log(`${APPLY ? "" : "would "}tick #303: ${l.slice(6, 70)}`);
  return `${l.replace("- [ ] ", "- [x] ")} (${note})`;
});
if (APPLY && changes > 0) setBody(303, lines.join("\n"));

// #511: the #515 review's optional minor, as a watch item.
const WATCH =
  '- [ ] (from the #515 review) `packages/api/src/auth/routes.ts` orphan-row comment lists two sources; a sign-in racing the disable is a third (identity still refuses it). Reword at the next touch: "a sign-in made after or racing the disable".';
const carry = getBody(511);
if (!carry.includes("(from the #515 review)")) {
  const anchor = "\n\n**Source:**";
  if (!carry.includes(anchor)) throw new Error("#511: no Source line to insert before");
  changes += 1;
  console.log(`${APPLY ? "" : "would "}add the #515 review watch item to #511`);
  if (APPLY) setBody(511, carry.replace(anchor, `\n${WATCH}${anchor}`));
}
console.log(`${APPLY ? "applied" : "planned"} ${changes} change(s)`);
