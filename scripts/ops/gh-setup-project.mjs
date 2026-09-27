#!/usr/bin/env node
// gh-setup-project.mjs: configure the "Query Module 2.0" GitHub Project, labels,
// milestones, phase and wave parent issues, sub-issue links and follow-up issues.
//
// Purpose
//   The backlog is GitHub Issues on BirchDesignLab/queryModule, shown on the
//   user-owned Project #1. This script makes the project-management layer match
//   docs/project-board.md: custom fields (Track, Phase, Wave, Size, Priority,
//   Req IDs), the six Status columns, one parent issue per phase (the STATUS grid
//   rows) with the P0 waves and tasks as sub-issues, follow-up issues for the
//   carries found in review, and field values on every item.
//
// Idempotent
//   Every step reads first and writes only what differs. Existing issues are
//   matched by their recorded issue number (a title change is a rename, #80),
//   fields and options by name. Status, Priority, Start
//   and Finish are only seeded when empty (an issue closed as completed is forced to Done; Done
//   comes from issue state only), so a rerun never undoes project-sync or the
//   developer. Prerequisites (milestones, task issues) are checked before the
//   first write. A wave closes when all its tasks are
//   closed. Safe to run again after editing the data below (for example to add a
//   follow-up).
//
// Usage (PowerShell or bash, repo root)
//   node scripts/ops/gh-setup-project.mjs                 # dry run: reads only, prints the plan
//   node scripts/ops/gh-setup-project.mjs --apply         # writes
//   node scripts/ops/gh-setup-project.mjs --dashboard     # live reads only; writes the two SVGs and
//                                                          # the README picture block, no GitHub writes
//                                                          # (#80 requirement 8)
//   node scripts/ops/gh-setup-project.mjs --as <login>    # gh account to act as (default BirchDesignLab)
//
// Requires
//   gh CLI with the acting account in its keyring (`gh auth status` lists it) and
//   scopes repo and project. The script passes that account's token to each gh
//   call through GH_TOKEN; it never switches the active gh account and never
//   prints a token. Views and built-in project workflows have no API: they are
//   the manual checklist in docs/project-board.md.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELDS,
  KNOWN_LABELS,
  LABELS,
  MILESTONES,
  OWNER,
  PROJECT_NUMBER,
  REMOVE_LABELS,
  REPO,
  STATUS_OPTIONS,
} from "./board-config.mjs";
import { loadBoardDataOrExit } from "./board-data.mjs";
import {
  bodyUpdate,
  closedStatus,
  followUpAdoptionError,
  leafDates,
  matchParent,
  rollUp,
  titleUpdate,
  waveParentStatus,
  waveSpan,
} from "./board-model.mjs";
import { renderDashboard } from "./progress-svg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN = "docs/superpowers/plans/2026-09-25-p0-contracts.md";

// ---------------------------------------------------------------- data
//
// Structural and destructive config (REPO, OWNER, PROJECT_NUMBER,
// REMOVE_LABELS, LABELS, MILESTONES, STATUS_OPTIONS, FIELDS) stays imported
// from board-config.mjs, next to this script (`[gate]`, ADR-0007): a data
// file edit can never delete a label, add a field, or change which repo or
// project is written (Task 604, #92 R2).
//
// Issue content (PHASES, CONTRACTS_M0P0, MILESTONE_PARENT_NUMBERS, WAVES,
// FOLLOW_UPS: titles, bodies, labels, milestone, parent, track, phase,
// number, state) lives in docs/board/board-data.json, outside `[gate]`
// (Task 604 R1): recording an issue number or adding a follow-up is now an
// ordinary change. Validated here, before the first gh call or GitHub read
// (dry run included), fail closed with a JSON pointer per error (R3).
const BOARD_DATA_PATH = resolve(ROOT, "docs/board/board-data.json");
const boardData = loadBoardDataOrExit(BOARD_DATA_PATH, {
  milestoneNames: Object.keys(MILESTONES),
  labelNames: KNOWN_LABELS,
  fields: FIELDS,
});

// Human-readable titles; codes live in fields (Level, Phase, Wave), never in
// the title (developer decision, #80). Matched to GitHub by `number`
// (recorded 09-26-26, .superpowers/sdd/2026-09-25-p0-contracts/task-W5B-mapping.md),
// never by title: a title below that differs from GitHub is a planned rename
// (matchParent, titleUpdate in board-model.mjs).
const PHASES = boardData.phases;
const CONTRACTS_M0P0 = boardData.contractsM0P0;

