#!/usr/bin/env node
// gh-create-m2-p2-issues.mjs: open M2 P2 (audit) on GitHub (session "M2 P2 planning", Task 0 of
// the two plans below). One issue per plan task, linked as a sub-issue of the existing phase parent
// "Audit (M2 P2)" (#45, found by exact title), which is linked under the M2 milestone parent (#88)
// if it is not already. Carried follow-ups (#561, #511, #317) are never recreated: each gets a
// "Plan: <file> Task <n> (this task covers part of this issue)" comment, stays linked under the
// phase parent, and gets the M2 milestone if it has none (#561 has none today).
// With --headings, writes "(#n)" into each plan's "### Task <n>:" heading.
// Same logic as gh-create-m2-p1-issues.mjs, except that no task reuses a carried issue as its own.
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; a plan comment is posted only when no comment has that exact text.
// Fail closed: before any GitHub call, the task headings of each plan (Task 0 excluded) must equal
// the tasks below, and every blocker key must exist.
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m2-p2-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m2-p2-issues.mjs --apply
//   node scripts/pm/gh-create-m2-p2-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M2 Results and audit";
const MILESTONE_PARENT = 88;
const P2_PARENT_TITLE = "Audit (M2 P2)";
const PLAN_A = "docs/superpowers/plans/2026-10-18-m2-track-a-p2.md";
const PLAN_B = "docs/superpowers/plans/2026-10-18-m2-track-b-p2.md";

// [task, title, sensitive, labels, opts]; opts: carried (issues this task covers part of),
// blockedBy, note.
const aTasks = [
  [
    1,
    "Admin audit routes take the adminAudit feature key (spec 5.1, 5.8)",
    false,
    [],
    {
      carried: [561],
    },
  ],
  [
    2,
    "Session ceiling for Better Auth and its validate rule (AUD-1, spec 5.6)",
    true,
    [],
    {
      carried: [511],
    },
  ],
  [
    3,
    "GET /api/v1/admin/audit with auditViewed, cursor paged (spec 5.1, 4.7)",
    true,
    [],
    {
      carried: [561],
      blockedBy: ["A1"],
    },
  ],
  [
    4,
    "GET /api/v1/admin/audit/export NDJSON with auditExported (spec 5.1, 4.7)",
    true,
    [],
    {
      carried: [561],
      blockedBy: ["A3"],
    },
  ],
  [
    5,
    "GET /api/v1/admin/queries/:correlationId with adminViewed (FR-063, spec 5.1)",
    true,
    [],
    {
      carried: [561],
      blockedBy: ["A1"],
    },
  ],
  [6, "Story A9: query audit rows field by field (spec 10.2)", true, [], { blockedBy: ["A3"] }],
  [
    7,
    "Sweeper: session expiry with sessionRevoked, hourly event_log prune (spec 5.2)",
    true,
    [],
    { carried: [511], blockedBy: ["A5", "A6"] },
  ],
  [
    8,
    "AUD-1: Better Auth ceiling and live expiresAt in the users list (spec 5.6)",
    true,
    [],
    { carried: [511], blockedBy: ["A2", "A7"] },
  ],
  [
    9,
    "Start the sweeper at startup and stop it in the drain (spec 5.2, 8.1)",
    true,
    [],
    {
      blockedBy: ["A7"],
      note: "Starts after the DEBT-4 critical PR (#560, #699: startup.ts) merges.",
    },
  ],
  [
    10,
    "Persist the publish note and serve the publisher's name (D-M2P0-4)",
    true,
    [],
    { carried: [511], blockedBy: ["A9"] },
  ],
  [
    11,
    "Server-Timing on the 202; ack latency from request receipt (NFR-004)",
    true,
    [],
    {
      carried: [317],
      blockedBy: ["A9"],
    },
  ],
  [12, "ackReceipt metric and ack-stats summary (NFR-004)", true, [], { blockedBy: ["A9"] }],
  [
    13,
    "Docs: M2 P2 admin audit, sweeper, metrics",
    false,
    [],
    {
      blockedBy: ["A10", "A11", "A12"],
    },
  ],
  [
    14,
    "M2 P2 release note, phase gate docs refresh, gate and promote",
    false,
    [],
    { blockedBy: ["A13", "A17", "B9", "B10"] },
  ],
  [
    15,
    "Core: config:validate resolves mapping paths against mock payloads (spec 4.5)",
    true,
    ["core"],
  ],
  [16, "config:validate --diff <tag> for release notes (spec 7, 9.5)", true, ["core"]],
  [
    17,
    "bearer.test.ts: bearer auth on REST and the WebSocket upgrade (spec 10.7)",
    true,
    [],
    {
      blockedBy: ["A15"],
    },
  ],
];

