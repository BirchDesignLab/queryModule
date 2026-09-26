import type { Diagnostic } from "./diagnostic";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

/** Identity key per keyed array, by object-key path with array indices dropped (spec 4.1 Overlays). */
export const IDENTITY_KEYS: Readonly<Record<string, string>> = {
  picklists: "id",
  sources: "id",
  queryTypes: "code",
  commands: "code",
  personas: "key",
  keywords: "keyword",
  responseMappings: "id",
  "delegation.purposes": "key",
  "picklists.values": "code",
  "queryTypes.fields": "key",
  "queryTypes.sections": "key",
  "queryTypes.sources": "sourceId",
  "queryTypes.alsoRun": "queryType",
};

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRemoveMarker(v: unknown): boolean {
  return isObject(v) && v.$remove === true && Object.keys(v).length === 1;
}

function mergeValue(base: Json | undefined, over: Json, path: string): Json {
  if (Array.isArray(over)) {
    const idKey = IDENTITY_KEYS[path];
    if (!idKey || !Array.isArray(base)) return structuredClone(over);
    const out: Json[] = structuredClone(base);
    for (const item of over) {
      if (!isObject(item)) continue;
      const id = item[idKey];
      const idx = out.findIndex((b) => isObject(b) && b[idKey] === id);
      if (item.$remove === true) {
        if (idx >= 0) out.splice(idx, 1);
        continue;
      }
      if (idx >= 0) out[idx] = mergeValue(out[idx], item, path);
      else out.push(structuredClone(item));
    }
    return out;
  }
  if (isObject(over)) {
    const out: JsonObject = isObject(base) ? structuredClone(base) : {};
    for (const [k, v] of Object.entries(over)) {
      if (isRemoveMarker(v)) {
        delete out[k];
        continue;
      }
      out[k] = mergeValue(out[k], v, path === "" ? k : `${path}.${k}`);
    }
    return out;
  }
  return over;
}

/** Merge an overlay site onto its base (raw JSON, after migrateConfig, before the strict parse). */
export function mergeSiteOverlay(
  base: unknown,
  overlay: unknown,
): { config: Record<string, unknown>; errors: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  if (!isObject(base) || !isObject(overlay)) {
    errors.push({ level: "error", path: "", key: "config.notAnObject", params: {} });
    return { config: {}, errors };
  }
  if (typeof base.extends === "string") {
    errors.push({
      level: "error",
      path: "/extends",
      key: "config.nestedExtends",
      params: { extends: base.extends },
    });
  }
  const rest = { ...overlay };
  delete rest.extends;
  const merged = mergeValue(base, rest, "") as JsonObject;
  delete merged.extends;
  return { config: merged, errors };
}
