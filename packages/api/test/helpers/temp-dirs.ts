import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * A libsql client, closed, can still hold its Windows file handle for several seconds afterward
 * (observed here: ~4.5-5.5s, and a startup test's qm-data-* dirs all free within 7s; the actual
 * holder is unclear, could be the native libsql close path itself). No retry budget worth
 * paying on every test run closes that gap, so on win32 a still-locked dir is left in place
 * (one summary warning per call) instead of failing the file; the next run's sweep clears it.
 * Every other platform, and every other rmSync error, still throws. The real leak check is an
 * assertion that each client reports closed, which runs everywhere including Linux CI.
 */
export function removeTempDirs(
  dirs: readonly string[],
  label: string,
  o: { platform?: NodeJS.Platform; rm?: (dir: string) => void } = {},
): void {
  const platform = o.platform ?? process.platform;
  const rm = o.rm ?? ((dir: string) => rmSync(dir, { recursive: true, force: true }));
  let stuck = 0;
  for (const dir of dirs) {
    try {
      rm(dir);
    } catch (e) {
      if (platform !== "win32") throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY") throw e;
      stuck++;
    }
  }
  if (stuck > 0) console.warn(`[${label}] ${stuck} temp dir(s) left for the next run's sweep`);
}

/** Removes dirs under root whose name starts with one of prefixes and is older than maxAgeMs. Best-effort: failures are ignored. */
export function sweepStaleTempDirs(
  root: string,
  maxAgeMs: number,
  prefixes: readonly string[] = ["qm-db-"],
  now = Date.now(),
): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    const dir = join(root, name);
    try {
      if (now - statSync(dir).mtimeMs > maxAgeMs) rmSync(dir, { recursive: true, force: true });
    } catch {
      // still locked or already gone; leave it for a later run
    }
  }
}
