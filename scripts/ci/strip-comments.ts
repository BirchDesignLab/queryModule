/**
 * Strips `//` line comments and `/* ... *\/` block comments from `source`,
 * without touching comment-like text inside a string or template literal.
 * Shared by story-tags.ts (hasTaggedTest) and barrels.ts (isPureBarrel), both
 * of which previously stripped comments with plain regexes that did not know
 * about strings: a `//` or `/*` inside a string literal could swallow real
 * code up to the next matching marker anywhere later in the file (item 7).
 *
 * Template literals are treated as opaque strings (no `${...}` tracking, and
 * no nested templates) - good enough for source that never puts a comment
 * marker inside an expression hole.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j += 1;
      i = j;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(source[j] === "*" && source[j + 1] === "/")) j += 1;
      i = j + 2 <= n ? j + 2 : n;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
