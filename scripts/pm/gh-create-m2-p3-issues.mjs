#!/usr/bin/env node
// gh-create-m2-p3-issues.mjs: open M2 P3 (hardening, the M2 exit) on GitHub (session "M2 P3
// planning", Task 0 of the two plans below). One issue per plan task, linked as a sub-issue of the
// existing phase parent "Hardening (M2 P3)" (#46, found by exact title), which is linked under the
// M2 milestone parent (#88) if it is not already. Carried follow-ups are never recreated: each gets
// a "Plan: <file> Task <n> (this task covers part of this issue)" comment, stays linked under the
// phase parent, and gets the M2 milestone if it has none. #46 itself carries boxes for some tasks;
// it is the parent, so those tasks name it in their body instead of commenting on it.
// PULL_IN issues (#511, #317, #561: still under the closed #45) are linked under #46 with a
// comment pointing at the plan's "Box audit"; they have no task of their own.
// With --headings, appends "(#n)" to each plan's "### Task <n>:" heading. Headings already end
// with carried references such as "(#760)", so the new number is appended, never substituted, and a
// heading that already ends with its own number is left alone (idempotent).
// Blockers name the direct predecessors only; each plan's wave table governs start order.
// Same logic as gh-create-m2-p2-issues.mjs otherwise.
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; a comment is posted only when no comment has that exact text.
// Fail closed: before any GitHub call, the task headings of each plan (Task 0 excluded) must equal
// the tasks below, and every blocker key must exist.
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m2-p3-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m2-p3-issues.mjs --apply
//   node scripts/pm/gh-create-m2-p3-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M2 Results and audit";
const MILESTONE_PARENT = 88;
const P3_PARENT_TITLE = "Hardening (M2 P3)";
const PHASE_PARENT = 46;
const PLAN_A = "docs/superpowers/plans/2026-10-19-m2-track-a-p3.md";
const PLAN_B = "docs/superpowers/plans/2026-10-19-m2-track-b-p3.md";
const PULL_IN = [511, 317, 561];
const PULL_IN_COMMENT = `Box audit 10-19-26: see "Box audit" in ${PLAN_A} (done boxes to tick, M3-deferred boxes to move). Linked under #${PHASE_PARENT} (M2 P3).`;

// [task, title, sensitive, labels, opts]; opts: carried (issues this task covers part of),
// blockedBy, note.
const aTasks = [
  [
    1,
    "Sweeper stops between sessions and skips failed ids (spec 5.2, 8.1)",
    true,
    [],
    { carried: [760] },
  ],
  [
    2,
    "Fatal close stops accepting before it waits for the sweeper (spec 8.1)",
    true,
    [],
    { carried: [760], blockedBy: ["A1"] },
  ],
  [
    3,
    "Admin query read mounts with the owner's read; one query error helper",
    true,
    [],
    { carried: [755, 760] },
  ],
  [
    4,
    "Publish and rollback answers carry publishedByName (D-M2P0-4)",
    true,
    [],
    { carried: [771] },
  ],
  [5, "Server-Timing on the lost idempotency race 202 (NFR-004)", true, [], { carried: [771] }],
  [
    6,
    "Core: wrap long tokenize test comments",
    true,
    ["core"],
    { note: "Carries a box of #46 (tokenize.test.ts:48, also lines 75 and 204)." },
  ],
  [
    7,
    "config:import brings an image's site config to a seeded deploy (CFG-4)",
    true,
    [],
    {
      blockedBy: ["A4"],
      note: "Carries the CFG-4 box of #46. Provisional until D-M2P3-4 is ruled.",
    },
  ],
  [
    8,
    "Client config carries the published versionId for label-only publishes (CFG-1)",
    true,
    [],
    {
      blockedBy: ["A4"],
      note: "Carries the CFG-1 box of #46 (server half). Provisional until D-M2P3-5 is ruled. Contract change: master plan 8.4 row.",
    },
  ],
  [
    9,
    "Refuse a foreign Origin on every REST route (spec 5.3, 10.7)",
    true,
    [],
    { carried: [753], note: "Provisional until #753 (D-M2P3-1) is ruled." },
  ],
  [
    10,
    "Per-account limit on wrong current passwords at change-password (spec 5.6)",
    true,
    [],
    {
      blockedBy: ["A9"],
      note: "Carries the change-password lockout box of #46. Provisional until D-M2P3-3 is ruled.",
    },
  ],
  [11, "M2 security map: every spec 12.7 M2 row has a named test", true, []],
  [12, "ack-stats moves beside the other ops modules", true, [], { carried: [771] }],
  [
    13,
    "add-demo-users keeps the cause and hashes only new accounts",
    true,
    [],
    { carried: [782], blockedBy: ["A12"] },
  ],
  [14, "Board script phaseBodyUpdate edge cases", true, [], { carried: [770] }],
  [
    15,
    "Close the CI and paging watch boxes owned by Track A (#748, G-m4)",
    false,
    [],
    { carried: [748] },
  ],
  [
    16,
    "M2 P3 final board batch: ticks, M3 moves, closes with the m2 promote",
    false,
    [],
    { blockedBy: ["A19"] },
  ],
  [
    17,
    "M2 exit host steps: live smoke and restore test",
    false,
    [],
    {
      blockedBy: ["A8", "A11", "A14"],
      note: "Runs on the Linux deploy host (D-M2P3-10).",
    },
  ],
  [
    18,
    "ADR-0014: replay excludes hidden moves to the M3 P2 gate",
    false,
    [],
    { note: "Provisional until D-M2P3-2 is ruled." },
  ],
  [
    19,
    "M2 release note, docs refresh, gate and promote m2",
    false,
    [],
    { blockedBy: ["A17", "A18", "B10", "B11"] },
  ],
];

