// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the cases are JS source text with template holes, scanned as data.
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

  // A2 review G-M1: a conflict clause after UPDATE and any schema name before the table.
  it("flags UPDATE OR <conflict> and any schema prefix", () => {
    for (const src of [
      "UPDATE OR IGNORE sqlite_master SET sql = 'x'",
      "update or replace main.sqlite_master set sql='x'",
      "UPDATE aux.sqlite_master SET sql = 'x'",
      'DELETE FROM "aux"."sqlite_schema"',
    ])
      expect(findSchemaWrites(src), src).not.toEqual([]);
  });

  // A2 review C-M2: a SQL comment between the keyword and the table.
  it("flags a write with a SQL comment between the keyword and the table", () => {
    for (const src of [
      "sql`UPDATE -- note\n  sqlite_master SET sql = 'x'`",
      'c.execute("UPDATE -- note\\n sqlite_master SET sql = 1")',
      'c.execute("DELETE FROM /* x */ sqlite_master")',
    ])
      expect(findSchemaWrites(src), src).not.toEqual([]);
  });

  // A2 review G-I1 / C-M2: a comment opener inside a string, template or regex literal
  // starts no comment, so it cannot blank the code that follows it.
  it("flags writable_schema after a string that holds a comment opener", () => {
    for (const src of [
      "const g = 'drizzle/*.sql';\nawait c.execute('PRAGMA writable_schema=ON');\n/** doc */",
      "const u = 'a // b'; c.execute('PRAGMA writable_schema=ON');",
      'app.get("/api/*", h);\nc.execute("PRAGMA writable_schema=ON");\n/* note */',
      "const t = `a // b ${x}`; c.execute('PRAGMA writable_schema=ON');",
      "const t = `a ${'`'} /* b`; c.execute('PRAGMA writable_schema=ON'); /* c */",
      "const e = 'it\\'s /*'; c.execute('PRAGMA writable_schema=ON'); /* c */",
      "const r = /\\/*/; c.execute('PRAGMA writable_schema=ON'); /* c */",
      "const r = x.split(/[/*]/); c.execute('PRAGMA writable_schema=ON'); /* c */",
    ])
      expect(findSchemaWrites(src), src).not.toEqual([]);
  });

  it("still strips comments that follow strings, templates and division", () => {
    for (const src of [
      'const a = "it\'s"; // writable_schema',
      "const t = `${a /* writable_schema */}`; // UPDATE sqlite_master",
      "const s = '/* not a comment */'; const x = 1;",
      "const h = a / b; /* writable_schema */ const k = c / d; // writable_schema",
    ])
      expect(findSchemaWrites(src), src).toEqual([]);
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