const bTasks = [
  [
    1,
    "Design: audit log, admin request view, note, purged, terminal pane (mockup v6)",
    false,
    ["design"],
  ],
  [2, "Web: admin audit API helpers and MSW handlers", false, [], { blockedBy: ["B1", "A1"] }],
  [3, "Web: admin audit log page and rail entry (spec 6.2)", false, [], { blockedBy: ["B2"] }],
  [
    4,
    "Web: admin request view, read-only and recorded (FR-063)",
    false,
    [],
    {
      blockedBy: ["B3", "A5"],
    },
  ],
  [
    5,
    "Web: publish note and publisher name in the history drawer (D-M2P0-4)",
    false,
    [],
    {
      blockedBy: ["B4", "A10"],
    },
  ],
  [
    6,
    "Web: purged results and values show Purged under retention (spec 5.5)",
    false,
    [],
    {
      blockedBy: ["B4"],
    },
  ],
  [7, "Client: send ackReceipt on each 202 (spec 6.7)", false, [], { blockedBy: ["B4"] }],
  [
    8,
    "Web: terminal beside the results, chosen in the account menu (FR-050)",
    false,
    [],
    {
      blockedBy: ["B7"],
      note: "Starts after DEBT-4's #478 and #476 merge.",
    },
  ],
  [
    9,
    "E2E: admin audit, history note, terminal pane; v6 comparison shots",
    false,
    [],
    {
      blockedBy: ["B8", "A4", "A10"],
    },
  ],
  [10, "Docs: M2 P2 audit log, request view, terminal pane", false, [], { blockedBy: ["B9"] }],
];

const toEntries = (prefix, plan, phaseLabel, trackLabel, tasks) =>
  tasks.map(([n, title, sens, extra = [], opts = {}]) => ({
    key: `${prefix}${n}`,
    plan,
    n,
    title,
    labels: [...new Set([trackLabel, phaseLabel, ...(sens ? ["sensitive"] : []), ...extra])],
    body: `Plan: ${plan} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}${opts.carried ? `\nCarries part of: #${opts.carried.join(", #")}` : ""}${opts.note ? `\n${opts.note}` : ""}`,
    blockedBy: opts.blockedBy ?? [],
    carried: opts.carried ?? [],
  }));
const A = toEntries("A", PLAN_A, "p2", "platform", aTasks);
const B = toEntries("B", PLAN_B, "p2", "web", bTasks);

function dependencyOrder(entries) {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const out = [];
  const state = new Map();
  const visit = (e) => {
    if (state.get(e.key) === "done") return;
    if (state.get(e.key) === "visiting") throw new Error(`blocker cycle at ${e.key}`);
    state.set(e.key, "visiting");
    for (const k of e.blockedBy) if (byKey.has(k)) visit(byKey.get(k));
    state.set(e.key, "done");
    out.push(e);
  };
  for (const e of entries) visit(e);
  return out;
}

const planComment = (e) => `Plan: ${e.plan} Task ${e.n} (this task covers part of this issue)`;

function planTaskNumbers(path) {
  return [...readFileSync(path, "utf8").matchAll(/^### Task (\d+):/gm)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== 0)
    .sort((x, y) => x - y);
}

function checkAgainstPlans(all) {
  const problems = [];
  for (const [path, entries] of [
    [PLAN_A, A],
    [PLAN_B, B],
  ]) {
    const want = planTaskNumbers(path);
    const have = entries.map((e) => e.n).sort((x, y) => x - y);
    if (JSON.stringify(want) !== JSON.stringify(have))
      problems.push(`${path}: headings ${want.join(",")} but data ${have.join(",")}`);
  }
  const keys = new Set(all.map((e) => e.key));
  for (const e of all)
    for (const k of e.blockedBy) if (!keys.has(k)) problems.push(`${e.key}: unknown blocker ${k}`);
  if (new Set(all.map((e) => e.title)).size !== all.length) problems.push("duplicate titles");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`check ok: P2 A ${A.length}, P2 B ${B.length} tasks match plan headings`);
}

const gh = (args, input) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] });

function existingByTitle() {
  const rows = JSON.parse(
    gh([
      "issue",
      "list",
      "-R",
      REPO,
      "--milestone",
      MILESTONE,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title",
    ]),
  );
  return new Map(rows.map((r) => [r.title, r.number]));
}

function commentOnce(number, text) {
  const bodies = JSON.parse(
    gh(["api", "--paginate", `repos/${REPO}/issues/${number}/comments`]),
  ).map((c) => c.body);
  if (bodies.includes(text)) return;
  gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/comments`, "-f", `body=${text}`]);
  console.log(`  commented #${number}: ${text}`);
}

