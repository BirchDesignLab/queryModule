// tick-ac1-am1-2026-10-03.mjs: tick the issue boxes done by AC1 (#498), AM1 (#500) and the
// CLAUDE.md chore (#501), with a short "done in" note, as BirchDesignLab (M1 finish session).
//
// Why: sdd agents never write to GitHub; the controller ticks boxes after merge. Box text is
// matched by a unique substring of the unticked line, so a rerun is a no-op (idempotent).
// Usage (repo root): node scripts/board/tick-ac1-am1-2026-10-03.mjs [--apply]
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

/** [issue, unique substring of the box, note appended after the tick] */
const TICKS = [
  // #315, all boxes (AM1 21a, #500)
  [315, "Cited IDs SEC-014 / NFR-003", "done in #500"],
  [315, "`trustedClientIp` production path untested", "done in #500"],
  [
    315,
    "share the `ws:ip:unknown` bucket",
    "done in #500: kept shared, documented (developer 10-02-26)",
  ],
  [315, "Verbose header narrowing", "done in #500"],
  [315, "60-upgrade test is a full-suite load flake risk", "done in #500"],
  [315, "`SEED_PASSWORD_SECRET` check uses `-e`", "done in #500"],
  [315, "Age-key-never-printed test is weak", "done in #500"],
  [315, "`volume rm -f ... || true` hides daemon errors", "done in #500"],
  [315, "Step-12 guard bypasses", "done in #500"],
  [315, "chmod-000 test is vacuous", "done in #500"],
  [315, "Recursive schemas never mapped", "done in #500 (mutual recursion documented as a limit)"],
  [315, "rename-map / openapi-base CLI `main()` untested", "done in #500"],
  [315, "`openapi-base.ts` header omits head-ref", "done in #500"],
  // #303 Task 9 and the plateType box (AM1 21b, #500)
  [303, "`config-migrate` `process.exit(1)` branch never exercised", "done in #500"],
  [303, "r1-b test calls `validateResolved` directly", "done in #500"],
  [303, "An unreadable file aborts the whole CLI report", "done in #500"],
  [303, "Two exception classes plus try/catch", "done in #500"],
  [303, "Base file read before migrate", "done in #500"],
  [303, "Redundant `now: Date.now()`", "done in #500"],
  [303, "Raw line breaks replaced `\\n` inside template literals", "done in #500"],
  [
    303,
    "Scripts import `packages/api/src/config/load.ts` across a package boundary",
    "closed as not doing (developer 10-02-26)",
  ],
  [303, "Known plateType warning hardcoded", "done in #500"],
  // #311 gate boxes (AM1 21c, #500) and C-m1 (already in .github/sensitive-paths)
  [311, "DELETE removes every `request_key` row", "done in #500"],
  [311, "Separate distinct-request count query unexplained", "done in #500"],
  [311, "No-table test asserts the return value only", "done in #500"],
  [311, "`smoke-request-key.mjs` hardcodes system actor strings", "done in #500"],
  [311, "G-m1: `lost-data-key` runbook", "done in #500 (checkQueryTriggers added)"],
  [
    311,
    "C-m1: critical CI checks",
    "already done: `.github/sensitive-paths` lists is-main-module.mjs as critical (checked 10-03-26)",
  ],
  // #220 (AM1 21d, #500; M2 found done on main 10-03-26)
  [
    220,
    "**M2, main() guard fail-open",
    "done: every listed CLI uses isMainModule on main (checked 10-03-26)",
  ],
  [220, "**M4.**", "done: describe timeout 20_000 on main (checked 10-03-26)"],
  [220, "**r1-a.**", "done in #500"],
  // #339 (AC1 #498, chore #501)
  [339, "G-G-m1 (gate)", "done in #498"],
  [339, "C-C-m1 (critical)", "done in #498"],
  [339, "C-C-m2 (docs)", "done in #501"],
  [339, "C-C-m3:", "done in #498"],
  [339, "m1 `packages/api/src/ops/grant-role.ts", "done in #498"],
  [339, "m2 `packages/api/src/seed/seed.ts", "done in #498"],
  [339, "m3 persona test names the default site only", "done in #501"],
  // #497 (AM1 #500, chore #501; #311 C-m1 and #220 M2 found done)
  [497, "G-M1 (gate", "done in #500"],
  [497, "G-M2 (gate", "done in #500"],
  [497, "C-m2 (ordinary", "done in #501"],
  [
    497,
    "#311 C-m1 (critical, rides AC2)",
    "already done in .github/sensitive-paths (checked 10-03-26)",
  ],
  [
    497,
    "#220 M2 remainder (critical, rides AC2)",
    "already done on main: isMainModule (checked 10-03-26)",
  ],
];

let changes = 0;
for (const n of [...new Set(TICKS.map((t) => t[0]))]) {
  let body = JSON.parse(gh(["api", `repos/${REPO}/issues/${n}`])).body ?? "";
  for (const [, box, note] of TICKS.filter((t) => t[0] === n)) {
    const lines = body.split("\n");
    const hits = lines.flatMap((l, i) => (l.startsWith("- [ ] ") && l.includes(box) ? [i] : []));
    if (hits.length === 0) {
      if (!lines.some((l) => l.startsWith("- [x]") && l.includes(box)))
        console.log(`#${n}: no box matches "${box}"`);
      continue;
    }
    if (hits.length > 1) throw new Error(`#${n}: "${box}" matches ${hits.length} boxes`);
    lines[hits[0]] = `${lines[hits[0]].replace("- [ ] ", "- [x] ")} (${note})`;
    body = lines.join("\n");
    changes += 1;
    console.log(`${APPLY ? "" : "would "}tick #${n}: ${box}`);
  }
  if (APPLY)
    gh(
      ["api", `repos/${REPO}/issues/${n}`, "--method", "PATCH", "--input", "-"],
      JSON.stringify({ body }),
    );
}
console.log(`${APPLY ? "applied" : "planned"} ${changes} tick(s)`);
