import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIELDS, KNOWN_LABELS, MILESTONES } from "./board-config.mjs";
import { parseBoardData } from "./board-data.mjs";
import { validateBoardData } from "./board-data-schema.mjs";
import { phaseLabel } from "./board-model.mjs";

// docs/board/board-data.json holds the issue-content board data that used to
// live inline in gh-setup-project.mjs (`[gate]`, ADR-0007): PHASES,
// CONTRACTS_M0P0, MILESTONE_PARENT_NUMBERS, WAVES, FOLLOW_UPS (Task 604, #92).
// This test validates the shipped file, fail closed (R3), and has one failing
// case per schema rule so a future edit that breaks a rule is caught before
// the setup script ever reads GitHub.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOARD_DATA_PATH = resolve(ROOT, "docs/board/board-data.json");

const known = { milestoneNames: Object.keys(MILESTONES), labelNames: KNOWN_LABELS, fields: FIELDS };

function loadBoardData(): unknown {
  return JSON.parse(readFileSync(BOARD_DATA_PATH, "utf8"));
}

describe("validateBoardData: the shipped docs/board/board-data.json", () => {
  it("every Phase option has its label in scripts/ops/gh-setup-labels.sh (AW1 review G-M1)", () => {
    const sh = readFileSync(resolve(ROOT, "scripts/ops/gh-setup-labels.sh"), "utf8");
    const defined = new Set([...sh.matchAll(/^\s*"([a-z0-9-]+)\|/gm)].map((m) => m[1]));
    const phase = FIELDS.find((x) => x.name === "Phase");
    if (phase === undefined) throw new Error("no Phase field");
    for (const o of phase.options ?? []) expect(defined, o.name).toContain(phaseLabel(o.name));
  });

  it("validates with no errors", () => {
    const result = validateBoardData(loadBoardData(), known);
    expect(result.ok).toBe(true);
  });

  it("carries the Dispatch (M2 P0.5) phase parent #519 with the P0.5 phase option (ADR-0012)", () => {
    const data = loadBoardData() as {
      phases: Array<{ number: number; title: string; phase: string; milestone: string }>;
    };
    expect(data.phases.find((p) => p.number === 519)).toMatchObject({
      title: "Dispatch (M2 P0.5)",
      phase: "P0.5",
      milestone: "M2 Results and audit",
    });
    expect(KNOWN_LABELS).toContain("p0-5");
    // Carried into the P0.5 plans and linked under #519 by the planning PR (#557).
    const followUps = (
      loadBoardData() as { followUps: Array<{ number: number; parent: number; phase: string }> }
    ).followUps;
    for (const n of [482, 484, 486, 493]) {
      expect(followUps.find((f) => f.number === n)).toMatchObject({ parent: 519, phase: "P0.5" });
    }
  });

  it("carries the two Task 604 follow-ups (#92, #94) with their GitHub titles", () => {
    const data = loadBoardData() as { followUps: Array<{ number: number; title: string }> };
    const f92 = data.followUps.find((f) => f.number === 92);
    const f94 = data.followUps.find((f) => f.number === 94);
    expect(f92?.title).toMatch(/^Review cost: split small fixes by tier/);
    expect(f94?.title).toMatch(/^Documentation: final whole-product review/);
  });
});

describe("validateBoardData: fails closed on each schema rule (R3)", () => {
  const valid = loadBoardData() as {
    phases: unknown[];
    contractsM0P0: number;
    milestoneParentNumbers: Record<string, number | null>;
    waves: Array<Record<string, unknown>>;
    followUps: Array<Record<string, unknown>>;
  };

  it("accepts the valid document as a control", () => {
    expect(validateBoardData(valid, known).ok).toBe(true);
  });

  it("rejects an unknown key at the top level", () => {
    const result = validateBoardData({ ...valid, extra: true }, known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.pointer === "")).toBe(true);
  });

  it("rejects an unknown key on a follow-up", () => {
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, notAField: "x" } : f));
    const result = validateBoardData({ ...valid, followUps }, known);
    expect(result.ok).toBe(false);
  });

  it("rejects a follow-up label the scripts do not manage", () => {
    const followUps = valid.followUps.map((f, i) =>
      i === 0 ? { ...f, labels: ["not-a-real-label"] } : f,
    );
    const result = validateBoardData({ ...valid, followUps }, known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.pointer.includes("/labels/0"))).toBe(true);
  });

  it("rejects a follow-up milestone not in MILESTONES", () => {
    const followUps = valid.followUps.map((f, i) =>
      i === 0 ? { ...f, milestone: "M9 Not Real" } : f,
    );
    const result = validateBoardData({ ...valid, followUps }, known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.pointer.includes("/milestone"))).toBe(true);
  });

  it("rejects a negative issue number", () => {
    const phases = valid.phases.map((p, i) =>
      i === 0 ? { ...(p as Record<string, unknown>), number: -39 } : p,
    );
    const result = validateBoardData({ ...valid, phases }, known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.pointer.includes("/number"))).toBe(true);
  });

  it("rejects an empty title", () => {
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, title: "" } : f));
    const result = validateBoardData({ ...valid, followUps }, known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.pointer.includes("/title"))).toBe(true);
  });

  it("rejects a wave whose tasks range is descending", () => {
    const waves = valid.waves.map((w, i) => (i === 0 ? { ...w, tasks: [6, 1] } : w));
    const result = validateBoardData({ ...valid, waves }, known);
    expect(result.ok).toBe(false);
  });

  it("rejects a negative wave pr", () => {
    const waves = valid.waves.map((w, i) => (i === 0 ? { ...w, pr: -31 } : w));
    const result = validateBoardData({ ...valid, waves }, known);
    expect(result.ok).toBe(false);
  });

  it("rejects milestoneParentNumbers missing one of the five milestones", () => {
    const milestoneParentNumbers = { ...valid.milestoneParentNumbers };
    delete milestoneParentNumbers["M4 Mobile and host integration"];
    const result = validateBoardData({ ...valid, milestoneParentNumbers }, known);
    expect(result.ok).toBe(false);
  });

  it("accepts a milestone parent number of null (not created yet)", () => {
    const milestoneParentNumbers = { ...valid.milestoneParentNumbers, "M0 Skeleton": null };
    const result = validateBoardData({ ...valid, milestoneParentNumbers }, known);
    expect(result.ok).toBe(true);
  });

  it("rejects a follow-up parent that is not a positive integer", () => {
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, parent: 0 } : f));
    const result = validateBoardData({ ...valid, followUps }, known);
    expect(result.ok).toBe(false);
  });

  it("rejects a follow-up parent that is not a phase or wave issue, before any write (#96 G-M3)", () => {
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, parent: 9999 } : f));
    const result = validateBoardData({ ...valid, followUps }, known);
    expect(result).toMatchObject({
      ok: false,
      errors: [{ pointer: "/followUps/0/parent", message: expect.stringMatching(/#9999/) }],
    });
  });

  it("accepts a follow-up parent that is a phase or a wave issue", () => {
    const phase = (valid.phases[0] as { number: number }).number;
    const wave = valid.waves[0]?.number as number;
    for (const parent of [phase, wave]) {
      const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, parent } : f));
      expect(validateBoardData({ ...valid, followUps }, known).ok).toBe(true);
    }
  });
});

