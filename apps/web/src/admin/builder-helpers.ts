import type { JsonObject } from "./draft.js";
import { hasPointer, parentPointer } from "./issues.js";

/**
 * A selection that no longer exists after a draft change (a raw edit, a removed item) moves to
 * what does, so the tree and the editor show the same item (critic m4): a type index past the
 * end goes to the last type, anything else to its nearest existing parent.
 */
export function existingPointer(doc: JsonObject, pointer: string): string | null {
  if (pointer.startsWith("#") || hasPointer(doc, pointer)) return pointer;
  const types = Array.isArray(doc.queryTypes) ? doc.queryTypes.length : 0;
  const m = /^\/queryTypes\/([0-9]+)/.exec(pointer);
  if (m !== null && types > 0 && Number(m[1]) >= types) return `/queryTypes/${types - 1}`;
  for (let p = parentPointer(pointer); p !== null && p !== ""; p = parentPointer(p))
    if (hasPointer(doc, p) && !isTopArray(p)) return p;
  return null;
}

/** "/queryTypes" itself is not an item the editor can show; its elements are. */
const isTopArray = (pointer: string) => pointer === "/queryTypes";
