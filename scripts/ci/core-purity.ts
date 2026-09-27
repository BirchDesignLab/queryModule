import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * #85 item 1: biome's noRestrictedGlobals (#71) catches bare identifiers only.
 * This scan catches the same IO globals reached through a global object
 * (globalThis, window, self, global), by dot, optional chain or string index.
 */
const GLOBAL_OBJECTS = ["globalThis", "window", "self", "global"];

/** The deniedGlobals names from biome.json (one source for both checks). Throws when absent. */
export function deniedGlobals(biomeJson: string): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "deniedGlobals" && x && typeof x === "object")
          for (const name of Object.keys(x)) found.add(name);
        else walk(x);
      }
  };
  walk(JSON.parse(biomeJson));
  if (found.size === 0) throw new Error("biome.json lists no deniedGlobals");
  return [...found].sort();
}

/** Every `<global object>.<denied name>` (or `?.`, or `["name"]`) in one source text. */
export function findGlobalMemberAccess(source: string, names: readonly string[]): string[] {
  const objects = GLOBAL_OBJECTS.join("|");
  const members = names.join("|");
  const obj = String.raw`(?<![\w$.])(?:${objects})\s*`;
  const dot = String.raw`(?:\?\.|\.)\s*(?:${members})(?![\w$])`;
  const index = String.raw`(?:\?\.)?\[\s*["'\x60](?:${members})["'\x60]\s*\]`;
  const re = new RegExp(`${obj}(?:${dot}|${index})`, "g");
  return [...source.matchAll(re)].map((m) => m[0]);
}

/** Violations in packages/core/src, test files excluded, as "path: match". */
export function scanCore(root: string, names: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        for (const m of findGlobalMemberAccess(readFileSync(p, "utf8"), names))
          out.push(`${relative(root, p).replaceAll("\\", "/")}: ${m}`);
    }
  };
  walk(join(root, "packages", "core", "src"));
  return out;
}
