import type { ClientSiteConfig } from "@querymodule/core/config";

type FieldDef = ClientSiteConfig["queryTypes"][number]["fields"][number];

/**
 * Read-back data (plates, VINs, IDs, dates) is set in the monospace face so 0/O and 1/I differ
 * (visual system "Direction"). The implementer decides per field with the `mono` flag of the site
 * config (set in the builder), never from its key, type or query type (BR-001, #476).
 */
export function isDataField(field: FieldDef): boolean {
  return field.mono;
}
