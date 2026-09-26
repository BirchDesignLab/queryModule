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
//   matched by exact title, fields and options by name. Status and Priority are
//   only seeded when empty (a closed issue is forced to Done), so a rerun never
//   undoes project-sync or the developer. A wave closes when all its tasks are
//   closed. Safe to run again after editing the data below (for example to add a
//   follow-up).
//
// Usage (PowerShell or bash, repo root)
//   node scripts/ops/gh-setup-project.mjs                 # dry run: reads only, prints the plan
//   node scripts/ops/gh-setup-project.mjs --apply         # writes
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

const REPO = "BirchDesignLab/queryModule";
const OWNER = "BirchDesignLab";
const PROJECT_NUMBER = 1;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN = "docs/superpowers/plans/2026-09-25-p0-contracts.md";
const WAVE_DATE = "2026-09-26";

// ---------------------------------------------------------------- data

const REMOVE_LABELS = ["good first issue", "help wanted", "invalid", "wontfix", "duplicate"];

const LABELS = [
  {
    name: "epic",
    color: "3E4B9E",
    description: "Parent issue for a phase or wave; progress comes from its sub-issues",
  },
  {
    name: "follow-up",
    color: "C5DEF5",
    description: "Found in review or a ruling; carried to a later task, phase or track",
  },
  {
    name: "decision",
    color: "D93F0B",
    description: "Needs a developer decision before work can start or a gate can pass",
  },
];

const MILESTONES = {
  "M0 Skeleton":
    "P0: workspace, frozen M0/M1 contracts, the verify gate (CI, sensitive review), tokens, web shell, mobile placeholder. P1 foundation: secrets, encrypted SQLite, auth and limiter, meta, health, locales, WS heartbeat, image smoke, release promote. Exit: spec 12.7.",
  "M1 Forms and terminal":
    "P2 engine: config load, GET config, POST queries transaction with audit, rules-driven form, shortcut engine, tokenizer and parser. P3 flow: mock adapter, event_log, WS sourceStatus, terminal UI. Exit: stories A1 to A5 green, keyboard-only Playwright, live smoke.",
  "M2 Results and audit":
    "P0 contracts (ResponseMapping, assessResult, resultHidden, resync, admin audit), P1 feed (replay, GET queries, WS client), P2 audit (sweeper, admin audit route, NDJSON export), P3 hardening. Exit: spec 12.7.",
  "M3 Workflow and compliance":
    "P0 contracts (delegation and auth blocks, credential and delegation audit), P1 credentials and MFA, P2 multi-source, nested queries and hide, P3 delegation. Exit: spec 12.7 with flags on.",
  "M4 Mobile and host integration":
    "P0 contracts (postMessage v1), P1 layouts and embedded host identity, P2 native (Expo, Maestro), P3 exit. Exit: stories C1 and C2 green on native, spec 12.7.",
};

const STATUS_OPTIONS = [
  { name: "Todo", color: "GRAY", description: "Not started" },
  { name: "Ready", color: "BLUE", description: "Briefed and unblocked; next up" },
  { name: "In Progress", color: "YELLOW", description: "A session is working on it" },
  { name: "In Review", color: "PURPLE", description: "PR open; review or checks running" },
  {
    name: "Blocked",
    color: "RED",
    description: "Waiting on a decision, another issue or an admin step",
  },
  { name: "Done", color: "GREEN", description: "Merged or closed as completed" },
];

