/**
 * Shared read/parse and path-formatting helpers for the scripts/ci CLIs
 * (config-migrate.ts, check-licences.ts, story-tags.ts, config-validate.ts).
 * Extracted so the ENOENT-vs-other-error classification and the JSON.parse
 * wrapping exist in one place instead of three near-identical copies
 * (review Q1/C6), matching the pattern already used for strip-comments.ts.
 */

/** The shared entry-point guard (#220 M2); the implementation is JS so .mjs CLIs share it. */
export { isMainModule } from "./is-main-module.mjs";

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