// Five milestone parents (label epic, milestone set): title is the milestone
// name (developer decision, #80). Numbers recorded from the first --apply
// (09-26-26); a new milestone starts at null until the script creates it.
const MILESTONE_PARENT_NUMBERS = boardData.milestoneParentNumbers;
const MILESTONE_PARENTS = Object.keys(MILESTONES).map((title) => ({
  number: MILESTONE_PARENT_NUMBERS[title] ?? null,
  title,
}));

// P0 waves (plan "## Waves"). Task N is issue #N+1. Numbers #55 to #60
// recorded 09-26-26 (task-W5B-mapping.md); titles are the wave parent titles
// from the #80 developer decision (human-readable, matched by number).
const WAVES = boardData.waves;

// Found in review or a ruling; carried to a later task, phase or track
// (docs/project-board.md). See docs/board/board-data.json for the full list
// and every follow-up's title and body.
const FOLLOW_UPS = boardData.followUps;

// ---------------------------------------------------------------- gh plumbing

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
// --dashboard: live gh api reads only, writes the two committed SVGs and the
// README picture block, no GitHub writes at all (task-W5B-carries W5B-2; #80
// requirement 8). Mutually exclusive with --apply, so a single invocation is
// never both "writes GitHub" and "read-only dashboard regen".
const DASHBOARD = argv.includes("--dashboard");
const asAt = argv.indexOf("--as");
const AS = asAt >= 0 ? argv[asAt + 1] : "BirchDesignLab";
const USAGE = "usage: node scripts/ops/gh-setup-project.mjs [--apply | --dashboard] [--as <login>]";
if (!AS || AS.startsWith("--")) {
  console.error(`--as needs a login; ${USAGE}`);
  process.exit(2);
}
if (APPLY && DASHBOARD) {
  console.error(`--apply and --dashboard are mutually exclusive; ${USAGE}`);
  process.exit(2);
}
const known = new Set(["--apply", "--dashboard", "--as", AS]);
for (const a of argv) {
  if (!known.has(a)) {
    console.error(`unknown argument ${a}; ${USAGE}`);
    process.exit(2);
  }
}

const tok = spawnSync("gh", ["auth", "token", "-u", AS], { encoding: "utf8" });
if (tok.status !== 0 || !tok.stdout.trim()) {
  console.error(`gh has no token for ${AS}; run gh auth login for that account first`);
  process.exit(2);
}
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || "").trim()}`);
  return r.stdout;
}
function rest(path, method = "GET", body) {
  const args = ["api", path, "--method", method];
  if (body) args.push("--input", "-");
  const out = gh(args, body ? JSON.stringify(body) : undefined);
  return out.trim() ? JSON.parse(out) : null;
}
const restAll = (path) => JSON.parse(gh(["api", path, "--paginate", "--slurp"])).flat();
function gql(query, variables = {}) {
  const out = JSON.parse(
    gh(["api", "graphql", "--input", "-"], JSON.stringify({ query, variables })),
  );
  if (out.errors) throw new Error(`graphql: ${out.errors.map((e) => e.message).join("; ")}`);
  return out.data;
}

let writes = 0;
function write(what, fn) {
  writes += 1;
  if (!APPLY) {
    console.log(`would ${what}`);
    return undefined;
  }
  console.log(`${what}`);
  const r = fn();
  pause(400);
  return r;
}

// ---------------------------------------------------------------- run

const login = rest("user").login;
if (login !== AS) {
  console.error(`token for ${AS} resolves to ${login}; stopping`);
  process.exit(2);
}
console.log(
  `acting as ${AS} on ${REPO} and project ${OWNER}#${PROJECT_NUMBER} (${APPLY ? "apply" : "dry run"})`,
);

// Prerequisites, checked before the first write so a fresh repo or project stops cleanly.
const milestones = new Map(
  restAll(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m]),
);
for (const title of Object.keys(MILESTONES)) {
  if (!milestones.has(title))
    throw new Error(`milestone "${title}" missing; run scripts/ops/gh-setup-labels.sh first`);
}
// Keyed by issue number (developer decision, #80: matching is by number, never
// by title). issuesByTitle is a second index used only for the number:null
// duplicate guard in ensureIssue (a milestone parent not yet created has no
// number to match by).
const issues = new Map(
  restAll(`repos/${REPO}/issues?state=all&per_page=100`)
    .filter((i) => !i.pull_request)
    .map((i) => [i.number, i]),
);
const issuesByTitle = new Map([...issues.values()].map((i) => [i.title, i]));
const byNumber = (n) => issues.get(n);
// #96 G-M4: fail closed before any write if a follow-up number points at a live
// issue that is not labelled follow-up.
{
  const adoption = followUpAdoptionError(FOLLOW_UPS, byNumber);
  if (adoption) throw new Error(adoption);
}
{
  const missing = [];
  for (const w of WAVES)
    for (let t = w.tasks[0]; t <= w.tasks[1]; t += 1)
      if (!byNumber(t + 1)) missing.push(`#${t + 1}`);
  if (missing.length > 0) {
    const m = `task issues missing: ${missing.join(", ")}; create the P0 task issues first`;
    if (APPLY) throw new Error(m);
    console.log(`warning: ${m}`);
  }
}

