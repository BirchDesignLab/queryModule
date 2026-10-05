#!/usr/bin/env node
// gh-create-m2-p0-issues.mjs: open M2 P0 (contracts) and M2 P0.5 (dispatch, ADR-0012) on GitHub
// (session "M2 planning 1", Task 0 of the three plans below). One issue per plan task, linked as a
// sub-issue of its phase parent: "Contracts (M2 P0)" (#43) for the P0 plan, and "Dispatch (M2
// P0.5)" for both P0.5 plans. The P0.5 phase parent is created here (by exact title) and linked
// under the M2 milestone parent (#88), because the board data has no P0.5 phase option yet
// (gate chore: scripts/ops/board-config.mjs Phase options, rides Track A wave AW1).
// Carried follow-ups (existing) are never recreated: they are linked under the phase parent and
// get a "Plan: <file> Task <n>" comment.
// With --headings, writes "(#n)" into each plan's "### Task <n>:" heading.
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; a plan comment is posted only when no comment has that exact text.
// Fail closed: before any GitHub call, the numeric task headings of each plan (Task 0 excluded)
// must equal the numeric tasks below, and every blocker key must exist.
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m2-p0-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m2-p0-issues.mjs --apply
//   node scripts/pm/gh-create-m2-p0-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M2 Results and audit";
const MILESTONE_PARENT = 88;
const P0_PARENT = 43;
const P05_PARENT_TITLE = "Dispatch (M2 P0.5)";
const PLAN_C = "docs/superpowers/plans/2026-10-05-m2-p0-contracts.md";
const PLAN_A = "docs/superpowers/plans/2026-10-05-m2-track-a-p0-5.md";
const PLAN_B = "docs/superpowers/plans/2026-10-05-m2-track-b-p0-5.md";
const P05_PARENT_BODY = `Phase parent for Dispatch (M2 Results and audit P0.5, ADR-0012). Progress comes from its sub-issues.

**Gate:** A4 clean no-record at the API layer and in the UI status list; smoke 1 to 5; dispatch and lifecycle tests; source-status.spec.ts.

Plans: \`${PLAN_A}\` and \`${PLAN_B}\`. Grid and handoffs: \`docs/superpowers/plans/STATUS.md\`.`;

