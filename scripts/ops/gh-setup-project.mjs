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
  bodyUpdate,
  closedStatus,
  leafDates,
  matchParent,
  rollUp,
  titleUpdate,
  waveParentStatus,
} from "./board-model.mjs";
import { renderDashboard } from "./progress-svg.mjs";

const REPO = "BirchDesignLab/queryModule";
const OWNER = "BirchDesignLab";
const PROJECT_NUMBER = 1;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN = "docs/superpowers/plans/2026-09-25-p0-contracts.md";

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
  {
    name: "Level",
    options: ["Milestone", "Phase", "Wave", "Task", "Follow-up"].map((name, i) => ({
      name,
      color: ["PURPLE", "BLUE", "GRAY", "GREEN", "YELLOW"][i],
      description: `A ${name.toLowerCase()} item on the board`,
    })),
  },
];

// Human-readable titles; codes live in fields (Level, Phase, Wave), never in
// the title (developer decision, #80). Matched to GitHub by `number`
// (recorded 09-26-26, .superpowers/sdd/2026-09-25-p0-contracts/task-W5B-mapping.md),
// never by title: a title below that differs from GitHub is a planned rename
// (matchParent, titleUpdate in board-model.mjs).
const PHASES = [
  [
    39,
    "Contracts (M0 P0)",
    "M0 Skeleton",
    "P0",
    "Typecheck and CI green; contracts frozen",
    "2026-09-25-p0-contracts.md",
  ],
  [
    40,
    "Foundation (M0 P1)",
    "M0 Skeleton",
    "P1",
    "M0 exit",
    "2026-09-25-track-a-p1.md and 2026-09-25-track-b-p1.md",
  ],
  [
    41,
    "Engine (M1 P2)",
    "M1 Forms and terminal",
    "P2",
    "Form on GET config; parser property tests",
    null,
  ],
  [42, "Flow (M1 P3)", "M1 Forms and terminal", "P3", "M1 exit", null],
  [
    43,
    "Contracts (M2 P0)",
    "M2 Results and audit",
    "P0",
    "Contracts frozen; OpenAPI diff reviewed",
    null,
  ],
  [44, "Feed (M2 P1)", "M2 Results and audit", "P1", "A6; replay test", null],
  [45, "Audit (M2 P2)", "M2 Results and audit", "P2", "A7 to A9", null],
  [46, "Hardening (M2 P3)", "M2 Results and audit", "P3", "M2 exit", null],
  [
    47,
    "Contracts (M3 P0)",
    "M3 Workflow and compliance",
    "P0",
    "Contracts frozen; flags off",
    null,
  ],
  [
    48,
    "Credentials and MFA (M3 P1)",
    "M3 Workflow and compliance",
    "P1",
    "B4; raw-bytes and log-capture",
    null,
  ],
  [
    49,
    "Multi-source, nested, hide (M3 P2)",
    "M3 Workflow and compliance",
    "P2",
    "B1, B2, B5, B7",
    null,
  ],
  [50, "Delegation (M3 P3)", "M3 Workflow and compliance", "P3", "M3 exit; flags on", null],
  [
    51,
    "Contracts (M4 P0)",
    "M4 Mobile and host integration",
    "P0",
    "expo export green; contracts frozen",
    null,
  ],
  [
    52,
    "Layouts and host (M4 P1)",
    "M4 Mobile and host integration",
    "P1",
    "C1 on web; host-simulator test",
    null,
  ],
  [53, "Native (M4 P2)", "M4 Mobile and host integration", "P2", "C1 and C2 on native", null],
  [54, "Exit (M4 P3)", "M4 Mobile and host integration", "P3", "M4 exit", null],
].map(([number, title, milestone, phase, gate, plan]) => ({
  number,
  title,
  milestone,
  phase,
  gate,
  plan,
}));
const CONTRACTS_M0P0 = 39;