const FIELDS = [
  {
    name: "Track",
    options: [
      { name: "Platform (A)", color: "BLUE", description: "Track A, Linux: api, deploy, CI, ops" },
      {
        name: "Web (B)",
        color: "GREEN",
        description: "Track B, Windows: web, client, tokens, e2e",
      },
      { name: "Core", color: "PURPLE", description: "packages/core, config, contract files" },
      { name: "Mobile (D)", color: "ORANGE", description: "Track D from M4: Expo, rn-ui" },
    ],
  },
  {
    name: "Phase",
    options: ["P0", "P1", "P2", "P3"].map((p, i) => ({
      name: p,
      color: ["GRAY", "BLUE", "YELLOW", "GREEN"][i],
      description: [
        "Contracts",
        "Foundation or first build",
        "Engine or core feature",
        "Flow, hardening or exit",
      ][i],
    })),
  },
  {
    name: "Wave",
    options: [1, 2, 3, 4, 5, 6].map((k) => ({
      name: `W${k}`,
      color: "GRAY",
      description: `P0 wave ${k}`,
    })),
  },
  {
    name: "Size",
    options: [
      { name: "S", color: "GREEN", description: "Up to 150 plan lines, or a one-file change" },
      { name: "M", color: "YELLOW", description: "Up to 300 plan lines" },
      { name: "L", color: "ORANGE", description: "Up to 450 plan lines" },
      { name: "XL", color: "RED", description: "Over 450 plan lines" },
    ],
  },
  {
    name: "Priority",
    options: [
      { name: "Urgent", color: "RED", description: "Blocks a gate or a freeze" },
      { name: "High", color: "ORANGE", description: "Current or next wave" },
      { name: "Medium", color: "YELLOW", description: "Due in its phase" },
      { name: "Low", color: "GRAY", description: "Hardening or tidy-up" },
    ],
  },
  { name: "Req IDs", text: true },
];

const PHASES = [
  [
    "M0 P0: Contracts",
    "M0 Skeleton",
    "P0",
    "Typecheck and CI green; contracts frozen",
    "2026-09-25-p0-contracts.md",
  ],
  [
    "M0 P1: Foundation",
    "M0 Skeleton",
    "P1",
    "M0 exit",
    "2026-09-25-track-a-p1.md and 2026-09-25-track-b-p1.md",
  ],
  [
    "M1 P2: Engine",
    "M1 Forms and terminal",
    "P2",
    "Form on GET config; parser property tests",
    null,
  ],
  ["M1 P3: Flow", "M1 Forms and terminal", "P3", "M1 exit", null],
  [
    "M2 P0: Contracts",
    "M2 Results and audit",
    "P0",
    "Contracts frozen; OpenAPI diff reviewed",
    null,
  ],
  ["M2 P1: Feed", "M2 Results and audit", "P1", "A6; replay test", null],
  ["M2 P2: Audit", "M2 Results and audit", "P2", "A7 to A9", null],
  ["M2 P3: Hardening", "M2 Results and audit", "P3", "M2 exit", null],
  ["M3 P0: Contracts", "M3 Workflow and compliance", "P0", "Contracts frozen; flags off", null],
  [
    "M3 P1: Credentials and MFA",
    "M3 Workflow and compliance",
    "P1",
    "B4; raw-bytes and log-capture",
    null,
  ],
  ["M3 P2: Multi-source, nested, hide", "M3 Workflow and compliance", "P2", "B1, B2, B5, B7", null],
  ["M3 P3: Delegation", "M3 Workflow and compliance", "P3", "M3 exit; flags on", null],
  [
    "M4 P0: Contracts",
    "M4 Mobile and host integration",
    "P0",
    "expo export green; contracts frozen",
    null,
  ],
  [
    "M4 P1: Layouts and host",
    "M4 Mobile and host integration",
    "P1",
    "C1 on web; host-simulator test",
    null,
  ],
  ["M4 P2: Native", "M4 Mobile and host integration", "P2", "C1 and C2 on native", null],
  ["M4 P3: Exit", "M4 Mobile and host integration", "P3", "M4 exit", null],
].map(([title, milestone, phase, gate, plan]) => ({ title, milestone, phase, gate, plan }));

// P0 waves (plan "## Waves"). Task N is issue #N+1.
const WAVES = [
  { k: 1, tasks: [1, 6], pr: 31, state: "done" },
  { k: 2, tasks: [7, 11], pr: 33, state: "done" },
  { k: 3, tasks: [12, 16], pr: 35, state: "done" },
  { k: 4, tasks: [17, 22], pr: 38, state: "done" },
  { k: 5, tasks: [23, 25], pr: null, state: "ready" },
  { k: 6, tasks: [26, 28], pr: null, state: "todo" },
];
const waveTitle = (w) => `M0 P0 W${w.k}: Tasks ${w.tasks[0]} to ${w.tasks[1]}`;

