import { readFileSync } from "node:fs";
import { ROUTES } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";

describe("BR-007 committed openapi.json", () => {
  it("lists exactly the route contracts", () => {
    const doc = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as {
      openapi: string;
      info: { version: string };
      paths: Record<string, Record<string, unknown>>;
    };
    const ops = Object.entries(doc.paths)
      .flatMap(([p, methods]) => Object.keys(methods).map((m) => `${m} ${p}`))
      .sort();
    expect(ops).toEqual(ROUTES.map((r) => `${r.method} ${r.path}`).sort());
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("v1");
  });
});
