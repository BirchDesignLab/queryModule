import { ROUTES, type RouteDef } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument, registerSchema, toJsonSchema } from "./openapi";

function refs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) refs(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refs(v, out);
    }
  }
  return out;
}

describe("BR-007 OpenAPI generated from route contracts (spec 5.1)", () => {
  const doc = buildOpenApiDocument(ROUTES);

  it("is OpenAPI 3.1 for API v1 with one operation per route", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("v1");
    // Derived from ROUTES so a new route contract needs no edit here; the operation count
    // still fails a generator that drops or merges a route.
    expect(Object.keys(doc.paths)).toEqual([...new Set(ROUTES.map((r) => r.path))]);
    const ops = Object.values(doc.paths).reduce((n, methods) => n + Object.keys(methods).length, 0);
    expect(ops).toBe(ROUTES.length);
  });

  it("declares path parameters", () => {
    const op = doc.paths["/api/v1/locales/{locale}"]?.get as {
      parameters: Array<{ name: string; in: string; required: boolean }>;
    };
    expect(op.parameters.map((p) => [p.name, p.in, p.required])).toEqual([
      ["locale", "path", true],
    ]);
  });

  it("every $ref resolves inside components and none points at a local $defs", () => {
    const all = refs(doc);
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.startsWith("#/components/schemas/")).toBe(true);
      expect(doc.components.schemas[r.slice("#/components/schemas/".length)], r).toBeDefined();
    }
  });

  it("the config response never exposes server-only source settings", () => {
    const text = JSON.stringify(doc.components.schemas);
    expect(text).not.toContain('"maxConcurrent"');
    expect(text).not.toContain('"server"');
    expect(text).not.toContain('"retention"');
  });

  it("emits x-feature and x-requires, never since or status", () => {
    const route: RouteDef = {
      id: "putDevThing",
      method: "put",
      path: "/api/v1/dev/thing",
      summary: "test",
      access: "admin",
      since: "m3",
      status: "planned",
      feature: "credentials",
      requires: "ALLOW_MOCK_SOURCES",
      requiresRequestedWith: true,
      request: { body: z.strictObject({ a: z.string() }) },
      responses: { 204: { description: "Done" } },
    };
    const op = buildOpenApiDocument([route]).paths["/api/v1/dev/thing"]?.put as Record<
      string,
      unknown
    >;
    expect(op["x-feature"]).toBe("credentials");
    expect(op["x-requires"]).toBe("ALLOW_MOCK_SOURCES");
    expect(op).not.toHaveProperty("since");
    expect(op).not.toHaveProperty("status");
    expect(op.requestBody).toEqual({
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/putDevThingBody" } } },
    });
    expect(op.responses).toEqual({ 204: { description: "Done" } });
  });
});

describe("toJsonSchema fails closed (review W4 M9)", () => {
  it("throws on an unrepresentable type instead of publishing {}", () => {
    expect(() => toJsonSchema(z.date())).toThrow();
    expect(() => toJsonSchema(z.object({ n: z.bigint() }))).toThrow();
  });
});

describe("#69 stable Condition component and input-side bodies", () => {
  const doc = buildOpenApiDocument(ROUTES);

  it("names the recursive Condition from its registry id, never from zod's internal counter", () => {
    const names = Object.keys(doc.components.schemas);
    expect(names).toContain("Condition");
    expect(names.filter((n) => n.includes("__schema"))).toEqual([]);
    const conditionRefs = refs(doc).filter((r) => r.endsWith("Condition"));
    expect(conditionRefs.length).toBeGreaterThan(0);
    for (const r of conditionRefs) expect(r).toBe("#/components/schemas/Condition");
  });

  const WithDefault = z.object({ a: z.string().default("x"), b: z.string() });
  const route = {
    id: "postThing",
    method: "post",
    path: "/api/v1/thing",
    summary: "test route",
    access: "authenticated",
    since: "M1",
    status: "planned",
    requiresRequestedWith: true,
    request: { body: WithDefault },
    responses: { 200: { description: "ok", schema: WithDefault } },
  } as unknown as RouteDef;

  it("publishes a request body with io input: a defaulted field is optional", () => {
    const d = buildOpenApiDocument([route]);
    const body = d.components.schemas.postThingBody as { required?: string[] };
    const res = d.components.schemas.postThing200 as { required?: string[] };
    expect(body.required).toEqual(["b"]);
    expect(res.required).toEqual(["a", "b"]);
  });

  it("toJsonSchema takes io, defaulting to output", () => {
    expect((toJsonSchema(WithDefault) as { required: string[] }).required).toEqual(["a", "b"]);
    expect((toJsonSchema(WithDefault, "input") as { required: string[] }).required).toEqual(["b"]);
  });
});

describe("registerSchema fails closed on a shared id clash (#69)", () => {
  it("throws when one registry id would name two different bodies", () => {
    const B = z.object({ y: z.number() });
    const components: Record<string, Record<string, unknown>> = {
      Clash: { type: "object", properties: { x: { type: "string" } } },
    };
    const wrap = (s: z.ZodType) => z.object({ inner: s });
    z.globalRegistry.add(B, { id: "Clash" });
    expect(() => registerSchema("one", wrap(B), components)).toThrow(
      "component Clash is defined twice with different bodies",
    );
  });
});
