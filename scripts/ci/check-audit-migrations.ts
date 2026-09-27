import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Spec 9.2: audit_event is append-only and additive-only across migrations
// (SEC-010). A statement naming audit_event passes only if it is the first
// CREATE TABLE audit_event, one of the three append-only triggers (once each),
// a nullable ADD COLUMN, or a CREATE [UNIQUE] INDEX on audit_event. Anything
// else, including drizzle's __new_audit_event table rebuild, fails.

const norm = (s: string) =>
  s
    .replace(/[`"[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// A non-trigger statement must be a single statement: a second one hidden in
// the same chunk (no statement-breakpoint) would otherwise ride on an allowed prefix.
const single = (s: string) => !s.replace(/;$/, "").includes(";");

export function checkAuditMigrations(files: { name: string; sql: string }[]): string[] {
  const errors: string[] = [];
  let created = false;
  const triggers = new Set<string>();
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const raw of f.sql.split("--> statement-breakpoint")) {
      const s = norm(raw);
      if (!/audit_event/i.test(s)) continue;
      const bad = (why: string) => errors.push(`${f.name}: ${why}: ${s.slice(0, 120)}`);
      if (/__new_audit_event/i.test(s)) {
        bad("table rebuild");
        continue;
      }
      if (/^CREATE TABLE audit_event \(/i.test(s) && single(s)) {
        if (created) bad("second CREATE TABLE");
        created = true;
        continue;
      }
      const t =
        /^CREATE TRIGGER (audit_event_no_update|audit_event_no_delete|audit_event_no_replace) /i.exec(
          s,
        );
      if (t?.[1]) {
        const name = t[1].toLowerCase();
        if (triggers.has(name)) bad("trigger created twice");
        triggers.add(name);
        continue;
      }
      if (/^CREATE (UNIQUE )?INDEX \S+ ON audit_event \(/i.test(s) && single(s)) continue;
      if (/^ALTER TABLE audit_event ADD (COLUMN )?\S+ \S+/i.test(s) && single(s)) {
        if (/NOT NULL/i.test(s)) bad("added column must be nullable");
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