// Leaf and roll-up Start/Finish (developer decision, #80 requirements 4-7),
// from live issue state, using the same board-model.mjs functions
// project-sync's inline copy mirrors (scripts/ci/project-sync.test.ts parity
// test). Task N is issue #N+1; wave parents roll up their tasks; the
// Contracts (M0 P0) phase parent rolls up its P0 wave parents (the only
// phase with wave children so far); milestone parents roll up their phase
// parents. A parent with no dated child (no wave children yet) keeps no
// dates, same as project-sync. These child sets come from the data above, not
// from live `parent` links as in project-sync (which also counts follow-ups
// under their parent), and the values only seed empty Start/Finish; project-sync
// recomputes both on its next run (PR #83 review M2).
const datesByNumber = new Map();
for (const w of WAVES)
  for (let t = w.tasks[0]; t <= w.tasks[1]; t += 1) {
    const issue = byNumber(t + 1);
    if (issue)
      datesByNumber.set(issue.number, { ...leafDates(issue), closed: issue.state === "closed" });
  }
for (const f of FOLLOW_UPS) {
  const issue = f.number ? byNumber(f.number) : undefined;
  if (issue)
    datesByNumber.set(issue.number, { ...leafDates(issue), closed: issue.state === "closed" });
}
for (const w of WAVES) {
  const issue = byNumber(w.number);
  if (!issue) continue;
  const children = [];
  for (let t = w.tasks[0]; t <= w.tasks[1]; t += 1) {
    const c = byNumber(t + 1);
    if (c) children.push(datesByNumber.get(c.number));
  }
  datesByNumber.set(issue.number, { ...rollUp(children), closed: issue.state === "closed" });
}
for (const phase of PHASES) {
  const issue = byNumber(phase.number);
  if (!issue) continue;
  const children =
    phase.number === CONTRACTS_M0P0 ? WAVES.map((w) => datesByNumber.get(w.number)) : [];
  datesByNumber.set(issue.number, { ...rollUp(children), closed: issue.state === "closed" });
}
for (const mp of MILESTONE_PARENTS) {
  const issue = mp.number ? byNumber(mp.number) : undefined;
  if (!issue) continue;
  const children = PHASES.filter((p) => p.milestone === mp.title).map((p) =>
    datesByNumber.get(p.number),
  );
  datesByNumber.set(issue.number, { ...rollUp(children), closed: issue.state === "closed" });
}

// Labels
const labels = new Map(restAll(`repos/${REPO}/labels?per_page=100`).map((l) => [l.name, l]));
for (const name of REMOVE_LABELS) {
  if (labels.has(name))
    write(`delete label "${name}"`, () => gh(["label", "delete", name, "--repo", REPO, "--yes"]));
}
for (const l of LABELS) {
  const cur = labels.get(l.name);
  if (cur && cur.color.toLowerCase() === l.color.toLowerCase() && cur.description === l.description)
    continue;
  write(`${cur ? "update" : "create"} label "${l.name}"`, () =>
    gh([
      "label",
      "create",
      l.name,
      "--repo",
      REPO,
      "--color",
      l.color,
      "--description",
      l.description,
      "--force",
    ]),
  );
}

// Milestones (existence checked above)
for (const [title, description] of Object.entries(MILESTONES)) {
  const m = milestones.get(title);
  if (m.description !== description) {
    write(`describe milestone "${title}"`, () =>
      rest(`repos/${REPO}/milestones/${m.number}`, "PATCH", { description }),
    );
  }
}

// Project and fields
const PROJECT_Q = `query($o:String!,$n:Int!){user(login:$o){projectV2(number:$n){id shortDescription readme
  fields(first:50){nodes{__typename ... on ProjectV2FieldCommon{id name dataType}
  ... on ProjectV2SingleSelectField{options{id name color description}}}}}}}`;
const loadProject = () => gql(PROJECT_Q, { o: OWNER, n: PROJECT_NUMBER }).user.projectV2;
let project = loadProject();

const README = readFileSync(resolve(ROOT, "docs/project-board.md"), "utf8")
  .split("\n## Manual steps")[0]
  .trim();
const SHORT =
  "Query Module 2.0: CAD query module prototype. Milestones M0 to M4, phases, P0 waves; mock data only.";
