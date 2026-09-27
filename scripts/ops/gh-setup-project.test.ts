import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

describe("gh-setup-project: SVG dashboard, --dashboard flag (#80 requirement 8)", () => {
  it("recognises --dashboard, rejects it combined with --apply, and never sets APPLY from it", () => {
    expect(source).toMatch(/const DASHBOARD = argv\.includes\("--dashboard"\);/);
    expect(source).toMatch(/if \(APPLY && DASHBOARD\)/);
    expect(source).toMatch(/known = new Set\(\["--apply", "--dashboard", "--as", AS\]\);/);
  });

  it("gates local file writes (SVGs, README) on APPLY or DASHBOARD, never GitHub writes on DASHBOARD alone", () => {
    const start = source.indexOf("function writeLocalFile(what, fn) {");
    const end = source.indexOf("{\n  const model = dashboardModel();");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/if \(!\(APPLY \|\| DASHBOARD\)\)/);
    // The GitHub-write helper stays gated on APPLY alone (unchanged by this task).
    const writeFn = source.slice(
      source.indexOf("function write(what, fn) {"),
      source.indexOf("function writeLocalFile"),
    );
    expect(writeFn).toMatch(/if \(!APPLY\)/);
  });

  it("replaces the Mermaid README block with an SVG <picture> built from renderDashboard", () => {
    expect(source).toMatch(/import \{ renderDashboard \} from "\.\/progress-svg\.mjs";/);
    expect(source).toMatch(/<picture>/);
    expect(source).toMatch(/prefers-color-scheme: dark/);
    expect(source).not.toMatch(/```mermaid/);
  });
});

describe("gh-setup-project: dashboardModel reads post-write field values (r2:new-1)", () => {
  it("reloads items after the field-value write loop, before dashboardModel() runs", () => {
    const loopStart = source.indexOf("for (const issue of all) {");
    const loopEnd = source.indexOf("// README progress block:");
    const dashboardCallIndex = source.indexOf("const model = dashboardModel();");
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);
    expect(dashboardCallIndex).toBeGreaterThan(loopEnd);
    const betweenLoopAndDashboard = source.slice(loopStart, dashboardCallIndex);
    // Mirrors the deleted progressBlock()'s `APPLY ? loadItems() : items`: a
    // live --apply run must see the Status/field values this run just wrote,
    // not the pre-run snapshot captured before the loop.
    expect(betweenLoopAndDashboard).toMatch(/items = APPLY \? loadItems\(\) : items;/);
    // `items` must be reassignable for the reload to take effect.
    expect(source).toMatch(/let items = loadItems\(\);/);
    expect(source).not.toMatch(/const items = loadItems\(\);/);
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

describe("gh-setup-project: merged-wave PR reads gated on --dashboard (#85, #92 R6)", () => {
  it("reads a wave's PR and commits only from inside fetchPrSpan/dashboardModel", () => {
    const start = source.indexOf("function fetchPrSpan(prNumber) {");
    const end = source.indexOf("// Local file writes");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/pulls\/\$\{/);
    expect(block).toMatch(/DASHBOARD/);
  });

  it("only calls the PR-span fetch when DASHBOARD is true and the wave has a pr", () => {
    // fetchPrSpan is the only place `pulls/{n}` (and its commits) are read;
    // gating this call site is what keeps the live reads out of a plain dry
    // run or --apply alone (R6: "only in --dashboard mode").
    expect(source).toMatch(
      /DASHBOARD\s*&&\s*w\.pr\s*\?\s*waveSpan\(rolled,\s*fetchPrSpan\(w\.pr\)\)\s*:\s*rolled/,
    );
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
