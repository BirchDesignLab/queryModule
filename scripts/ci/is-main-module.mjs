// is-main-module.mjs: the one entry-point guard for every scripts/ci CLI (#220 M2, #280).
// Plain JS with JSDoc types so .mjs CLIs can import it; cli-io.ts re-exports it for .ts ones.

import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when this module is the process entry point. Replaces the bare
 * `import.meta.url === pathToFileURL(process.argv[1]).href` guard, which is
 * false for a symlinked checkout or a drive-letter/case difference on Windows,
 * so a gate CLI skipped main() and exited 0 with no output (fail open). Both
 * sides are realpath-resolved, and compared case-insensitively on win32.
 *
 * @param {string} metaUrl import.meta.url of the calling module
 * @param {string | undefined} argv1 process.argv[1]
 * @param {{ platform?: NodeJS.Platform, realpath?: (p: string) => string }} [o]
 * @returns {boolean}
 */
export function isMainModule(metaUrl, argv1, o = {}) {
  if (!argv1) return false;
  const platform = o.platform ?? process.platform;
  const isWin = platform === "win32";
  const path = isWin ? win32 : posix;
  const real =
    o.realpath ??
    ((/** @type {string} */ p) => {
      try {
        return realpathSync.native(p);
      } catch {
        return p;
      }
    });
  const norm = (/** @type {string} */ p) => {
    const r = path.resolve(real(path.resolve(p)));
    return isWin ? r.toLowerCase() : r;
  };
  return norm(fileURLToPath(metaUrl, { windows: isWin })) === norm(argv1);
}
