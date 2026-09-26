import { describe, expect, it } from "vitest";
import { changedFiles, isDocsOnly } from "./changed-paths.mjs";

describe("docs-only fast path (master plan 11)", () => {
  it("is true only when every changed file is under docs/ or is Markdown", () => {
    expect(
      isDocsOnly(["docs/superpowers/plans/STATUS.md", "README.md", "docs/decisions/0002-x.md"]),
    ).toBe(true);
    expect(isDocsOnly(["docs/a.md", "packages/core/src/x.ts"])).toBe(false);
    expect(isDocsOnly([])).toBe(false);
  });

  it("treats gate inputs under docs/testing/ as non-docs (review critic:K2, spec 9.3 step 6)", () => {
    expect(isDocsOnly(["docs/testing/stories.json"])).toBe(false);
    expect(isDocsOnly(["docs/testing/stories.json", "docs/a.md"])).toBe(false);
  });
});

describe("changedFiles (review critic:K1)", () => {
  it("diffs base...head with rename detection off, so a move into docs/ is not docs-only", () => {
    const calls: string[][] = [];
    const files = changedFiles("abc", "def", (args: string[]) => {
      calls.push(args);
      return "packages/core/src/x.ts\ndocs/x.md\n\n";
    });
    expect(calls).toEqual([["diff", "--name-only", "--no-renames", "abc...def"]]);
    expect(files).toEqual(["packages/core/src/x.ts", "docs/x.md"]);
    expect(isDocsOnly(files)).toBe(false);
  });
});
