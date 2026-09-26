import { describe, expect, it } from "vitest";
import { isDocsOnly } from "./changed-paths.mjs";

describe("docs-only fast path (master plan 11)", () => {
  it("is true only when every changed file is under docs/ or is Markdown", () => {
    expect(
      isDocsOnly(["docs/superpowers/plans/STATUS.md", "README.md", "docs/decisions/0002-x.md"]),
    ).toBe(true);
    expect(isDocsOnly(["docs/testing/stories.json"])).toBe(true);
    expect(isDocsOnly(["docs/a.md", "packages/core/src/x.ts"])).toBe(false);
    expect(isDocsOnly([])).toBe(false);
  });
});
