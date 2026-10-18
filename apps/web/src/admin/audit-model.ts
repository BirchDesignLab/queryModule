import {
  AUDIT_EVENT_TYPES,
  type AuditEventType,
  MAX_AUDIT_WINDOW_MS,
  Uuid7Schema,
} from "@querymodule/core/contracts";
import { formatAckTime } from "@querymodule/web-ui";
import type { AuditFilters } from "./audit-api.js";

/** The filter form as typed: every value is text until Apply validates it. */
export interface AuditForm {
  user: string;
  correlationId: string;
  type: string;
  /** Local `MM-DD-YY HH:mm`. */
  from: string;
  to: string;
}

export type AuditField = "user" | "correlationId" | "from" | "to";
export type AuditFormErrors = Partial<Record<AuditField, string>>;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const TIME_TEXT = /^(\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const pad = (n: number): string => String(n).padStart(2, "0");

/** Local `MM-DD-YY HH:mm` (spec 6.2 time format, without seconds). */
export function formatWindowTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Epoch ms of local `MM-DD-YY HH:mm`, or null when the text is not a real date and time. */
export function parseWindowTime(text: string): number | null {
  const m = TIME_TEXT.exec(text.trim());
  if (m === null) return null;
  const [month, day, year, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const d = new Date(2000 + year, month - 1, day, hour, minute, 0, 0);
  const real =
    d.getFullYear() === 2000 + year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day &&
    d.getHours() === hour &&
    d.getMinutes() === minute;
  return real ? d.getTime() : null;
}

/** The last 24 hours up to `now`, as the form's text. */
export function defaultWindow(now: number): Pick<AuditForm, "from" | "to"> {
  const to = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  return { from: formatWindowTime(to - DAY_MS), to: formatWindowTime(to) };
}

/**
 * Checks the form before any request is made (every fetch writes `auditViewed`, so a bad window
 * sends nothing). `to` names a minute, so the whole minute is included. Message keys, not text.
 */
export function validateAuditForm(form: AuditForm): {
  filters: AuditFilters | null;
  errors: AuditFormErrors;
} {
  const errors: AuditFormErrors = {};
  const from = parseWindowTime(form.from);
  const toMinute = parseWindowTime(form.to);
  const correlationId = form.correlationId.trim();
  if (from === null) errors.from = "admin.audit.error.dateFrom";
  if (toMinute === null) errors.to = "admin.audit.error.dateTo";
  if (correlationId !== "" && !Uuid7Schema.safeParse(correlationId).success)
    errors.correlationId = "admin.audit.error.requestId";
  if (from !== null && toMinute !== null) {
    if (toMinute < from) errors.to = "admin.audit.error.order";
    else if (toMinute - from > MAX_AUDIT_WINDOW_MS) errors.to = "admin.audit.error.span";
  }
  if (Object.keys(errors).length > 0 || from === null || toMinute === null)
    return { filters: null, errors };
  const user = form.user.trim();
  return {
    errors,
    filters: {
      ...(user === "" ? {} : { user }),
      ...(correlationId === "" ? {} : { correlationId }),
      ...(isAuditEventType(form.type) ? { type: form.type } : {}),
      from,
      // The server limit is inclusive: the last minute never pushes a 31-day window over it.
      to: Math.min(toMinute + MINUTE_MS - 1, from + MAX_AUDIT_WINDOW_MS),
    },
  };
}

export function isAuditEventType(value: string): value is AuditEventType {
  return (AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}

/** Stored detail keys that hold epoch ms: shown with the local time beside them. */
const EPOCH_KEYS = new Set(["olderThan", "from", "to"]);

/**
 * The stored details as key and value pairs (identifiers and metadata only, spec 5.5). Nothing is
 * interpreted: a value is shown as stored, nested ones as JSON.
 */
export function auditDetailRows(
  details: Record<string, unknown>,
): { key: string; value: string }[] {
  return Object.entries(details).map(([key, value]) => {
    if (EPOCH_KEYS.has(key) && typeof value === "number")
      return { key, value: `${value} (${formatAckTime(value)})` };
    if (typeof value === "string") return { key, value };
    return { key, value: JSON.stringify(value) };
  });
}
