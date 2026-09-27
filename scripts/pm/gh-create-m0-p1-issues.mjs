#!/usr/bin/env node
// gh-create-m0-p1-issues.mjs: open the M0 P1 phase on GitHub (Track A plan Task 0 Steps 1 and 2,
// Track B plan Task 0 Steps 0.7 to 0.9). One issue per plan task, linked as a sub-issue of the
// phase parent "Foundation (M0 P1)" (#40, docs/project-board.md Flow step 1), plus the Track B
// Step 0.8 contract issue. With --headings, writes "(#n)" into each plan's "### Task N:" heading.
//
// Idempotent: an issue is created only when no issue in the milestone (open or closed) has the
// exact title; existing ones are reused for linking, Blocked-by lines and headings.
//
// Fail closed: before any GitHub call, the task numbers below must equal the "### Task N:"
// headings of both plans (Task 0 excluded, Track B Task 2 skipped: Step 0.4 printed root-ok).
//
// Usage (Git Bash or Linux; issue management runs as BirchDesignLab, memory separate-admin-account):
//   node scripts/pm/gh-create-m0-p1-issues.mjs                 # dry run: check and print
//   GH_TOKEN=$(gh auth token -u BirchDesignLab) node scripts/pm/gh-create-m0-p1-issues.mjs --apply
//   node scripts/pm/gh-create-m0-p1-issues.mjs --headings      # after --apply: number the plans
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "BirchDesignLab/queryModule";
const MILESTONE = "M0 Skeleton";
const PHASE_PARENT = 40;
const PLAN_A = "docs/superpowers/plans/2026-09-25-track-a-p1.md";
const PLAN_B = "docs/superpowers/plans/2026-09-25-track-b-p1.md";
const SKIPPED_B = new Set([2]); // Track B Task 2 runs only when Step 0.4 printed gaps (root-ok 09-27-26)

// Track A plan Task 0 Step 1 list, plus Tasks 36 and 37 (added after the list was written).
// sens: the plan's (S) marker; blockedBy: keys of other entries.
const A = [
  [
    1,
    "Contract: auth and roleChanged audit schemas (SEC-005, SEC-010)",
    true,
    ["contract", "core"],
  ],
  [2, "Deps and build tooling for the API image (none)", false],
  [3, "Deploy env reader (BR-001, SEC-007)", false],
  [4, "Docker secret loader with validation (SEC-006)", true],
  [5, "Structured logger with redaction (SEC-006)", false],
  [6, "Encrypted libSQL connection and transactions (SEC-006)", true],
  [7, "Drizzle schema, initial migration, audit triggers (SEC-010, SEC-013)", true],
  [8, "Migrations at start and trigger presence check (SEC-010, SEC-013)", true],
  [9, "CI audit_event additive-only guard (SEC-010, SEC-013)", true],
  [10, "Key canaries (SEC-006)", true],
  [11, "Seams and AuditService (SEC-010, SEC-012)", true],
  [12, "Site config load, configHash, ClientSiteConfig (BR-001)", false],
  [13, "HTTP errors, security headers, CSP, CSRF (SEC-006, SEC-007)", false],
  [14, "Better Auth with __Host- cookie (SEC-005)", true],
  [15, "EventBus, IdentityService, requireSession (SEC-005, SEC-014)", true],
  [16, "SQLite rate limiter (SEC-005)", true],
  [17, "App, deps, auth routes with lockout and login audit (SEC-005, SEC-010)", true],
  [18, "meta, health, config, locales routes and web build (BR-007, NFR-001)", false],
  [19, "WebSocket heartbeat with upgrade checks (SEC-014, NFR-003)", true],
  [20, "Startup sequence, fail closed (SEC-006, SEC-010)", true],
  [21, "Dev launcher: dev, dev:api, e2e (none)", false],
  [22, "Security test: route matrix (SEC-006)", true],
  [23, "Security test: log capture (SEC-006)", true],
  [24, "grant-role (SEC-010)", true],
  [25, "Seed users and password derivation (SEC-005)", true],
  [26, "Ops scripts: check-triggers, audit-stats (SEC-010)", true],
  [27, "Dockerfile and boot smoke (SEC-006, SEC-007)", true],
  [28, "Compose, env template, deploy docs (SEC-007)", false],
  [29, "CI image build, boot smoke, publish (BR-006)", true],
  [30, "promote workflow (BR-004)", true],
  [31, "Backups (NFR-003)", true],
  [32, "Restore test (NFR-003)", true],
  [33, "Smoke and WS soak (NFR-003, SEC-014)", true],
  [34, "Lost-key runbooks (SEC-006)", true],
  [35, "Tunnel and first deploy (SEC-007)", false],
  [36, "Contract and route: GET/PUT /api/v1/me/preferences (UX-014)", false, ["contract", "core"]],
  [37, "Deploy-host container inventory check (none)", false],
].map(([n, title, sens, extra = []]) => ({
  key: `A${n}`,
  plan: PLAN_A,
  n,
  title,
  labels: ["platform", "p1", ...(sens ? ["sensitive"] : []), ...extra],
  body: `Plan: ${PLAN_A} Task ${n}. Tests first: see plan. Sensitive: ${sens ? "yes" : "no"}.`,
  blockedBy: [],
}));

