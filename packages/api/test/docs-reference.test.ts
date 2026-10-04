import { readFileSync } from "node:fs";
import { FEATURES, SiteConfigSchema } from "@querymodule/core/config";
import {
  API_ERROR_CODES,
  ROUTES,
  WsClientMessageSchema,
  WsServerMessageSchema,
} from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";

// BR-005, NFR-001: the hand-written reference docs must keep up with the contracts. String
// presence only, never formatting: the openapi.json file stays the source of truth (D-A18).
const doc = (name: string): string =>
  readFileSync(new URL(`../../../docs/${name}`, import.meta.url), "utf8");

describe("BR-005 docs/api.md", () => {
  const api = doc("api.md");
  const openapi = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };

  it("names every route of openapi.json, method and path on one line", () => {
    const lines = api.split("\n");
    const missing = Object.entries(openapi.paths).flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((m) => !lines.some((l) => l.includes(`\`${path}\``) && l.includes(m.toUpperCase())))
        .map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(missing).toEqual([]);
  });

  // #507 item 27 (Q3): one table row per route, matched on its exact cells, so a changed response
  // code or status fails here instead of passing on a substring elsewhere on the line.
  it("lists each route once, with exactly the response codes and status of the contract", () => {
    const row = (method: string, path: string): string[] | null => {
      const found = api
        .split("\n")
        .filter((l) => l.startsWith(`| ${method.toUpperCase()} | \`${path}\` |`));
      return found.length === 1 ? (found[0] as string).split("|").map((c) => c.trim()) : null;
    };
    const drift = Object.entries(openapi.paths).flatMap(([path, methods]) =>
      Object.entries(methods).flatMap(([method, op]) => {
        const cells = row(method, path);
        if (cells === null) return [`${method.toUpperCase()} ${path}: not exactly one row`];
        const codes = Object.keys((op as { responses: Record<string, unknown> }).responses).sort();
        const documented = (cells[6] ?? "").split(",").map((c) => c.trim());
        const status = ROUTES.find((r) => r.method === method && r.path === path)?.status;
        return [
          ...(documented.join(",") === codes.join(",")
            ? []
            : [
                `${method.toUpperCase()} ${path}: codes ${documented.join(",")} != ${codes.join(",")}`,
              ]),
          ...(cells[5] === status
            ? []
            : [`${method.toUpperCase()} ${path}: status ${cells[5]} != ${status}`]),
        ];
      }),
    );
    expect(drift).toEqual([]);
  });

  it("names every ApiError code", () => {
    expect(API_ERROR_CODES.filter((c) => !api.includes(`\`${c}\``))).toEqual([]);
  });

  it("names every WebSocket message type and the openapi.json source of truth", () => {
    const types = [...WsClientMessageSchema.options, ...WsServerMessageSchema.options].map(
      (o) => o.shape.type.value,
    );
    expect(types.filter((t) => !api.includes(`\`${t}\``))).toEqual([]);
    expect(api).toContain("packages/api/openapi.json");
  });
});

describe("BR-005 docs/site-config.md", () => {
  const site = doc("site-config.md");

  it("covers every SiteConfig section and every feature key", () => {
    const keys = [
      ...Object.keys(SiteConfigSchema.shape).filter((k) => k !== "$schema"),
      ...FEATURES,
    ];
    expect(keys.filter((k) => !site.includes(`\`${k}\``))).toEqual([]);
  });

  it("names the config commands", () => {
    for (const s of ["pnpm config:validate", "--resolved", "pnpm config:migrate"])
      expect(site).toContain(s);
  });
});

describe("BR-005 docs/demo.md", () => {
  it("points at the v1 runbook", () => {
    expect(doc("demo.md")).toContain("demo/m1-v1.md");
  });
});
