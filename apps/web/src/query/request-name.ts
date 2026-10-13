import type { RequestEntry } from "@querymodule/client";

/** The typed field that names a request, per query type (ruling 12, 10-13-26). Others use the short ID. */
const PRIMARY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  VEH: ["plate"],
  PER: ["last", "first"],
};

/**
 * The one accessible name for a request row: the fieldset, Copy and Retry all use it. The query type
 * and the primary typed field (the plate for VEH, the name for PER), or the short correlation ID
 * when that field is empty. Never the command text and never a payload. The typed field is read
 * from the kept values and goes nowhere but the accessible name.
 */
export function requestAccessibleName(entry: RequestEntry, typeLabel: string): string {
  const typed = (PRIMARY_FIELDS[entry.queryType] ?? [])
    .map((key) => entry.submitted?.values[key])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim())
    .join(" ");
  if (typed !== "") return `${typeLabel} ${typed}`;
  return entry.status === "acknowledged"
    ? `${typeLabel} ${entry.correlationId.slice(0, 8)}`
    : typeLabel;
}
