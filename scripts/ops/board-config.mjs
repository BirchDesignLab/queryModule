// board-config.mjs: structural and destructive GitHub config for
// gh-setup-project.mjs (Task 604, #92, R2 "what stays in the script"). No IO:
// pure data only, so it can be imported by a test (board-data.test.ts) without
// triggering the live gh calls that importing gh-setup-project.mjs itself
// would run at module load time.
//
// A docs/board/board-data.json edit must never be able to delete a label, add
// a field, or change which repo or project is written; nothing here moves to
// the data file.

export const REPO = "BirchDesignLab/queryModule";
export const OWNER = "BirchDesignLab";
export const PROJECT_NUMBER = 1;

export const REMOVE_LABELS = ["good first issue", "help wanted", "invalid", "wontfix", "duplicate"];

export const LABELS = [
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

export const MILESTONES = {
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

export const STATUS_OPTIONS = [
  { name: "Todo", color: "GRAY", description: "Not started" },
  { name: "In Progress", color: "YELLOW", description: "A session is working on it" },
  { name: "In Review", color: "PURPLE", description: "PR open; review or checks running" },
  {
    name: "Blocked",
    color: "RED",
    description: "Waiting on a decision, another issue or an admin step",
  },
  { name: "Done", color: "GREEN", description: "Merged or closed as completed" },
];

export const FIELDS = [
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
    options: [
      { name: "P0", color: "GRAY", description: "Contracts" },
      {
        name: "P0.5",
        color: "PINK",
        description: "Dispatch: an interim build between contracts and P1 (ADR-0012)",
      },
      { name: "P1", color: "BLUE", description: "Foundation or first build" },
      { name: "P2", color: "YELLOW", description: "Engine or core feature" },
      { name: "P3", color: "GREEN", description: "Flow, hardening or exit" },
    ],
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

// The full label vocabulary the board scripts manage or rely on (Task 604,
// R3), used to validate `board-data.json` follow-up labels. `LABELS` above
// (epic, follow-up, decision) are created by this script; the track and phase
// labels plus `sensitive`, `contract` and `api-breaking` are created by
// scripts/ops/gh-setup-labels.sh; `documentation`, `bug`, `enhancement`,
// `question` and `accessibility` are GitHub's own defaults that
// docs/project-board.md's "## Labels" section names as part of the set every
// issue draws from. A label outside this list is not one the board scripts
// know how to create, so a follow-up naming it fails validation instead of
// silently trying to apply a label GitHub may reject.
export const KNOWN_LABELS = [
  ...LABELS.map((l) => l.name),
  "platform",
  "web",
  "core",
  "mobile",
  "p0",
  "p0-5",
  "p1",
  "p2",
  "p3",
  "sensitive",
  "contract",
  "api-breaking",
  "documentation",
  "bug",
  "enhancement",
  "question",
  "accessibility",
];
