/**
 * Strips `//` line comments and `/* ... *\/` block comments from `source`,
 * without touching comment-like text inside a string or template literal.
 * Shared by story-tags.ts (hasTaggedTest) and barrels.ts (isPureBarrel), both
 * of which previously stripped comments with plain regexes that did not know
 * about strings: a `//` or `/*` inside a string literal could swallow real
 * code up to the next matching marker anywhere later in the file (item 7).
 *
 * Regex literals are recognised (a `/` after `(`, `,`, `=`, `:`, `[`, `!`, `&`,
 * `|`, `?`, `{`, `}`, `;`, a keyword such as `return`, or at line start) and
 * copied through to their closing unescaped `/` outside a character class, so
 * a quote or `//` inside one opens nothing (#220 G-M-a, r1-a). When the scanner
 * cannot find the closing `/` on the line it fails closed: the rest of that line
 * gets the plain comment strip with no string or regex handling, so a comment
 * opener is never hidden and a tagged test in a block comment never counts.
 *
 * Template literals are treated as opaque strings (no `${...}` tracking, and
 * no nested templates) - good enough for source that never puts a comment
 * marker inside an expression hole.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "instanceof",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

/** True when a `/` at the end of `out` starts a regex literal, not a division. */
function startsRegex(out: string): boolean {
  let k = out.length - 1;
  while (k >= 0 && (out[k] === " " || out[k] === "\t")) k -= 1;
  if (k < 0 || out[k] === "\n" || out[k] === "\r") return true;
  if ("(,=:[!&|?{};".includes(out[k] as string)) return true;
  let w = k;
  while (w >= 0 && /[A-Za-z_$]/.test(out[w] as string)) w -= 1;
  return w < k && REGEX_PRECEDING_KEYWORDS.has(out.slice(w + 1, k + 1));
}

/** Index just past a regex literal (with flags) starting at `start`, or -1. */
function scanRegex(source: string, start: number): number {
  const n = source.length;
  let j = start + 1;
  let inClass = false;
  while (j < n) {
    const ch = source[j];
    if (ch === "\n") return -1;
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "/") {
      j += 1;
      while (j < n && /[A-Za-z]/.test(source[j] as string)) j += 1;
      return j;
    }
    j += 1;
  }
  return -1;
}

export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  // Fail-closed mode: set when a `/` looked like a regex start but never
  // closed; lasts to the end of the line.
  let plain = false;
  while (i < n) {
    const c = source[i];
    if (c === "\n") plain = false;
    if (!plain && (c === '"' || c === "'")) {
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
    if (!plain && c === "`") {
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
    if (c === "/" && !plain && startsRegex(out)) {
      const end = scanRegex(source, i);
      if (end === -1) {
        plain = true;
      } else {
        out += source.slice(i, end);
        i = end;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}
