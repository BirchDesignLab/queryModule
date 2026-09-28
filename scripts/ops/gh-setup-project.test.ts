import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STATUS_OPTIONS } from "./board-config.mjs";

// gh-setup-project.mjs is network glue and stays out of coverage, but the
// specific shape of its wave-parent ensureIssue call is a static fact we can
// check without hitting GitHub.
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "gh-setup-project.mjs");
const source = readFileSync(scriptPath, "utf8");

describe("gh-setup-project: wave parent close (#79 item 1, critic:I1)", () => {
  it("never plans a close of a wave parent issue", () => {
    // Closing a wave parent is project-sync's job (docs/project-board.md, "a
    // wave parent closes when all of its tasks are closed"). The setup
    // script's ensureIssue call for a wave issue must never pass a `closed`
    // key at all, so a rerun never forces a wave parent issue closed itself.
    const start = source.indexOf("const waveIssue = new Map();");
    const end = source.indexOf("const followUps = new Map();");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const waveSetupBlock = source.slice(start, end);
    expect(waveSetupBlock).not.toMatch(/closed\s*:/);
  });
});

describe("gh-setup-project: issue index keyed by number, not title (#80, critic:C3)", () => {
  it("builds the issues Map keyed by issue number", () => {
    const start = source.indexOf("const issues = new Map(");
    const end = source.indexOf("const byNumber =");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const issuesMapEnd = source.indexOf(");", start);
    const issuesMapBlock = source.slice(start, issuesMapEnd);
    // Keyed by i.number, never i.title: two live issues sharing a title must
    // not collapse to one map entry.
    expect(issuesMapBlock).toMatch(/\.map\(\(i\) => \[i\.number, i\]\)/);
    expect(issuesMapBlock).not.toMatch(/\.map\(\(i\) => \[i\.title, i\]\)/);
  });

  it("looks numbers up directly instead of scanning issues.values()", () => {
    expect(source).toMatch(/const byNumber = \(n\) => issues\.get\(n\);/);
    expect(source).not.toMatch(/\[\.\.\.issues\.values\(\)\]\.find\(\(i\) => i\.number === n\)/);
  });
});

describe("gh-setup-project: date backfill reuses board-model.mjs (#80 requirement 7, critic:C2)", () => {
  it("imports leafDates and rollUp from board-model.mjs instead of a hardcoded WAVE_DATE", () => {
    expect(source).toMatch(
      /import \{[^}]*leafDates[^}]*rollUp[^}]*\} from "\.\/board-model\.mjs";/s,
    );
    expect(source).not.toMatch(/WAVE_DATE/);
  });

  it("rolls wave, phase and milestone dates up from their children before desired() reads them", () => {
    const start = source.indexOf("const datesByNumber = new Map();");
    const end = source.indexOf("// Labels");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/leafDates\(issue\)/);
    expect(block).toMatch(/rollUp\(children\)/);
  });
});

describe("gh-setup-project: refuses to adopt a non-follow-up issue (#96 G-M4)", () => {
  it("checks followUpAdoptionError after loading issues and throws before the first write", () => {
    const load = source.indexOf("const byNumber = ");
    const check = source.indexOf("followUpAdoptionError(FOLLOW_UPS, byNumber)");
    const firstWrite = source.indexOf("write(`");
    expect(load).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(load);
    expect(check).toBeLessThan(firstWrite);
  });
});