// [task, title, sensitive, labels, opts]; opts: existing (carried issue), partial, blockedBy, note.
const cTasks = [
  [
    1,
    "CFG-3: config store verifies the stored hash before defaults (ADR-0011, prototype shortcut)",
    true,
    ["platform"],
    { note: "Carried from #511 (CFG-3). Must merge before any config schema change." },
  ],
  [
    2,
    "WS receipt policy (ADR-0013); resultHidden and resync contracts (FR-065, spec 4.7)",
    true,
    ["core", "contract"],
    { note: "Carried from #511 (from #98 C-M4); policy for #66." },
  ],
  [
    3,
    "assessResult and mapResponse contracts; response mapping freeze review (spec 4.5)",
    false,
    ["core", "contract"],
  ],
  [
    4,
    "M2 audit catalogue: fromRole, revoke target, passwordChanged, admin audit types (SEC-010 to SEC-013)",
    true,
    ["core", "contract"],
    {
      note: "Carried from #511 (from #505: G-m3, password change, revokeSession target). Scheduled after the developer's demo (plan D-M2P0-5).",
    },
  ],
  [
    5,
    "Request-key versioning: ruling and change (SEC-006, SEC-011)",
    true,
    ["platform"],
    {
      note: "Carried from #511 (from #311). Scheduled after the developer's demo (plan D-M2P0-5).",
    },
  ],
  [
    6,
    "Publish change note and publisher name in the admin config contract (#507)",
    false,
    ["core", "contract"],
    {
      note: "Carried from #511 (from #507). Persistence and UI in M2 P2. Scheduled after the developer's demo (plan D-M2P0-5).",
    },
  ],
  [
    7,
    "Routes and OpenAPI: GET queries, admin audit, admin queries (FR-062, FR-063, spec 5.1)",
    false,
    ["core", "contract"],
  ],
  [8, "Stories A6 to A9 in stories.json (spec 10.2)", false, ["core"]],
  [9, "M2 P0 gate: contracts frozen, oasdiff reviewed, master plan 8 log", false, ["core"]],
];
const aTasks = [
  [1, "Core: fixture policy allowlist for mock payloads (SEC-002, spec 5.4)", true, ["core"]],
  [2, "Mock data generator and regenerated mock files (FR-043, FR-044, spec 5.4)", false, []],
  [3, "config:validate runs the fixture policy and generator check (spec 10.8)", true, []],
  [
    4,
    "Admin validate, publish and rollback enforce the fixture policy on the stored mock (SEC-002)",
    true,
    [],
    { blockedBy: ["C1"], note: "Carried from #511 (T27 IC1, CV1)." },
  ],
  [5, "event_log table and seq allocation (FR-043, FR-065, NFR-003)", true, []],
  [6, "Adapter API v1, Secret and the adapter registry (FR-043, SEC-006)", true, []],
  [
    7,
    "Mock adapter answers from the pinned snapshot's stored mock (#493)",
    true,
    [],
    { existing: 493, blockedBy: ["C1"] },
  ],
  [8, "Dispatcher with deadlines and caps (FR-040, FR-043, FR-044, NFR-002)", true, []],
  [
    9,
    "Outcome transaction T2, sourceResponded and sourceStatus (FR-043, SEC-010, SEC-012)",
    true,
    [],
  ],
  [
    10,
    "Dispatch tests: deadlines, write-once, scenarios, snapshot pin; B1 API half (FR-044, NFR-002)",
    true,
    [],
  ],
  [
    11,
    "Startup sweep to interrupted; startup error fields (NFR-003, SEC-010)",
    true,
    [],
    { note: "Carried from #511 (C-M-1, C-M-2)." },
  ],
  [12, "WS welcome.latestSeq from event_log and owner-only delivery (FR-065, SEC-014)", true, []],
  [13, "SIGTERM drain (NFR-003)", true, []],
  [14, "Smoke step 4: sources settle (spec 8.7)", true, [], { note: "Also closes #503." }],
  [
    15,
    "Security rows: mock gate, adapter log capture, dispatch audit rows (SEC-006, SEC-010, SEC-012)",
    true,
    [],
  ],
  [
    16,
    "Change-password page reads the server's password minimum (SEC-005, #507)",
    true,
    [],
    { note: "Carried from #511 (from #507 item 17)." },
  ],
  [17, "Docs refresh: dispatch, fixture policy, live status (BR-005)", false, ["documentation"]],
  [18, "M2 P0.5 gate, release note and promote (ADR-0012)", false, []],
];
const bTasks = [
  ["0a", "App bar minors", false, [], { existing: 482 }],
  ["0b", "Admin layout minors", false, [], { existing: 484 }],
  ["0c", "Builder editor and preview padding", false, [], { existing: 486 }],
  [
    "0d",
    "Tighten the builder toolbar visual checks after the 1366 layout ruling (#507)",
    false,
    [],
    { note: "Carried from #511 (from #507 C/M1)." },
  ],
  [
    1,
    "Mock responses editor design (CFG-2)",
    false,
    [],
    { note: "Carried from #511 (CFG-2). Ruled 10-05-26: purpose-built editor." },
  ],
  [
    2,
    "Mock document model, coverage and scaffold for the builder (CFG-2)",
    false,
    [],
    { blockedBy: ["A1"] },
  ],
  [
    "3a",
    "Mock responses editor in the builder: component and tree (CFG-2, spec 5.4)",
    false,
    ["accessibility"],
  ],
  ["3b", "Mock changes in Review and the issues list (CFG-2)", false, ["accessibility"]],
  [
    4,
    "New query types and sources on mock sites get mock responses; editor e2e (CFG-2)",
    false,
    [],
    { blockedBy: ["A4"] },
  ],
  [
    "5a",
    "Client: feed socket with heartbeat, reconnect and tolerant parsing (FR-065, ADR-0013)",
    false,
    [],
    { blockedBy: ["C2"], note: "WS half of #66." },
  ],
  ["5b", "Web: open the feed socket while signed in (FR-065, spec 6.7)", false, []],
  [
    6,
    "Client: per-source status in the requests store with coalesced announcements (FR-043, spec 6.6)",
    false,
    ["accessibility"],
    { blockedBy: ["A9"] },
  ],
  [
    7,
    "Web: live per-source status in the requests list (FR-064, UX-004)",
    false,
    ["accessibility"],
  ],
  [
    8,
    "E2E: live source status and the mock editor end to end (spec 10.6)",
    false,
    [],
    { blockedBy: ["A5", "A9", "A12"] },
  ],
];

const toEntries = (prefix, plan, phaseLabel, trackLabel, tasks) =>
  tasks.map(([n, title, sens, extra = [], opts = {}]) => ({
    key: `${prefix}${n}`,
    plan,
    n,
    title,
    parent: plan === PLAN_C ? "P0" : "P05",
    labels: [...new Set([trackLabel, phaseLabel, ...(sens ? ["sensitive"] : []), ...extra])],
    body: `Plan: ${plan} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}${opts.note ? `\n${opts.note}` : ""}`,
    blockedBy: opts.blockedBy ?? [],
    existing: opts.existing === undefined ? undefined : [opts.existing].flat(),
    partial: opts.partial ?? false,
  }));