if (project.shortDescription !== SHORT || project.readme !== README) {
  write("update project description and readme", () =>
    gql(
      `mutation($p:ID!,$s:String!,$r:String!){updateProjectV2(input:{projectId:$p,shortDescription:$s,readme:$r}){projectV2{id}}}`,
      { p: project.id, s: SHORT, r: README },
    ),
  );
}

const sameOptions = (a, b) =>
  a.length === b.length &&
  a.every(
    (o, i) =>
      o.name === b[i].name && o.color === b[i].color && (o.description ?? "") === b[i].description,
  );

function ensureSelect(name, options) {
  const cur = project.fields.nodes.find((f) => f.name === name);
  if (cur && cur.dataType !== "SINGLE_SELECT")
    throw new Error(`field ${name} exists with type ${cur.dataType}`);
  if (!cur) {
    write(`create field ${name} (${options.map((o) => o.name).join(", ")})`, () =>
      gql(
        `mutation($p:ID!,$n:String!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$n,singleSelectOptions:$o}){projectV2Field{... on ProjectV2FieldCommon{id}}}}`,
        { p: project.id, n: name, o: options },
      ),
    );
    return;
  }
  if (sameOptions(cur.options, options)) return;
  // Keep existing option ids so current item values and workflow targets survive.
  const withIds = options.map((o) => {
    const old = cur.options.find((x) => x.name === o.name);
    return old ? { ...o, id: old.id } : o;
  });
  write(`update field ${name} options to ${options.map((o) => o.name).join(", ")}`, () =>
    gql(
      `mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on ProjectV2FieldCommon{id}}}}`,
      { f: cur.id, o: withIds },
    ),
  );
}
ensureSelect("Status", STATUS_OPTIONS);
for (const f of FIELDS) {
  if (f.options) ensureSelect(f.name, f.options);
  else if (!project.fields.nodes.some((x) => x.name === f.name)) {
    write(`create text field ${f.name}`, () =>
      gql(
        `mutation($p:ID!,$n:String!){createProjectV2Field(input:{projectId:$p,dataType:TEXT,name:$n}){projectV2Field{... on ProjectV2FieldCommon{id}}}}`,
        { p: project.id, n: f.name },
      ),
    );
  }
}
for (const name of ["Start", "Finish"]) {
  const cur = project.fields.nodes.find((x) => x.name === name);
  if (cur && cur.dataType !== "DATE")
    throw new Error(`field ${name} exists with type ${cur.dataType}`);
  if (!cur) {
    write(`create date field ${name}`, () =>
      gql(
        `mutation($p:ID!,$n:String!){createProjectV2Field(input:{projectId:$p,dataType:DATE,name:$n}){projectV2Field{... on ProjectV2FieldCommon{id}}}}`,
        { p: project.id, n: name },
      ),
    );
  }
}
if (APPLY) project = loadProject();

// Issues (loaded with the prerequisites above)
// Matched by issue `number` (developer decision, #80: match before any
// rename), never by title. A spec with `number: null` (the five milestone
// parents, not created yet) always creates; once created, record the number
// it prints in the data above so the next run matches it.
function ensureIssue(spec) {
  let issue = matchParent(spec, byNumber);
  // A milestone parent (spec.number === null) is created once. Before POSTing,
  // check for one already created by an earlier --apply run whose number was
  // never recorded back into the data (for example a mid-run throw after the
  // create but before this line printed): matched by title, since that is the
  // only handle a number:null spec has.
  let matchedUnrecordedParent = false;
  if (!issue && spec.number === null && issuesByTitle.has(spec.title)) {
    issue = issuesByTitle.get(spec.title);
    matchedUnrecordedParent = true;
  }
  if (!issue) {
    const body = {
      title: spec.title,
      body: spec.body,
      labels: spec.labels,
      milestone: milestones.get(spec.milestone)?.number,
      ...(spec.assignee ? { assignees: [spec.assignee] } : {}),
    };
    issue = write(`create issue "${spec.title}"`, () => rest(`repos/${REPO}/issues`, "POST", body));
    if (issue) {
      issues.set(issue.number, issue);
      issuesByTitle.set(issue.title, issue);
      if (spec.number === null)
        console.log(`record number #${issue.number} for "${spec.title}" in the setup-script data`);
    }
  } else {
    if (matchedUnrecordedParent)
      console.log(`record number #${issue.number} for "${spec.title}" in the setup-script data`);
    const nextTitle = titleUpdate(issue.title, spec.title);
    if (nextTitle !== null) {
      write(`rename #${issue.number} to "${nextTitle}"`, () =>
        rest(`repos/${REPO}/issues/${issue.number}`, "PATCH", { title: nextTitle }),
      );
    }
    const have = new Set(issue.labels.map((l) => l.name));
    const missing = spec.labels.filter((l) => !have.has(l));
    if (missing.length > 0) {
      write(`add labels ${missing.join(", ")} to #${issue.number}`, () =>
        rest(`repos/${REPO}/issues/${issue.number}/labels`, "POST", { labels: missing }),
      );
    }
    // Body edits to the data below (for example wording fixed after review) never
    // reached GitHub before; sync them here, compared after normalising line
    // endings so an unchanged rerun plans 0 writes (#79 item 3).
    const nextBody = bodyUpdate(issue.body ?? "", spec.body ?? "");
    if (nextBody !== null) {
      write(`update body of #${issue.number} "${spec.title}"`, () =>
        rest(`repos/${REPO}/issues/${issue.number}`, "PATCH", { body: nextBody }),
      );
    }
  }
  if (issue && spec.closed && issue.state === "open") {
    write(`close #${issue.number} "${spec.title}" as completed`, () =>
      rest(`repos/${REPO}/issues/${issue.number}`, "PATCH", {
        state: "closed",
        state_reason: "completed",
      }),
    );
    // Keep the local copy current so later readers (dashboardModel) see it closed.
    if (APPLY) {
      issue.state = "closed";
      issue.state_reason = "completed";
    }
  }
  return issue;
}