// R4 equivalence: the objects gh-setup-project.mjs builds from
// docs/board/board-data.json (via parseBoardData, the same parse-and-validate
// path the script itself calls) must deep-equal a snapshot of the five
// constants (PHASES, CONTRACTS_M0P0, MILESTONE_PARENT_NUMBERS, WAVES,
// FOLLOW_UPS) as they were hardcoded in gh-setup-project.mjs before the move,
// so a dry run plans the same writes before and after (R4). The fixture was
// generated once, mechanically, by
// scripts/migrations/2026-09-26-extract-board-data.mjs against commit
// a88611f528888d60f070d2de838806b21015b7cb (this task's starting HEAD): that
// script `git show`s the pre-move gh-setup-project.mjs, re-exports its five
// data constants from a temporary module, imports it, and serializes the
// constants to JSON, so the comparison never depends on a hand-transcribed
// copy of the (very long) follow-up bodies.
type BoardData = {
  phases: unknown;
  contractsM0P0: unknown;
  milestoneParentNumbers: unknown;
  waves: unknown;
  followUps: Array<{ number: number }>;
};

describe("R4 equivalence: the move commit's board-data.json matches the pre-move constants", () => {
  // A one-time migration proof, anchored to the move commit (8a438d2) so later
  // ordinary edits to docs/board/board-data.json (a wave's PR number, a ticked
  // follow-up) never trip it; the schema tests above judge the live file.
  const MOVE_COMMIT = "8a438d20877d834d4210a447c6fe751ff03738b0";
  const fixturePath = resolve(ROOT, "scripts/ops/__fixtures__/board-data-pre-move.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as BoardData;
  // #92 and #94 (R5) never existed in the pre-move script; every other
  // follow-up must match byte for byte.
  const ADDED_BY_TASK_604 = new Set([92, 94]);
  const shown = spawnSync("git", ["show", `${MOVE_COMMIT}:docs/board/board-data.json`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const moved = () => {
    // CI checks out full history (fetch-depth 0); a missing commit fails, never skips.
    expect(shown.status, shown.stderr).toBe(0);
    const result = parseBoardData(shown.stdout, known);
    if (!result.ok) throw new Error("expected the move commit's board-data.json to validate");
    return result.data as BoardData;
  };

  it("phases, contractsM0P0, milestoneParentNumbers and waves are unchanged by the move", () => {
    const data = moved();
    expect(data.phases).toEqual(fixture.phases);
    expect(data.contractsM0P0).toEqual(fixture.contractsM0P0);
    expect(data.milestoneParentNumbers).toEqual(fixture.milestoneParentNumbers);
    expect(data.waves).toEqual(fixture.waves);
  });

  it("every follow-up that existed before the move is byte-identical after it", () => {
    const carried = moved().followUps.filter((f) => !ADDED_BY_TASK_604.has(f.number));
    expect(carried).toEqual(fixture.followUps);
  });

  it("adds exactly #92 and #94 on top of the pre-move follow-ups", () => {
    const added = moved()
      .followUps.map((f) => f.number)
      .filter((n) => ADDED_BY_TASK_604.has(n))
      .sort((x, y) => x - y);
    expect(added).toEqual([92, 94]);
  });
});

describe("validateBoardData: numbers and field options (W6 critic C2, C3)", () => {
  const valid = JSON.parse(readFileSync(BOARD_DATA_PATH, "utf8")) as {
    phases: Array<Record<string, unknown>>;
    milestoneParentNumbers: Record<string, number | null>;
    waves: Array<Record<string, unknown>>;
    followUps: Array<Record<string, unknown>>;
  };
  const errorsOf = (doc: unknown) => {
    const r = validateBoardData(doc, known);
    return r.ok ? [] : r.errors;
  };

  it("rejects a follow-up that reuses a phase issue number", () => {
    const phaseNo = valid.phases[0]?.number as number;
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, number: phaseNo } : f));
    const errs = errorsOf({ ...valid, followUps });
    expect(errs.some((e) => e.message.includes(`#${phaseNo} is used more than once`))).toBe(true);
  });

  it("rejects a follow-up that reuses a task issue number (task N is issue #N+1)", () => {
    const [first] = (valid.waves[0] as { tasks: [number, number] }).tasks;
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, number: first + 1 } : f));
    expect(
      errorsOf({ ...valid, followUps }).some((e) => e.message.includes("more than once")),
    ).toBe(true);
  });

  it("rejects a wave that reuses a milestone parent number", () => {
    const mp = Object.values(valid.milestoneParentNumbers).find((n) => n !== null) as number;
    const waves = valid.waves.map((w, i) => (i === 0 ? { ...w, number: mp } : w));
    expect(errorsOf({ ...valid, waves }).some((e) => e.message.includes(`#${mp}`))).toBe(true);
  });

  it("rejects a wave k with no W<k> option in the Wave field", () => {
    const waves = valid.waves.map((w, i) => (i === 0 ? { ...w, k: 7 } : w));
    const errs = errorsOf({ ...valid, waves });
    expect(errs.some((e) => e.pointer === "/waves/0/k")).toBe(true);
  });

  it("takes track, size and priority options from FIELDS, not a hardcoded list", () => {
    const narrowed = FIELDS.map((f) =>
      f.name === "Size" && f.options
        ? { ...f, options: f.options.filter((o) => o.name !== "S") }
        : f,
    );
    const followUps = valid.followUps.map((f, i) => (i === 0 ? { ...f, size: "S" } : f));
    const r = validateBoardData({ ...valid, followUps }, { ...known, fields: narrowed });
    expect(r.ok).toBe(false);
  });
});