const subIssues = (parent) =>
  new Set(
    JSON.parse(gh(["api", "--paginate", `repos/${REPO}/issues/${parent}/sub_issues`])).map(
      (i) => i.number,
    ),
  );

function linkOnce(parent, linked, number) {
  if (linked.has(number)) return;
  const id = JSON.parse(gh(["api", `repos/${REPO}/issues/${number}`])).id;
  gh([
    "api",
    "-X",
    "POST",
    `repos/${REPO}/issues/${parent}/sub_issues`,
    "-F",
    `sub_issue_id=${id}`,
    "-F",
    "replace_parent=true",
  ]);
  linked.add(number);
  console.log(`  linked #${number} under #${parent}`);
}

function milestoneOnce(milestone, number) {
  const issue = JSON.parse(gh(["api", `repos/${REPO}/issues/${number}`]));
  if (issue.milestone) return;
  gh([
    "api",
    "-X",
    "PATCH",
    `repos/${REPO}/issues/${number}`,
    "-F",
    `milestone=${milestone.number}`,
  ]);
  console.log(`  milestone "${MILESTONE}" on #${number}`);
}

function createIssue(milestone, title, body, labels) {
  const payload = JSON.stringify({ title, body, labels, milestone: milestone.number });
  return JSON.parse(gh(["api", "-X", "POST", `repos/${REPO}/issues`, "--input", "-"], payload))
    .number;
}

function apply(entries) {
  const milestone = JSON.parse(gh(["api", `repos/${REPO}/milestones`])).find(
    (m) => m.title === MILESTONE,
  );
  if (!milestone) throw new Error(`milestone not found: ${MILESTONE}`);
  const byTitle = existingByTitle();
  const p2 = byTitle.get(P2_PARENT_TITLE);
  if (p2 === undefined) throw new Error(`phase parent not found: ${P2_PARENT_TITLE}`);
  console.log(`exists  #${p2} phase parent ${P2_PARENT_TITLE}`);
  linkOnce(MILESTONE_PARENT, subIssues(MILESTONE_PARENT), p2);
  const linked = subIssues(p2);
  const numbers = new Map();
  for (const e of entries) {
    let number = byTitle.get(e.title);
    if (number === undefined) {
      const blocked = e.blockedBy.map((k) => `Blocked by #${numbers.get(k)}`);
      number = createIssue(
        milestone,
        e.title,
        [e.body, ...(blocked.length ? ["", ...blocked] : [])].join("\n"),
        e.labels,
      );
      console.log(`created #${number} ${e.key} ${e.title}`);
    } else console.log(`exists  #${number} ${e.key} ${e.title}`);
    linkOnce(p2, linked, number);
    numbers.set(e.key, number);
    for (const c of e.carried) {
      milestoneOnce(milestone, c);
      linkOnce(p2, linked, c);
      commentOnce(c, planComment(e));
    }
  }
}

function writeHeadings(entries) {
  const byTitle = existingByTitle();
  for (const path of [PLAN_A, PLAN_B]) {
    let md = readFileSync(path, "utf8");
    for (const e of entries.filter((x) => x.plan === path)) {
      const number = byTitle.get(e.title);
      if (number === undefined) throw new Error(`no issue for ${e.key}: ${e.title}`);
      const heading = new RegExp(`^(### Task ${e.n}: .*?)(?: \\(#\\d+\\))?$`, "m");
      if (!heading.test(md)) throw new Error(`${path}: no heading for Task ${e.n}`);
      md = md.replace(heading, `$1 (#${number})`);
    }
    writeFileSync(path, md);
    console.log(`numbered ${path}`);
  }
}

const ENTRIES = dependencyOrder([...A, ...B]);
checkAgainstPlans(ENTRIES);
const mode = process.argv[2];
if (mode === "--apply") apply(ENTRIES);
else if (mode === "--headings") writeHeadings(ENTRIES);
else if (mode === undefined) {
  console.log(`would reuse phase parent "${P2_PARENT_TITLE}" (#45) under #${MILESTONE_PARENT}`);
  for (const e of ENTRIES) {
    const extra = e.blockedBy.length ? ` <- ${e.blockedBy.join(",")}` : "";
    const carried = e.carried.length ? ` (comment on #${e.carried.join(", #")})` : "";
    console.log(`would create ${e.key} [${e.labels.join(",")}] ${e.title}${extra}${carried}`);
  }
  console.log(`${ENTRIES.length} entries; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m2-p2-issues.mjs [--apply | --headings]");
  process.exit(2);
}
