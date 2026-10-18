#!/usr/bin/env node
// m2-p2-511-carry-2026-10-18.mjs: D-M2P2-7 and D-M2P2-3 (developer, 10-18-26, as recommended) on
// the board. On #511:
//   - ticks the boxes already done on main (checked at c91391a by "M2 P2 planning"), each with its
//     evidence;
//   - ticks the boxes moved to #46 (M2 P3) with "moved to #46";
//   - notes the boxes M2 P2 plans (left open, the plan task named);
//   - posts one evidence comment and the D-M2P2-3 "Ruling:" comment.
// On #46: appends a "Carried from #511" section with the moved boxes, open.
//
// Idempotent: a box already ticked or already annotated is left alone; the #46 section is added
// once (by its heading); each comment is posted only when no comment has that exact text.
// Fail closed: every marker must match exactly one line of the #511 body, or nothing is written.
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/board/m2-p2-511-carry-2026-10-18.mjs            # dry run: print the changes
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/board/m2-p2-511-carry-2026-10-18.mjs --apply
import { execFileSync } from "node:child_process";

const REPO = "BirchDesignLab/queryModule";
const SOURCE = 511;
const TARGET = 46;
const PLAN_A = "docs/superpowers/plans/2026-10-18-m2-track-a-p2.md";
const PLAN_B = "docs/superpowers/plans/2026-10-18-m2-track-b-p2.md";

// [marker (a unique substring of the box line), kind, note]
const BOXES = [
  [
    "`REQUEST_KEY_VERSION` independent of DATA_KEY",
    "done",
    "Done: ruled option A (D-M2P0-3, developer 10-16-26), Ruling comment on this issue; full rotation is #685.",
  ],
  [
    "G-m3 (critical, `contracts/audit.ts`)",
    "done",
    "Done in #688 (#523): `roleChanged.details.fromRole`.",
  ],
  [
    "A password change writes no audit row",
    "done",
    "Done in #688 (#523): `passwordChanged`; one transaction since #694 (#690 PR-2).",
  ],
  [
    "revokeSession's `sessionRevoked` row carries no target user id",
    "done",
    "Done in #688 (#523): `sessionRevoked.details.targetUserId`.",
  ],
  [
    "T27 IC1 carry",
    "done",
    "Done on main: `packages/api/src/admin/config/draft.ts` runs `checkFixturePolicy` on the mock (validate, publish, rollback).",
  ],
  [
    "CFG-2 (ordinary, M2 P0.5, design)",
    "done",
    "Done in M2 P0.5: the mock responses editor (#548 to #551).",
  ],
  [
    "hard-codes MIN_LENGTH 12",
    "done",
    "Done on main: the page reads core's `PASSWORD_MIN_LENGTH` (`packages/core/src/config/password.ts`).",
  ],
  [
    "C-M-1 (critical, `packages/api/src/startup.ts` bootstrap catch)",
    "done",
    "Done on main: `refuse()` in `startup.ts` logs `error: errorFields(e)` and throws the fixed `StartupRefusedError`.",
  ],
  [
    "C-M-2 (critical, `packages/api/src/startup.ts` FIXED_TEXT_STARTUP_ERRORS comment)",
    "done",
    "Done on main: the `FIXED_TEXT_STARTUP_ERRORS` comment says app-built fixed text, never a value, and warns about new classes.",
  ],
  ["G-m4 (gate): listUsers caps at 1000 rows", "moved", ""],
  ["Change-password has no per-account lockout", "moved", ""],
  ["T27 critic CV1 carry", "moved", ""],
  ["If anything else becomes sticky", "moved", ""],
  ["CFG-4 (gate, M2 P0.5)", "moved", ""],
  ["CFG-1 (ordinary, M2 P1)", "moved", ""],
  ["a server endpoint for shipped-only label keys", "moved", ""],
  [
    'Publish change note and "who" in the history drawer',
    "planned",
    `Planned: M2 P2, ${PLAN_A} Task 10 and ${PLAN_B} Task 5.`,
  ],
  ["AUD-1 with AC-3/CFG-7", "planned", `Planned: M2 P2, ${PLAN_A} Tasks 2, 7, 8 and 9.`],
  ["orphan-row comment lists two sources", "planned", `Planned: M2 P2, ${PLAN_A} Task 8.`],
];

const MOVED_NOTE = "Moved to #46 (D-M2P2-7, developer 10-18-26).";
const SECTION_HEADING = "**Carried from #511 (D-M2P2-7, developer 10-18-26)**";

