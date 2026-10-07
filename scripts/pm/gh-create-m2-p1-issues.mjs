#!/usr/bin/env node
// gh-create-m2-p1-issues.mjs: open M2 P1 (feed) on GitHub (session "M2 P1 planning", Task 0 of
// the two plans below). One issue per plan task, linked as a sub-issue of the phase parent
// "Feed (M2 P1)", which is created here (by exact title) and linked under the M2 milestone parent
// (#88). Carried follow-ups (existing) are never recreated: they are linked under the phase parent
// and get a "Plan: <file> Task <n>" comment. Same logic as gh-create-m2-p0-issues.mjs.
// With --headings, writes "(#n)" into each plan's "### Task <n>:" heading.
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; a plan comment is posted only when no comment has that exact text.
// Fail closed: before any GitHub call, the task headings of each plan (Task 0 excluded) must equal
// the tasks below, and every blocker key must exist.
//
// Usage (Git Bash; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m2-p1-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m2-p1-issues.mjs --apply
//   node scripts/pm/gh-create-m2-p1-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M2 Results and audit";
const MILESTONE_PARENT = 88;
const P1_PARENT_TITLE = "Feed (M2 P1)";
const PLAN_A = "docs/superpowers/plans/2026-10-07-m2-track-a-p1.md";
const PLAN_B = "docs/superpowers/plans/2026-10-07-m2-track-b-p1.md";
const P1_PARENT_BODY = `Phase parent for Feed (M2 Results and audit P1). Progress comes from its sub-issues. Ends at the developer's demo pause.

**Gate:** A6 green; socket-close-mid-dispatch replay test; result-card and builder e2e; smoke 1 to 5 with the HTTP payload check; promote :release (no milestone tag).

Plans: \`${PLAN_A}\` and \`${PLAN_B}\`. Design note: \`docs/design/2026-10-07-result-card-config.md\`. Grid and handoffs: \`docs/superpowers/plans/STATUS.md\`.`;

// [task, title, sensitive, labels, opts]; opts: existing (carried issue), partial, blockedBy, note.
// A carried task has no title of its own (the existing issue keeps its title).
const aTasks = [
  [1, "", true, [], { existing: 576, partial: true }],
  [2, "", true, [], { existing: 565, partial: true }],
  [3, "", true, [], { existing: 561, partial: true }],
  [
    4,
    "GET /api/v1/queries list, newest first, cursor paged (spec 5.1)",
    true,
    [],
    { blockedBy: ["A3"] },
  ],
  [
    5,
    "Replay missed events by lastSeq with caps and resync (FR-065, spec 5.3)",
    true,
    [],
    { blockedBy: ["A3"] },
  ],
  [
    6,
    "Replay after a socket closes mid-dispatch: P1 gate test (spec 10.4)",
    true,
    [],
    { blockedBy: ["A5"] },
  ],
  [
    7,
    "Smoke step 4 checks the returned payload over HTTP (spec 8.7)",
    true,
    [],
    { blockedBy: ["A3"] },
  ],
  [8, "Docs: M2 P1 read routes, replay and result cards", false, [], { blockedBy: ["A5"] }],
  [
    9,
    "M2 P1 release note, gate and promote",
    false,
    [],
    { blockedBy: ["A6", "A7", "A8", "B8", "B13"] },
  ],
];

