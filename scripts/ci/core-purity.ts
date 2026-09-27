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
 * Builds a regex source for a chain of `names` (dot, optional-chain dot, or a
 * string-indexed bracket, optionally itself preceded by `?.`), e.g.
 * `globalThis`, `globalThis.window`, `globalThis?.['window']`. Shared by
 * `findGlobalAliases` (a chain of global objects) and `findGlobalMemberAccess`
 * (a chain of global objects and/or one-level aliases) so the two stay in
 * sync (#184 item 5).
 */
function buildChainPattern(names: string): string {
  const dotStep = String.raw`(?:\?\.|\.)\s*(?:${names})\s*`;
  const indexStep = String.raw`(?:\?\.)?\s*\[\s*["'\x60](?:${names})["'\x60]\s*\]\s*`;
  return String.raw`(?:${names})\s*(?:${dotStep}|${indexStep})*`;
}

/**
 * One-level alias tracking only (developer ruling 09-27-26, #96 G-M5): a
 * `const`/`let`/`var` whose initializer is exactly a global-object name, or a
 * chain of global-object names (`const g = globalThis;`, `const w =
 * globalThis.window;`), optionally followed by a type cast (`const g =
 * globalThis as any;`). Any declarator in a multi-declarator statement is
 * checked (`let a = 1, g = globalThis;`), not only the first. Deeper alias
 * tracking is out of scope: an alias of an alias, an alias passed through a
 * function, reassignment, `Reflect.get`, computed non-literal keys and
 * `eval`/`Function` are not followed. Detection is whole-file and scope-blind:
 * a same-named identifier initialized this way in another, unrelated scope is
 * still treated as a global alias everywhere in the file; over-flagging (a
 * false positive) is the safe failure for a purity gate, never under-flagging.
 */
function findGlobalAliases(source: string): string[] {
  const objects = GLOBAL_OBJECTS.join("|");
  const chain = buildChainPattern(objects);
  // [critic:I2] allow an optional type annotation between the binding name and `=`,
  // e.g. `const g: typeof globalThis = globalThis;`. The terminator is a lookahead
  // (not consumed) so a comma stays available to start the next declarator's match.
  const re = new RegExp(
    String.raw`(?:\b(?:const|let|var)\s+|,\s*)([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*` +
      chain +
      String.raw`(?:\s*as\s+[^;,\n]+)?(?=\s*(?:[;,\n]|$))`,
    "g",
  );
  const aliases = new Set<string>();
  for (const m of source.matchAll(re)) aliases.add(m[1]);
  return [...aliases];
}

/** Escapes a string for safe interpolation into a RegExp source (critic:I1). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every `<global object or one-level alias>.<denied name>` (dot, optional
 * chain or string index, through any chain of global-object names), and
 * every destructuring of a denied name from a global object or alias.
 */
export function findGlobalMemberAccess(source: string, names: readonly string[]): string[] {
  const aliases = findGlobalAliases(source);
  // [critic:I1] alias names go into a RegExp source; escape them (e.g. `$g`, `$`)
  // so a regex metacharacter in the alias name can't change what the pattern matches.
  const objects = [...GLOBAL_OBJECTS, ...aliases.map(escapeRegExp)].join("|");
  const members = names.join("|");
  const link = buildChainPattern(objects);
  const obj = String.raw`(?<![\w$.])${link}`;
  const dot = String.raw`(?:\?\.|\.)\s*(?:${members})(?![\w$])`;
  const index = String.raw`(?:\?\.)?\[\s*["'\x60](?:${members})["'\x60]\s*\]`;
  const access = new RegExp(`${obj}(?:${dot}|${index})`, "g");
  const out = [...source.matchAll(access)].map((m) => m[0]);

  // Destructuring from a global object or a one-level alias: `const { N } = globalThis`,
  // `let { N: f } = window`, `var { a, N } = g` (whitespace/newlines inside braces allowed).
  // [critic:C1] the binding list's closing `}` is found by brace-depth scanning (see
  // `findBraceEnd` below), not by a regex character class, so the match cannot cross into
  // an earlier or later statement's own destructure (e.g. `const { x } = opts;` immediately
  // before the real one). [critic:re1:nested-destructure-brace-regression] brace-depth
  // scanning also means a brace nested inside the binding list itself (a nested
  // destructuring pattern, e.g. `const { navigator: { userAgent } } = window;`) no longer
  // makes the whole match fail, unlike a flat "exclude every brace" character class would.
  // [critic:I2] an optional type annotation is allowed between the closing `}` and `=`,
  // e.g. `const { fetch }: typeof globalThis = globalThis`.
  // #184 item 1: the source must be exactly a global object or a chain of global
  // objects, ending the expression right there; a member of a global object
  // (`window.api`) is not itself a global object and must not match.
  const memberRe = new RegExp(`^(?:${members})$`);
  const openBrace = /\b(?:const|let|var)\s*\{/g;
  const afterBrace = new RegExp(
    String.raw`^\s*(?::[^=;]+)?=\s*(?<![\w$.])${link}(?=\s*(?:[;,\n]|$))`,
  );
  for (const m of source.matchAll(openBrace)) {
    const bindingsStart = m.index + m[0].length;
    const braceEnd = findBraceEnd(source, bindingsStart - 1);
    if (braceEnd === -1) continue;
    const rest = afterBrace.exec(source.slice(braceEnd + 1));
    if (!rest) continue;
    const bindingList = source.slice(bindingsStart, braceEnd);
    const bindings = splitTopLevel(bindingList).map((b) => {
      // [critic:I3] strip a default value (`N = default`), then a rename (`N: f`), then
      // quotes or a literal computed-key bracket (`'N'`, `['N']`) around the key.
      const key = b.split("=")[0]?.split(":")[0]?.trim() ?? "";
      const bracketed = key.match(/^\[\s*(['"`])([^'"`]*)\1\s*\]$/);
      if (bracketed) return bracketed[2];
      const quoted = key.match(/^(['"`])([^'"`]*)\1$/);
      if (quoted) return quoted[2];
      return key;
    });
    if (bindings.some((b) => memberRe.test(b)))
      out.push(source.slice(m.index, braceEnd + 1 + rest[0].length));
  }

  return out;
}

/**
 * Given the index of an opening `{`, returns the index of its matching `}` by brace-depth
 * scanning, or -1 if unbalanced before the source ends. [critic:re1] lets the destructure
 * scan handle a binding list containing its own nested braces (e.g. a nested destructuring
 * pattern) instead of excluding every brace outright.
 */
function findBraceEnd(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits a destructuring binding list on top-level commas only (brace-depth aware). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "{" || list[i] === "[") depth++;
    else if (list[i] === "}" || list[i] === "]") depth--;
    else if (list[i] === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
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