// Five milestone parents (label epic, milestone set): title is the milestone
// name (developer decision, #80). Numbers recorded from the first --apply
// (09-26-26); a new milestone starts at null until the script creates it.
const MILESTONE_PARENT_NUMBERS = {
  "M0 Skeleton": 86,
  "M1 Forms and terminal": 87,
  "M2 Results and audit": 88,
  "M3 Workflow and compliance": 89,
  "M4 Mobile and host integration": 90,
};
const MILESTONE_PARENTS = Object.keys(MILESTONES).map((title) => ({
  number: MILESTONE_PARENT_NUMBERS[title] ?? null,
  title,
}));

// P0 waves (plan "## Waves"). Task N is issue #N+1. Numbers #55 to #60
// recorded 09-26-26 (task-W5B-mapping.md); titles are the wave parent titles
// from the #80 developer decision (human-readable, matched by number).
const WAVES = [
  {
    number: 55,
    k: 1,
    title: "Wave 1: Workspace and first contracts (Tasks 1 to 6)",
    tasks: [1, 6],
    pr: 31,
    state: "done",
  },
  {
    number: 56,
    k: 2,
    title: "Wave 2: Site config schema (Tasks 7 to 11)",
    tasks: [7, 11],
    pr: 33,
    state: "done",
  },
  {
    number: 57,
    k: 3,
    title: "Wave 3: Config validation and shipped sites (Tasks 12 to 16)",
    tasks: [12, 16],
    pr: 35,
    state: "done",
  },
  {
    number: 58,
    k: 4,
    title: "Wave 4: Verify gate (Tasks 17 to 22)",
    tasks: [17, 22],
    pr: 38,
    state: "done",
  },
  {
    number: 59,
    k: 5,
    title: "Wave 5: Tokens and web shell (Tasks 23 to 25)",
    tasks: [23, 25],
    pr: 83,
    state: "done",
  },
  {
    number: 60,
    k: 6,
    title: "Wave 6: Mobile placeholder and ruleset (Tasks 26 to 28)",
    tasks: [26, 28],
    pr: null,
    state: "todo",
  },
];

