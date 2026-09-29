import { describe, expect, it } from "vitest";
import { type OpenApiDoc, renameToBase } from "./openapi-rename-map";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const doc = (schemas: Record<string, unknown> | undefined, paths: unknown = {}): OpenApiDoc =>
  ({
    openapi: "3.1.0",
    paths,
    ...(schemas === undefined ? {} : { components: { schemas } }),
  }) as OpenApiDoc;
const route = (name: string) => ({
  "/api/v1/config": {
    get: { responses: { "200": { content: { "application/json": { schema: ref(name) } } } } },
  },
});
const body = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };

describe("renameToBase", () => {
  it("maps a byte-identical component under a new name (the #69 case) and rewrites refs", () => {
    const base = doc({ getConfig200___schema0: body }, route("getConfig200___schema0"));
    const head = doc({ Condition: body }, route("Condition"));
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([["Condition", "getConfig200___schema0"]]);
    expect(r.doc).toEqual(base);
  });

  it("does not map a rename that also removes a required property", () => {
    const base = doc({ Old: body }, route("Old"));
    const head = doc({ New: { ...body, required: [] } }, route("New"));
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([]);
    expect(r.doc).toEqual(head);
  });

  it("never maps when two base components share the body (ambiguous)", () => {
    const base = doc({ A: body, B: body });
    const head = doc({ C: body });
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([]);
    expect(r.doc).toEqual(head);
  });

  it("never maps two head components onto one base component", () => {
    const base = doc({ A: body });
    const head = doc({ C: body, D: body });
    expect(renameToBase(base, head).renames).toEqual([]);
  });

  it("ignores key order when comparing bodies", () => {
    const base = doc({ A: { type: "object", required: ["a"] } });
    const head = doc({ B: { required: ["a"], type: "object" } });
    expect(renameToBase(base, head).renames).toEqual([["B", "A"]]);
  });

  it("converges nested $ref renames to a fixed point", () => {
    const base = doc({ Outer0: { type: "array", items: ref("Inner0") }, Inner0: body });
    const head = doc({ Outer: { type: "array", items: ref("Inner") }, Inner: body });
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([
      ["Inner", "Inner0"],
      ["Outer", "Outer0"],
    ]);
    expect(r.doc).toEqual(base);
  });

  it("leaves components present in both documents alone", () => {
    const base = doc({ A: body });
    const head = doc({ A: { ...body, required: [] } });
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([]);
    expect(r.doc).toEqual(head);
  });

  it("returns a head with no components unchanged", () => {
    const head = doc(undefined, route("X"));
    const r = renameToBase(doc({ A: body }), head);
    expect(r.renames).toEqual([]);
    expect(r.doc).toEqual(head);
  });
});
