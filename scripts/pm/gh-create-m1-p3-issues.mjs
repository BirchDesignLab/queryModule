#!/usr/bin/env node
// gh-create-m1-p3-issues.mjs: open the M1 P3 phase on GitHub (Track A P3 plan Task 0, Track B P3
// plan Task 0), after the UI-first re-plan of 09-29-26. One issue per ACTIVE plan task, linked as a
// sub-issue of the phase parent "Flow (M1 P3)" (#42). Parked tasks (the dispatch backend, ADR-0012)
// get no issue here: the M2 P0.5 plan creates theirs. Carried follow-ups (existing) are never
// recreated: they are linked under #42 if not already and get a "Plan: <file> Task <n>" comment.
// With --headings, writes "(#n)" into each plan's "### Task N:" heading, or into the bold lead of
// a "- **Task N: ...**" bullet (Track A Tasks 30 to 35 share one heading).
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; the plan comment is posted only when no comment has that exact text.
//
// Fail closed: before any GitHub call, the active and parked task numbers below must together
// equal the plan's task numbers (Task 0 excluded), with no overlap.
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m1-p3-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m1-p3-issues.mjs --apply
//   node scripts/pm/gh-create-m1-p3-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M1 Forms and terminal";
const PHASE_PARENT = 42;
const PLAN_A = "docs/superpowers/plans/2026-09-29-track-a-p3.md";
const PLAN_B = "docs/superpowers/plans/2026-09-29-track-b-p3.md";

// Parked by the re-plan (ADR-0012, M2 P0.5 dispatch): no issue in this phase.
const PARKED = {
  [PLAN_A]: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [PLAN_B]: [13, 14, 15, 16],
};

// Track A active tasks: [task, title, sensitive, extraLabels, opts].
// opts: existing (carried issue number, or a list: the first is written into the heading),
// partial (the task covers part of it), blockedBy (entry keys), scope (an extra body line).
const aTasks = [
  [
    16,
    "Docs refresh: site-config, api, demo for the v1 demo (BR-005, D-A18)",
    false,
    ["documentation"],
    {
      scope:
        "Scope (checker 09-29-26): docs/site-config.md incl. the admin builder and config store; docs/api.md incl. the admin routes; docs/demo.md for the v1 demo (three personas, the core loop). Dispatch sections move to M2 P0.5. Own ordinary PR before the exit PR (D-A18 a).",
    },
  ],
  [
    17,
    "M1 exit: v1 demo, release notes, smoke, restore test, promote m1 (BR-004, ADR-0012)",
    false,
    [],
    { existing: 237, partial: true },
  ],
  [18, "sensitive-paths lists http/security.ts as gate (#338)", true, [], { existing: 338 }],
  [19, "Idle-expired sign-out writes a logout row (#337)", true, [], { existing: 337 }],
  [20, "P2 PR-1 review minors (#339)", true, [], { existing: 339 }],
  [
    21,
    "P2 PR-2 gate minors (#311, #315, #303, #220)",
    true,
    [],
    { existing: [311, 315, 303, 220], partial: true },
  ],
  [22, "Example-query config for the default site (BR-001, FR-001 to FR-056)", false, ["core"]],
  [23, "example-ok site variations and the demo script (BR-001, FR-051, FR-052)", false, ["core"]],
  [
    24,
    "Contracts for the admin console (BR-001, FR-060, SEC-010, ADR-0011)",
    true,
    ["contract", "core"],
  ],
  [25, "Versioned config store and startup from it (BR-001, SEC-010, ADR-0011)", true],
  [26, "Live activation on publish (BR-001, SEC-010, FR-064)", true],
  [27, "Admin config API (BR-001, SEC-010, SEC-014)", true],
  [28, "User administration API (SEC-005, SEC-010, SEC-014)", true],
  [29, "Admin security rows (SEC-010, SEC-014, spec 10.3)", true],
  [30, "Admin UI: admin shell (BR-002, UX-004)", false, ["web"]],
  [31, "Admin UI: config builder (BR-001, FR-060)", false, ["web"]],
  [
    32,
    "Admin UI: live preview on the dispatcher renderer (BR-001)",
    false,
    ["web"],
    { blockedBy: ["B19"] },
  ],
  [33, "Admin UI: diagnostics, diff, publish and rollback (BR-001, UX-004)", false, ["web"]],
  [34, "Admin UI: users (SEC-005, UX-004)", false, ["web"]],
  [
    35,
    "Core-loop e2e: builder publish seen in an open dispatcher form (BR-001, ADR-0012)",
    false,
    ["web"],
    { blockedBy: ["B12", "B18"] },
  ],
  [36, "Demo persona users (UX-001, UX-012, BR-002)", true],
];
const A = aTasks.map(([n, title, sens, extra = [], opts = {}]) => ({
  key: `A${n}`,
  plan: PLAN_A,
  n,
  title,
  labels: ["platform", "p3", ...(sens ? ["sensitive"] : []), ...extra],
  body: `Plan: ${PLAN_A} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}${opts.scope ? `\n${opts.scope}` : ""}`,
  blockedBy: opts.blockedBy ?? [],
  existing: opts.existing === undefined ? undefined : [opts.existing].flat(),
  partial: opts.partial ?? false,
}));