describe("gh-setup-project: board data loads and validates before any gh call (Task 604, #92 R3)", () => {
  it("imports the ordinary-tier board data loader and the gate-tier config module", () => {
    expect(source).toMatch(/import \{ loadBoardDataOrExit \} from "\.\/board-data\.mjs";/);
    expect(source).toMatch(/from "\.\/board-config\.mjs";/);
  });

  it("calls loadBoardDataOrExit before the first gh CLI invocation", () => {
    const loadIndex = source.indexOf("loadBoardDataOrExit(");
    const firstGhCall = source.indexOf('spawnSync("gh"');
    expect(loadIndex).toBeGreaterThan(-1);
    expect(firstGhCall).toBeGreaterThan(-1);
    expect(loadIndex).toBeLessThan(firstGhCall);
  });

  it("no longer hardcodes PHASES, WAVES or FOLLOW_UPS; they come from boardData", () => {
    expect(source).not.toMatch(/const PHASES = \[/);
    expect(source).not.toMatch(/const WAVES = \[/);
    expect(source).not.toMatch(/const FOLLOW_UPS = \[/);
    expect(source).toMatch(/const PHASES = boardData\.phases;/);
    expect(source).toMatch(/const WAVES = boardData\.waves;/);
    expect(source).toMatch(/const FOLLOW_UPS = boardData\.followUps;/);
  });
});

describe("gh-setup-project: no hard-coded parent Status (issue #193)", () => {
  it("no longer hard-codes a milestone or phase Status; both come from parentStatus", () => {
    expect(source).not.toMatch(/"M0 Skeleton" \? "In Progress" : "Todo"/);
    expect(source).not.toMatch(/CONTRACTS_M0P0 \? "In Progress" : "Todo"/);
    expect(source).toMatch(/import \{[^}]*parentStatus[^}]*\} from "\.\/board-model\.mjs";/s);
    expect(source).toMatch(/parentStatus\(/);
  });
});

describe("gh-setup-project: number:null duplicate guard (#80, critic:C4)", () => {
  it("looks up an existing issue by title before POSTing a spec with number: null", () => {
    const start = source.indexOf("function ensureIssue(spec) {");
    const end = source.indexOf("const subCache = new Map();");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    // The guard runs before the create POST and only for number: null specs,
    // so a rerun after a mid-run throw (number never recorded back into the
    // data) reuses the already-created epic instead of creating another.
    const guardIndex = block.indexOf("issuesByTitle.has(spec.title)");
    const postIndex = block.search(/rest\(`repos\/\$\{REPO\}\/issues`, "POST", body\)/);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(guardIndex);
    expect(block).toMatch(/spec\.number === null && issuesByTitle\.has\(spec\.title\)/);
  });
});

describe("gh-setup-project: follow-up with no parent (#231 board cap)", () => {
  // The M0 P1 phase parent is at GitHub's 100 sub-issue cap, and board-data-schema.mjs allows
  // a follow-up without `parent`. Such a follow-up stays on the project with its fields but is
  // never linked; a follow-up whose declared parent is missing still reaches ensureChild, which
  // throws under --apply.
  it("skips ensureChild only when f.parent is undefined", () => {
    const start = source.indexOf("const followUps = new Map();");
    const end = source.indexOf("// Field values");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const skip = block.search(/if \(f\.parent === undefined\) continue;/);
    const link = block.indexOf("ensureChild(parent, issue");
    expect(skip).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(skip);
    expect(block.indexOf("followUps.set(f.number, issue);")).toBeLessThan(skip);
  });
});

describe("gh-setup-project: no README SVG dashboard; the Project board is the view (#244)", () => {
  it("rejects --dashboard as an unknown option with exit 2 and the usage line", () => {
    const r = spawnSync(process.execPath, [scriptPath, "--dashboard"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown argument --dashboard");
    expect(r.stderr).toContain(
      "usage: node scripts/ops/gh-setup-project.mjs [--apply] [--as <login>]",
    );
  });

  it("writes no local file in any mode: no SVG, no README block, no PR span reads", () => {
    expect(source).not.toMatch(/writeFileSync/);
    expect(source).not.toMatch(/docs\/assets/);
    expect(source).not.toMatch(/README\.md/);
    expect(source).not.toMatch(/progress:start|progress-svg|renderDashboard|DASHBOARD|waveSpan/);
    expect(source).not.toMatch(/pulls\/\$\{/);
  });
});

describe("gh-setup-project: Status options drop the unused Ready column (#244)", () => {
  it("has no Ready option and keeps Blocked for project-sync's Blocked preservation", () => {
    const names = STATUS_OPTIONS.map((o) => o.name);
    expect(names).toEqual(["Todo", "In Progress", "In Review", "Blocked", "Done"]);
  });

  it("maps a ready wave to Todo when seeding task Status", () => {
    expect(source).not.toMatch(/ready: "Ready"/);
    expect(source).toMatch(/\{ review: "In Review", ready: "Todo", todo: "Todo" \}\[w\.state\]/);
  });
});
