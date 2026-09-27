import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSchemaWrites, scanSchemaWrites } from "./check-schema-writes";

// A2 (developer 09-27-26): app code must never enable writable_schema or write to the
// schema table; either could rewrite the audit_event triggers at run time (#189).
describe("schema-table writes in packages/api/src are refused (spec 9.2, #189)", () => {
  it("flags writable_schema in any case", () => {
    for (const src of [
      'await db.$client.execute("PRAGMA writable_schema=ON");',
      "sql`pragma WRITABLE_SCHEMA = 1`",
      "const p = 'writable_schema';",
    ])
      expect(findSchemaWrites(src), src).not.toEqual([]);
  });

  it("flags UPDATE, INSERT, DELETE and REPLACE on sqlite_master or sqlite_schema", () => {
    for (const src of [
      "UPDATE sqlite_master SET sql = 'x'",
      "update  main.sqlite_schema set sql='x'",
      'INSERT INTO "sqlite_master" VALUES (1)',
      "INSERT OR REPLACE INTO sqlite_master VALUES (1)",
      "DELETE FROM\n  sqlite_master WHERE name = 't'",
      "REPLACE INTO [sqlite_schema] VALUES (1)",
      "update sqlite_temp_master set sql = 'x'",
    ])
      expect(findSchemaWrites(src), src).not.toEqual([]);
  });

  it("allows reads of sqlite_master and mentions inside comments", () => {
    for (const src of [
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger'",
      "// rewritten through PRAGMA writable_schema and an UPDATE of sqlite_master",
      "/* writable_schema\n UPDATE sqlite_master */ const x = 1;",
      "const url = 'https://example.test/a'; // UPDATE sqlite_master",
    ])
      expect(findSchemaWrites(src), src).toEqual([]);
  });

  it("packages/api/src has no schema-table write", () => {
    expect(scanSchemaWrites(join(import.meta.dirname, "../../packages/api/src"))).toEqual([]);
  });
});
