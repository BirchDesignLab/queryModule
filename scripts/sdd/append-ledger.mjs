// append-ledger.mjs: append the ledgerLines of an sdd-task Workflow result to the SDD ledger.
// The sdd-task workflow computes the ledger lines and returns them; the controller appends them
// (post-pilot 09-26-26: the Haiku ledger agent was dropped).
//
// Usage (repo root, PowerShell or Git Bash):
//   node scripts/sdd/append-ledger.mjs <workflow-output-file> <ledgerPath>
//
// <workflow-output-file> holds the result: a bare result object, or any text that contains the
// result JSON (a task output file, a fenced block, a JSON-escaped string). When several results
// are present the last one wins. The ledger must already exist; lines are appended with the
// ledger's own line ending and a trailing newline.
//
// Exit codes: 0 appended (prints the count), 2 usage error or unreadable file, 3 no ledgerLines.
// Node only, no dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isLines = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

// Parses the JSON value that starts at text[start] ("[" or "{"), respecting strings and escapes.
// Returns the parsed value, or undefined when it does not parse.
function parseBalancedAt(text, start) {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function collect(text, found, depth) {
  if (depth > 4 || !text.includes("ledgerLines")) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    walk(parsed, found, depth);
    return;
  }
  // Not JSON as a whole: scan for "ledgerLines": [ ... ] and for JSON string literals that hold
  // an escaped result.
  const re = /"ledgerLines"\s*:\s*\[|"(?:[^"\\]|\\.)*ledgerLines(?:[^"\\]|\\.)*"/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].startsWith('"ledgerLines"')) {
      const v = parseBalancedAt(text, m.index + m[0].length - 1);
      if (isLines(v)) found.push(v);
    } else {
      let inner;
      try {
        inner = JSON.parse(m[0]);
      } catch {
        continue;
      }
      collect(inner, found, depth + 1);
    }
  }
}

function walk(v, found, depth) {
  if (typeof v === "string") collect(v, found, depth + 1);
  else if (Array.isArray(v)) for (const x of v) walk(x, found, depth);
  else if (v && typeof v === "object") {
    if (isLines(v.ledgerLines)) found.push(v.ledgerLines);
    for (const [k, x] of Object.entries(v)) if (k !== "ledgerLines") walk(x, found, depth);
  }
}

// Returns the ledgerLines of the last result found in text, or null.
export function findLedgerLines(text) {
  const found = [];
  collect(String(text), found, 0);
  return found.length ? found[found.length - 1] : null;
}

// Returns the text to append to a ledger whose current content is existing.
export function appendText(existing, lines) {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const lead = existing.length && !existing.endsWith("\n") ? eol : "";
  return `${lead}${lines.join(eol)}${eol}`;
}

function main(argv) {
  if (argv.length !== 2) {
    console.error("usage: node scripts/sdd/append-ledger.mjs <workflow-output-file> <ledgerPath>");
    return 2;
  }
  const [input, ledger] = argv;
  let text;
  try {
    text = fs.readFileSync(input, "utf8");
  } catch (e) {
    console.error(`append-ledger: cannot read ${input}: ${e.message}`);
    return 2;
  }
  const lines = findLedgerLines(text);
  if (!lines?.length) {
    console.error(`append-ledger: no ledgerLines found in ${input}`);
    return 3;
  }
  let existing;
  try {
    existing = fs.readFileSync(ledger, "utf8");
  } catch (e) {
    console.error(`append-ledger: cannot read the ledger ${ledger}: ${e.message}`);
    return 2;
  }
  fs.appendFileSync(ledger, appendText(existing, lines), "utf8");
  console.log(`append-ledger: appended ${lines.length} line(s) to ${ledger}`);
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === self.toLowerCase()) {
  process.exit(main(process.argv.slice(2)));
}
