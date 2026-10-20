import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * docs/testing/m2-security-map.md maps every spec 12.7 M2 exit security item to a named test.
 * This test keeps the map honest: each row's file exists and still contains the named test, and
 * every M2 operation the map names is in openapi.json. SEC-005, SEC-010, SEC-012, SEC-014,
 * SEC-020; spec 10.3, 10.7, 12.7.
 */
const ROOT = resolve(import.meta.dirname, "../../../..");
const MAP = resolve(ROOT, "docs/testing/m2-security-map.md");

/** The M2 operations the spec 12.3 P3 route matrix row must cover (M2 P1 and P2 routes). */
const M2_OPERATIONS = [
  "submitQuery",
  "listQueries",
  "getQuery",
  "listAdminAudit",
  "exportAdminAudit",
  "getAdminQuery",
];

const ITEMS = [
  "no cross-user events",
  "replay excludes hidden",
  "admin-only audit routes",
  "bearer REST + WS",
  "security test matrix for M2 routes",
  "A6",
  "A7",
  "A8",
  "A9",
];

interface Row {
  item: string;
  file: string;
  name: string;
}

/** True when `text` holds `name` only as a skipped, todo or commented-out test (C1). */
function onlyInactive(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A running title opens a bare it/test/describe call, or the second call of an .each(...)(...);
  // the name may be part of the title, and the title may start on the next line.
  const active = new RegExp(
    `(?:(?<![.\\w])(?:it|test|describe)|\\))\\(\\s*["'\`][^"'\`\\n]*${esc}`,
  );
  const code = text
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  return !active.test(code);
}

function rows(): Row[] {
  const out: Row[] = [];
  for (const line of readFileSync(MAP, "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // | item | case | `file` | `name` | asserts |
    const file = /^`(.+)`$/.exec(cells[3] ?? "")?.[1];
    const name = /^`(.+)`$/.exec(cells[4] ?? "")?.[1];
    if (file !== undefined && name !== undefined) out.push({ item: cells[1] ?? "", file, name });
  }
  return out;
}

describe("onlyInactive (the map's running-test check)", () => {
  it("accepts a running it() or it.each() title and refuses skip, todo and comments", () => {
    expect(onlyInactive('it("refuses a foreign Origin", () => {', "refuses a foreign Origin")).toBe(
      false,
    );
    expect(onlyInactive('it.each([1])("flags on: %s", () => {', "flags on: %s")).toBe(false);
    expect(
      onlyInactive('it.skip("refuses a foreign Origin", () => {', "refuses a foreign Origin"),
    ).toBe(true);
    expect(onlyInactive('it.todo("refuses a foreign Origin")', "refuses a foreign Origin")).toBe(
      true,
    );
    expect(
      onlyInactive('// it("refuses a foreign Origin", () => {', "refuses a foreign Origin"),
    ).toBe(true);
  });
});

describe("M2 security map (spec 12.7 M2 row)", () => {
  it("names a test file and test name for every row, and every file holds its name", () => {
    const all = rows();
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      const path = resolve(ROOT, r.file);
      expect(existsSync(path), `${r.item}: ${r.file} exists`).toBe(true);
      const text = readFileSync(path, "utf8");
      expect(text, `${r.item}: ${r.file} has ${r.name}`).toContain(r.name);
      expect(onlyInactive(text, r.name), `${r.item}: ${r.name} is a running test`).toBe(false);
    }
  });

  it("covers every spec 12.7 M2 item", () => {
    const text = readFileSync(MAP, "utf8");
    const all = rows();
    for (const item of ITEMS) {
      // D-M2P3-2: replay-excludes-hidden has no M2 test; the map points to ADR-0014 instead.
      if (item === "replay excludes hidden") {
        expect(text, item).toContain("ADR-0014");
        continue;
      }
      expect(
        all.some((r) => r.item.toLowerCase().includes(item.toLowerCase())),
        `${item} has a named test`,
      ).toBe(true);
    }
  });

  it("names every M2 operation, each one in openapi.json", () => {
    const openapi = JSON.parse(
      readFileSync(resolve(ROOT, "packages/api/openapi.json"), "utf8"),
    ) as { paths: Record<string, Record<string, { operationId: string }>> };
    const ids = Object.values(openapi.paths).flatMap((m) =>
      Object.values(m).map((o) => o.operationId),
    );
    const text = readFileSync(MAP, "utf8");
    for (const op of M2_OPERATIONS) {
      expect(ids, op).toContain(op);
      expect(text, op).toContain(op);
    }
  });
});