const EVIDENCE_COMMENT = `M2 P2 planning, 10-18-26 (D-M2P2-7, developer, as recommended). Each open box was checked against main at c91391a:

- Done, ticked with evidence: REQUEST_KEY_VERSION (option A), G-m3 fromRole, password change audit, sessionRevoked target, T27 IC1, CFG-2, the ChangePasswordPage minimum, C-M-1, C-M-2.
- Planned in M2 P2: publish note and "who" (${PLAN_A} Task 10, ${PLAN_B} Task 5), AUD-1 (${PLAN_A} Tasks 2, 7, 8, 9), the routes.ts orphan comment (${PLAN_A} Task 8), and from the P0-W1 comment above, C-m1 the store.ts backfill rows-affected check (${PLAN_A} Task 10).
- Moved to #46 (M2 P3): G-m4 listUsers paging, the change-password per-account lockout, T27 CV1, the #483 sticky watch, CFG-4, CFG-1, the shipped-only label keys endpoint.
- Stays for M3 P2 (hide): C-m2 resultHidden.resultIds max (P0-W1 comment above).
- The loginSucceeded hardening box (P0-W3 comment, tracked as #690, closed): see the Ruling comment (D-M2P2-3).`;

const RULING_COMMENT = `Ruling: loginSucceeded audit hardening (D-M2P2-3), ruled by the developer 10-18-26 on M2 Manager 7's relay, as recommended.

What: accept the double-failure residual on sign-in (the loginSucceeded row fails AND the session delete fails). No route-owned sign-in transaction.

Why: the session token never leaves the server in that path (the route answers 500 and sends no cookie), so the row grants no access. passwordChanged, where the residual was real, has been atomic since #694. The M2 P2 sweeper's idle pass removes such a row with its sessionRevoked row, and a sweeper test pins this (${PLAN_A} Task 7). Rebuilding sign-in on Better Auth internals (cookie signing) would couple us to its cookie format for no access benefit.`;

const gh = (args, input) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] });

const issue = (n) => JSON.parse(gh(["api", `repos/${REPO}/issues/${n}`]));

function planSource(body) {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const problems = [];
  const moved = [];
  for (const [marker, kind, note] of BOXES) {
    const hits = lines.flatMap((l, i) => (l.includes(marker) ? [i] : []));
    if (hits.length !== 1) {
      problems.push(`#${SOURCE}: marker matches ${hits.length} lines: ${marker}`);
      continue;
    }
    const i = hits[0];
    const line = lines[i];
    const text = kind === "moved" ? MOVED_NOTE : note;
    if (kind === "moved")
      moved.push(line.replace(/^- \[[ x]\] /, "- [ ] ").replace(` ${MOVED_NOTE}`, ""));
    if (line.includes(text)) continue;
    if (!line.startsWith("- [ ] ")) {
      problems.push(`#${SOURCE}: box already ticked without this note: ${marker}`);
      continue;
    }
    lines[i] = `${kind === "planned" ? line : line.replace("- [ ] ", "- [x] ")} ${text}`;
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  return { body: lines.join(eol), moved, eol };
}

function planTarget(body, moved, eol) {
  if (body.includes(SECTION_HEADING)) return body;
  return [body.trimEnd(), "", SECTION_HEADING, ...moved].join(eol);
}

function commentOnce(number, text, apply) {
  const bodies = JSON.parse(
    gh(["api", "--paginate", `repos/${REPO}/issues/${number}/comments`]),
  ).map((c) => c.body);
  if (bodies.includes(text)) {
    console.log(`comment on #${number} exists`);
    return;
  }
  if (!apply) {
    console.log(`would comment on #${number}: ${text.split("\n")[0]}`);
    return;
  }
  gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/comments`, "-f", `body=${text}`]);
  console.log(`commented #${number}: ${text.split("\n")[0]}`);
}

function setBody(number, before, after, apply) {
  if (before === after) {
    console.log(`#${number} body unchanged`);
    return;
  }
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  for (const line of b) if (!a.includes(line)) console.log(`#${number} + ${line}`);
  if (!apply) return;
  gh(
    ["api", "-X", "PATCH", `repos/${REPO}/issues/${number}`, "--input", "-"],
    JSON.stringify({ body: after }),
  );
  console.log(`#${number} body updated`);
}

const mode = process.argv[2];
if (mode !== undefined && mode !== "--apply") {
  console.error("usage: m2-p2-511-carry-2026-10-18.mjs [--apply]");
  process.exit(2);
}
const apply = mode === "--apply";
const source = issue(SOURCE).body;
const s = planSource(source);
const target = issue(TARGET).body ?? "";
setBody(SOURCE, source, s.body, apply);
setBody(TARGET, target, planTarget(target, s.moved, s.eol), apply);
commentOnce(SOURCE, EVIDENCE_COMMENT, apply);
commentOnce(SOURCE, RULING_COMMENT, apply);
if (!apply) console.log("dry run (pass --apply)");
