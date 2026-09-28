import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Spec 9.2 and #189 (developer 09-27-26): app code under packages/api/src must never
// enable PRAGMA writable_schema or write to the schema table, either of which could
// rewrite the audit_event triggers at run time. Reads (checkAuditTriggers selects from
// sqlite_master) stay allowed. This is a source guard; #189 adds the connection-level
// block. Comments are stripped first so documentation may name the forms it forbids.

const WRITABLE_SCHEMA = /\bwritable_schema\b/i;
const QUOTE = String.raw`["'\x60\[\]]?`;
// Between two SQL words: whitespace, an escaped newline or tab as written in a JS string,
// or a SQL comment (A2 review C-M2).
const SEP = String.raw`(?:\s|\\[nrt]|--[^\n]*?(?:\n|\\n)|/\*[\s\S]*?\*/)+`;
// Any schema name may prefix the table: main, temp or an attached one (A2 review G-M1).
const TABLE = String.raw`(?:${QUOTE}\w+${QUOTE}\s*\.\s*)?${QUOTE}sqlite_(?:temp_)?(?:master|schema)\b`;
const OR = String.raw`(?:or${SEP}\w+${SEP})?`;
const WRITE = new RegExp(
  String.raw`\b(?:update${SEP}${OR}|insert${SEP}${OR}into${SEP}|replace${SEP}into${SEP}|delete${SEP}from${SEP})${TABLE}`,
  "i",
);

// Words after which a "/" starts a regex literal rather than a division.
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** End (exclusive) of the string literal opening at i; an unterminated one ends at the newline. */
function endOfString(src: string, i: number, close: string): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === close) return j + 1;
    else if (c === "\n") return j;
    else j++;
  }
  return src.length;
}

/** End (exclusive) of the regex literal opening at i, flags included; "/" in a class is text. */
function endOfRegex(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === "\n") return j;
    else {
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j++;
        while (j < src.length && /[a-z]/i.test(src[j] as string)) j++;
        return j;
      }
      j++;
    }
  }
  return src.length;
}

/** Whether a "/" after this code (comments already stripped) starts a regex literal. */
function regexStartsAfter(code: string): boolean {
  const t = code.trimEnd();
  const last = t.at(-1);
  if (last === undefined) return true;
  if (/[\w$]/.test(last)) return REGEX_AFTER_WORD.has(/[\w$]+$/.exec(t)?.[0] ?? "");
  // After a value (")", "]", a closing quote or template) it is a division. Anywhere else,
  // "}" included, it is read as a regex: a wrong guess then keeps code, never hides it.
  return !/[)\]'"\x60]/.test(last);
}

/**
 * Source with JS comments removed: a block comment becomes a space, a line comment runs
 * to its newline. String ('...', "..."), template (`...`, with each ${...} scanned as
 * code) and regex literals are copied whole, escapes included, so a comment opener inside
 * one starts nothing and the SQL text of a string stays visible (A2 review G-I1, C-M2).
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  // The brace depth inside each open ${...}, innermost last; empty outside templates.
  const holes: number[] = [];
  // Copies template text from i up to and including its closing backtick or next "${".
  const template = (): void => {
    while (i < src.length) {
      const c = src[i] as string;
      if (c === "\\") {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (c === "\x60") {
        out += c;
        i++;
        return;
      } else if (c === "$" && src[i + 1] === "{") {
        out += "${";
        i += 2;
        holes.push(0);
        return;
      } else {
        out += c;
        i++;
      }
    }
  };
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      out += " ";
    } else if (c === "'" || c === '"') {
      const j = endOfString(src, i, c);
      out += src.slice(i, j);
      i = j;
    } else if (c === "\x60") {
      out += c;
      i++;
      template();
    } else if (c === "/" && regexStartsAfter(out)) {
      const j = endOfRegex(src, i);
      out += src.slice(i, j);
      i = j;
    } else {
      const depth = holes.length - 1;
      if (depth >= 0 && c === "{") holes[depth] = (holes[depth] as number) + 1;
      if (depth >= 0 && c === "}") {
        if (holes[depth] === 0) {
          holes.pop();
          out += c;
          i++;
          template();
          continue;
        }
        holes[depth] = (holes[depth] as number) - 1;
      }
      out += c;
      i++;
    }
  }
  return out;
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
