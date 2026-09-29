import { createContext, useContext } from "react";

/**
 * What the builder tree selected (A-D1 A2): a JSON pointer into the draft ("/queryTypes/0/fields/2",
 * "/commands"), or LABELS_ITEM for the label overlay. `seq` changes on every selection, so choosing
 * the same item again still opens and scrolls to it.
 */
export interface Selection {
  pointer: string | null;
  seq: number;
}

export const LABELS_ITEM = "#labels";

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
