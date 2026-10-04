// m1-close-2026-10-04.mjs: close M1 on GitHub after the M1 exit (PR #517, merged as 76464d8,
// `m1` promoted by promote.yml run 37241619560), as BirchDesignLab (session "M2 planning 1").
//
// Does: closes epics #41 (Engine, M1 P2) and #42 (Flow, M1 P3), then the milestone parent #87,
// each as completed with a one-line comment; closes the "M1 Forms and terminal" milestone; and
// comments on #237 (closed by #517) that the manual m1 smoke, step 3 included, waits for the
// developer's next host visit.
// Guards (checked before any write): the milestone's only open issues are the three epics, and
// #41, #42 and #87 have no open sub-issues besides each other. Closed items are skipped and the
// #237 comment carries a marker, so a rerun is a no-op.
// Usage (repo root): node scripts/board/m1-close-2026-10-04.mjs [--apply]
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M1 Forms and terminal";
const EPICS = [41, 42, 87]; // children first: #87 is the parent of #41 and #42
const tok = spawnSync("gh", ["auth", "token", "-u", "BirchDesignLab"], { encoding: "utf8" });
if (tok.status !== 0) throw new Error("no gh token for BirchDesignLab");
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
const api = (path, method = "GET", body) =>
  JSON.parse(
    gh(
      ["api", path, "--method", method, ...(body ? ["--input", "-"] : [])],
      body ? JSON.stringify(body) : undefined,
    ) || "null",
  );
const listAll = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

let changes = 0;
const plan = (what, fn) => {
  changes += 1;
  console.log(`${APPLY ? "" : "would "}${what}`);
  if (APPLY) fn();
};

// Guards
const milestone = listAll(`repos/${REPO}/milestones?state=all&per_page=100`).find(
  (m) => m.title === MILESTONE,
);
if (!milestone) throw new Error(`milestone "${MILESTONE}" missing`);
const openInMilestone = listAll(
  `repos/${REPO}/issues?milestone=${milestone.number}&state=open&per_page=100`,
).map((i) => i.number);
const strays = openInMilestone.filter((n) => !EPICS.includes(n));
if (strays.length > 0)
  throw new Error(`milestone still has open issues besides the epics: #${strays.join(", #")}`);
for (const n of EPICS) {
  const open = listAll(`repos/${REPO}/issues/${n}/sub_issues?per_page=100`)
    .filter((s) => s.state === "open" && !EPICS.includes(s.number))
    .map((s) => s.number);
  if (open.length > 0) throw new Error(`#${n} has open sub-issues: #${open.join(", #")}`);
}

// Epics
const EXIT_NOTE =
  "M1 exit: PR #517 merged as 76464d8 and `m1` promoted from it (promote.yml run 37241619560, 10-04-26). Remaining M1 minors are carried in #511 (M2).";
for (const n of EPICS) {
  const issue = api(`repos/${REPO}/issues/${n}`);
  if (issue.state === "closed") continue;
  plan(`close #${n} "${issue.title}" as completed, with the M1 exit note`, () => {
    api(`repos/${REPO}/issues/${n}/comments`, "POST", { body: EXIT_NOTE });
    api(`repos/${REPO}/issues/${n}`, "PATCH", { state: "closed", state_reason: "completed" });
  });
}

// Milestone
if (milestone.state !== "closed")
  plan(`close milestone "${MILESTONE}" (#${milestone.number})`, () =>
    api(`repos/${REPO}/milestones/${milestone.number}`, "PATCH", { state: "closed" }),
  );

// #237: smoke held
const MARK = "<!-- m1-smoke-held -->";
const SMOKE_NOTE = `${MARK}
**m1 smoke held (developer, 10-04-26).** \`m1\` was promoted from 76464d8 (promote.yml run 37241619560). The manual smoke against m1, step 3 included, is pending the developer's next host visit, at the latest before the M2 P0.5 promote: from main on the host, \`bash scripts/ops/smoke.sh https://querymodule.birchdesignlab.com\`. deploy-pull's own smoke (steps 1, 2 and 5) runs on each pull.`;
const comments = listAll(`repos/${REPO}/issues/237/comments?per_page=100`);
if (!comments.some((c) => c.body?.includes(MARK)))
  plan("comment on #237: m1 smoke step 3 pending the next host visit", () =>
    api(`repos/${REPO}/issues/237/comments`, "POST", { body: SMOKE_NOTE }),
  );

console.log(`${APPLY ? "applied" : "planned"} ${changes} change(s)`);
