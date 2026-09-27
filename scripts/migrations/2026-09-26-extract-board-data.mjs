#!/usr/bin/env node
// 2026-09-26-extract-board-data.mjs: one-off migration helper for Task 604
// (#92 "board data out of the gate path"). Extracts the five in-script board
// data constants (PHASES, CONTRACTS_M0P0, MILESTONE_PARENT_NUMBERS, WAVES,
// FOLLOW_UPS) straight out of the pre-move scripts/ops/gh-setup-project.mjs
// source and writes them to scripts/ops/__fixtures__/board-data-pre-move.json.
//
// Why a script instead of hand-transcribing: FOLLOW_UPS carries long body
// strings with embedded backticks, quotes and markdown; copying them by hand
// risks a silent byte drift that the R4 equivalence test exists to catch.
// Evaluating the real source once, before any edit, removes that risk.
//
// This fixture is the baseline the equivalence test (scripts/ops/board-data.test.ts)
// deep-equals against (minus the two follow-ups #92 and #94 added by Task 604,
// which never existed in the pre-move script). Re-run only if a future task
// needs to regenerate the pre-move baseline from a different commit; the
// normal path after this migration is to edit docs/board/board-data.json
// directly, not to re-run this script.
//
// Usage: node scripts/migrations/2026-09-26-extract-board-data.mjs [ref]
//   ref: a git ref/committish to read scripts/ops/gh-setup-project.mjs from
//        (default: HEAD). Uses `git show <ref>:<path>` so it works even after
//        the script has since been edited on the current branch.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ref = process.argv[2] ?? "HEAD";
const scriptRelPath = "scripts/ops/gh-setup-project.mjs";

const show = spawnSync("git", ["show", `${ref}:${scriptRelPath}`], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (show.status !== 0) {
  console.error(`git show ${ref}:${scriptRelPath} failed: ${show.stderr.trim()}`);
  process.exit(1);
}
const source = show.stdout;

const startMarker = "// ---------------------------------------------------------------- data";
const endMarker = "// ---------------------------------------------------------------- gh plumbing";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  console.error(`could not find the data section markers in ${scriptRelPath}@${ref}`);
  process.exit(1);
}
const dataSection = source.slice(start, end);

// OS temp, never the repo tree (W6 critic C6); removed after the import below.
const tmpDir = mkdtempSync(resolve(tmpdir(), "board-data-extract-"));
const tmpFile = resolve(tmpDir, `board-data-source-${ref.replace(/[^A-Za-z0-9]/g, "_")}.mjs`);
writeFileSync(
  tmpFile,
  `${dataSection}\nexport { PHASES, CONTRACTS_M0P0, MILESTONE_PARENT_NUMBERS, WAVES, FOLLOW_UPS };\n`,
);

let mod;
try {
  mod = await import(`file://${tmpFile.replace(/\\/g, "/")}`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
const fixture = {
  phases: mod.PHASES,
  contractsM0P0: mod.CONTRACTS_M0P0,
  milestoneParentNumbers: mod.MILESTONE_PARENT_NUMBERS,
  waves: mod.WAVES,
  followUps: mod.FOLLOW_UPS,
};

const outPath = resolve(ROOT, "scripts/ops/__fixtures__/board-data-pre-move.json");
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${outPath} from ${scriptRelPath}@${ref}`);
console.log(
  `phases=${fixture.phases.length} waves=${fixture.waves.length} followUps=${fixture.followUps.length}`,
);
