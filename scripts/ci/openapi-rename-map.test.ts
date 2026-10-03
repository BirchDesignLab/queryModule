import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
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

  it("never maps a second head component onto a base target claimed in an earlier round", () => {
    // Round 1 maps B2 -> B and A3 -> A (A3 already refs B). A2 refs B2, so it only equals A
    // after round 1's rewrite; mapping it onto A too would drop one schema silently.
    const leaf = { type: "string" };
    const node = (to: string) => ({ type: "object", properties: { p: ref(to) } });
    const base = doc({ A: node("B"), B: leaf });
    const head = doc({ A2: node("B2"), A3: node("B"), B2: leaf });
    const r = renameToBase(base, head);
    expect(r.renames.filter(([, to]) => to === "A")).toHaveLength(1);
    expect(Object.keys(r.doc.components?.schemas ?? {}).sort()).toHaveLength(3);
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

describe("renameToBase: recursive schemas and discriminators (#171, #315)", () => {
  const tree = (self: string) => ({
    type: "object",
    properties: { children: { type: "array", items: ref(self) } },
  });

  it("maps a self-referencing component under a new name and rewrites its own $ref", () => {
    const base = doc({ Node0: tree("Node0") }, route("Node0"));
    const head = doc({ Node: tree("Node") }, route("Node"));
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([["Node", "Node0"]]);
    expect(r.doc).toEqual(base);
  });

  it("does not map a self-referencing component whose body also changed", () => {
    const base = doc({ Node0: tree("Node0") });
    const head = doc({ Node: { ...tree("Node"), required: ["children"] } });
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([]);
    expect(r.doc).toEqual(head);
  });

  it("does not map a head component that refers to a different base component than itself", () => {
    // Head Node points at Other, base Node0 points at itself: not the same shape.
    const base = doc({ Node0: tree("Node0"), Other0: body });
    const head = doc({ Node: tree("Other"), Other: body });
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([["Other", "Other0"]]);
    expect(Object.keys(r.doc.components?.schemas ?? {}).sort()).toEqual(["Node", "Other0"]);
  });

  it("rewrites discriminator mapping values, which are not $ref keys", () => {
    const one = (name: string, to: string) => ({
      oneOf: [ref(name)],
      discriminator: { propertyName: "kind", mapping: { a: `#/components/schemas/${to}` } },
    });
    const base = doc({ Shape0: one("Circle0", "Circle0"), Circle0: body });
    const head = doc({ Shape: one("Circle", "Circle"), Circle: body });
    const r = renameToBase(base, head);
    expect(r.renames).toEqual([
      ["Circle", "Circle0"],
      ["Shape", "Shape0"],
    ]);
    expect(r.doc).toEqual(base);
  });

  it("leaves a discriminator mapping value that is not a component reference alone", () => {
    const head = doc({
      Shape: { discriminator: { propertyName: "kind", mapping: { a: "Circle", b: 5 } } },
    });
    const r = renameToBase(doc({ Other: body }), head);
    expect(r.doc).toEqual(head);
  });
});

describe("openapi-rename-map CLI contract (#315)", { timeout: 60_000 }, () => {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const script = fileURLToPath(new URL("./openapi-rename-map.ts", import.meta.url));
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
  });
  const work = () => {
    const d = mkdtempSync(join(tmpdir(), "oasrename-"));
    dirs.push(d);
    return d;
  };
  const run = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [tsxCli, script, ...args], { cwd, encoding: "utf8" });

  it("writes the renamed head, prints each rename and exits 0", () => {
    const d = work();
    const base = doc({ Old0: body }, route("Old0"));
    const head = doc({ New: body }, route("New"));
    writeFileSync(join(d, "base.json"), JSON.stringify(base));
    writeFileSync(join(d, "head.json"), JSON.stringify(head));
    const res = run(d, ["base.json", "head.json", "out.json"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("renamed New -> Old0");
    expect(JSON.parse(readFileSync(join(d, "out.json"), "utf8"))).toEqual(base);
  });

  it("writes the head unchanged when nothing is renamed", () => {
    const d = work();
    const head = doc({ A: body }, route("A"));
    writeFileSync(join(d, "base.json"), JSON.stringify(doc({ A: body }, route("A"))));
    writeFileSync(join(d, "head.json"), JSON.stringify(head));
    expect(run(d, ["base.json", "head.json", "out.json"]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "out.json"), "utf8"))).toEqual(head);
  });

  it("exits 2 on bad usage and writes nothing", () => {
    const d = work();
    const res = run(d, ["base.json", "head.json"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("usage:");
  });

  it("exits 1 when a document is missing or not JSON, naming the reason only", () => {
    const d = work();
    writeFileSync(join(d, "head.json"), "{ secret-looking text");
    const res = run(d, ["nope.json", "head.json", "out.json"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("file not found");
    expect(res.stderr).toContain("invalid JSON");
    expect(res.stderr).not.toContain("secret-looking");
    expect(existsSync(join(d, "out.json"))).toBe(false);
  });
});
