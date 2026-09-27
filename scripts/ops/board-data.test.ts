import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_LABELS, MILESTONES } from "./board-config.mjs";
import { parseBoardData } from "./board-data.mjs";
import { validateBoardData } from "./board-data-schema.mjs";

// docs/board/board-data.json holds the issue-content board data that used to
// live inline in gh-setup-project.mjs (`[gate]`, ADR-0007): PHASES,
// CONTRACTS_M0P0, MILESTONE_PARENT_NUMBERS, WAVES, FOLLOW_UPS (Task 604, #92).
// This test validates the shipped file, fail closed (R3), and has one failing
// case per schema rule so a future edit that breaks a rule is caught before
// the setup script ever reads GitHub.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOARD_DATA_PATH = resolve(ROOT, "docs/board/board-data.json");

const known = { milestoneNames: Object.keys(MILESTONES), labelNames: KNOWN_LABELS };

function loadBoardData(): unknown {
  return JSON.parse(readFileSync(BOARD_DATA_PATH, "utf8"));
}

describe("validateBoardData: the shipped docs/board/board-data.json", () => {
  it("validates with no errors", () => {
    const result = validateBoardData(loadBoardData(), known);
    expect(result.ok).toBe(true);
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

describe("R4 equivalence: board-data.json matches the pre-move in-script constants", () => {
  const fixturePath = resolve(ROOT, "scripts/ops/__fixtures__/board-data-pre-move.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as BoardData;
  // #92 and #94 (R5) never existed in the pre-move script; every other
  // follow-up must match byte for byte.
  const ADDED_BY_TASK_604 = new Set([92, 94]);

  it("parses and validates docs/board/board-data.json", () => {
    const result = parseBoardData(readFileSync(BOARD_DATA_PATH, "utf8"), known);
    expect(result.ok).toBe(true);
  });

  it("phases, contractsM0P0, milestoneParentNumbers and waves are unchanged by the move", () => {
    const result = parseBoardData(readFileSync(BOARD_DATA_PATH, "utf8"), known);
    if (!result.ok) throw new Error("expected board-data.json to validate");
    const data = result.data as BoardData;
    expect(data.phases).toEqual(fixture.phases);
    expect(data.contractsM0P0).toEqual(fixture.contractsM0P0);
    expect(data.milestoneParentNumbers).toEqual(fixture.milestoneParentNumbers);
    expect(data.waves).toEqual(fixture.waves);
  });

  it("every follow-up that existed before the move is byte-identical after it", () => {
    const result = parseBoardData(readFileSync(BOARD_DATA_PATH, "utf8"), known);
    if (!result.ok) throw new Error("expected board-data.json to validate");
    const data = result.data as BoardData;
    const carried = data.followUps.filter((f) => !ADDED_BY_TASK_604.has(f.number));
    expect(carried).toEqual(fixture.followUps);
  });

  it("adds exactly #92 and #94 on top of the pre-move follow-ups", () => {
    const result = parseBoardData(readFileSync(BOARD_DATA_PATH, "utf8"), known);
    if (!result.ok) throw new Error("expected board-data.json to validate");
    const data = result.data as BoardData;
    const added = data.followUps
      .map((f) => f.number)
      .filter((n) => ADDED_BY_TASK_604.has(n))
      .sort((a, b) => a - b);
    expect(added).toEqual([92, 94]);
  });
});