const bTasks = [
  ["0a", "", false, [], { existing: 587 }],
  ["0b", "", false, [], { existing: 576, partial: true }],
  ["0c", "", false, [], { existing: 586 }],
  [
    1,
    "Design: result cards, builder card and keyword editors, Try a match (FR-060, UX-015, UX-016)",
    false,
    ["design"],
  ],
  [2, "Core: highlight and assessResult (FR-060, UX-010, UX-011, spec 4.5)", false, ["core"]],
  [
    3,
    "Core: mapResponse with precedence, path language and generic dump (spec 4.5)",
    false,
    ["core"],
    { blockedBy: ["B2"] },
  ],
  [
    4,
    "Client: fetch result payloads when sources settle (spec 6.7)",
    false,
    [],
    { blockedBy: ["A3"] },
  ],
  [
    5,
    "Client: replay cursor, resync refetch and list load (spec 5.3, 6.8)",
    false,
    [],
    { blockedBy: ["A4", "A5"] },
  ],
  [
    6,
    "Web UI: result card, severity badge, table and highlight primitives (spec 6.2)",
    false,
    [],
    { blockedBy: ["B1", "B3"] },
  ],
  [
    7,
    "Web: result cards in each request with severity and skip reasons (spec 6.2, 6.6)",
    false,
    [],
    { blockedBy: ["A1", "B4", "B6"] },
  ],
  [
    8,
    "E2E: A6, result cards and replay after a dropped socket (spec 10.2, 10.6)",
    false,
    [],
    { blockedBy: ["B5", "B7", "A6"] },
  ],
  [9, "Builder: result cards and keywords model", false, [], { blockedBy: ["B3"] }],
  [
    10,
    "Builder: result cards editor with live card preview (FR-060, UX-015)",
    false,
    [],
    { blockedBy: ["A2", "B6", "B9"] },
  ],
  [11, "Builder: keywords and severity editor (UX-010, UX-011)", false, [], { blockedBy: ["B9"] }],
  [12, "", false, [], { existing: [565, 572], blockedBy: ["A2"] }],
  [
    13,
    "E2E: result cards configured and published from the builder",
    false,
    [],
    { blockedBy: ["B10", "B11", "B12"] },
  ],
];

const toEntries = (prefix, plan, phaseLabel, trackLabel, tasks) =>
  tasks.map(([n, title, sens, extra = [], opts = {}]) => ({
    key: `${prefix}${n}`,
    plan,
    n,
    title: title || `${plan} Task ${n} (carried)`,
    parent: "P1",
    labels: [...new Set([trackLabel, phaseLabel, ...(sens ? ["sensitive"] : []), ...extra])],
    body: `Plan: ${plan} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: ${sens ? "yes" : "no"}${opts.note ? `\n${opts.note}` : ""}`,
    blockedBy: opts.blockedBy ?? [],
    existing: opts.existing === undefined ? undefined : [opts.existing].flat(),
    partial: opts.partial ?? false,
  }));
const A = toEntries("A", PLAN_A, "p1", "platform", aTasks);
const B = toEntries("B", PLAN_B, "p1", "web", bTasks);

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
  console.log(`check ok: P1 A ${A.length}, P1 B ${B.length} tasks match plan headings`);
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
  let p1 = byTitle.get(P1_PARENT_TITLE);
  if (p1 === undefined) {
    p1 = createIssue(milestone, P1_PARENT_TITLE, P1_PARENT_BODY, ["epic", "p1"]);
    console.log(`created #${p1} phase parent ${P1_PARENT_TITLE}`);
  } else console.log(`exists  #${p1} phase parent ${P1_PARENT_TITLE}`);
  linkOnce(MILESTONE_PARENT, subIssues(MILESTONE_PARENT), p1);
  const parents = { P1: p1 };
  const linked = { P1: subIssues(p1) };
  const numbers = new Map();
  for (const e of entries) {
    let number;
    if (e.existing !== undefined) {
      number = e.existing[0];
      console.log(`carried #${e.existing.join(", #")} ${e.key}`);
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
  for (const path of [PLAN_A, PLAN_B]) {
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

const ENTRIES = dependencyOrder([...A, ...B]);
checkAgainstPlans(ENTRIES);
const mode = process.argv[2];
if (mode === "--apply") apply(ENTRIES);
else if (mode === "--headings") writeHeadings(ENTRIES);
else if (mode === undefined) {
  console.log(`would create or reuse phase parent "${P1_PARENT_TITLE}" under #${MILESTONE_PARENT}`);
  for (const e of ENTRIES) {
    const verb =
      e.existing !== undefined ? `would link #${e.existing.join(", #")}` : "would create";
    const extra = e.blockedBy.length ? ` <- ${e.blockedBy.join(",")}` : "";
    console.log(`${verb} ${e.key} [${e.labels.join(",")}] ${e.title}${extra}`);
  }
  console.log(`${ENTRIES.length} entries; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m2-p1-issues.mjs [--apply | --headings]");
  process.exit(2);
}