const subCache = new Map();
function ensureChild(parent, child, childLabel) {
  if (!parent || !child) {
    if (APPLY) throw new Error(`cannot link ${childLabel}: parent or child issue not found`);
    write(`link ${childLabel} under its parent`, () => {});
    return;
  }
  if (!subCache.has(parent.number)) {
    subCache.set(
      parent.number,
      new Set(
        restAll(`repos/${REPO}/issues/${parent.number}/sub_issues?per_page=100`).map((s) => s.id),
      ),
    );
  }
  if (subCache.get(parent.number).has(child.id)) return;
  write(`link #${child.number} under #${parent.number}`, () =>
    rest(`repos/${REPO}/issues/${parent.number}/sub_issues`, "POST", {
      sub_issue_id: child.id,
      replace_parent: true,
    }),
  );
}

const statusDocs = "`docs/superpowers/plans/STATUS.md`";

// Five milestone parents (label epic, milestone set, #80 requirement 2).
// Phase parents become their sub-issues; "No Parent issue" then holds only
// these. Numbers are null until first created; the script prints each
// number so the controller can record it here.
const milestoneParentIssue = new Map();
for (const mp of MILESTONE_PARENTS) {
  const issue = ensureIssue({
    number: mp.number,
    title: mp.title,
    labels: ["epic"],
    milestone: mp.title,
    body: `Milestone parent for ${mp.title}. Progress comes from its sub-issues (the phase parents).\n\nGrid and handoffs: ${statusDocs}.`,
  });
  milestoneParentIssue.set(mp.title, issue);
}

const phaseIssue = new Map();
for (const p of PHASES) {
  const planLine = p.plan
    ? `Plan: \`docs/superpowers/plans/${p.plan}\`.`
    : "Plan: written at phase start (master plan 6.1).";
  const name = p.title.replace(/ \([^)]*\)$/, "");
  const issue = ensureIssue({
    number: p.number,
    title: p.title,
    labels: ["epic", p.phase.toLowerCase()],
    milestone: p.milestone,
    body: `Phase parent for ${name} (${p.milestone} ${p.phase}). Progress comes from its sub-issues.\n\n**Gate:** ${p.gate}.\n\n${planLine} Grid and handoffs: ${statusDocs}.`,
  });
  phaseIssue.set(p.number, issue);
  ensureChild(milestoneParentIssue.get(p.milestone), issue, p.title);
}

const waveIssue = new Map();
for (const w of WAVES) {
  const tasks = `Tasks ${w.tasks[0]} to ${w.tasks[1]} (issues #${w.tasks[0] + 1} to #${w.tasks[1] + 1})`;
  const issue = ensureIssue({
    number: w.number,
    title: w.title,
    labels: ["epic", "p0"],
    milestone: "M0 Skeleton",
    // Closing a wave parent stays with project-sync (docs/project-board.md,
    // "a wave parent closes when all of its tasks are closed"); the setup
    // script never requests a close here (critic:I1).
    body: `P0 wave ${w.k}: ${tasks}, one PR per wave (ADR-0006).${w.pr ? ` PR #${w.pr}.` : ""}\n\nWave map: \`${PLAN}\` section "Waves".`,
  });
  waveIssue.set(w.number, issue);
  ensureChild(phaseIssue.get(CONTRACTS_M0P0), issue, w.title);
  for (let t = w.tasks[0]; t <= w.tasks[1]; t += 1)
    ensureChild(issue, byNumber(t + 1), `#${t + 1}`);
}

