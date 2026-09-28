#!/usr/bin/env node
// One-off (checker, developer ruling 09-28-26): M0 exit gate item 8 needs no open
// platform p1 issues on "M0 Skeleton". Follow-ups that M0 does not need move out:
// milestone, phase label and sub-issue parent change here; docs/board/board-data.json
// gets the matching edit so gh-setup-project.mjs --apply links the new parents.
// gh-setup-project.mjs never changes a milestone, removes a label or unlinks a
// sub-issue, which is why this script exists.
//
// Usage (as BirchDesignLab): GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/move-m0-followups.mjs [--apply]
import { execFileSync } from "node:child_process";

const REPO = "BirchDesignLab/queryModule";
const APPLY = process.argv.includes("--apply");
const OLD_PARENT = 40; // Foundation (M0 P1), at GitHub's 100 sub-issue cap

// milestone: target milestone title, or null to clear it.
// labels: [remove, add] phase-label swap, or null to keep labels.
const MOVES = [
  { n: 98, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 189, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 225, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 220, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 237, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 171, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 222, milestone: "M1 Forms and terminal", labels: ["p1", "p2"] },
  { n: 66, milestone: "M2 Results and audit", labels: null },
  { n: 70, milestone: "M3 Workflow and compliance", labels: null },
  { n: 77, milestone: null, labels: null },
  { n: 182, milestone: null, labels: null },
];

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024, // the 100-child sub-issue listing is ~1 MB of JSON
  });
}
const api = (path, method = "GET", body) =>
  JSON.parse(
    gh(["api", "-X", method, path, ...(body ? ["--input", "-"] : [])], body ? JSON.stringify(body) : undefined) ||
      "null",
  );

const milestones = new Map(api(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m.number]));
const oldChildren = new Set(api(`repos/${REPO}/issues/${OLD_PARENT}/sub_issues?per_page=100`).map((s) => s.id));

let planned = 0;
const step = (what, fn) => {
  planned += 1;
  console.log(`${APPLY ? "" : "would "}${what}`);
  if (APPLY) fn();
};

for (const m of MOVES) {
  const issue = api(`repos/${REPO}/issues/${m.n}`);
  const want = m.milestone === null ? null : milestones.get(m.milestone);
  if (m.milestone !== null && want === undefined) throw new Error(`no milestone "${m.milestone}"`);
  if ((issue.milestone?.number ?? null) !== want)
    step(`set #${m.n} milestone = ${m.milestone ?? "none"}`, () =>
      api(`repos/${REPO}/issues/${m.n}`, "PATCH", { milestone: want }),
    );
  if (m.labels) {
    const [from, to] = m.labels;
    const have = new Set(issue.labels.map((l) => l.name));
    if (have.has(from))
      step(`remove label ${from} from #${m.n}`, () => gh(["api", "-X", "DELETE", `repos/${REPO}/issues/${m.n}/labels/${from}`]));
    if (!have.has(to))
      step(`add label ${to} to #${m.n}`, () => api(`repos/${REPO}/issues/${m.n}/labels`, "POST", { labels: [to] }));
  }
  if (oldChildren.has(issue.id))
    step(`unlink #${m.n} from #${OLD_PARENT}`, () =>
      api(`repos/${REPO}/issues/${OLD_PARENT}/sub_issue`, "DELETE", { sub_issue_id: issue.id }),
    );
}
console.log(`${APPLY ? "applied" : "planned"} ${planned} change(s)`);
