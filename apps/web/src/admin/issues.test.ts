import { describe, expect, it } from "vitest";
import { controlId } from "./controls.js";
import { type DraftIssue, draftIssues, groupByControl } from "./issues.js";

// #388: direct unit tests for the diagnostics-to-controls half of the builder draft.

const diag = (level: "error" | "warning", path: string, key = "config.k") => ({
  level,
  path,
  key,
  params: { n: 1 },
});

describe("draftIssues (#388)", () => {
  it("shape issues become errors keyed by their text", () => {
    expect(draftIssues({ ok: false, issues: [{ pointer: "/a", message: "bad" }] })).toEqual([
      { level: "error", pointer: "/a", key: "admin.config.shapeIssue", params: { message: "bad" } },
    ]);
  });

  it("drops exact duplicates and lists errors before warnings", () => {
    const issues = draftIssues({
      ok: true,
      errors: [diag("error", "/x"), diag("error", "/x")],
      warnings: [diag("warning", "/y")],
    } as Parameters<typeof draftIssues>[0]);
    expect(issues.map((i) => [i.level, i.pointer])).toEqual([
      ["error", "/x"],
      ["warning", "/y"],
    ]);
  });
});

describe("groupByControl (#388)", () => {
  const issue = (pointer: string): DraftIssue => ({
    level: "error",
    pointer,
    key: "config.k",
    params: {},
  });

  it("keeps an issue on an existing node and moves one on a missing key to its parent", () => {
    const doc = { a: { b: 1 }, list: [{ id: "x" }] };
    const groups = groupByControl(doc, [issue("/a/b"), issue("/a/missing"), issue("/list/0/nope")]);
    expect(groups.get("/a/b")).toHaveLength(1);
    expect(groups.get("/a")).toHaveLength(1);
    expect(groups.get("/list/0")).toHaveLength(1);
  });

  it("root issues and issues under a missing top-level key sit under the empty pointer", () => {
    const groups = groupByControl({ a: 1 }, [issue(""), issue("/gone/deeper")]);
    expect(groups.get("")).toHaveLength(2);
  });

  it("unescapes ~1 and ~0 in pointer segments", () => {
    const groups = groupByControl({ "a/b": { "c~d": 1 } }, [issue("/a~1b/c~0d")]);
    expect(groups.get("/a~1b/c~0d")).toHaveLength(1);
  });
});

describe("controlId (#388 M10)", () => {
  it("gives distinct ids to a dotted key and the path it looks like", () => {
    expect(controlId("p", ["a.b"])).not.toBe(controlId("p", ["a", "b"]));
    expect(controlId("p", ["a-b"])).not.toBe(controlId("p", ["a", "b"]));
  });

  it("uses only id-safe characters, whatever the key", () => {
    expect(controlId("p", ["label key", "x/y", 3])).toMatch(/^p-[A-Za-z0-9_-]+$/);
  });
});
