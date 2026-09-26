import { describe, expect, it } from "vitest";
import {
  checkStoryTags,
  hasTaggedTest,
  highestMilestoneTag,
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
});
