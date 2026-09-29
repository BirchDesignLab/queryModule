import type { Translator } from "@querymodule/client";
import { createContext, useContext } from "react";

/**
 * What the builder tree selected (A-D1 A2): a JSON pointer into the draft ("/queryTypes/0/fields/2",
 * "/commands"), or LABELS_ITEM for the label overlay. `seq` changes on every selection, so choosing
 * the same item again still opens and scrolls to it.
 */
export interface Selection {
  pointer: string | null;
  seq: number;
  /** An issue's pointer: after opening, focus the control that shows it (the issue button). */
  focus?: string;
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
