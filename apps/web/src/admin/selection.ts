import type { Translator } from "@querymodule/client";
import { createContext, useContext } from "react";

/**
 * What the builder tree selected (A-D1 A2): a JSON pointer into the draft ("/queryTypes/0/fields/2",
 * "/commands"), or LABELS_ITEM for the label overlay. `seq` changes on every selection, so choosing
 * the same item again still opens and scrolls to it.
 */
export const LABELS_ITEM = "#labels";

export interface Selection {
  pointer: string | null;
  seq: number;
  /** An issue's pointer: after opening, focus the control that shows it (the issue button). */
  focus?: string;
  /** Opened from the Changes view: after opening, focus the item's first control. */
  focusNode?: boolean;
  /** Selects another item (an editor that adds or removes a query type moves the selection). */
  select?(pointer: string): void;
}

/** Top-level keys that are not settings a user edits: kept out of the tree and the form. */
export const HIDDEN_KEYS: ReadonlySet<string> = new Set(["schemaVersion"]);

/** The top-level item a pointer belongs to: a config key, or LABELS_ITEM. */
export function topItem(pointer: string): string {
  if (pointer === LABELS_ITEM) return LABELS_ITEM;
  const first = pointer.split("/")[1] ?? "";
  return first.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * An issue with no item of its own in the tree or the editor: the whole config (""), a missing
 * top-level key, or a hidden key (schemaVersion). It is listed with the whole-config messages.
 */
export function isRootIssue(doc: Readonly<Record<string, unknown>>, pointer: string): boolean {
  if (pointer === "") return true;
  const top = topItem(pointer);
  return HIDDEN_KEYS.has(top) || !(top in doc);
}

/** What the editor shows before any selection: the first query type, else the first setting. */
export function defaultPointer(doc: Readonly<Record<string, unknown>>): string {
  const types = doc.queryTypes;
  if (Array.isArray(types) && types.length > 0) return "/queryTypes/0";
  const first = Object.keys(doc).find((k) => !HIDDEN_KEYS.has(k) && k !== "queryTypes");
  return first === undefined
    ? LABELS_ITEM
    : `/${first.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

export const SelectionContext = createContext<Selection>({ pointer: null, seq: 0 });

/** True when the selection is `pointer` or inside it. */
export function selects(selection: Selection, pointer: string): boolean {
  const p = selection.pointer;
  return p !== null && (p === pointer || p.startsWith(`${pointer}/`));
}

/** The list index a selection names under a top-level array key, as in /queryTypes/<i>/... */
export function useSelectedIndex(key: string): number | null {
  const { pointer } = useContext(SelectionContext);
  const m = pointer === null ? null : new RegExp(`^/${key}/([0-9]+)(/|$)`).exec(pointer);
  return m === null ? null : Number(m[1]);
}

/** "1 error, 2 warnings": the parts with a count, joined (no plural rules in the bundle). */
export function issueWords(t: Translator["t"], errors: number, warnings: number): string {
  const parts: string[] = [];
  if (errors > 0)
    parts.push(t(errors === 1 ? "admin.issues.error" : "admin.issues.errors", { count: errors }));
  if (warnings > 0)
    parts.push(
      t(warnings === 1 ? "admin.issues.warning" : "admin.issues.warnings", { count: warnings }),
    );
  return parts.join(", ");
}
