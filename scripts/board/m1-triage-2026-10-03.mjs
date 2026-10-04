// m1-triage-2026-10-03.mjs: the M1 triage the developer approved on 10-03-26 (session
// "M1 finish 3"), as BirchDesignLab through a per-call GH_TOKEN.
//
// Why: M1 exits with as little carried debt as reasonable. Small fixes stay in M1 and are
// fixed before Task 17; features, design work and demo prep move to M2; the design and
// M2-only boxes inside issues that stay in M1 move to one new M2 carry issue, so those
// issues can close at the M1 exit. gh-setup-project.mjs never changes a milestone or
// unlinks a sub-issue (precedent: scripts/pm/move-m0-followups.mjs), so this script does
// the GitHub side and makes the matching docs/board/board-data.json edit.
//
// Steps (each skipped when already done, so a rerun is a no-op):
//   1. close #333 and #315 with a comment;
//   2. move #476-#479, #481 (features, design) and #482, #484, #486 (demo prep) to
//      "M2 Results and audit" under Hardening (M2 P3) #46, with a comment;
//   3. create the M2 carry issue under Audit (M2 P2) #45 from the live box texts, and tick
//      each source box "moved to #N";
//   4. board-data.json: the moves, plus entries for #505, #507 and the carry issue.
// Then: node scripts/board/sync-followups.mjs, the board dry run, --apply,
// gh workflow run project-sync.yml (memory: project-board).
//
// Usage (repo root): node scripts/board/m1-triage-2026-10-03.mjs [--apply]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const M2 = "M2 Results and audit";
const HARDENING_M2_P3 = 46;
const AUDIT_M2_P2 = 45;
const DATA_PATH = "docs/board/board-data.json";

const tok = spawnSync("gh", ["auth", "token", "-u", "BirchDesignLab"], { encoding: "utf8" });
if (tok.status !== 0) throw new Error("no gh token for BirchDesignLab");
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 4).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
const api = (path, method = "GET", body) =>
  JSON.parse(
    gh(
      ["api", "-X", method, path, ...(body ? ["--input", "-"] : [])],
      body ? JSON.stringify(body) : undefined,
    ) || "null",
  );

let planned = 0;
const step = (what, fn) => {
  planned += 1;
  console.log(`${APPLY ? "" : "would "}${what}`);
  return APPLY ? fn() : undefined;
};

const CLOSES = [
  [
    333,
    "Closed in the M1 triage (10-03-26): the admin console and visual site-config builder shipped in AC1 (#498), AC2 (#506) and AC3 (#508). Open minors are tracked in #505 and #507.",
  ],
  [315, "Closed in the M1 triage (10-03-26): every box was done in #500."],
];

const FEATURE_NOTE =
  "Moved to M2 in the M1 triage (10-03-26, developer-approved): a feature or design item, not an M1 minor. Parent: Hardening (M2 P3) #46.";
const DEMO_NOTE =
  "Moved to M2 in the M1 triage (10-03-26, developer-approved) as demo prep: the real v1 demo comes after responses (M2 P0.5), so demo polish is planned then, not an M1 exit gate. Parent: Hardening (M2 P3) #46.";
const MOVES = [
  [476, FEATURE_NOTE],
  [477, FEATURE_NOTE],
  [478, FEATURE_NOTE],
  [479, FEATURE_NOTE],
  [481, `${FEATURE_NOTE} Blocked until APP_VERSION and coreVersion read real versions.`],
  [482, DEMO_NOTE],
  [484, DEMO_NOTE],
  [486, DEMO_NOTE],
];