const bTasks = [
  [
    1,
    "E2E flakes: admin columns Show in wrap, admin config axe contrast",
    false,
    [],
    { carried: [773] },
  ],
  [
    2,
    "Officer flakes: focus at 800x600, view toggle target at 200% zoom",
    false,
    [],
    { carried: [645] },
  ],
  [
    3,
    "Three full verify runs in a row on Windows; flake watch results",
    false,
    [],
    { carried: [610, 645], blockedBy: ["B1", "B2"] },
  ],
  [4, "Web: offline submit and reconnect refetch (spec 10.4)", false, [], { blockedBy: ["B3"] }],
  [
    5,
    "Web: typing while a result arrives keeps the live region quiet; 10.6 map",
    false,
    [],
    { blockedBy: ["B3"] },
  ],
  [
    6,
    "Web: terminal pane width, scroll, wording and save alert",
    false,
    [],
    { carried: [767], blockedBy: ["B5"] },
  ],
  [7, "Web: close the mockup v6 gaps", false, [], { carried: [774], blockedBy: ["B6"] }],
  [
    8,
    "Web: purged meta line, keyword separators, design note wording",
    false,
    [],
    {
      carried: [754],
      blockedBy: ["B7"],
      note: "Carries the keyword comma box of #46.",
    },
  ],
  [
    9,
    "Web: a label-only publish reaches open clients (CFG-1)",
    false,
    [],
    {
      blockedBy: ["A8"],
      note: "Carries the CFG-1 box of #46 (client half). Provisional until D-M2P3-5 is ruled.",
    },
  ],
  [10, "NVDA and Chrome pass for the M2 exit (spec 10.6)", false, [], { blockedBy: ["B8", "B9"] }],
  [11, "Docs: M2 P3 screens, offline and NVDA results", false, [], { blockedBy: ["B10"] }],
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
const A = toEntries("A", PLAN_A, "p3", "platform", aTasks);
const B = toEntries("B", PLAN_B, "p3", "web", bTasks);

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
  for (const e of all)
    if (e.carried.includes(PHASE_PARENT))
      problems.push(`${e.key}: #${PHASE_PARENT} is the phase parent; name it in the note`);
  if (new Set(all.map((e) => e.title)).size !== all.length) problems.push("duplicate titles");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`check ok: P3 A ${A.length}, P3 B ${B.length} tasks match plan headings`);
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
  const p3 = byTitle.get(P3_PARENT_TITLE);
  if (p3 !== PHASE_PARENT)
    throw new Error(`phase parent "${P3_PARENT_TITLE}" is #${p3}, expected #${PHASE_PARENT}`);
  console.log(`exists  #${p3} phase parent ${P3_PARENT_TITLE}`);
  linkOnce(MILESTONE_PARENT, subIssues(MILESTONE_PARENT), p3);
  const linked = subIssues(p3);
  for (const n of PULL_IN) {
    milestoneOnce(milestone, n);
    linkOnce(p3, linked, n);
    commentOnce(n, PULL_IN_COMMENT);
  }
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
    linkOnce(p3, linked, number);
    numbers.set(e.key, number);
    for (const c of e.carried) {
      milestoneOnce(milestone, c);
      linkOnce(p3, linked, c);
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
      const heading = new RegExp(`^(### Task ${e.n}: .*)$`, "m");
      const found = md.match(heading);
      if (!found) throw new Error(`${path}: no heading for Task ${e.n}`);
      if (found[1].endsWith(` (#${number})`)) continue;
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
  console.log(
    `would reuse phase parent "${P3_PARENT_TITLE}" (#${PHASE_PARENT}) under #${MILESTONE_PARENT}`,
  );
  console.log(
    `would pull in #${PULL_IN.join(", #")} under #${PHASE_PARENT} with a box audit comment`,
  );
  for (const e of ENTRIES) {
    const extra = e.blockedBy.length ? ` <- ${e.blockedBy.join(",")}` : "";
    const carried = e.carried.length ? ` (comment on #${e.carried.join(", #")})` : "";
    console.log(`would create ${e.key} [${e.labels.join(",")}] ${e.title}${extra}${carried}`);
  }
  console.log(`${ENTRIES.length} entries; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m2-p3-issues.mjs [--apply | --headings]");
  process.exit(2);
}
