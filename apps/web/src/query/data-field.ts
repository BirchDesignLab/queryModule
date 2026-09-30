import type { ClientSiteConfig } from "@querymodule/core/config";

type FieldDef = ClientSiteConfig["queryTypes"][number]["fields"][number];

/**
 * Read-back data (plates, VINs, IDs, dates) is set in the monospace face so 0/O and 1/I differ
 * (visual system "Direction"). Decided from the field's properties, never its key or query type
 * (BR-001): a year or date, or a code-like string (a pattern, upper case, or the ASCII-only
 * charset). Free text in the wider charset stays in the interface face. A config flag may replace
 * this later (deferred: core schema plus an admin editor).
 */
export function isDataField(field: FieldDef): boolean {
  if (field.dataType === "year" || field.dataType === "date") return true;
  if (field.dataType !== "string") return false;
  return (
    field.pattern !== undefined || field.transform === "upper" || field.charset === "printableAscii"
  );
}
