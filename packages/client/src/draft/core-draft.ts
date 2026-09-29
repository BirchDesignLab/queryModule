import type { Draft } from "@querymodule/core/terminal";
import type { DraftValue } from "./draft-store.js";

/**
 * The core terminal Draft marks an empty value with null; the client stores a cleared
 * field as '' (#297 type gap). Own keys only, built with Object.fromEntries so a key
 * named "__proto__" stays plain data.
 */
export function toCoreDraft(values: Readonly<Record<string, DraftValue>>): Draft {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v]));
}

/** null to ''; numbers to strings (tokenize never makes numbers). */
export function fromCoreDraft(draft: Draft): Record<string, DraftValue> {
  return Object.fromEntries(
    Object.entries(draft).map(([k, v]) => [
      k,
      v === null ? "" : typeof v === "number" ? String(v) : v,
    ]),
  );
}