const src = (s) => `\n\n**Source:** ${s}`;
const FOLLOW_UPS = [
  {
    number: 61,
    title: "Decide: bound message and label keys before the P0 freeze (ADR-0005)",
    labels: ["decision", "follow-up", "core", "p0", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 39,
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
    number: 62,
    title: "Sensitive paths: list nested biome.json files and .gitignore",
    labels: ["follow-up", "platform", "p0", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 59,
    track: "Platform (A)",
    phase: "P0",
    size: "S",
    priority: "High",
    reqIds: "SEC-020",
    body:
      "Biome honours nested `biome.json` files (`root: false`) and `vcs.useIgnoreFile: true` skips files matched by `.gitignore`. A PR can add `packages/core/biome.json` or a `.gitignore` line and switch off lint, including the core purity rule, without a sensitive-review artifact.\n\nFixed in PR #76 (ADR-0007 tiers): replace `biome.json` with `**/biome.json` and add `.gitignore` in `.github/sensitive-paths` (or set `useIgnoreFile: false` and rely on `files.includes`), mirror in CLAUDE.md, and extend the shipped-glob test in `scripts/ci/sensitive-review.test.ts`. PR #76 lists both in `[gate]` and closes this issue." +
      src("PR #38 wave-review residual RR-M1."),
  },
  {
    number: 63,
    title: "GET /api/v1/config returns only the ClientSiteConfig allowlist",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 64,
    title: "getLocale handler returns 400 validationFailed for a malformed locale",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 65,
    title: "Confirm Better Auth user ids fit BoundedIdSchema",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 66,
    title: "Client parsers tolerate unknown WS message types and ApiError fields",
    labels: ["follow-up", "web", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 67,
    title: "promote.yml: milestone argument, full history, fail on non-zero",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 68,
    title: "Licence check covers the first runtime dependency of api or apps",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 69,
    title: "OpenAPI: input-side request bodies and a stable Condition component name",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 70,
    title: "Threat model: sensitive-review cannot stop a PR editing its own checker",
    labels: ["follow-up", "documentation", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 71,
    title: "Core purity lint also catches IO globals",
    labels: ["follow-up", "core", "p0"],
    milestone: "M0 Skeleton",
    parent: 39,
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
    number: 72,
    title: "Embedded login: validate the host email claim before it reaches audit",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M4 Mobile and host integration",
    parent: 52,
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
    number: 73,
    title: "Duplicate response-mapping check uses the canonical when condition",
    labels: ["follow-up", "core", "p2"],
    milestone: "M1 Forms and terminal",
    parent: 41,
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
    number: 74,
    title: "Verify-gate CLI tidy-ups (deferred minors from W4)",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 77,
    title: "Live progress dashboard on GitHub Pages",
    labels: ["follow-up", "enhancement", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 40,
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
    number: 78,
    title: "Decide: recalibrate review rules before W5 (sdd-task and wave-review by tier)",
    labels: ["decision", "follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
    track: "Platform (A)",
    phase: "P1",
    size: "M",
    priority: "Medium",
    reqIds: "",
    body:
      "ADR-0007 tiered the CI sensitive-review check; our own agent review rules are not tiered yet. PR #76 cost three xhigh reviews (about 1.4M tokens, over 2 hours); W4 cost 74 agents.\n\nQuestions to settle before W5:\n- `sdd-task`: `sensitive: true` runs Opus medium implementer, fixer, critic, ruler and re-reviewer for every sensitive task. Should gate-tier tasks use ordinary tiers plus the Opus critic, keeping the full set for critical-tier tasks?\n- Per-task critic when `wave-review` follows: redundant for gate-tier tasks?\n- `wave-review` default effort should follow the PR's highest tier automatically (critical xhigh, gate high), not a manual role override.\n- `.claude/workflows/**` and the CLAUDE.md roles table decide how much review everything gets but are in no tier. Gate tier?\n- Scope freeze: a PR's sensitive scope is fixed before its review starts; later work goes in the next PR.\n- Retro: per role across W1 to W4, which findings were real (spec reviewer, quality reviewer, critic, ruler, checker, re-reviewer)." +
      src("developer, 09-26-26 (after PR #76)."),
  },
  {
    number: 79,
    title: "Board tooling: residual minors from the PR #76 review",
    labels: ["follow-up", "platform", "p1", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 40,
    track: "Platform (A)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "",
    body:
      "Residual minors from the final PR #76 `wave-review` (none fail open):\n- [ ] A setup-script rerun forces Done on an open wave parent whose tasks are all closed; derive it from issue state only.\n- [ ] The ci job's registry-only lockfile check is a text match; a block-style, quoted or differently spaced `resolution` with a tarball can slip past. Parse `pnpm-lock.yaml` instead.\n- [ ] `gh-setup-project.mjs` never rewrites existing issue bodies, so edits to follow-up text (#75) do not reach GitHub.\n\nNote: `scripts/ops/**` and `.github/**` are gate tier (ADR-0007), so these fixes need an Opus high review; bundle them into a wave PR." +
      src("PR #76 review 3 residual M1, M5, M11."),
  },
  {
    number: 80,
    title: "Roadmap roll-up: milestone parents, Level field, date roll-ups",
    labels: ["follow-up", "platform", "p0", "sensitive"],
    milestone: "M0 Skeleton",
    parent: 39,
    track: "Platform (A)",
    phase: "P0",
    size: "L",
    priority: "Urgent",
    reqIds: "",
    body:
      'The Roadmap view falls apart when tweaked: two layers of data are missing (developer, 09-26-26).\n\n- [ ] Task and follow-up dates: Start = issue created date, Finish = closed date (the roadmap needs custom date fields, so copy them).\n- [ ] Parent dates (wave, phase, milestone): Start = earliest child Start; Finish = latest child Finish once all children are closed, else the latest child date so far.\n- [ ] Milestone parent issues M0 to M4 (label `epic`), phases as their sub-issues; "No Parent issue" then holds only milestones.\n- [ ] `Level` single-select field: Milestone, Phase, Wave, Task, Follow-up. Suggested views: "Plan" (level Milestone, Phase), "P0 detail" (level Wave, Task, grouped by parent).\n- [ ] `project-sync` rolls dates up on every event; `scripts/ops/gh-setup-project.mjs` backfills once.\n- [ ] README SVG dashboard (option B) reads the same roll-ups.\n\nGate tier (`.github/workflows/**`, `scripts/ops/**`): ride W5, which gets a gate `wave-review` anyway.' +
      src("Roadmap view feedback, developer 09-26-26."),
  },
  {
    number: 84,
    title: "Track B P1 plan: align with the P0 tokens, platform and shell (W5 phase critic)",
    labels: ["follow-up", "web", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
    track: "Web (B)",
    phase: "P1",
    size: "M",
    priority: "Medium",
    reqIds: "",
    body:
      'The W5 phase Opus critic (PR #83) found that the Track B P1 plan (`docs/superpowers/plans/2026-09-25-track-b-p1.md`) contradicts what P0 shipped. Amend the plan before Track B P1 starts:\n\n- [ ] F1 (important): Tasks 1 and 14 still create `packages/client/src/platform.ts` with another shape (`Signal.get`, `WritableSignal`, non-null `tokenStore`, no `clear()`, a `visibility` field; plan lines ~150, 3058, 3114-3116, 5461, 5601). Lead ruling R1: Modify, and use the P0 names (`PlatformSignal.current`, `visible`, nullable `tokenStore`).\n- [ ] F4 (important): `styles.css` (plan ~4716-4795) uses variables P0 never emits (`--focus-ring`, `--type-*`, `--space-*`, `--field-required`, `--radius-control`, `--motion-*`), so the focus outline is invalid and no ring shows (spec 6.4). Use the `--qm-` names from `cssVarName` (now including `--qm-focus-ring-width`, `--qm-focus-ring-offset`, `--qm-border-width`, `--qm-color-accent`), drop the literal `48px` (`--qm-target-min`), dedupe `body` and `:focus-visible` with `apps/web/src/shell.css`, and test that no unknown variable is used.\n- [ ] F5: Task 12 test expects `:root[data-theme="day"] {`; P0 emits day on bare `:root`.\n- [ ] F6: Task 11 quotes stale ratios; `it.each(COLOR_TOKENS)` gets an object (use `Object.keys`).\n- [ ] F7: the built entry script has no nonce; under `\'strict-dynamic\'` the app will not boot unless the API injects one. Use Vite `html.cspNonce` with a placeholder the API replaces, and an e2e check for zero CSP violations (Task 27 dependency).\n- [ ] F8: set `document.title` and `<html lang>` from the active locale (NFR-001).\n- [ ] F9: reuse P0 `VisuallyHidden` instead of a new `.qm-visually-hidden` class; add `clipPath: "inset(50%)"`.\n- [ ] F10: the focus ring colour equals some severity fills; keep offset rings on filled controls and draw badge edges with `color.border`.\n- [ ] Shell CSS tests read CSS from disk: a Vite `?raw` CSS import is `""` under Vitest (found in PR #83).' +
      src(
        "W5 phase critic, `.superpowers/sdd/2026-09-25-p0-contracts/w5-phase-critic.md` (Windows ledger), PR #83.\n",
      ),
  },
  {
    number: 85,
    title:
      "W5 deferred minors: IO-globals member access, config typecheck, TokenStore tier, jsdom and Node floor",
    labels: ["follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
    track: "Platform (A)",
    phase: "P1",
    size: "M",
    priority: "Medium",
    reqIds: "",
    body:
      'Deferred minors from the W5 reviews (PR #83), none fail open today:\n\n- [ ] Core IO-globals lint (#71) matches bare identifiers only: `globalThis.fetch`, `window.localStorage`, `self.navigator` in `packages/core/src` lint clean. Add a restricted member-access rule or a test-side scan.\n- [ ] `apps/web/vite.config.ts` and `vitest.config.ts` sit outside `tsc -b` (tsconfig `include: ["src"]`); add a node tsconfig so they are typechecked.\n- [ ] `packages/client` TokenStore (bearer token storage, SEC-006) has no `.github/sensitive-paths` tier, so the P1 native SecureStore store would land at ordinary tier. Decide its tier (critical-tier file change, own PR).\n- [x] jsdom is held at 29.1.1 because jsdom 30 needs Node >= 24.15 and `engines` is `>=24 <25`. Decide whether to raise the Node floor to 24.15 (ADR-0001) and then take jsdom 30.\n- [ ] Dashboard wave timeline uses issue created dates (#80 rule), so every P0 wave shows 09-26; consider first-commit-to-merge spans for merged waves.\n- [x] `milestone parents` get Level and dates only on the run after their numbers are recorded (first `--apply` creates them).' +
      src("SDD ledger, W5 deferred minors (Tasks 23 to 25, W5A, W5B).\n"),
  },
  {
    number: 81,
    title: "Decide: CI pipeline design before the ruleset (ADR, before W6 Tasks 26 and 28)",
    labels: ["decision", "follow-up", "platform", "p1"],
    milestone: "M0 Skeleton",
    parent: 40,
    track: "Platform (A)",
    phase: "P1",
    size: "M",
    priority: "Medium",
    reqIds: "",
    body:
      "Before the ruleset makes `ci` and `sensitive-review` required (Task 28) and CI grows (Task 26 web build and expo export; Track A P1 image, boot smoke, Playwright, publish), settle the pipeline design so CI never becomes a merge blocker the way the review workflows did on PR #76 (developer, 09-26-26).\n\n- [ ] One stable required check: heavy work in separate jobs, a final `ci` job aggregates them, so new steps never touch the ruleset.\n- [ ] Path-scoped jobs: web build, expo export, image and Playwright run only when their paths change (extends the docs-only fast path).\n- [ ] Fast fail first: lint and typecheck ahead of parallel heavy jobs; `timeout-minutes` on every job; PR CI budget under 10 minutes.\n- [ ] Flake policy: Playwright one retry with trace; quarantine label plus issue; no silent retry loops.\n- [ ] External services (oasdiff image, dependency review, pipx zizmor): pinned and cached; an outage fails with a clear message, not a code failure.\n- [ ] Break glass: spec 9.1's empty bypass list plus a broken CI deadlocks a CI fix. Who may lift the ruleset (repo admin), when, and how it is logged.\n- [ ] Merge style: squash with linear history (spec 9.1) or merge commits for wave PRs, recorded in an ADR.\n- [ ] CI duration per PR recorded next to agent metrics." +
      src("developer, 09-26-26."),
  },
  {
    number: 75,
    title: "Board and repo settings: the manual steps",
    labels: ["documentation", "platform", "p0"],
    milestone: "M0 Skeleton",
    parent: 39,
    track: null,
    phase: "P0",
    size: "S",
    priority: "High",
    reqIds: "",
    assignee: "BirchDesignLab",
    body: 'Views, built-in project workflows and repo settings have no API. Follow the checklist in `docs/project-board.md` (section "Manual steps"), tick it there (it is the one checklist), and close this issue when it is done.',
  },
];

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
 * Build the progress-svg.mjs model from live data: milestone and phase
 * sub-issue progress, the P0 wave timeline (the same roll-up as
 * datesByNumber above), open decisions (label `decision`) and task/follow-up
 * counts by board Status (#80 requirement 8).
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
    return {
      k: w.k,
      title: w.title.replace(/^Wave \d+: /, "").replace(/ \(Tasks[^)]*\)$/, ""),
      start: d.start ?? null,
      finish: d.finish ?? null,
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
