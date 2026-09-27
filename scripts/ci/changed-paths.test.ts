import { describe, expect, it } from "vitest";
import { areas, changedFiles, isDocsOnly, main } from "./changed-paths.mjs";

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

describe("areas (ADR-0008 per-area outputs)", () => {
  it("web is true under apps/web/, packages/, or a shared root file", () => {
    expect(areas(["apps/web/src/App.tsx"]).web).toBe(true);
    expect(areas(["packages/core/src/x.ts"]).web).toBe(true);
    expect(areas(["package.json"]).web).toBe(true);
    expect(areas(["pnpm-lock.yaml"]).web).toBe(true);
    expect(areas(["pnpm-workspace.yaml"]).web).toBe(true);
    expect(areas(["tsconfig.base.json"]).web).toBe(true);
    expect(areas([".nvmrc"]).web).toBe(true);
    expect(areas([".github/workflows/ci.yml"]).web).toBe(true);
    expect(areas(["scripts/ci/changed-paths.mjs"]).web).toBe(true);
    expect(areas(["apps/mobile/App.tsx"]).web).toBe(false);
    expect(areas(["docs/a.md"]).web).toBe(false);
  });

  it("mobile is true under apps/mobile/, packages/, or the same shared root files", () => {
    expect(areas(["apps/mobile/App.tsx"]).mobile).toBe(true);
    expect(areas(["packages/client/src/x.ts"]).mobile).toBe(true);
    expect(areas(["package.json"]).mobile).toBe(true);
    expect(areas(["apps/web/src/App.tsx"]).mobile).toBe(false);
    expect(areas(["docs/a.md"]).mobile).toBe(false);
  });

  it("docs_only mirrors isDocsOnly, excluding docs/testing/", () => {
    expect(areas(["docs/a.md"]).docs_only).toBe(true);
    expect(areas(["docs/testing/stories.json"]).docs_only).toBe(false);
    expect(areas(["packages/core/src/x.ts"])).toEqual({
      docs_only: false,
      web: true,
      mobile: true,
    });
    expect(areas([])).toEqual({ docs_only: false, web: false, mobile: false });
  });
});

describe("main (fail-closed, ADR-0008)", () => {
  function sink() {
    const lines: string[] = [];
    return { lines, write: (line: string) => lines.push(line) };
  }

  it("fails closed when BASE_SHA is empty (push to a new branch)", () => {
    const { lines, write } = sink();
    main({ env: { BASE_SHA: "", EVENT_NAME: "pull_request" }, runGit: () => "", write });
    expect(lines).toEqual(["docs_only=false", "web=true", "mobile=true"]);
  });

  it("fails closed when BASE_SHA is all zeros", () => {
    const { lines, write } = sink();
    main({
      env: { BASE_SHA: "0".repeat(40), EVENT_NAME: "pull_request" },
      runGit: () => "",
      write,
    });
    expect(lines).toEqual(["docs_only=false", "web=true", "mobile=true"]);
  });

  it("fails closed on a push to main (EVENT_NAME=push)", () => {
    const { lines, write } = sink();
    main({ env: { BASE_SHA: "abc", EVENT_NAME: "push" }, runGit: () => "", write });
    expect(lines).toEqual(["docs_only=false", "web=true", "mobile=true"]);
  });

  it("fails closed and prints a ::warning:: naming the failure when git fails", () => {
    const { lines, write } = sink();
    main({
      env: { BASE_SHA: "abc", HEAD_SHA: "def", EVENT_NAME: "pull_request" },
      runGit: () => {
        throw new Error("git exited with 128");
      },
      write,
    });
    expect(lines[0]).toBe("::warning::changed-paths: git exited with 128");
    expect(lines.slice(1)).toEqual(["docs_only=false", "web=true", "mobile=true"]);
  });

  it("computes areas normally on a successful diff", () => {
    const { lines, write } = sink();
    main({
      env: { BASE_SHA: "abc", HEAD_SHA: "def", EVENT_NAME: "pull_request" },
      runGit: () => "docs/a.md\n",
      write,
    });
    expect(lines).toEqual(["docs_only=true", "web=false", "mobile=false"]);
  });
});
