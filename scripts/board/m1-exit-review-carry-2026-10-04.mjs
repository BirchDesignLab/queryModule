// m1-exit-review-carry-2026-10-04.mjs: record the two minors the M1 exit PR's second wave-review
// left (docs/reviews/fix-m1-exit.md, approve at 26d65ff) on the carry issue #511, to ride the next
// critical PR, as BirchDesignLab (session "M1 finish 3").
//
// Why: each review pass found new minors; the controller stopped after the second approve
// rather than pay a third, and records them here so they are not lost. Added once; a rerun is a
// no-op.
// Usage (repo root): node scripts/board/m1-exit-review-carry-2026-10-04.mjs [--apply]
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const CARRY = 511;
const tok = spawnSync("gh", ["auth", "token", "-u", "BirchDesignLab"], { encoding: "utf8" });
if (tok.status !== 0) throw new Error("no gh token for BirchDesignLab");
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

const HEAD =
  "**From the M1 exit PR review (docs/reviews/fix-m1-exit.md, 10-04-26; ride the next critical PR)**";
const SECTION = [
  HEAD,
  "- [ ] C-M-1 (critical, `packages/api/src/startup.ts` bootstrap catch): the `configLoaded audit write failed` log line drops the error, so SQLITE_FULL, SQLITE_READONLY, SQLITE_BUSY and a trigger abort look the same to an operator. Catch it and add `error: errorFields(e)` (name and code token only); keep throwing the fixed StartupRefusedError with no cause.",
  '- [ ] C-M-2 (critical, `packages/api/src/startup.ts` FIXED_TEXT_STARTUP_ERRORS comment): say "app-built fixed text, never a value" (as error-fields.ts does) and warn that a class added to the list must never embed a runtime value, since its message reaches stderr.',
].join("\n");

const body = JSON.parse(gh(["api", `repos/${REPO}/issues/${CARRY}`])).body ?? "";
if (body.includes(HEAD)) {
  console.log("planned 0 change(s)");
} else {
  const anchor = "\n\n**Source:**";
  if (!body.includes(anchor)) throw new Error(`#${CARRY}: no Source line to insert before`);
  console.log(`${APPLY ? "" : "would "}add the M1 exit review minors (2 boxes) to #${CARRY}`);
  if (APPLY)
    gh(
      ["api", `repos/${REPO}/issues/${CARRY}`, "--method", "PATCH", "--input", "-"],
      JSON.stringify({ body: body.replace(anchor, `\n\n${SECTION}${anchor}`) }),
    );
  console.log(`${APPLY ? "applied" : "planned"} 1 change(s)`);
}