const src = (s) => `\n\n**Source:** ${s}`;
const FOLLOW_UPS = [
  {
    title: "Decide: bound message and label keys before the P0 freeze (ADR-0005)",
    labels: ["decision", "follow-up", "core", "p0", "sensitive"],
    milestone: "M0 Skeleton",
    parent: "M0 P0: Contracts",
    track: "Core",
    phase: "P0",
    size: "S",
    priority: "Urgent",
    reqIds: "SEC-010, NFR-001",
    body:
      "`AuditValidationErrorSchema.key` and `params.labelKey` (`packages/core/src/contracts/audit.ts`) and config `Key` (`packages/core/src/config/schema-fields.ts`) are unbounded `z.string().min(1)`. Tightening after the P0 freeze is a breaking audit change.\n\nOptions:\n1. Bound message and label keys with one shared pattern in `contracts/primitives.ts`, used by config and audit together (test first).\n2. Add an ADR-0005 line recording that they stay unbounded (server-generated keys, never user text).\n\n**Done when:** the developer has chosen, and the choice is merged before the P0 gate." +
      src("PR #38 wave-review minor M3 (carry W4R-M3)."),
  },
  {
    title: "Sensitive paths: list nested biome.json files and .gitignore",
    labels: ["follow-up", "platform", "p0", "sensitive"],
    milestone: "M0 Skeleton",
    parent: waveTitle(WAVES[4]),
    track: "Platform (A)",
    phase: "P0",
    size: "S",
    priority: "High",
    reqIds: "SEC-020",
    body:
      "Biome honours nested `biome.json` files (`root: false`) and `vcs.useIgnoreFile: true` skips files matched by `.gitignore`. A PR can add `packages/core/biome.json` or a `.gitignore` line and switch off lint, including the core purity rule, without a sensitive-review artifact.\n\nFix in W5 (Task 23 is sensitive, so its wave-review covers it): replace `biome.json` with `**/biome.json` and add `.gitignore` in `.github/sensitive-paths` (or set `useIgnoreFile: false` and rely on `files.includes`), mirror in CLAUDE.md, and extend the shipped-glob test in `scripts/ci/sensitive-review.test.ts`." +
      src("PR #38 wave-review residual RR-M1."),
  },
  {
    title: "GET /api/v1/config returns only the ClientSiteConfig allowlist",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "High",
    reqIds: "BR-001",
    body:
      "The route handler must return `toClientSiteConfig(resolved, configHash)`, never the server `SiteConfig`, with a test that `auth`, `retention`, `extends` and `Source.kind`, `server`, `maxConcurrent` are absent from the response." +
      src("W2 Task 9 carry forward (ledger)."),
  },
  {
    title: "getLocale handler returns 400 validationFailed for a malformed locale",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "NFR-001",
    body:
      "The route contract declares 400 `validationFailed` (ApiError) for a malformed locale param; 404 stays for a well-formed locale that is not listed. The handler implements both, with tests." +
      src("Ruling W3-5, PR #35."),
  },
  {
    title: "Confirm Better Auth user ids fit BoundedIdSchema",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "High",
    reqIds: "SEC-010",
    body:
      "Audit `actor.id` and credential user ids use `BoundedIdSchema` (`/^[A-Za-z0-9_-]{1,64}$/`, ADR-0005). If Better Auth issues ids outside that pattern, every audit write fails closed. Configure or verify the id generator, with a test that a created user's id parses." +
      src("W1 xhigh review, Track A note (Ruling P-1)."),
  },
  {
    title: "Client parsers tolerate unknown WS message types and ApiError fields",
    labels: ["follow-up", "web", "p1"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Web (B)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "NFR-003",
    body:
      "M2 and M3 add WS message types and fields additively. The WS client and the ApiError receipt parser must ignore unknown types and fields instead of failing, with tests." +
      src("W1 xhigh review M10, Track B note."),
  },
  {
    title: "promote.yml: milestone argument, full history, fail on non-zero",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "SEC-020",
    body:
      "When `promote.yml` runs the story-tag gate it passes `--milestone <mN>` as two argv entries, checks out with `fetch-depth: 0` (tags and history), and a non-zero exit fails the job." +
      src("W4 Task 20 carry forward."),
  },
  {
    title: "Licence check covers the first runtime dependency of api or apps",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Low",
    reqIds: "BR-006",
    body:
      "The first task that adds a runtime dependency to `packages/api` or `apps/*` shows it in `pnpm licenses list --prod --json` output, so the CI licence gate really sees workspace runtime dependencies." +
      src("W4 Task 19 carry forward."),
  },
  {
    title: "OpenAPI: input-side request bodies and a stable Condition component name",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "BR-007",
    body:
      '- `scripts/ci/openapi.ts` emits request bodies (and `WsClientMessage`) with zod `io: "output"`; a body field with a default or transform is published with the wrong required flag or type. Use `io: "input"` for bodies once P1 adds them.\n- The recursive `Condition` component is named from zod\'s internal id (`getConfig200___schema0`) and can change on a zod upgrade, causing spurious drift. Give `Condition` a registry id.' +
      src("W4 Task 17 critic minors M2 and M5."),
  },
  {
    title: "Threat model: sensitive-review cannot stop a PR editing its own checker",
    labels: ["follow-up", "documentation", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Low",
    reqIds: "SEC-020",
    body:
      "`sensitive-review` runs on `pull_request`, so a PR can change `ci.yml`, `scripts/ci/sensitive-review.ts` or the lockfile's gate tools and pass without an artifact. Spec 9.1 accepts this (the check proves a review was recorded, and the edit is visible in the diff). Record it in a threat-model doc, and optionally run the base branch's copy of the checker." +
      src("PR #38 wave-review answer 2."),
  },
  {
    title: "Core purity lint also catches IO globals",
    labels: ["follow-up", "core", "p0"],
    milestone: "M0 Skeleton",
    parent: "M0 P0: Contracts",
    track: "Core",
    phase: "P0",
    size: "S",
    priority: "Low",
    reqIds: "",
    body:
      "The Biome override forbids IO imports in `packages/core/src`, but not IO globals that need no import: `fetch`, `process.env`, `WebSocket`, `XMLHttpRequest`. Add a restricted-globals rule for non-test core files, with a probe showing it fires." +
      src("W4 Task 22 critic minor M3."),
  },
  {
    title: "Embedded login: validate the host email claim before it reaches audit",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M4 Mobile and host integration",
    parent: "M4 P1: Layouts and host",
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "SEC-010, SEC-011",
    body:
      "`AuditActor.email` is `z.email().max(254).nullable()`, which rejects host-issued addresses such as `user@cadhost`, IP literals and non-ASCII domains. At `POST /api/v1/auth/embedded`, check the host JWT email claim with `AuditActorSchema.shape.email` and store `null` (or reject the login) when it fails, with a test. Otherwise every audit write, and so every submit (spec 5.2), fails for that principal." +
      src("PR #38 wave-review minor M2 (carry W4R-M2)."),
  },
  {
    title: "Duplicate response-mapping check uses the canonical when condition",
    labels: ["follow-up", "core", "p2"],
    milestone: "M1 Forms and terminal",
    parent: "M1 P2: Engine",
    track: "Core",
    phase: "P2",
    size: "S",
    priority: "Medium",
    reqIds: "BR-001",
    body:
      "`checkLimits` keys duplicate response mappings on whether `when` is present, not on the condition itself, so mutually exclusive mappings raise a spurious `duplicateMapping`. Once condition canonicalisation lands, key on the canonical `when`, with a test that distinct conditions pass." +
      src("W3 Task 13 ruling and carry forward."),
  },
  {
    title: "Verify-gate CLI tidy-ups (deferred minors from W4)",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "M",
    priority: "Low",
    reqIds: "",
    body:
      "Deferred minors, none fail open:\n- [ ] `config:validate` rejects unknown `--` flags instead of dropping them.\n- [ ] `config:validate` prints forward-slash paths on Windows too (master plan 9: identical output in PowerShell and bash).\n- [ ] `config:migrate` catches read and parse errors and prints path and key only (no raw stack or file excerpt).\n- [ ] `config:validate` reports an invalid-JSON locale bundle as `config.invalidJson`, not `config.missingLocale`.\n- [ ] `mockSchema` diagnostics point into the mock file, not the site file.\n- [ ] `stories.json` file paths stay inside the repo (no absolute or `..` paths).\n- [ ] `hasTaggedTest` and `isPureBarrel` comment stripping become string-aware.\n- [ ] `check-licences.ts`, `check-story-tags.ts`: clean `path: message` errors instead of stack traces for a missing or malformed input file." +
      src("SDD ledger, W4 deferred minors (Tasks 18 to 22)."),
  },
  {
    title: "Live progress dashboard on GitHub Pages",
    labels: ["follow-up", "enhancement", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: "M0 P1: Foundation",
    track: "Platform (A)",
    phase: "P1",
    size: "M",
    priority: "Low",
    reqIds: "",
    body:
      "The README Mermaid block is regenerated when `scripts/ops/gh-setup-project.mjs` runs. For a live view: a workflow rebuilds an SVG dashboard (milestone progress rings, phase bars from sub-issue progress, the wave timeline, open decisions and follow-ups) on issue and PR events and publishes it to GitHub Pages; the README embeds it.\n\nNeeds: Pages enabled (repo admin), a workflow under `.github/workflows/` (sensitive, needs the review artifact), no repository code run next to any token, and a fallback when Pages is down (the Mermaid block stays)." +
      src("Developer request 09-26-26 (README visuals, option both)."),
  },
  {
    title: "Board and repo settings: the manual steps",
    labels: ["documentation", "platform", "p0"],
    milestone: "M0 Skeleton",
    parent: "M0 P0: Contracts",
    track: null,
    phase: "P0",
    size: "S",
    priority: "High",
    reqIds: "",
    assignee: "BirchDesignLab",
    body: 'Views, built-in project workflows and repo settings have no API. Follow the checklist in `docs/project-board.md` (section "Manual steps") and tick it there or here.',
  },
];

// ---------------------------------------------------------------- gh plumbing

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const asAt = argv.indexOf("--as");
const AS = asAt >= 0 ? argv[asAt + 1] : "BirchDesignLab";
const USAGE = "usage: node scripts/ops/gh-setup-project.mjs [--apply] [--as <login>]";
if (!AS || AS.startsWith("--")) {
  console.error(`--as needs a login; ${USAGE}`);
  process.exit(2);
}
const known = new Set(["--apply", "--as", AS]);
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

// Milestones
const milestones = new Map(
  restAll(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m]),
);
for (const [title, description] of Object.entries(MILESTONES)) {
  const m = milestones.get(title);
  if (!m) throw new Error(`milestone "${title}" missing; run scripts/ops/gh-setup-labels.sh first`);
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

// Issues
const issues = new Map(
  restAll(`repos/${REPO}/issues?state=all&per_page=100`)
    .filter((i) => !i.pull_request)
    .map((i) => [i.title, i]),
);
const byNumber = (n) => [...issues.values()].find((i) => i.number === n);

function ensureIssue(spec) {
  let issue = issues.get(spec.title);
  if (!issue) {
    const body = {
      title: spec.title,
      body: spec.body,
      labels: spec.labels,
      milestone: milestones.get(spec.milestone)?.number,
      ...(spec.assignee ? { assignees: [spec.assignee] } : {}),
    };
    issue = write(`create issue "${spec.title}"`, () => rest(`repos/${REPO}/issues`, "POST", body));
    if (issue) issues.set(issue.title, issue);
  } else {
    const have = new Set(issue.labels.map((l) => l.name));
    const missing = spec.labels.filter((l) => !have.has(l));
    if (missing.length > 0) {
      write(`add labels ${missing.join(", ")} to #${issue.number}`, () =>
        rest(`repos/${REPO}/issues/${issue.number}/labels`, "POST", { labels: missing }),
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
const phaseIssue = new Map();
for (const p of PHASES) {
  const planLine = p.plan
    ? `Plan: \`docs/superpowers/plans/${p.plan}\`.`
    : "Plan: written at phase start (master plan 6.1).";
  const issue = ensureIssue({
    title: p.title,
    labels: ["epic", p.phase.toLowerCase()],
    milestone: p.milestone,
    body: `Phase parent for ${p.title.split(":")[0]} (${p.milestone}). Progress comes from its sub-issues.\n\n**Gate:** ${p.gate}.\n\n${planLine} Grid and handoffs: ${statusDocs}.`,
  });
  phaseIssue.set(p.title, issue);
}

// A wave is done when every task issue in it is closed (issue state is the truth).
const waveDone = (w) => {
  for (let t = w.tasks[0]; t <= w.tasks[1]; t += 1) {
    if (byNumber(t + 1)?.state !== "closed") return false;
  }
  return true;
};
const waveIssue = new Map();
for (const w of WAVES) {
  const tasks = `Tasks ${w.tasks[0]} to ${w.tasks[1]} (issues #${w.tasks[0] + 1} to #${w.tasks[1] + 1})`;
  const issue = ensureIssue({
    title: waveTitle(w),
    labels: ["epic", "p0"],
    milestone: "M0 Skeleton",
    closed: waveDone(w),
    body: `P0 wave ${w.k}: ${tasks}, one PR per wave (ADR-0006).${w.pr ? ` PR #${w.pr}.` : ""}\n\nWave map: \`${PLAN}\` section "Waves".`,
  });
  waveIssue.set(w.k, issue);
  ensureChild(phaseIssue.get("M0 P0: Contracts"), issue, waveTitle(w));
  for (let t = w.tasks[0]; t <= w.tasks[1]; t += 1)
    ensureChild(issue, byNumber(t + 1), `#${t + 1}`);
}

const followUps = new Map();
for (const f of FOLLOW_UPS) {
  const issue = ensureIssue(f);
  followUps.set(f.title, issue);
  const parent =
    phaseIssue.get(f.parent) ?? [...waveIssue.values()].find((i) => i?.title === f.parent);
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
    v.Track = trackOf(names);
    v.Phase = "P0";
    v.Wave = `W${w.k}`;
    v.Size = sizeOf(taskLines.get(task) ?? 0);
    v["Req IDs"] = /\(([^)]*)\)\s*$/.exec(issue.title)?.[1] ?? "";
    if (issue.state === "closed") v.Status = "Done";
    else v.Status = { review: "In Review", ready: "Ready", todo: "Todo", done: "Done" }[w.state];
    if (issue.state === "open") v.Priority = "High";
    if (issue.state === "closed" || w.state === "review") {
      v.Start = WAVE_DATE;
      v.Finish = WAVE_DATE;
    }
    return v;
  }
  const phase = PHASES.find((p) => p.title === issue.title);
  if (phase) {
    v.Phase = phase.phase;
    v.Status = phase.title === "M0 P0: Contracts" ? "In Progress" : "Todo";
    if (phase.title === "M0 P0: Contracts") v.Start = WAVE_DATE;
    return v;
  }
  const wave = WAVES.find((w) => waveTitle(w) === issue.title);
  if (wave) {
    v.Phase = "P0";
    v.Wave = `W${wave.k}`;
    v.Status = waveDone(wave)
      ? "Done"
      : { done: "Done", review: "In Review", ready: "Ready", todo: "Todo" }[wave.state];
    if (waveDone(wave) || wave.state === "review") {
      v.Start = WAVE_DATE;
      v.Finish = WAVE_DATE;
    }
    return v;
  }
  const f = FOLLOW_UPS.find((x) => x.title === issue.title);
  if (f) {
    if (f.track) v.Track = f.track;
    v.Phase = f.phase;
    v.Size = f.size;
    v.Priority = f.priority;
    v["Req IDs"] = f.reqIds;
    v.Status = issue.state === "closed" ? "Done" : "Todo";
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
const items = loadItems();

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
    // Status and Priority are seeded once; project-sync and the developer own them after
    // that. Only a closed issue is forced to Done.
    const seedOnly = name === "Priority" || (name === "Status" && value !== "Done");
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

// README progress block (Mermaid), regenerated from live data between markers.
const README_PATH = resolve(ROOT, "README.md");
const START =
  "<!-- progress:start (generated by scripts/ops/gh-setup-project.mjs; do not edit) -->";
const END = "<!-- progress:end -->";

function progressBlock() {
  const liveIssues = APPLY
    ? restAll(`repos/${REPO}/issues?state=all&per_page=100`).filter((i) => !i.pull_request)
    : [...issues.values()];
  const liveItems = APPLY ? loadItems() : items;
  const msLive = restAll(`repos/${REPO}/milestones?state=all&per_page=100`);
  const lines = [];

  // Roadmap: milestones left to right, phases coloured by status with sub-issue progress.
  lines.push("```mermaid", "flowchart LR");
  const classOf = new Map();
  PHASES.forEach((p, idx) => {
    const issue = liveIssues.find((i) => i.title === p.title);
    const sum = issue ? rest(`repos/${REPO}/issues/${issue.number}`).sub_issues_summary : null;
    const status = issue ? liveItems.get(issue.number)?.values.Status : undefined;
    const done = issue?.state === "closed" || (sum && sum.total > 0 && sum.completed === sum.total);
    const active =
      !done && (status === "In Progress" || status === "In Review" || (sum?.completed ?? 0) > 0);
    classOf.set(idx, done ? "done" : active ? "active" : "todo");
    p.node = `ph${idx}`;
    p.label = `${p.title.split(": ")[0].split(" ")[1]} ${p.title.split(": ")[1]}${sum && sum.total > 0 ? `<br/>${sum.completed}/${sum.total} done` : ""}`;
  });
  const byMilestone = new Map();
  for (const p of PHASES)
    byMilestone.set(p.milestone, [...(byMilestone.get(p.milestone) ?? []), p]);
  let mi = 0;
  const firstNodes = [];
  for (const [title, phases] of byMilestone) {
    const m = msLive.find((x) => x.title === title);
    const total = m ? m.open_issues + m.closed_issues : 0;
    const pct = total > 0 ? Math.round((100 * m.closed_issues) / total) : 0;
    lines.push(
      `  subgraph M${mi}["${title}<br/>${pct}% of ${total} issues closed"]`,
      "    direction TB",
    );
    for (const p of phases) lines.push(`    ${p.node}["${p.label}"]`);
    for (let j = 1; j < phases.length; j += 1)
      lines.push(`    ${phases[j - 1].node} --> ${phases[j].node}`);
    lines.push("  end");
    firstNodes.push(`M${mi}`);
    mi += 1;
  }
  lines.push(`  ${firstNodes.join(" --> ")}`);
  lines.push(
    "  classDef done fill:#2da44e,stroke:#1a7f37,color:#ffffff",
    "  classDef active fill:#d29922,stroke:#9a6700,color:#ffffff",
    "  classDef todo fill:#eaeef2,stroke:#8c959f,color:#24292f",
  );
  for (const cls of ["done", "active", "todo"]) {
    const ids = PHASES.filter((_, i) => classOf.get(i) === cls).map((p) => p.node);
    if (ids.length > 0) lines.push(`  class ${ids.join(",")} ${cls}`);
  }
  lines.push("```", "");

  // P0 wave timeline: first commit to merge of each merged wave PR (UTC).
  const spans = [];
  for (const w of WAVES) {
    if (!w.pr) continue;
    const pr = rest(`repos/${REPO}/pulls/${w.pr}`);
    if (!pr.merged_at) continue;
    const commits = restAll(`repos/${REPO}/pulls/${w.pr}/commits?per_page=100`);
    const first = commits.map((c) => c.commit.author.date).sort()[0] ?? pr.created_at;
    spans.push({ w, start: first, end: pr.merged_at });
  }
  if (spans.length > 0) {
    const fmt = (iso) => iso.slice(0, 16).replace("T", " ");
    lines.push(
      "```mermaid",
      "gantt",
      "  title P0 waves: first commit to merge (UTC)",
      "  dateFormat YYYY-MM-DD HH:mm",
      "  axisFormat %m-%d %H:%M",
    );
    lines.push("  section M0 P0 Contracts");
    for (const s of spans) {
      lines.push(
        `  W${s.w.k} Tasks ${s.w.tasks[0]} to ${s.w.tasks[1]} (PR ${s.w.pr}) :done, w${s.w.k}, ${fmt(s.start)}, ${fmt(s.end)}`,
      );
    }
    lines.push("```", "");
  }

  // Board status of task and follow-up issues (parents excluded).
  const counts = new Map(STATUS_OPTIONS.map((o) => [o.name, 0]));
  for (const i of liveIssues) {
    if (i.labels.some((l) => (l.name ?? l) === "epic")) continue;
    const st = liveItems.get(i.number)?.values.Status;
    if (st && counts.has(st)) counts.set(st, counts.get(st) + 1);
  }
  lines.push("```mermaid", "pie showData", "  title Tasks and follow-ups by board status");
  for (const [name, n] of counts) if (n > 0) lines.push(`  "${name}" : ${n}`);
  lines.push("```");
  return lines.join("\n");
}

{
  const readme = readFileSync(README_PATH, "utf8");
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error("README.md has no progress markers");
  const next = `${readme.slice(0, a + START.length)}\n\n${progressBlock()}\n\n${readme.slice(b)}`;
  if (next !== readme) {
    write("update the README progress block", () => writeFileSync(README_PATH, next));
    if (APPLY) console.log("README.md changed locally; commit it");
  }
}

console.log(`${APPLY ? "applied" : "planned"} ${writes} change(s)`);
