const REEXPORT =
  /\s*export(?:\s+type\b)?\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?/y;

/** True when the source holds only `export ... from` statements (and comments). */
export function isPureBarrel(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  REEXPORT.lastIndex = 0;
  while (REEXPORT.lastIndex < code.length) {
    const start = REEXPORT.lastIndex;
    if (!REEXPORT.test(code)) return code.slice(start).trim() === "";
  }
  return true;
}
