/**
 * Shared read/parse and path-formatting helpers for the scripts/ci CLIs
 * (config-migrate.ts, check-licences.ts, story-tags.ts, config-validate.ts).
 * Extracted so the ENOENT-vs-other-error classification and the JSON.parse
 * wrapping exist in one place instead of three near-identical copies
 * (review Q1/C6), matching the pattern already used for strip-comments.ts.
 */

import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when this module is the process entry point. Replaces the bare
 * `import.meta.url === pathToFileURL(process.argv[1]).href` guard, which is
 * false for a symlinked checkout or a drive-letter/case difference on Windows,
 * so a gate CLI skipped main() and exited 0 with no output (fail open). Both
 * sides are realpath-resolved, and compared case-insensitively on win32.
 */
export function isMainModule(
  metaUrl: string,
  argv1: string | undefined,
  o: { platform?: NodeJS.Platform; realpath?: (p: string) => string } = {},
): boolean {
  if (!argv1) return false;
  const platform = o.platform ?? process.platform;
  const isWin = platform === "win32";
  const path = isWin ? win32 : posix;
  const real =
    o.realpath ??
    ((p: string) => {
      try {
        return realpathSync.native(p);
      } catch {
        return p;
      }
    });
  const norm = (p: string) => {
    const r = path.resolve(real(path.resolve(p)));
    return isWin ? r.toLowerCase() : r;
  };
  return norm(fileURLToPath(metaUrl, { windows: isWin })) === norm(argv1);
}

/** Forward slashes on every platform (item 2), a pure string function so it is
 * testable with either separator style regardless of the host OS. */
export function toPosixRel(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

export type ReadJsonResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Reads and JSON-parses `path` via `readFile`, turning fs and JSON errors into
 * a short reason with no raw stack trace and no file excerpt: JSON.parse
 * messages can quote file content, so its message text is never printed.
 */
export function readJsonFile(readFile: (path: string) => string, path: string): ReadJsonResult {
  let text: string;
  try {
    text = readFile(path);
  } catch (e) {
    const reason =
      (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
        ? "file not found"
        : "cannot read file";
    return { ok: false, reason };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
}
