import type { Format } from "../config/schema";
import { isCalendarDate } from "../rules";

/**
 * Declarative value formats (spec 4.1 Format, spec 6.7): numbers and case through `Intl` for the
 * locale, dates as MM-DD-YY unless a `date` pattern says otherwise. Pure: no clock, no IO.
 */

const FALLBACK_LOCALE = "en-US";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_TOKEN = /YYYY|YY|MM|DD/gu;
export const DEFAULT_DATE_PATTERN = "MM-DD-YY";

function safeLocale(locale: string): string {
  try {
    return new Intl.NumberFormat(locale).resolvedOptions().locale;
  } catch {
    return FALLBACK_LOCALE;
  }
}

function formatNumber(value: number, locale: string): string {
  // No grouping: a vehicle year or an ID number must not read as 1,901.
  return new Intl.NumberFormat(safeLocale(locale), {
    useGrouping: false,
    maximumFractionDigits: 20,
  }).format(value);
}

/** ISO YYYY-MM-DD as `pattern`; null when `value` is not a calendar-valid ISO date. */
function formatIsoDate(value: unknown, pattern: string): string | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value);
  if (m === null) return null;
  const [year, month, day] = [m[1] ?? "", m[2] ?? "", m[3] ?? ""];
  if (!isCalendarDate(Number(year), Number(month), Number(day))) return null;
  return pattern.replace(DATE_TOKEN, (token) => {
    if (token === "YYYY") return year;
    if (token === "YY") return year.slice(2);
    return token === "MM" ? month : day;
  });
}

/** The unformatted rendering: Intl numbers, ISO dates as MM-DD-YY, everything else as text. */
function plain(value: unknown, locale: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value, locale);
  return formatIsoDate(value, DEFAULT_DATE_PATTERN) ?? String(value);
}

function formatPhone(text: string): string {
  const digits = text.replace(/\D/gu, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return text;
  const national = `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return local === digits ? national : `+1 ${national}`;
}

export function formatValue(value: unknown, format: Format | undefined, locale: string): string {
  if (value === null || value === undefined) return "";
  switch (format?.type) {
    case undefined:
      return plain(value, locale);
    case "text":
      return String(value);
    case "upper":
      return plain(value, locale).toLocaleUpperCase(safeLocale(locale));
    case "phone":
      return formatPhone(String(value));
    case "date":
      return formatIsoDate(value, format.pattern) ?? String(value);
    case "template": {
      const text = plain(value, locale);
      return format.template.replace(/\{value\}/gu, () => text);
    }
  }
}
