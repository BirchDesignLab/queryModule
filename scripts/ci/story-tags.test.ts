import { describe, expect, it } from "vitest";
import {
  checkStoryTags,
  type GitResult,
  hasTaggedTest,
  highestMilestoneTag,
  parseArgs,
  readMilestoneTags,
  type StoryRow,
  storiesInScope,
} from "./story-tags";

const rows: StoryRow[] = [
  { story: "A1", milestone: "m1", files: ["a1.test.ts", "a1.spec.ts"] },
  { story: "A6", milestone: "m2", files: ["a6.test.ts"] },
  { story: "B6", milestone: "later", files: ["b6.test.ts"] },
];

describe("story-tag gate (spec 10.2)", () => {
  it("finds the highest milestone tag", () => {
    expect(highestMilestoneTag([])).toBeNull();
    expect(highestMilestoneTag(["m0", "m1", "v0.1", "m10"])).toBe("m1");
  });

  it("scopes stories at or below the highest tag, or exactly one milestone, never later", () => {
    expect(storiesInScope(rows, { highestTag: null })).toEqual([]);
    expect(storiesInScope(rows, { highestTag: "m1" }).map((r) => r.story)).toEqual(["A1"]);
    expect(storiesInScope(rows, { highestTag: "m4" }).map((r) => r.story)).toEqual(["A1", "A6"]);
    expect(storiesInScope(rows, { highestTag: null, milestone: "m2" }).map((r) => r.story)).toEqual(
      ["A6"],
    );
  });

  it("recognises tagged test titles", () => {
    expect(hasTaggedTest('it("[A1] plate only submits", () => {})', "A1")).toBe(true);
    expect(hasTaggedTest("test.only(`[A1] x`, () => {})", "A1")).toBe(true);
    expect(hasTaggedTest("describe('[A1] form', () => {})", "A1")).toBe(true);
    expect(hasTaggedTest("// [A1] comment only", "A1")).toBe(false);
    expect(hasTaggedTest('it("[A10] other", () => {})', "A1")).toBe(false);
  });

  it("fails a story in scope with no tagged test in any listed file", () => {
    const files: Record<string, string> = {
      "a1.spec.ts": 'test("[A1] keyboard only", async () => {})',
    };
    expect(checkStoryTags(rows, { highestTag: "m2" }, (p) => files[p])).toEqual([
      "A6 (m2): no test titled with [A6] in a6.test.ts",
    ]);
  });

  it("does not count tests that never run (commented out, skip, todo, fixme)", () => {
    expect(hasTaggedTest('// it("[A1] x", () => {})', "A1")).toBe(false);
    expect(hasTaggedTest('  // test("[A1] x", () => {})', "A1")).toBe(false);
    expect(hasTaggedTest('/* test("[A1]") */', "A1")).toBe(false);
    expect(hasTaggedTest('/*\n it("[A1] x", () => {})\n*/', "A1")).toBe(false);
    expect(hasTaggedTest('it.skip("[A1]", () => {})', "A1")).toBe(false);
    expect(hasTaggedTest('test.todo("[A1]")', "A1")).toBe(false);
    expect(hasTaggedTest('test.fixme("[A1]", () => {})', "A1")).toBe(false);
    expect(hasTaggedTest('describe.skip("[A1]", () => {})', "A1")).toBe(false);
    expect(hasTaggedTest('describe.only.skip("[A1]", () => {})', "A1")).toBe(false);
    expect(hasTaggedTest('/* note */ it("[A1] x", () => {})', "A1")).toBe(true);
    expect(hasTaggedTest("// note\nit.each(`[A1] x`, () => {})", "A1")).toBe(true);
  });
});

describe("story-tag CLI arguments", () => {
  it("accepts no arguments or one known milestone", () => {
    expect(parseArgs([])).toEqual({ ok: true });
    expect(parseArgs(["--milestone", "m1"])).toEqual({ ok: true, milestone: "m1" });
    expect(parseArgs(["--milestone=m2"])).toEqual({ ok: true, milestone: "m2" });
  });

  it.each([
    [["--milestone"]],
    [["--milestone="]],
    [["--milestone", "m9"]],
    [["--milestone=m9"]],
    [["--milestone", "--milestone"]],
    [["--milestone", "m1", "extra"]],
    [["--milestone", "m1", "--milestone", "m2"]],
    [["--verbose"]],
    [["m1"]],
  ])("rejects %j", (args) => {
    expect(parseArgs(args).ok).toBe(false);
  });
});

describe("milestone tag read (fails closed)", () => {
  const git =
    (answers: Record<string, GitResult>) =>
    (args: string[]): GitResult =>
      answers[args.join(" ")] ?? { status: 1, stdout: "" };
  const TAGS = "tag --list m*";
  const SHALLOW = "rev-parse --is-shallow-repository";

  it("returns the tags from a full clone", () => {
    const run = git({
      [TAGS]: { status: 0, stdout: "m0\nm1\n" },
      [SHALLOW]: { status: 0, stdout: "false\n" },
    });
    expect(readMilestoneTags(run)).toEqual({ ok: true, tags: ["m0", "m1"] });
  });

  it("fails when git tag exits non-zero", () => {
    const run = git({
      [TAGS]: { status: 128, stdout: "" },
      [SHALLOW]: { status: 0, stdout: "false\n" },
    });
    expect(readMilestoneTags(run)).toEqual({ ok: false, reason: "git-failed" });
  });

  it("fails when git cannot start (null status or stdout)", () => {
    expect(readMilestoneTags(() => ({ status: null, stdout: null }))).toEqual({
      ok: false,
      reason: "git-failed",
    });
    const run = git({
      [TAGS]: { status: 0, stdout: null },
      [SHALLOW]: { status: 0, stdout: "false\n" },
    });
    expect(readMilestoneTags(run)).toEqual({ ok: false, reason: "git-failed" });
  });

  it("fails on a shallow clone, or when the shallow check itself fails", () => {
    const shallow = git({
      [TAGS]: { status: 0, stdout: "" },
      [SHALLOW]: { status: 0, stdout: "true\n" },
    });
    expect(readMilestoneTags(shallow)).toEqual({ ok: false, reason: "shallow" });
    const unknown = git({ [TAGS]: { status: 0, stdout: "" } });
    expect(readMilestoneTags(unknown)).toEqual({ ok: false, reason: "shallow" });
  });
});
