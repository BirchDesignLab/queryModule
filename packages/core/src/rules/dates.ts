export type Century = "2000" | "past";

type DateToken = "YYYY" | "YY" | "MM" | "DD";

interface CompiledFormat {
  re: RegExp;
  tokens: DateToken[];
}

const FOUR_DIGIT_YEAR = /^[1-9]\d{3}$/;
const TWO_DIGIT_YEAR = /^\d{2}$/;
const TOKEN_PATTERN = /YYYY|YY|MM|DD/g;
const formatCache = new Map<string, CompiledFormat>();

/** Four digits as written; two digits by century (spec 4.3 step 2, 11). */
export function resolveYear(text: string, century: Century, now: number): number | null {
  if (FOUR_DIGIT_YEAR.test(text)) return Number(text);
  if (!TWO_DIGIT_YEAR.test(text)) return null;
  const candidate = 2000 + Number(text);
  if (century === "2000") return candidate;
  const currentYear = new Date(now).getUTCFullYear();
  return candidate <= currentYear ? candidate : candidate - 100;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileDateFormat(format: string): CompiledFormat {
  const cached = formatCache.get(format);
  if (cached !== undefined) return cached;
  const tokens: DateToken[] = [];
  let source = "";
  let last = 0;
  for (const match of format.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    const token = match[0] as DateToken;
    source += escapeRegex(format.slice(last, index));
    source += token === "YYYY" ? "(\\d{4})" : "(\\d{2})";
    tokens.push(token);
    last = index + token.length;
  }
  source += escapeRegex(format.slice(last));
  const compiled = { re: new RegExp(`^${source}$`), tokens };
  formatCache.set(format, compiled);
  return compiled;
}

export function isCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parses `text` with one DateFormat; returns ISO YYYY-MM-DD or null. */
export function parseDate(
  text: string,
  format: string,
  century: Century,
  now: number,
): string | null {
  const { re, tokens } = compileDateFormat(format);
  const match = re.exec(text);
  if (match === null) return null;
  let year: number | null = null;
  let month = 0;
  let day = 0;
  for (const [i, token] of tokens.entries()) {
    const part = match[i + 1] ?? "";
    if (token === "YYYY") year = FOUR_DIGIT_YEAR.test(part) ? Number(part) : null;
    else if (token === "YY") year = resolveYear(part, century, now);
    else if (token === "MM") month = Number(part);
    else day = Number(part);
  }
  if (year === null || !isCalendarDate(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
