import { stripComments } from "./strip-comments";

const REEXPORT =
  /\s*export(?:\s+type\b)?\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?/y;

/** True when the source holds only `export ... from` statements (and comments). */
export function isPureBarrel(source: string): boolean {
  const code = stripComments(source);
  REEXPORT.lastIndex = 0;
  while (REEXPORT.lastIndex < code.length) {
    const start = REEXPORT.lastIndex;
    if (!REEXPORT.test(code)) return code.slice(start).trim() === "";
  }
  return true;
}
