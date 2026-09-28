#!/usr/bin/env node
// gh-create-m1-p2-issues.mjs: open the M1 P2 phase on GitHub (Track A P2 plan Task 0 Steps 0.1 to
// 0.3, Track B P2 plan Task 0). One issue per new plan task, linked as a sub-issue of the phase
// parent "Engine (M1 P2)" (#41). Carried follow-ups (existing) are never recreated: they are linked
// under #41 if not already and get a "Plan: <file> Task <n>" comment. Tasks already merged (done)
// are closed as completed with a comment naming the PR. With --headings, writes "(#n)" into each
// plan's "### Task N:" heading.
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; the plan comment is posted only when no comment has that exact text; a done issue
// is closed only while open.
//
// Fail closed: before any GitHub call, the task numbers below must equal the "### Task N:"
// headings of both plans (Task 0 excluded).
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m1-p2-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m1-p2-issues.mjs --apply
//   node scripts/pm/gh-create-m1-p2-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M1 Forms and terminal";
const PHASE_PARENT = 41;
const PLAN_A = "docs/superpowers/plans/2026-09-28-track-a-p2.md";
const PLAN_B = "docs/superpowers/plans/2026-09-28-track-b-p2.md";

// Track A plan Task 0 Step 0.1 list: [task, title, sensitive, extraLabels, opts].
// opts: existing (carried issue number), partial (the task covers part of it), blockedBy (entry keys).
const aTasks = [
  [1, "sdd workflows: read shas from git (#222)", false, [], { existing: 222 }],
  [
    2,
    "Contract: query audit credentialUserId rule (SEC-011, #98)",
    true,
    ["contract", "core"],
    { existing: 98 },
  ],
  [
    3,
    "Contract: configLoaded and retentionPurged audit types (SEC-010, SEC-021)",
    true,
    ["contract", "core"],
  ],
  [
    4,
    "Contract: POST /api/v1/queries route (FR-040, FR-064, SEC-014)",
    false,
    ["contract", "core"],
  ],
  [5, "Core: resolveSiteConfig chain (BR-001, NFR-001)", false, ["core"]],
  [
    6,
    "Core: validateSiteConfig referential pass gaps (BR-001, FR-031)",
    false,
    ["core"],
    { blockedBy: ["B1"] },
  ],
  [7, "Config load on the resolved chain (BR-001, PLT-007)", false],
  [8, "configLoaded at startup (SEC-010, BR-001)", true],
  [9, "config CLIs on the shared chain (BR-001, #220)", true, [], { existing: 220, partial: true }],
  [10, "GET config on the resolved overlay (BR-001, BR-007)", false],
  [11, "AES-GCM helper and per-request DEKs (SEC-006, SEC-021)", true],
  [12, "lost-data-key shreds request_key (SEC-006, SEC-021)", true],
  [13, "query_request, source_result, request_key tables (SEC-010, SEC-013, FR-063)", true],
  [14, "db: block writable_schema on the app connection (#189)", true, [], { existing: 189 }],
  [15, "CLI main guards on isMainModule (#220 M2)", true],
  [16, "Core: query planner (FR-012, FR-040, FR-041, FR-042)", true, ["core"]],
  [17, "Query access policy function (FR-062, FR-063, SEC-014)", true],
  [18, "Submit admission and Idempotency-Key (FR-064, SEC-014, NFR-002)", true],
  [19, "Submit validation, plan and credential snapshot (FR-040, FR-041, SEC-011)", true],
  [20, "Submit transaction T1 and the 202 (FR-064, SEC-010, SEC-012, NFR-004)", true],
  [21, "Submit security and concurrency tests (SEC-006, SEC-014, NFR-002)", true],
  [22, "WS upgrade rate limit and Origin first (#225)", true, [], { existing: 225 }],
  [23, "e2e, smoke, restore-test and deploy-pull hardening (#237)", true, [], { existing: 237 }],
  [24, "oasdiff rename-aware step (#171)", true, [], { existing: 171 }],
  [
    25,
    "scanner and test minors (#220 G-M-a, r1-a, M4)",
    true,
    [],
    { existing: 220, partial: true },
  ],
  [26, "Remove the README SVG dashboard (#244)", true, [], { existing: 244 }],
  [27, "Sign-out fails when the session row survives (#246)", true, [], { existing: 246 }],
];
const A = aTasks.map(([n, title, sens, extra = [], opts = {}]) => ({
  key: `A${n}`,
  plan: PLAN_A,
  n,
  title,
  labels: ["platform", "p2", ...(sens ? ["sensitive"] : []), ...extra],
  body: `Plan: ${PLAN_A} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}`,
  blockedBy: opts.blockedBy ?? [],
  existing: opts.existing,
  partial: opts.partial ?? false,
}));

