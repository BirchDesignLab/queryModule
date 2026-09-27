// board-data.mjs: reads and validates docs/board/board-data.json for
// gh-setup-project.mjs (Task 604, #92 "board data out of the gate path").
//
// R3: validation runs and fails closed before the script makes its first
// GitHub read (dry run included). `parseBoardData` is pure (no filesystem
// access) so it is testable on its own (board-data.test.ts R4 equivalence);
// `loadBoardDataOrExit` does the one piece of IO gh-setup-project.mjs needs
// and never returns on a schema error.

import { readFileSync } from "node:fs";
import { validateBoardData } from "./board-data-schema.mjs";

/**
 * Parse and validate raw JSON text against the board-data schema.
 *
 * @param {string} raw
 * @param {{milestoneNames: string[], labelNames: string[], fields: object[]}} known
 * @returns {{ok: true, data: object} | {ok: false, errors: Array<{pointer: string, message: string}>}}
 */
export function parseBoardData(raw, known) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [{ pointer: "", message: `invalid JSON: ${e.message}` }] };
  }
  return validateBoardData(json, known);
}

/**
 * Read and validate `path` (docs/board/board-data.json), or print one line
 * per schema error (path, JSON pointer, message) to stderr and exit(1)
 * without ever calling `gh` or GitHub (R3). Never returns on failure.
 *
 * @param {string} path absolute path to board-data.json
 * @param {{milestoneNames: string[], labelNames: string[], fields: object[]}} known
 * @returns {object} the validated board data
 */
export function loadBoardDataOrExit(path, known) {
  const raw = readFileSync(path, "utf8");
  const result = parseBoardData(raw, known);
  if (result.ok) return result.data;
  for (const e of result.errors) console.error(`${path} ${e.pointer || "/"}: ${e.message}`);
  process.exit(1);
}