// Track B Step 0.8: P0 has S.QueryType and S.Picklist in core config/schema.ts but no exported values.
const CONTRACT = {
  key: "C1",
  title: "Contract: QueryTypeSchema and PicklistSchema for Track B P1",
  labels: ["contract", "core", "web", "p1"],
  body: [
    "Track B P1 plan Task 0 Step 0.5 printed `QueryTypeSchema: false, PicklistSchema: false` (09-27-26).",
    "",
    "- Consumers: Track B P1 Tasks 4 to 9 (rules engine fixtures and `validateRuleGraph`, `PicklistSchema.parse` / `QueryTypeSchema.parse` filling the spec 4.1 defaults). Track A P2 `validateSiteConfig` calls `validateRuleGraph`.",
    "- Change: export `QueryTypeSchema = S.QueryType` and `PicklistSchema = S.Picklist` from `packages/core/src/config/schema.ts` (reached through `@querymodule/core/config`), with parse tests showing the defaults are filled.",
    "- Additive, not breaking; no audit or event types affected; no generated-file change expected.",
    "",
    "Master plan 8.1. Plan: docs/superpowers/plans/2026-09-25-track-b-p1.md Task 0 Step 0.8.",
  ].join("\n"),
  blockedBy: [],
};

const bTasks = [
  [1, "web", "Scaffold packages/client and packages/web-ui; P1 dependencies (none)"],
  [3, "core", "Rules: two-digit year and date formats (FR-005)"],
  [4, "core", "Rules: canonicalise per dataType (FR-005, FR-031, NFR-001)", ["C1"]],
  [5, "core", "Rules: compile and condition evaluator (FR-002, FR-003, FR-011, FR-032)", ["C1"]],
  [6, "core", "Rules: user and effective values, setDefault (FR-004, FR-031, FR-032)", ["C1"]],
  [
    7,
    "core",
    "Rules: sections, visibility, required, plate-only (FR-001, FR-002, FR-003, FR-008, FR-010, FR-011, FR-012, UX-004)",
    ["C1"],
  ],
  [
    8,
    "core",
    "Rules: evaluateForm and story tests A1 A2 A3 B7 (FR-001 to FR-005, FR-008, FR-010 to FR-012, FR-031, FR-032, UX-004)",
    ["C1"],
  ],
  [9, "core", "Rules: setDefault cycle and order diagnostics (FR-004, BR-001)", ["C1"]],
  [10, "core", "Locales: login, theme, status keys (NFR-001, BR-002)"],
  [
    11,
    "web",
    "Tokens: mobile-unit contrast verification and red-shift check (UX-002, UX-011, BR-001)",
  ],
  [12, "web", "Tokens: verify P0 CSS and native theme for P1 consumers (UX-002, BR-001)"],
  [13, "web", "Tokens: theme mode resolution (UX-002)"],
  [14, "web", "Client: platform and typed API client (SEC-006, SEC-007)"],
  // $authIssue: the auth routes task (e2e only; unit tests use MSW).
  [
    15,
    "web",
    "Client: auth state and reset on logout, 401, user change (SEC-006, BR-002, PLT-006)",
    ["A17"],
  ],
  [16, "web", "Client: announcer, translator, meta version check (NFR-001, FR-005)"],
  [
    17,
    "web",
    "Client: persona resolution and preferences store (UX-001, UX-012, UX-014, BR-002, PLT-006)",
  ],
  [18, "web", "Client: WebSocket heartbeat probe (NFR-003)"],
  // /api/v1/me/preferences is not in openapi.json: blocked on Track A Task 36 (Wave F ruling R2).
  [19, "web", "Client: preferences sync with /me/preferences (UX-014, UX-002)", ["A36"]],
  [20, "web", "Web-ui: LiveAnnouncer and base styles (FR-005)"],
  [21, "web", "Web-ui: TextField and focusFirstInvalid (UX-004, FR-001, FR-005)"],
  [22, "web", "Web-ui: theme and persona hooks, ThemeModeSelect (UX-002, UX-001, UX-012)"],
  [23, "web", "Web: platform, services, bootstrap (NFR-001, SEC-006, BR-002)"],
  [24, "web", "Web: login screen (BR-002, PLT-006, UX-004, FR-005, NFR-001)"],
  [25, "web", "Web: routes, home, status page, entry (BR-002, UX-002, NFR-003)"],
  [26, "web", "Web: Playwright harness with CSP and axe (SEC-006, SEC-007)"],
  // Step 0.7: auth, locales and /meta, WS heartbeat, image smoke (CI steps 10 to 12).
  [
    27,
    "web",
    "Web: M0 Playwright suite (BR-002, PLT-006, UX-002, UX-004, SEC-006, SEC-007, NFR-003)",
    ["A17", "A18", "A19", "A29"],
  ],
];
const B = bTasks.map(([n, label, title, blockedBy = []]) => ({
  key: `B${n}`,
  plan: PLAN_B,
  n,
  title,
  labels: [label, "p1"],
  body: `Plan: ${PLAN_B} Task ${n}\nIDs: see title and plan task\nTests first: the task's first step\nSensitive: no`,
  blockedBy,
}));