const CARRY_TITLE = "M1 carry-overs: WS receipt policy, key versioning, audit catalogue, admin UI";
/** [section heading, [[source issue, unique substring of the open box]]] */
const CARRY = [
  [
    "Contracts and keys (critical)",
    [
      [98, "C-M4 `ws.ts:136-185`"],
      [311, "`REQUEST_KEY_VERSION` independent of DATA_KEY"],
    ],
  ],
  [
    "Audit catalogue and auth (M2 P2)",
    [
      [505, "G-m3 (critical, `contracts/audit.ts`)"],
      [505, "A password change writes no audit row"],
      [505, "revokeSession's `sessionRevoked` row"],
      [505, "Change-password has no per-account lockout"],
      [505, "G-m4 (gate): listUsers caps at 1000 rows"],
    ],
  ],
  [
    "M2 P0.5 and real adapters",
    [
      [505, "T27 IC1 carry"],
      [505, "T27 critic CV1 carry"],
    ],
  ],
  [
    "Admin UI and demo prep",
    [
      [507, 'Publish change note and "who" in the history drawer'],
      [507, "C/M1: `visual.spec.ts` admin look checks were loosened"],
    ],
  ],
  ["Watch", [[483, "If anything else becomes sticky"]]],
];

// 1. Closes
for (const [n, note] of CLOSES) {
  const issue = api(`repos/${REPO}/issues/${n}`);
  if (issue.state === "closed") continue;
  step(`close #${n} (completed) with a comment`, () => {
    api(`repos/${REPO}/issues/${n}/comments`, "POST", { body: note });
    api(`repos/${REPO}/issues/${n}`, "PATCH", { state: "closed", state_reason: "completed" });
  });
}

// 2. Moves
const milestones = new Map(
  api(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m.number]),
);
const m2 = milestones.get(M2);
if (m2 === undefined) throw new Error(`no milestone "${M2}"`);
const subIds = (parent) =>
  new Set(api(`repos/${REPO}/issues/${parent}/sub_issues?per_page=100`).map((s) => s.id));
const hardeningChildren = subIds(HARDENING_M2_P3);
for (const [n, note] of MOVES) {
  const issue = api(`repos/${REPO}/issues/${n}`);
  if (issue.milestone?.number !== m2)
    step(`move #${n} to "${M2}" with a comment`, () => {
      api(`repos/${REPO}/issues/${n}`, "PATCH", { milestone: m2 });
      api(`repos/${REPO}/issues/${n}/comments`, "POST", { body: note });
    });
  if (!hardeningChildren.has(issue.id))
    step(`link #${n} under #${HARDENING_M2_P3} (replaces its parent)`, () =>
      api(`repos/${REPO}/issues/${HARDENING_M2_P3}/sub_issues`, "POST", {
        sub_issue_id: issue.id,
        replace_parent: true,
      }),
    );
}

// 3. Carry issue
const sources = new Map();
const sourceBody = (n) => {
  if (!sources.has(n)) sources.set(n, api(`repos/${REPO}/issues/${n}`).body ?? "");
  return sources.get(n);
};
const existing = JSON.parse(
  gh([
    "issue",
    "list",
    "--repo",
    REPO,
    "--state",
    "all",
    "--search",
    `"${CARRY_TITLE}" in:title`,
    "--json",
    "number,title",
  ]),
).find((i) => i.title === CARRY_TITLE);

