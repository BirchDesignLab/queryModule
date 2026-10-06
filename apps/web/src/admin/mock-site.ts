import type { MockResponse } from "@querymodule/core/contracts";
import { asObjects, str } from "./controls.js";
import type { JsonObject } from "./draft.js";

/**
 * What the mock editor needs to know of the site (Task 3a, #549), read from the builder's draft:
 * the sources, and each query type with the sources it asks, its fields and its role:type field.
 */

export interface MockSiteType {
  code: string;
  labelKey: string;
  sourceIds: string[];
  fields: { key: string; labelKey: string }[];
  /** The role:"type" field and the picklist codes it offers; null when the type has none. */
  typeField: { key: string; labelKey: string; codes: { code: string; labelKey: string }[] } | null;
}

export interface MockSite {
  sources: { id: string; labelKey: string }[];
  queryTypes: MockSiteType[];
}

export function mockSiteOf(doc: JsonObject): MockSite {
  const picklists = new Map(
    asObjects(doc.picklists).map((p) => [
      str(p.id),
      asObjects(p.values).map((v) => ({ code: str(v.code), labelKey: str(v.labelKey) })),
    ]),
  );
  return {
    sources: asObjects(doc.sources).map((s) => ({ id: str(s.id), labelKey: str(s.labelKey) })),
    queryTypes: asObjects(doc.queryTypes).map((q) => {
      const fields = asObjects(q.fields);
      const type = fields.find((f) => f.role === "type");
      return {
        code: str(q.code),
        labelKey: str(q.labelKey),
        sourceIds: asObjects(q.sources).map((s) => str(s.sourceId)),
        fields: fields.map((f) => ({ key: str(f.key), labelKey: str(f.labelKey) })),
        typeField:
          type === undefined
            ? null
            : {
                key: str(type.key),
                labelKey: str(type.labelKey),
                codes: picklists.get(str(type.picklist)) ?? [],
              },
      };
    }),
  };
}

/** The codes of a response's type match, in words for the tree and lists; "" matches any type. */
export function typeValuesLabel(types: MockResponse["types"]): string {
  return types === undefined ? "" : Object.values(types).join(", ");
}