const C = toEntries("C", PLAN_C, "p0", "core", cTasks);
const A = toEntries("A", PLAN_A, "p0-5", "platform", aTasks);
const B = toEntries("B", PLAN_B, "p0-5", "web", bTasks);

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

const planComment = (e) =>
  `Plan: ${e.plan} Task ${e.n}${e.partial ? " (this task covers part of this issue)" : ""}`;

function planTaskNumbers(path) {
  return [...readFileSync(path, "utf8").matchAll(/^### Task (\d+):/gm)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== 0)
    .sort((x, y) => x - y);
}

function checkAgainstPlans(all) {
  const problems = [];
  for (const [path, entries] of [
    [PLAN_C, C],
    [PLAN_A, A],
    [PLAN_B, B],
  ]) {
    const want = planTaskNumbers(path);
    const have = entries
      .map((e) => e.n)
      .filter((n) => typeof n === "number")
      .sort((x, y) => x - y);
    if (JSON.stringify(want) !== JSON.stringify(have))
      problems.push(`${path}: headings ${want.join(",")} but data ${have.join(",")}`);
    const md = readFileSync(path, "utf8");
    for (const e of entries)
      if (typeof e.n === "string" && !new RegExp(`^### Task ${e.n}: `, "m").test(md))
        problems.push(`${path}: no heading for Task ${e.n}`);
  }
  const keys = new Set(all.map((e) => e.key));
  for (const e of all)
    for (const k of e.blockedBy) if (!keys.has(k)) problems.push(`${e.key}: unknown blocker ${k}`);
  const created = all.filter((e) => e.existing === undefined);
  if (new Set(created.map((e) => e.title)).size !== created.length)
    problems.push("duplicate titles");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(
    `check ok: P0 ${C.length}, P0.5 A ${A.length}, P0.5 B ${B.length} tasks match plan headings`,
  );
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
  let p05 = byTitle.get(P05_PARENT_TITLE);
  if (p05 === undefined) {
    p05 = createIssue(milestone, P05_PARENT_TITLE, P05_PARENT_BODY, ["epic", "p0-5"]);
    console.log(`created #${p05} phase parent ${P05_PARENT_TITLE}`);
  } else console.log(`exists  #${p05} phase parent ${P05_PARENT_TITLE}`);
  linkOnce(MILESTONE_PARENT, subIssues(MILESTONE_PARENT), p05);
  const parents = { P0: P0_PARENT, P05: p05 };
  const linked = { P0: subIssues(P0_PARENT), P05: subIssues(p05) };
  const numbers = new Map();
  for (const e of entries) {
    let number;
    if (e.existing !== undefined) {
      number = e.existing[0];
      console.log(`carried #${e.existing.join(", #")} ${e.key} ${e.title}`);
      for (const n of e.existing) {
        commentOnce(n, planComment(e));
        linkOnce(parents[e.parent], linked[e.parent], n);
      }
    } else {
      number = byTitle.get(e.title);
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
      linkOnce(parents[e.parent], linked[e.parent], number);
    }
    numbers.set(e.key, number);
  }
}

function writeHeadings(entries) {
  const byTitle = existingByTitle();
  for (const path of [PLAN_C, PLAN_A, PLAN_B]) {
    let md = readFileSync(path, "utf8");
    for (const e of entries.filter((x) => x.plan === path)) {
      const number = e.existing?.[0] ?? byTitle.get(e.title);
      if (number === undefined) throw new Error(`no issue for ${e.key}: ${e.title}`);
      const heading = new RegExp(`^(### Task ${e.n}: .*?)(?: \\(#\\d+\\))?$`, "m");
      if (!heading.test(md)) throw new Error(`${path}: no heading for Task ${e.n}`);
      md = md.replace(heading, `$1 (#${number})`);
    }
    writeFileSync(path, md);
    console.log(`numbered ${path}`);
  }
}

const ENTRIES = dependencyOrder([...C, ...A, ...B]);
checkAgainstPlans(ENTRIES);
const mode = process.argv[2];
if (mode === "--apply") apply(ENTRIES);
else if (mode === "--headings") writeHeadings(ENTRIES);
else if (mode === undefined) {
  console.log(
    `would create or reuse phase parent "${P05_PARENT_TITLE}" under #${MILESTONE_PARENT}`,
  );
  for (const e of ENTRIES) {
    const verb =
      e.existing !== undefined ? `would link #${e.existing.join(", #")}` : "would create";
    const extra = e.blockedBy.length ? ` <- ${e.blockedBy.join(",")}` : "";
    console.log(`${verb} ${e.key} [${e.labels.join(",")}] ${e.title}${extra}`);
  }
  console.log(`${ENTRIES.length} entries; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m2-p0-issues.mjs [--apply | --headings]");
  process.exit(2);
}