// Order matters: Blocked-by lines name issues created earlier.
const ENTRIES = [...A, CONTRACT, ...B];

function planTaskNumbers(path) {
  return [...readFileSync(path, "utf8").matchAll(/^### Task (\d+):/gm)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== 0);
}

function checkAgainstPlans() {
  const problems = [];
  for (const [path, entries, skipped] of [
    [PLAN_A, A, new Set()],
    [PLAN_B, B, SKIPPED_B],
  ]) {
    const want = planTaskNumbers(path).filter((n) => !skipped.has(n));
    const have = entries.map((e) => e.n);
    if (JSON.stringify(want) !== JSON.stringify(have)) {
      problems.push(`${path}: headings ${want.join(",")} but data ${have.join(",")}`);
    }
  }
  const keys = new Set(ENTRIES.map((e) => e.key));
  for (const e of ENTRIES) {
    for (const k of e.blockedBy) if (!keys.has(k)) problems.push(`${e.key}: unknown blocker ${k}`);
  }
  if (new Set(ENTRIES.map((e) => e.title)).size !== ENTRIES.length)
    problems.push("duplicate titles");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
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
  const existing = existingByTitle();
  const numbers = new Map();
  for (const e of ENTRIES) {
    let number = existing.get(e.title);
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
  }
}

function writeHeadings() {
  const existing = existingByTitle();
  for (const path of [PLAN_A, PLAN_B]) {
    let md = readFileSync(path, "utf8");
    for (const e of ENTRIES.filter((x) => x.plan === path)) {
      const number = existing.get(e.title);
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
    console.log(
      `${e.key} [${e.labels.join(",")}] ${e.title}${e.blockedBy.length ? ` <- ${e.blockedBy.join(",")}` : ""}`,
    );
  }
  console.log(`${ENTRIES.length} issues; dry run (pass --apply)`);
} else {
  console.error("usage: gh-create-m0-p1-issues.mjs [--apply | --headings]");
  process.exit(2);
}
