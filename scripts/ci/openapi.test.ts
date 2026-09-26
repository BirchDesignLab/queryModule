import { ROUTES, type RouteDef } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument } from "./openapi";

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
    expect(Object.keys(doc.paths)).toEqual([
      "/api/v1/health",
      "/api/v1/meta",
      "/api/v1/locales/{locale}",
      "/api/v1/config",
    ]);
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