const followUps = new Map();
for (const f of FOLLOW_UPS) {
  const issue = ensureIssue(f);
  followUps.set(f.number, issue);
  const parent = phaseIssue.get(f.parent) ?? waveIssue.get(f.parent);
  ensureChild(parent, issue, `"${f.title}"`);
}

// Field values
const planText = readFileSync(resolve(ROOT, PLAN), "utf8").split("\n");
const taskLines = new Map();
{
  const heads = planText.map((l, i) => [/^### Task (\d+):/.exec(l)?.[1], i]).filter(([n]) => n);
  const end = planText.findIndex((l) => l.startsWith("## Gate check"));
  heads.forEach(([n, i], k) => {
    taskLines.set(Number(n), (heads[k + 1]?.[1] ?? end) - i);
  });
}
const sizeOf = (lines) => (lines <= 150 ? "S" : lines <= 300 ? "M" : lines <= 450 ? "L" : "XL");
const trackOf = (names) =>
  names.includes("core")
    ? "Core"
    : names.includes("web")
      ? "Web (B)"
      : names.includes("mobile")
        ? "Mobile (D)"
        : names.includes("platform")
          ? "Platform (A)"
          : null;

function desired(issue) {
  const names = issue.labels.map((l) => l.name);
  const v = {};
  const task = issue.number >= 2 && issue.number <= 29 ? issue.number - 1 : null;
  if (task) {
    const w = WAVES.find((x) => task >= x.tasks[0] && task <= x.tasks[1]);
    v.Level = "Task";
    v.Track = trackOf(names);
    v.Phase = "P0";
    v.Wave = `W${w.k}`;
    v.Size = sizeOf(taskLines.get(task) ?? 0);
    v["Req IDs"] = /\(([^)]*)\)\s*$/.exec(issue.title)?.[1] ?? "";
    // Done only from issue state; an open task in a finished wave is project-sync's.
    if (issue.state === "closed") {
      const done = closedStatus(issue);
      if (done) v.Status = done;
    } else v.Status = { review: "In Review", ready: "Ready", todo: "Todo" }[w.state];
    if (issue.state === "open") v.Priority = "High";
    // Leaf dates (#80 requirement 4): Start = created date, Finish = closed
    // date only when closed as completed, both clamped to the 2026-09-25
    // floor (board-model.mjs leafDates, datesByNumber above).
    const dates = datesByNumber.get(issue.number);
    if (dates?.start) v.Start = dates.start;
    if (dates?.finish) v.Finish = dates.finish;
    return v;
  }
  const milestoneParent = MILESTONE_PARENTS.find((mp) => mp.number === issue.number);
  if (milestoneParent) {
    v.Level = "Milestone";
    v.Status = milestoneParent.title === "M0 Skeleton" ? "In Progress" : "Todo";
    const dates = datesByNumber.get(issue.number);
    if (dates?.start) v.Start = dates.start;
    if (dates?.finish) v.Finish = dates.finish;
    return v;
  }
  const phase = PHASES.find((p) => p.number === issue.number);
  if (phase) {
    v.Level = "Phase";
    v.Phase = phase.phase;
    v.Status = phase.number === CONTRACTS_M0P0 ? "In Progress" : "Todo";
    const dates = datesByNumber.get(issue.number);
    if (dates?.start) v.Start = dates.start;
    if (dates?.finish) v.Finish = dates.finish;
    return v;
  }
  const wave = WAVES.find((w) => w.number === issue.number);
  if (wave) {
    v.Level = "Wave";
    v.Phase = "P0";
    v.Wave = `W${wave.k}`;
    // Done comes only from the issue's own state; every task closed is not enough
    // on its own (that transition is project-sync's, #79 item 1).
    v.Status = waveParentStatus(issue, wave.state);
    // Parent roll-up (#80 requirement 5): earliest child Start, latest child
    // Finish once every task is closed (else the latest date so far).
    const dates = datesByNumber.get(issue.number);
    if (dates?.start) v.Start = dates.start;
    if (dates?.finish) v.Finish = dates.finish;
    return v;
  }
  const f = FOLLOW_UPS.find((x) => x.number === issue.number);
  if (f) {
    v.Level = "Follow-up";
    if (f.track) v.Track = f.track;
    v.Phase = f.phase;
    v.Size = f.size;
    v.Priority = f.priority;
    v["Req IDs"] = f.reqIds;
    if (issue.state === "open") v.Status = "Todo";
    else {
      const done = closedStatus(issue);
      if (done) v.Status = done;
    }
    const dates = datesByNumber.get(issue.number);
    if (dates?.start) v.Start = dates.start;
    if (dates?.finish) v.Finish = dates.finish;
    return v;
  }
  return null;
}

const ITEMS_Q = `query($p:ID!,$after:String){node(id:$p){... on ProjectV2{items(first:100,after:$after){
  pageInfo{hasNextPage endCursor} nodes{id content{... on Issue{number}}
  fieldValues(first:30){nodes{__typename
    ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}
    ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}}
    ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{name}}}}}}}}}}`;
function loadItems() {
  const out = new Map();
  for (let after = null; ; ) {
    const page = gql(ITEMS_Q, { p: project.id, after }).node.items;
    for (const it of page.nodes) {
      if (!it.content?.number) continue;
      const values = {};
      for (const fv of it.fieldValues.nodes) {
        if (fv.field?.name) values[fv.field.name] = fv.name ?? fv.text ?? fv.date;
      }
      out.set(it.content.number, { id: it.id, values });
    }
    if (!page.pageInfo.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}
let items = loadItems();

const fieldByName = (n) => project.fields.nodes.find((f) => f.name === n);
const all = [...issues.values()].sort((a, b) => a.number - b.number);
for (const issue of all) {
  const want = desired(issue);
  if (!want) continue;
  let item = items.get(issue.number);
  if (!item) {
    const added = write(`add #${issue.number} to the project`, () =>
      gql(
        `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
        { p: project.id, c: issue.node_id },
      ),
    );
    item = { id: added?.addProjectV2ItemById.item.id, values: {} };
  }
  for (const [name, value] of Object.entries(want)) {
    if (value === undefined || value === null || value === "") continue;
    if (item.values[name] === value) continue;
    // Status, Priority, Start and Finish are seeded once; project-sync and the developer
    // own them after that. Only a closed-as-completed issue is forced to Done
    // (waveParentStatus, #79 item 1); a wave parent whose tasks are all closed but
    // is itself still open is not.
    const seedOnly =
      name === "Priority" ||
      name === "Start" ||
      name === "Finish" ||
      (name === "Status" && value !== "Done");
    if (seedOnly && item.values[name]) continue;
    const field = fieldByName(name);
    let v;
    if (field?.options) {
      const opt = field.options.find((o) => o.name === value);
      if (!opt && APPLY) throw new Error(`field ${name} has no option ${value}`);
      v = opt ? { singleSelectOptionId: opt.id } : null;
    } else if (name === "Start" || name === "Finish") v = { date: value };
    else v = { text: value };
    write(`set #${issue.number} ${name} = ${value}`, () =>
      gql(
        `mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){projectV2Item{id}}}`,
        { p: project.id, i: item.id, f: field.id, v },
      ),
    );
  }
}

// Reload the live field values this run just wrote (Status, Priority, Start,
// Finish) so dashboardModel() below reflects what --apply just set, not the
// pre-run snapshot captured before the write loop. Mirrors the deleted
// progressBlock()'s `APPLY ? loadItems() : items` (r2:new-1); a dry run or
// --dashboard alone makes no field-value writes, so the pre-run snapshot is
// already current and reloading is skipped.
items = APPLY ? loadItems() : items;

// README progress block: an SVG dashboard (README option B, #80 requirement
// 8), regenerated from live data between markers. Superseded the earlier
// Mermaid flowchart/gantt/pie block (#80: "replaces the Mermaid block ...
// with a <picture>").
const README_PATH = resolve(ROOT, "README.md");
const ASSET_PATH = {
  light: "docs/assets/progress-light.svg",
  dark: "docs/assets/progress-dark.svg",
};
const START =
  "<!-- progress:start (generated by scripts/ops/gh-setup-project.mjs; do not edit) -->";
const END = "<!-- progress:end -->";

/**
 * A wave's PR and its commits, for waveSpan (#85, #92 R6). Read only from
 * dashboardModel, and only under --dashboard: a plain dry run or --apply
 * alone never fetches a PR's commits, so this is the one live-read path the
 * merged-wave span adds.
 *
 * @param {number} prNumber
 */
function fetchPrSpan(prNumber) {
  const pr = rest(`repos/${REPO}/pulls/${prNumber}`);
  const commits = restAll(`repos/${REPO}/pulls/${prNumber}/commits?per_page=100`);
  return { merged: pr.merged, merged_at: pr.merged_at, commits };
}

/**
 * Build the progress-svg.mjs model from live data: milestone and phase
 * sub-issue progress, the P0 wave timeline (a merged wave's first-commit-to-
 * merge span, else the same roll-up as datesByNumber above; #85, #92 R6),
 * open decisions (label `decision`) and task/follow-up counts by board
 * Status (#80 requirement 8).
 */
function dashboardModel() {
  const allIssues = [...issues.values()];
  const milestones = Object.keys(MILESTONES).map((title) => {
    const msIssues = allIssues.filter((i) => i.milestone?.title === title);
    const phases = PHASES.filter((p) => p.milestone === title).map((p) => {
      const issue = byNumber(p.number);
      const sum = issue ? rest(`repos/${REPO}/issues/${issue.number}`).sub_issues_summary : null;
      return { title: p.title, closed: sum?.completed ?? 0, total: sum?.total ?? 0 };
    });
    return {
      title,
      closed: msIssues.filter((i) => i.state === "closed").length,
      total: msIssues.length,
      phases,
    };
  });
  const waves = WAVES.map((w) => {
    const d = datesByNumber.get(w.number) ?? {};
    const rolled = { start: d.start ?? null, finish: d.finish ?? null };
    // Live pulls/commits reads only under --dashboard (R6); a plain dry run
    // or --apply alone keeps today's roll-up, same as before this task.
    const span = DASHBOARD && w.pr ? waveSpan(rolled, fetchPrSpan(w.pr)) : rolled;
    return {
      k: w.k,
      title: w.title.replace(/^Wave \d+: /, "").replace(/ \(Tasks[^)]*\)$/, ""),
      start: span.start,
      finish: span.finish,
    };
  });
  const decisions = allIssues
    .filter((i) => i.state === "open" && i.labels.some((l) => (l.name ?? l) === "decision"))
    .map((i) => ({ number: i.number, title: i.title }))
    .sort((a, b) => a.number - b.number);
  const counts = new Map(STATUS_OPTIONS.map((o) => [o.name, 0]));
  for (const i of allIssues) {
    if (i.labels.some((l) => (l.name ?? l) === "epic")) continue;
    const st = items.get(i.number)?.values.Status;
    if (st && counts.has(st)) counts.set(st, counts.get(st) + 1);
  }
  const statusCounts = [...counts]
    .filter(([, n]) => n > 0)
    .map(([status, count]) => ({ status, count }));
  return {
    asOf: new Date().toISOString().slice(0, 10),
    milestones,
    waves,
    decisions,
    statusCounts,
  };
}

// Local file writes (the two SVGs and README) run under --apply or
// --dashboard; --dashboard makes no GitHub writes (`write()` above stays
// gated on APPLY alone), so this is the only write path it takes
// (task-W5B-carries W5B-2, #80 requirement 8).
function writeLocalFile(what, fn) {
  writes += 1;
  if (!(APPLY || DASHBOARD)) {
    console.log(`would ${what}`);
    return undefined;
  }
  console.log(what);
  return fn();
}

{
  const model = dashboardModel();
  for (const theme of ["light", "dark"]) {
    const svg = renderDashboard(model, theme);
    writeLocalFile(`write ${ASSET_PATH[theme]}`, () =>
      writeFileSync(resolve(ROOT, ASSET_PATH[theme]), `${svg}\n`),
    );
  }
  const totalIssues = model.milestones.reduce((n, m) => n + m.total, 0);
  const closedIssues = model.milestones.reduce((n, m) => n + m.closed, 0);
  const summary = `As of ${model.asOf}: ${closedIssues}/${totalIssues} issues closed across ${model.milestones.length} milestones. Full dashboard: the image above (or docs/project-board.md).`;
  const alt = summary.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const picture = [
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="${ASSET_PATH.dark}">`,
    `  <img src="${ASSET_PATH.light}" alt="${alt}">`,
    "</picture>",
    "",
    summary,
  ].join("\n");
  const readme = readFileSync(README_PATH, "utf8");
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error("README.md has no progress markers");
  const next = `${readme.slice(0, a + START.length)}\n\n${picture}\n\n${readme.slice(b)}`;
  if (next !== readme) {
    writeLocalFile("update the README progress block", () => writeFileSync(README_PATH, next));
    if (APPLY || DASHBOARD) console.log("README.md changed locally; commit it");
  }
}

console.log(
  `${APPLY ? "applied" : DASHBOARD ? "regenerated dashboard," : "planned"} ${writes} change(s)`,
);
// These writes trigger no project-sync event; one manual run lets the board job
// roll up and close wave parents now that the Level field exists (PR #83 review M1).
if (APPLY)
  console.log("next: gh workflow run project-sync.yml (one board reconcile after --apply)");
