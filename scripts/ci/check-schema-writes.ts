import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Spec 9.2 and #189 (developer 09-27-26): app code under packages/api/src must never
// enable PRAGMA writable_schema or write to the schema table, either of which could
// rewrite the audit_event triggers at run time. Reads (checkAuditTriggers selects from
// sqlite_master) stay allowed. This is a source guard; #189 adds the connection-level
// block. Comments are stripped first so documentation may name the forms it forbids.

const WRITABLE_SCHEMA = /\bwritable_schema\b/i;
const QUOTE = String.raw`["'\x60\[]?`;
const TABLE = String.raw`(?:${QUOTE}(?:main|temp)${QUOTE}\s*\.\s*)?${QUOTE}sqlite_(?:temp_)?(?:master|schema)\b`;
const WRITE = new RegExp(
  String.raw`\b(?:update|insert\s+(?:or\s+\w+\s+)?into|replace\s+into|delete\s+from)\s+${TABLE}`,
  "i",
);

/** Source with block and line comments blanked; a "//" inside a string is kept. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'\x60\\])\/\/[^\n]*/g, "$1");
}

/** The forbidden forms found in one source text. */
export function findSchemaWrites(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  const w = code.match(WRITABLE_SCHEMA);
  if (w) out.push(w[0]);
  const m = code.match(WRITE);
  if (m) out.push(m[0].replace(/\s+/g, " "));
  return out;
}

/** Violations under dir (.ts, .mts, .js, .mjs), as "path: match". */
export function scanSchemaWrites(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(?:m?ts|m?js)$/.test(e.name))
        for (const m of findSchemaWrites(readFileSync(p, "utf8")))
          out.push(`${relative(dir, p).replaceAll("\\", "/")}: ${m}`);
    }
  };
  walk(dir);
  return out;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const dir = resolve(process.argv[2] ?? "packages/api/src");
  const errors = scanSchemaWrites(dir);
  for (const e of errors) console.error(e);
  console.log(errors.length === 0 ? "no schema-table writes" : `${errors.length} violation(s)`);
  process.exit(errors.length === 0 ? 0 : 1);
}