// Track B plan Task 0 Step 0.1 list: [task, title, sensitive, trackLabel, opts].
// done: the PR that already merged the task (close the new issue as completed).
const bTasks = [
  [
    1,
    "Core: literal canonicalisation and canonical conditions (FR-002, FR-031, BR-001)",
    false,
    "core",
    { done: 254 },
  ],
  [2, "Core: duplicate mapping keyed on the canonical when (#73)", false, "core", { existing: 73 }],
  [
    3,
    "Locales: validation, terminal, plan, form and shortcut strings (NFR-001)",
    false,
    "core",
    { done: 254 },
  ],
  [4, "Core: terminal tokenize (FR-050, FR-051, FR-052, FR-054)", true, "core"],
  [5, "Core: parseCommand and story A4 (FR-053, FR-055)", true, "core"],
  [6, "Core: formatCommand, selectCommand, mergeDraft (FR-056)", true, "core"],
  [7, "Core: terminal round trip and story A5 property tests (FR-056)", true, "core"],
  [8, "Client: config fetch from GET /api/v1/config (BR-001, SEC-006)", false, "web"],
  [9, "Client: draft store, user values per query type (FR-056, SEC-006)", false, "web"],
  [10, "Web-ui: generic field renderer (FR-001, FR-005, UX-004)", false, "web"],
  [11, "Web-ui: QueryForm from FormState (FR-002, FR-003, FR-006, UX-004)", false, "web"],
  [12, "Web: rules-driven query panel (FR-001 to FR-007, FR-010, UX-004)", false, "web"],
  [
    13,
    "Web: site theme selection from config (UX-002, UX-011, #175)",
    false,
    "web",
    { existing: 175, partial: true },
  ],
  [14, "Web: e2e form from config, A2, A3 (FR-002, FR-005, UX-004)", false, "web"],
  [15, "Web-ui: shortcut engine (FR-006, FR-007, FR-051, FR-053)", false, "web"],
  [16, "Web-ui: shortcut binding, panel actions, shortcut sheet (FR-006, FR-007)", false, "web"],
  [17, "Web: e2e keyboard shortcuts (FR-006, FR-007)", false, "web"],
];
const B = bTasks.map(([n, title, sens, label, opts = {}]) => ({
  key: `B${n}`,
  plan: PLAN_B,
  n,
  title,
  labels: [label, "p2", ...(sens ? ["sensitive"] : [])],
  body: `Plan: ${PLAN_B} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}`,
  blockedBy: [],
  existing: opts.existing,
  partial: opts.partial ?? false,
  done: opts.done,
}));

// Order matters: Blocked-by lines name issues created earlier (A6 <- B1).
const ENTRIES = [...B, ...A];

const planComment = (e) =>
  `Plan: ${e.plan} Task ${e.n}${e.partial ? " (this task covers part of this issue)" : ""}`;
const doneComment = (e) => `Done in #${e.done} (${e.plan} Task ${e.n}).`;

