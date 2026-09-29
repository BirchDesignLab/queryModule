// Pre-install lockfile guard (PR #83 review I1, W5A ruling, ADR-0007).
//
// Runs with the runner's own node before pnpm/action-setup and the install, so
// a [deps] PR cannot repoint tsx, yaml or esbuild (the tools the parsed check
// in check-lockfile.ts runs on) at a tarball, git repo or directory and then
// have that code run or tamper with the parsed check. It needs no dependency,
// so nothing from the PR's own lockfile runs before it.
//
// It is an allowlist over lines, not a YAML parser, and fails closed:
// - every line that mentions `resolution` must be exactly
//   `<indent>resolution: {integrity: <base64>}` (pnpm's registry form);
// - no line may carry a tarball, repo, commit, directory, path or type key;
// - no backslash (double-quoted escapes could spell a key), YAML tag, anchor,
//   alias, merge key, explicit key or directive, and no control character or
//   alternative line break;
// - `---` document starts are allowed (pnpm 12 lockfiles are multi-document);
//   `...` document ends are not.
// It never prints a line's value, only the line number and the rule broken.
//
// Usage: node scripts/ci/lockfile-guard.mjs [pnpm-lock.yaml]
// Exit 0 clean, 1 offenders, 2 unreadable file.

import { readFileSync } from "node:fs";
import { isMainModule } from "./is-main-module.mjs";

const REGISTRY_RESOLUTION = /^ +resolution: \{integrity: [A-Za-z0-9+/=-]+\}$/;
const FORBIDDEN_KEY = /(^|[\s{,[?])['"]?(tarball|repo|commit|directory|path|type)['"]?\s*:/;
// Tags (!), anchors (&) and aliases (*) start a token: at line start, after
// whitespace or a flow indicator. `workspace:*` is a plain scalar and passes.
const NODE_PROPERTY = /(^|[\s[{,])[!&*]/;
const EXPLICIT_KEY = /(^|[\s[{,])\?(\s|$)/;
// C0 controls other than LF (CR is split off first), DEL, NEL, LS, PS, BOM.
const BAD_CHAR = new RegExp(
  `[\x00-\x09\x0b-\x1f\x7f\x85${String.fromCharCode(0x2028, 0x2029, 0xfeff)}]`,
);

/** Quoted scalars blanked out, so their content is not read as syntax. */
function stripQuoted(line) {
  return line.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * @param {string} text the lockfile's contents
 * @returns {string[]} one message per offending line; empty when clean
 */
export function guardLockfile(text) {
  const out = [];
  let resolutions = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `line ${i + 1}: `;
    if (BAD_CHAR.test(line)) out.push(`${at}control character, tab or non-standard line break`);
    if (line.includes("\\")) out.push(`${at}backslash (escaped YAML key or value)`);
    if (/resolution/i.test(line)) {
      if (REGISTRY_RESOLUTION.test(line)) resolutions += 1;
      else out.push(`${at}resolution is not exactly {integrity: <hash>}`);
    }
    if (FORBIDDEN_KEY.test(line))
      out.push(`${at}tarball, repo, commit, directory, path or type key`);
    const bare = stripQuoted(line);
    if (NODE_PROPERTY.test(bare)) out.push(`${at}YAML tag, anchor or alias`);
    if (bare.includes("<<")) out.push(`${at}YAML merge key`);
    if (EXPLICIT_KEY.test(bare)) out.push(`${at}YAML explicit key`);
    if (line.startsWith("%")) out.push(`${at}YAML directive`);
    if (line.startsWith("---") && line !== "---") out.push(`${at}content after a document start`);
    if (line.startsWith("...")) out.push(`${at}YAML document end`);
  });
  if (resolutions === 0) out.push("no registry resolution lines found");
  return out;
}

function main() {
  const path = process.argv[2] ?? "pnpm-lock.yaml";
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    console.error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const offenders = guardLockfile(text);
  if (offenders.length > 0) {
    console.error(`${path} fails the pre-install registry-only guard:`);
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }
  console.log(`${path}: pre-install guard ok (registry integrity resolutions only)`);
}

if (isMainModule(import.meta.url, process.argv[1])) main();