const sections = [];
for (const [heading, boxes] of CARRY) {
  const lines = [];
  for (const [n, box] of boxes) {
    const all = sourceBody(n).split("\n");
    const open = all.filter((l) => l.startsWith("- [ ] ") && l.includes(box));
    if (open.length > 1) throw new Error(`#${n}: "${box}" matches ${open.length} boxes`);
    const text = (open[0] ?? all.find((l) => l.startsWith("- [") && l.includes(box)))
      ?.replace(/^- \[[ x]\] /, "")
      .replace(/ \(moved to #\d+\)$/, "");
    if (text === undefined) throw new Error(`#${n}: no box matches "${box}"`);
    lines.push(`- [ ] (from #${n}) ${text}`);
  }
  sections.push(`**${heading}**\n${lines.join("\n")}`);
}
const carryBody = [
  'Boxes carried out of issues that stay in M1, in the M1 triage (10-03-26, developer-approved). Each is a design decision or M2-only work; its source box is ticked "moved to #N" so the source issue can close at the M1 exit.',
  ...sections,
  '**Source:** `scripts/board/m1-triage-2026-10-03.mjs`, session "M1 finish 3".',
].join("\n\n");

let carryNumber = existing?.number;
if (carryNumber === undefined) {
  console.log(`${APPLY ? "" : "would "}create "${CARRY_TITLE}" with body:\n${carryBody}\n`);
  planned += 1;
  if (APPLY) {
    const created = api(`repos/${REPO}/issues`, "POST", {
      title: CARRY_TITLE,
      body: carryBody,
      milestone: m2,
      labels: ["platform", "p2", "follow-up", "sensitive", "decision"],
    });
    carryNumber = created.number;
    api(`repos/${REPO}/issues/${AUDIT_M2_P2}/sub_issues`, "POST", { sub_issue_id: created.id });
    console.log(`created #${carryNumber} under #${AUDIT_M2_P2}`);
  }
}
const carryRef = carryNumber === undefined ? "#<new>" : `#${carryNumber}`;

for (const n of [...new Set(CARRY.flatMap(([, boxes]) => boxes.map(([s]) => s)))]) {
  const lines = sourceBody(n).split("\n");
  let changed = false;
  for (const [, box] of CARRY.flatMap(([, boxes]) => boxes).filter(([s]) => s === n)) {
    const i = lines.findIndex((l) => l.startsWith("- [ ] ") && l.includes(box));
    if (i === -1) continue;
    lines[i] = `${lines[i].replace("- [ ] ", "- [x] ")} (moved to ${carryRef})`;
    changed = true;
    console.log(`${APPLY ? "" : "would "}tick #${n}: ${box} (moved to ${carryRef})`);
    planned += 1;
  }
  if (changed && APPLY) api(`repos/${REPO}/issues/${n}`, "PATCH", { body: lines.join("\n") });
}

// 4. board-data.json
const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const live = (n) => api(`repos/${REPO}/issues/${n}`);
for (const [n] of MOVES) {
  const f = data.followUps.find((x) => x.number === n);
  if (!f) throw new Error(`#${n} missing from ${DATA_PATH}`);
  if (f.milestone !== M2 || f.parent !== HARDENING_M2_P3) {
    console.log(
      `${APPLY ? "" : "would "}set ${DATA_PATH} #${n}: ${M2}, parent #${HARDENING_M2_P3}`,
    );
    planned += 1;
    Object.assign(f, { milestone: M2, parent: HARDENING_M2_P3, phase: "P3" });
  }
}
const ADDS = [
  {
    number: 505,
    milestone: "M1 Forms and terminal",
    parent: 42,
    phase: "P3",
    track: "Platform (A)",
    size: "M",
    priority: "Medium",
    reqIds: "SEC-005, SEC-010",
    labels: ["platform", "p3", "follow-up", "sensitive"],
  },
  {
    number: 507,
    milestone: "M1 Forms and terminal",
    parent: 42,
    phase: "P3",
    track: "Web (B)",
    size: "M",
    priority: "Medium",
    reqIds: "none",
    labels: ["web", "p3", "follow-up"],
  },
];
if (carryNumber !== undefined)
  ADDS.push({
    number: carryNumber,
    milestone: M2,
    parent: AUDIT_M2_P2,
    phase: "P2",
    track: "Platform (A)",
    size: "M",
    priority: "Medium",
    reqIds: "SEC-010",
    labels: ["platform", "p2", "follow-up", "sensitive", "decision"],
  });
for (const entry of ADDS) {
  if (data.followUps.some((x) => x.number === entry.number)) continue;
  console.log(`${APPLY ? "" : "would "}add #${entry.number} to ${DATA_PATH}`);
  planned += 1;
  if (APPLY) {
    const issue = live(entry.number);
    data.followUps.push({ ...entry, title: issue.title, body: issue.body });
  }
}
if (APPLY) {
  data.followUps.sort((a, b) => a.number - b.number);
  writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`${APPLY ? "applied" : "planned"} ${planned} change(s)`);
if (!APPLY && carryNumber === undefined)
  console.log("(the carry issue's board-data entry is added on --apply, once it has a number)");
