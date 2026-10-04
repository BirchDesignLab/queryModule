// m1-hardening-ticks-2026-10-03.mjs: after PR #513 (M1 critical hardening), tick the #98,
// #311 and #505 boxes it settled, with a short note, and record the two wave-review minors
// (G-M1, C-M1) on #303 so they ride the #303 PR. As BirchDesignLab (session "M1 finish 3").
//
// Why: sdd agents never write to GitHub; the controller ticks boxes and records review
// minors. Boxes are matched by a unique substring of the unticked line, and the #303 section
// is added only once, so a rerun is a no-op.
// Usage (repo root): node scripts/board/m1-hardening-ticks-2026-10-03.mjs [--apply]
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

const ALREADY = "already done in #340 (8d0e90a), verified in #513";
/** [issue, unique substring of the box, note appended after the tick] */
const TICKS = [
  [98, "C-M2 `audit.ts:263-270`", "done in #513"],
  [98, "C-m1 (review of #292)", "done in #513"],
  [98, "C-M6 `audit.ts:192`", "already done on main (identity.ts auditEmail), verified in #513"],
  [311, "DEK length not asserted on unwrap", ALREADY],
  [311, "AAD built from unvalidated ids/partId", ALREADY],
  [311, "NaN/Infinity become null through JSON", ALREADY],
  [311, "DEK and plaintext buffers not zeroed", ALREADY],
  [311, "Sorted-key test asserts length only", ALREADY],
  [
    311,
    "`query_request.origin` has no DB CHECK",
    "met by the 0006 trigger query_request_origin, pinned in QUERY_TRIGGERS; no migration 0009 (ruling in #513)",
  ],
  [311, "`QueryTriggerMissingError` duplicates", `${ALREADY} (now TriggerMissingError)`],
  [311, "`schema.test` helpers migrate a fresh DB", "done in #340 and #513 (try/finally closes)"],
  [311, "Spec 10.3 test asserts only that `KeyCanaryError`", "done in #513"],
  [311, "Pragma name split-joined", ALREADY],
  [311, "`guarded(...)` boilerplate x7", ALREADY],
  [311, "Per-case fresh encrypted DB in tests", ALREADY],
  [
    505,
    "T28 M6: the WS upgrade refusal",
    "no change needed: RequireAuth.tsx shows only ChangePasswordPage on the HTTP 403, no socket (verified in #513)",
  ],
  [505, "rr:N-m1 (critical, `admin/access.ts`)", "done in #513"],
  [505, "T27 Q6 (critical, `admin/config/**`)", "done in #513: refused as validationFailed"],
  [505, "T27 Q2 (critical, `queries/route.ts`)", "done in #513"],
  [505, "G-m2 (gate, ride the next gate PR)", "done in #513"],
  [
    505,
    "(critical, ride the next critical PR) `packages/core/src/contracts/audit-auth.ts`",
    "done in #513",
  ],
];

const MINORS_303 = [
  "**From the #513 wave-review (docs/reviews/fix-m1-critical-hardening.md, 10-03-26; ride the #303 PR)**",
  "- [ ] G-M1 (gate, `packages/api/src/auth/routes.ts:127-131`): the G-m2 catch can leave a disabled user's session row behind; it is safe only because identity.ts live() checks disabledAt. Reword the line-127 comment (\"holds no session\") to name the possible orphan row, and document that any future enable-user path must delete the user's sessions (disableUser or identity docs).",
  '- [ ] C-M1 (critical, `packages/api/src/admin/config/draft.ts:155-160`): the validateDocument docstring lists the activate() checks (site id, mfaRequired) but not the features.adminConfig refusal; append "and features.adminConfig stays true (#505 T27 Q6)". A critical file: the #303 PR then needs a critical slice (fast path if small).',
].join("\n");

let changes = 0;
for (const n of [...new Set([...TICKS.map((t) => t[0]), 303])]) {
  const before = JSON.parse(gh(["api", `repos/${REPO}/issues/${n}`])).body ?? "";
  let body = before;
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
  if (n === 303 && !body.includes("From the #513 wave-review")) {
    body = `${body.trimEnd()}\n\n${MINORS_303}\n`;
    changes += 1;
    console.log(`${APPLY ? "" : "would "}add the #513 review minors G-M1 and C-M1 to #303`);
  }
  if (APPLY && body !== before)
    gh(
      ["api", `repos/${REPO}/issues/${n}`, "--method", "PATCH", "--input", "-"],
      JSON.stringify({ body }),
    );
}
console.log(`${APPLY ? "applied" : "planned"} ${changes} change(s)`);