// Track B active tasks (B plan Task 0 Step 0.1 list, parked 13 to 16 left out):
// [task, title, sensitive, trackLabel, opts].
const bTasks = [
  [1, "Locales: submit, ack, mode and terminal UI strings (NFR-001, FR-055)", false, "core"],
  [
    2,
    "Client: terminal error text with label and delimiter (FR-055, #297)",
    false,
    "web",
    { existing: 297, partial: true },
  ],
  [
    3,
    "Client: draft store mode and terminal text; core Draft adapter (FR-056, SEC-006)",
    false,
    "web",
  ],
  [
    4,
    "Core: checkTerminalSubmit on the merged draft (FR-053, FR-055, FR-056, #297)",
    true,
    "core",
    { existing: 297, partial: true },
  ],
  [
    5,
    "Client: submit controller with Idempotency-Key and error outcomes (FR-064, NFR-003, SEC-014)",
    false,
    "web",
  ],
  [
    6,
    "Web: real submit from the form and the acknowledgment (FR-006, FR-064, UX-004)",
    false,
    "web",
  ],
  [7, "Web-ui: TerminalInput and ModeToggle (FR-050, FR-055, FR-056)", false, "web"],
  [8, "Web: terminal mode, toggle and terminal submit (FR-050 to FR-056)", false, "web"],
  [9, "Web: e2e A1, A4, A5 keyboard only (FR-006, FR-053, FR-056)", false, "web"],
  [10, "Web: axe in every scenario as an auto-fixture (UX-004, spec 10.6)", false, "web"],
  [11, "Web: submit error paths e2e and demo walkthrough text (FR-064, BR-005)", false, "web"],
  [
    12,
    "Web: quick-access buttons pick the type; type fields as the subtype control (FR-007, FR-031, BR-001, D-B15)",
    false,
    "web",
  ],
  [
    17,
    "Web: e2e for every requirements example query (BR-001, FR-001 to FR-056)",
    false,
    "web",
    { blockedBy: ["A22"] },
  ],
  [
    18,
    "Client and web: live config refresh; the open form reacts to a publish (BR-001, FR-002, UX-004)",
    false,
    "web",
  ],
  [19, "Web: query panel renders from an injected config (preview mode) (BR-001)", false, "web"],
  [20, "Web: officer mobile-unit layout, v1 subset (UX-002, UX-012, UX-014)", false, "web"],
  [
    21,
    "Web: persona e2e for dispatcher, officer and admin (UX-001, UX-012, BR-002)",
    false,
    "web",
    { blockedBy: ["A30", "A36"] },
  ],
];
const B = bTasks.map(([n, title, sens, label, opts = {}]) => ({
  key: `B${n}`,
  plan: PLAN_B,
  n,
  title,
  labels: [label, "p3", ...(sens ? ["sensitive"] : [])],
  body: `Plan: ${PLAN_B} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}`,
  blockedBy: opts.blockedBy ?? [],
  existing: opts.existing === undefined ? undefined : [opts.existing].flat(),
  partial: opts.partial ?? false,
}));

