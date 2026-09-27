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

/**
 * One-level alias tracking only (developer ruling 09-27-26, #96 G-M5): a
 * `const`/`let`/`var` whose initializer is exactly a global-object name, or a
 * chain of global-object names (`const g = globalThis;`, `const w =
 * globalThis.window;`). Deeper alias tracking is out of scope: an alias of an
 * alias, an alias passed through a function, reassignment, `Reflect.get`,
 * computed non-literal keys and `eval`/`Function` are not followed.
 */
function findGlobalAliases(source: string): string[] {
  const objects = GLOBAL_OBJECTS.join("|");
  const chain = String.raw`(?:${objects})(?:\s*(?:\?\.|\.)\s*(?:${objects})|\s*\[\s*["'\x60](?:${objects})["'\x60]\s*\])*`;
  const re = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:${chain})\s*(?:[;,\n]|$)`,
    "g",
  );
  const aliases = new Set<string>();
  for (const m of source.matchAll(re)) aliases.add(m[1]);
  return [...aliases];
}

/**
 * Every `<global object or one-level alias>.<denied name>` (dot, optional
 * chain or string index, through any chain of global-object names), and
 * every destructuring of a denied name from a global object or alias.
 */
export function findGlobalMemberAccess(source: string, names: readonly string[]): string[] {
  const aliases = findGlobalAliases(source);
  const objects = [...GLOBAL_OBJECTS, ...aliases].join("|");
  const members = names.join("|");
  const link = String.raw`(?:${objects})\s*(?:(?:\?\.|\.)\s*(?:${objects})\s*|\[\s*["'\x60](?:${objects})["'\x60]\s*\]\s*)*`;
  const obj = String.raw`(?<![\w$.])${link}`;
  const dot = String.raw`(?:\?\.|\.)\s*(?:${members})(?![\w$])`;
  const index = String.raw`(?:\?\.)?\[\s*["'\x60](?:${members})["'\x60]\s*\]`;
  const access = new RegExp(`${obj}(?:${dot}|${index})`, "g");
  const out = [...source.matchAll(access)].map((m) => m[0]);

  // Destructuring from a global object or a one-level alias: `const { N } = globalThis`,
  // `let { N: f } = window`, `var { a, N } = g` (whitespace/newlines inside braces allowed).
  const destructure = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{\s*([\s\S]*?)\s*\}\s*=\s*(?<![\w$.])(?:${objects})(?![\w$])`,
    "g",
  );
  const memberRe = new RegExp(`^(?:${members})$`);
  for (const m of source.matchAll(destructure)) {
    const bindings = m[1].split(",").map((b) => b.trim().split(":")[0].trim());
    if (bindings.some((b) => memberRe.test(b))) out.push(m[0]);
  }

  return out;
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