function planTaskNumbers(path) {
  return [...readFileSync(path, "utf8").matchAll(/^### Task (\d+):/gm)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== 0)
    .sort((x, y) => x - y);
}

function checkAgainstPlans() {
  const problems = [];
  for (const [path, entries] of [
    [PLAN_A, A],
    [PLAN_B, B],
  ]) {
    const want = planTaskNumbers(path);
    const have = entries.map((e) => e.n);
    if (JSON.stringify(want) !== JSON.stringify(have)) {
      problems.push(`${path}: headings ${want.join(",")} but data ${have.join(",")}`);
    }
  }
  const keys = new Set(ENTRIES.map((e) => e.key));
  for (const e of ENTRIES) {
    for (const k of e.blockedBy) if (!keys.has(k)) problems.push(`${e.key}: unknown blocker ${k}`);
    if (e.existing !== undefined && e.done !== undefined)
      problems.push(`${e.key}: existing and done`);
  }
  const created = ENTRIES.filter((e) => e.existing === undefined);
  if (new Set(created.map((e) => e.title)).size !== created.length)
    problems.push("duplicate titles");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`check ok: A tasks 1..${A.length}, B tasks 1..${B.length} match plan headings`);
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

function apply() {
  const milestone = JSON.parse(gh(["api", `repos/${REPO}/milestones`])).find(
    (m) => m.title === MILESTONE,
  );
  if (!milestone) throw new Error(`milestone not found: ${MILESTONE}`);
  const linked = new Set(
    JSON.parse(gh(["api", "--paginate", `repos/${REPO}/issues/${PHASE_PARENT}/sub_issues`])).map(
      (i) => i.number,
    ),
  );
  const byTitle = existingByTitle();
  const numbers = new Map();
  for (const e of ENTRIES) {
    let number = e.existing ?? byTitle.get(e.title);
    if (e.existing !== undefined) {
      console.log(`carried #${number} ${e.key} ${e.title}`);
      commentOnce(number, planComment(e));
    } else if (number === undefined) {
      const blocked = e.blockedBy.map((k) => `Blocked by #${numbers.get(k)}`);
      const body = [e.body, ...(blocked.length ? ["", ...blocked] : [])].join("\n");
      const payload = JSON.stringify({
        title: e.title,
        body,
        labels: e.labels,
        milestone: milestone.number,
      });
      number = JSON.parse(
        gh(["api", "-X", "POST", `repos/${REPO}/issues`, "--input", "-"], payload),
      ).number;
      console.log(`created #${number} ${e.key} ${e.title}`);
    } else {
      console.log(`exists  #${number} ${e.key} ${e.title}`);
    }
    numbers.set(e.key, number);
    if (!linked.has(number)) {
      const id = JSON.parse(gh(["api", `repos/${REPO}/issues/${number}`])).id;
      gh([
        "api",
        "-X",
        "POST",
        `repos/${REPO}/issues/${PHASE_PARENT}/sub_issues`,
        "-F",
        `sub_issue_id=${id}`,
      ]);
      console.log(`  linked under #${PHASE_PARENT}`);
    }
    if (e.done !== undefined) {
      const state = JSON.parse(gh(["api", `repos/${REPO}/issues/${number}`])).state;
      if (state === "open") {
        commentOnce(number, doneComment(e));
        gh([
          "api",
          "-X",
          "PATCH",
          `repos/${REPO}/issues/${number}`,
          "-f",
          "state=closed",
          "-f",
          "state_reason=completed",
        ]);
        console.log(`  closed #${number} as completed`);
      }
    }
  }
}

function writeHeadings() {
  const byTitle = existingByTitle();
  for (const path of [PLAN_A, PLAN_B]) {
    let md = readFileSync(path, "utf8");
    for (const e of ENTRIES.filter((x) => x.plan === path)) {
      const number = e.existing ?? byTitle.get(e.title);
      if (number === undefined) throw new Error(`no issue for ${e.key}: ${e.title}`);
      const re = new RegExp(`^(### Task ${e.n}: .*?)(?: \\(#\\d+\\))?$`, "m");
      if (!re.test(md)) throw new Error(`${path}: no heading for Task ${e.n}`);
      md = md.replace(re, `$1 (#${number})`);
    }
    writeFileSync(path, md);
    console.log(`numbered ${path}`);
  }
}

checkAgainstPlans();
const mode = process.argv[2];
if (mode === "--apply") apply();
else if (mode === "--headings") writeHeadings();
else if (mode === undefined) {
  for (const e of ENTRIES) {
    const verb = e.existing !== undefined ? `would link #${e.existing}` : "would create";
    const extra = [
      e.blockedBy.length ? `<- ${e.blockedBy.join(",")}` : "",
      e.done !== undefined ? `then close (done in #${e.done})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`${verb} ${e.key} [${e.labels.join(",")}] ${e.title}${extra ? ` ${extra}` : ""}`);
  }
  console.log(`${ENTRIES.length} entries; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m1-p2-issues.mjs [--apply | --headings]");
  process.exit(2);
}
