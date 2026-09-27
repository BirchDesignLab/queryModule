// Renders docs/assets/progress-{light,dark}.svg from a fixture model, so the
// README picture (#80 requirement 8) resolves without a live `gh api` read.
// The controller regenerates these from live data with
// `gh-setup-project.mjs --dashboard` after the wave merges (task-W5B-carries
// W5B-2/W5B-4); this script exists so the fixture render is reproducible and
// not a one-off hand edit (Scripts stay in the repo, not in temp).
//
// Usage: node scripts/mock-data/render-fixture-dashboard.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "../ops/progress-svg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const FIXTURE_MODEL = {
  asOf: "2026-09-26",
  milestones: [
    {
      title: "M0 Skeleton",
      closed: 26,
      total: 50,
      phases: [
        { title: "Contracts (M0 P0)", closed: 6, total: 9 },
        { title: "Foundation (M0 P1)", closed: 0, total: 10 },
      ],
    },
    {
      title: "M1 Forms and terminal",
      closed: 0,
      total: 3,
      phases: [{ title: "Engine (M1 P2)", closed: 0, total: 1 }],
    },
    { title: "M2 Results and audit", closed: 0, total: 4, phases: [] },
    { title: "M3 Workflow and compliance", closed: 0, total: 4, phases: [] },
    {
      title: "M4 Mobile and host integration",
      closed: 0,
      total: 5,
      phases: [{ title: "Layouts and host (M4 P1)", closed: 0, total: 1 }],
    },
  ],
  waves: [
    {
      k: 1,
      title: "Workspace and first contracts (Tasks 1 to 6)",
      start: "2026-09-25",
      finish: "2026-09-26",
    },
    {
      k: 2,
      title: "Site config schema (Tasks 7 to 11)",
      start: "2026-09-26",
      finish: "2026-09-26",
    },
    {
      k: 3,
      title: "Config validation and shipped sites (Tasks 12 to 16)",
      start: "2026-09-26",
      finish: "2026-09-26",
    },
    { k: 4, title: "Verify gate (Tasks 17 to 22)", start: "2026-09-26", finish: "2026-09-26" },
    { k: 5, title: "Tokens and web shell (Tasks 23 to 25)", start: "2026-09-26", finish: null },
    { k: 6, title: "Mobile placeholder and ruleset (Tasks 26 to 28)", start: null, finish: null },
  ],
  decisions: [],
  statusCounts: [
    { status: "Todo", count: 19 },
    { status: "Ready", count: 3 },
    { status: "Done", count: 22 },
  ],
};

for (const theme of ["light", "dark"]) {
  const svg = renderDashboard(FIXTURE_MODEL, theme);
  writeFileSync(resolve(ROOT, `docs/assets/progress-${theme}.svg`), `${svg}\n`);
  console.log(`wrote docs/assets/progress-${theme}.svg (${svg.length} bytes)`);
}