// Blocked-by lines name issues created earlier, and blockers run both ways (A32 <- B19,
// B17 <- A22), so entries are created in dependency order.
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
  return [...readFileSync(path, "utf8").matchAll(/^(?:### Task|- \*\*Task) (\d+):/gm)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== 0)
    .sort((x, y) => x - y);
}

function checkAgainstPlans(entriesAll) {
  const problems = [];
  for (const [path, entries] of [
    [PLAN_A, A],
    [PLAN_B, B],
  ]) {
    const want = planTaskNumbers(path);
    const active = entries.map((e) => e.n);
    const parked = PARKED[path];
    const overlap = active.filter((n) => parked.includes(n));
    if (overlap.length) problems.push(`${path}: active and parked ${overlap.join(",")}`);
    const have = [...active, ...parked].sort((x, y) => x - y);
    if (JSON.stringify(want) !== JSON.stringify(have)) {
      problems.push(`${path}: headings ${want.join(",")} but data ${have.join(",")}`);
    }
  }
  const keys = new Set(entriesAll.map((e) => e.key));
  for (const e of entriesAll)
    for (const k of e.blockedBy) if (!keys.has(k)) problems.push(`${e.key}: unknown blocker ${k}`);
  const created = entriesAll.filter((e) => e.existing === undefined);
  if (new Set(created.map((e) => e.title)).size !== created.length)
    problems.push("duplicate titles");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(
    `check ok: A active ${A.map((e) => e.n).join(",")} (parked ${PARKED[PLAN_A].join(",")}); ` +
      `B active ${B.map((e) => e.n).join(",")} (parked ${PARKED[PLAN_B].join(",")}) match plan headings`,
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

function linkOnce(linked, number) {
  if (linked.has(number)) return;
  const id = JSON.parse(gh(["api", `repos/${REPO}/issues/${number}`])).id;
  gh([
    "api",
    "-X",
    "POST",
    `repos/${REPO}/issues/${PHASE_PARENT}/sub_issues`,
    "-F",
    `sub_issue_id=${id}`,
    // A carried issue may still sit under the closed P2 parent (#41); an issue has one parent.
    "-F",
    "replace_parent=true",
  ]);
  linked.add(number);
  console.log(`  linked #${number} under #${PHASE_PARENT}`);
}

function apply(entries) {
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
  for (const e of entries) {
    let number;
    if (e.existing !== undefined) {
      number = e.existing[0];
      console.log(`carried #${e.existing.join(", #")} ${e.key} ${e.title}`);
      for (const n of e.existing) {
        commentOnce(n, planComment(e));
        linkOnce(linked, n);
      }
    } else {
      number = byTitle.get(e.title);
      if (number === undefined) {
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
      linkOnce(linked, number);
    }
    numbers.set(e.key, number);
  }
}

function writeHeadings(entries) {
  const byTitle = existingByTitle();
  for (const path of [PLAN_A, PLAN_B]) {
    let md = readFileSync(path, "utf8");
    for (const e of entries.filter((x) => x.plan === path)) {
      const number = e.existing?.[0] ?? byTitle.get(e.title);
      if (number === undefined) throw new Error(`no issue for ${e.key}: ${e.title}`);
      const heading = new RegExp(`^(### Task ${e.n}: .*?)(?: \\(#\\d+\\))?$`, "m");
      const bullet = new RegExp(`^(- \\*\\*Task ${e.n}: [^*]*?)(?: \\(#\\d+\\))?(\\.?\\*\\*)`, "m");
      if (heading.test(md)) md = md.replace(heading, `$1 (#${number})`);
      else if (bullet.test(md)) md = md.replace(bullet, `$1 (#${number})$2`);
      else throw new Error(`${path}: no heading for Task ${e.n}`);
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
  for (const e of ENTRIES) {
    const verb =
      e.existing !== undefined ? `would link #${e.existing.join(", #")}` : "would create";
    const extra = e.blockedBy.length ? ` <- ${e.blockedBy.join(",")}` : "";
    console.log(`${verb} ${e.key} [${e.labels.join(",")}] ${e.title}${extra}`);
  }
  console.log(`${ENTRIES.length} entries; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m1-p3-issues.mjs [--apply | --headings]");
  process.exit(2);
}
