/** True when a `/` after `out` starts a regex literal, not a division: the previous
 * non-space character is an operator, an opening bracket or nothing at all. */
function regexAllowedAfter(out: string): boolean {
  let k = out.length - 1;
  while (k >= 0 && (out[k] === " " || out[k] === "\t")) k -= 1;
  if (k < 0) return true;
  const ch = out[k] ?? "";
  // Postfix `i++ / 2` ends an operand: the slash divides (#220 G-M1).
  if ((ch === "+" || ch === "-") && out[k - 1] === ch) return false;
  if ("(,=:[!&|?{};+-*%>~^".includes(ch)) return true;
  // A keyword that takes an expression starts one: `return /a\//` (#220 G-M2). A longer
  // identifier that merely ends in one (`noreturn / 2`), or a property named like one
  // (`obj.in / 2`, G-m5), is an operand.
  const word = /(?:^|[^\w$.])(return|typeof|case|in|of|void|delete|throw)$/.exec(
    out.slice(0, k + 1),
  );
  return word !== null;
}

/** Index just past the regex literal starting at `start` (slash), or -1 when the line has none. */
function regexLiteralEnd(source: string, start: number): number {
  let j = start + 1;
  let inClass = false;
  while (j < source.length && source[j] !== "\n") {
    const ch = source[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      j += 1;
      while (/[a-z]/i.test(source[j] ?? "")) j += 1;
      return j;
    }
    j += 1;
  }
  return -1;
}

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
    if (c === '"' || c === "'") {
      // `'`/`"` string literals cannot legally contain a raw newline in JS,
      // so bound the scan to the current line: without this, a stray quote
      // inside a regex literal or JSX text (e.g. `/"/`) flips string parity
      // for the rest of the file, hiding real code or letting a commented-out
      // line masquerade as live (review C1, fail-open regression).
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "\n") break;
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
    if (c === "`") {
      // Template literals legitimately span multiple lines, so this scan is
      // not newline-bounded like `'`/`"` above.
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "`") {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && source[i + 1] !== "/" && source[i + 1] !== "*" && regexAllowedAfter(out)) {
      // A regex literal (#220 r1-a): a `//` inside it (`/a\//`) is not a line comment.
      // Bounded to the current line; with no closing `/` the `/` is just a division sign.
      const end = regexLiteralEnd(source, i);
      if (end > 0) {
        out += source.slice(i, end);
        i = end;
        continue;
      }
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
