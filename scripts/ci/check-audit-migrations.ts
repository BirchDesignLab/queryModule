import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Spec 9.2: audit_event is append-only and additive-only across migrations
// (SEC-010). A statement naming audit_event passes only if it is the first
// CREATE TABLE audit_event, one of the three append-only triggers (once each,
// in the exact BEFORE <event> ... RAISE(ABORT) form), a nullable ADD COLUMN with
// at most a literal DEFAULT, or a CREATE [UNIQUE] INDEX on audit_event. Anything
// else, including drizzle's __new_audit_event table rebuild, fails. A statement
// that touches the schema table (writable_schema, sqlite_master, sqlite_schema)
// fails whether or not it names audit_event: it can drop or rewrite the triggers.

/**
 * The code of one chunk for matching: comments become a space, every string
 * literal becomes '' (so neither a comment opener nor a keyword inside a string
 * counts), identifier quotes are dropped and whitespace is collapsed.
 */
function codeOf(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "-" && raw[i + 1] === "-") {
      const nl = raw.indexOf("\n", i);
      i = nl === -1 ? raw.length : nl;
      out += " ";
    } else if (c === "/" && raw[i + 1] === "*") {
      const close = raw.indexOf("*/", i + 2);
      i = close === -1 ? raw.length : close + 2;
      out += " ";
    } else if (c === "'") {
      // '' inside a literal is an escaped quote, so skip pairs until a lone quote
      i++;
      while (i < raw.length && !(raw[i] === "'" && raw[i + 1] !== "'")) {
        i += raw[i] === "'" ? 2 : 1;
      }
      i++;
      out += "''";
    } else if (c === "`" || c === '"' || c === "[" || c === "]") {
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

const display = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, 120);

// A non-trigger statement must be a single statement: a second one hidden in
// the same chunk (no statement-breakpoint) would otherwise ride on an allowed prefix.
const single = (s: string) => !s.replace(/;$/, "").includes(";");

const SCHEMA_TABLE = /\b(writable_schema|sqlite_(temp_)?(master|schema))\b/i;

/** The event each append-only trigger guards; its whole statement is pinned below. */
const TRIGGER_EVENT: Record<string, string> = {
  audit_event_no_update: "UPDATE",
  audit_event_no_delete: "DELETE",
  audit_event_no_replace: "INSERT",
};
const TRIGGER =
  /^CREATE TRIGGER (audit_event_no_update|audit_event_no_delete|audit_event_no_replace) BEFORE (UPDATE|DELETE|INSERT) ON audit_event (WHEN [^;]+ )?BEGIN SELECT RAISE\(ABORT, ''\); END;?$/i;

const ADD_COLUMN = /^ALTER TABLE audit_event ADD /i;
// Only a name, a type and an optional literal DEFAULT: NOT NULL, CHECK, REFERENCES,
// GENERATED, COLLATE, UNIQUE and every other constraint fail.
const NULLABLE_COLUMN =
  /^ALTER TABLE audit_event ADD (COLUMN )?\w+ \w+( ?\( ?\d+ ?(, ?\d+ ?)?\))?( DEFAULT (''|NULL|TRUE|FALSE|[+-]?\d+(\.\d+)?))?;?$/i;

export function checkAuditMigrations(files: { name: string; sql: string }[]): string[] {
  const errors: string[] = [];
  let created = false;
  const triggers = new Set<string>();
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const raw of f.sql.split("--> statement-breakpoint")) {
      const s = codeOf(raw);
      const bad = (why: string) => errors.push(`${f.name}: ${why}: ${display(raw)}`);
      if (SCHEMA_TABLE.test(s)) {
        bad("statement touches the schema table");
        continue;
      }
      if (!/audit_event/i.test(s)) continue;
      if (/__new_audit_event/i.test(s)) {
        bad("table rebuild");
        continue;
      }
      if (/^CREATE TABLE audit_event \(/i.test(s) && single(s)) {
        if (created) bad("second CREATE TABLE");
        created = true;
        continue;
      }
      const t = TRIGGER.exec(s);
      const name = t?.[1]?.toLowerCase();
      if (name && TRIGGER_EVENT[name] === t?.[2]?.toUpperCase()) {
        if (triggers.has(name)) bad("trigger created twice");
        triggers.add(name);
        continue;
      }
      if (/^CREATE (UNIQUE )?INDEX \S+ ON audit_event \(/i.test(s) && single(s)) continue;
      if (ADD_COLUMN.test(s)) {
        if (!NULLABLE_COLUMN.test(s)) {
          bad("added column must be nullable with no constraint but a literal DEFAULT");
        }
        continue;
      }
      bad("statement not allowed on audit_event");
    }
  }
  return errors;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const dir = resolve(process.argv[2] ?? "packages/api/drizzle");
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  const errors = checkAuditMigrations(files);
  for (const e of errors) console.error(e);
  console.log(
    errors.length === 0
      ? `audit_event migrations ok (${files.length} files)`
      : `${errors.length} violation(s)`,
  );
  process.exit(errors.length === 0 ? 0 : 1);
}
