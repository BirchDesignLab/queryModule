import type { RequestEntry } from "@querymodule/client";
import { formatAckTime } from "@querymodule/web-ui";

/** The typed field that names a request, per query type (ruling 12, 10-13-26). Others use the short ID. */
const PRIMARY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  VEH: ["plate"],
  PER: ["last", "first"],
};

/**
 * The request's primary typed field (the plate for VEH, the name for PER), trimmed; "" when it is
 * empty or the row kept no values. Read from the kept values, it goes nowhere but an accessible
 * name or an announcement (ruling 12).
 */
export function primaryTypedText(entry: RequestEntry): string {
  return (PRIMARY_FIELDS[entry.queryType] ?? [])
    .map((key) => entry.submitted?.values[key])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim())
    .join(" ");
}

/**
 * The one accessible name for a request row: the fieldset, Copy and Retry all use it. The query type
 * and the primary typed field (the plate for VEH, the name for PER), or the short correlation ID
 * when that field is empty; a row not yet acknowledged has no ID, so it adds its send time (so two
 * failed Warrant rows differ). Never the command text and never a payload.
 */
export function requestAccessibleName(
  entry: RequestEntry,
  typeLabel: string,
  sentText: (time: string) => string,
): string {
  const typed = primaryTypedText(entry);
  if (typed !== "") return `${typeLabel} ${typed}`;
  return entry.status === "acknowledged"
    ? `${typeLabel} ${entry.correlationId.slice(0, 8)}`
    : sentText(formatAckTime(entry.sentAt));
}
