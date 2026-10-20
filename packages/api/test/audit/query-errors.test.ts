import { describe, expect, it, vi } from "vitest";
import { queryStringErrors } from "../../src/queries/prepare";
import { adminConfigApp, errorOf } from "../helpers/admin-config";

/*
 * #755 T3 Q1: one helper turns schema issues into validation errors for the submit body
 * (queries/prepare.ts), the admin audit page and export (audit/routes.ts) and the admin query
 * read (queries/route.ts). A pass-through spy on the prepare export records each call, so a
 * route that kept its own copy would answer the same body without calling it, and fail here.
 * Mock ids only (spec 5.4).
 */

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../src/queries/prepare", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/queries/prepare")>();
  return {
    ...m,
    queryStringErrors: (...a: Parameters<typeof m.queryStringErrors>) => {
      calls.n += 1;
      return m.queryStringErrors(...a);
    },
  };
});

const UNKNOWN = "01890000-0000-7000-8000-000000000001";

describe("#755 T3 Q1 queryStringErrors", () => {
  it("names each top-level field once, in issue order; a root-level issue names none", () => {
    expect(
      queryStringErrors([
        { path: ["limit"] },
        { path: [] },
        { path: ["limit", 0] },
        { path: ["from"] },
        { path: [0] },
      ]),
    ).toEqual([
      { key: "validation.invalidBody", params: { field: "limit" } },
      { key: "validation.invalidBody" },
      { key: "validation.invalidBody", params: { field: "from" } },
    ]);
  });

  it("the audit page, export and admin query read answer their 400 through the one helper", async () => {
    const a = await adminConfigApp();
    const now = a.t.clock.now();
    const window = `from=${now - 1_000}&to=${now}`;
    const cases = [
      [`/api/v1/admin/audit?${window}&limit=0`, "limit"],
      [`/api/v1/admin/audit/export?${window}&zz=1`, null],
      [`/api/v1/admin/queries/${UNKNOWN}?includeHidden=yes`, "includeHidden"],
    ] as const;
    for (const [path, field] of cases) {
      const before = calls.n;
      const r = await a.call("admin", "GET", path);
      expect(r.status, path).toBe(400);
      const error = await errorOf(r);
      expect(error.code, path).toBe("validationFailed");
      expect(error.errors, path).toEqual([
        field === null
          ? { key: "validation.invalidBody" }
          : { key: "validation.invalidBody", params: { field } },
      ]);
      expect(calls.n, path).toBeGreaterThan(before);
    }
  }, 30_000);
});
