import { useRef } from "react";

/**
 * Stable identities for the rows of a list that has none of its own (a card's rows, the keywords),
 * so row-local state (which rows are open, half-typed text) follows the row, not its position
 * (BW3 polish, CRITIC-M2; spec 6.2 builder undo).
 *
 * The draft hands back the very objects it held before when a step is undone or redone, so a row
 * seen before keeps its id wherever it now sits: removing, moving, undoing and redoing all keep
 * row and state together. An object the hook has not seen is an edit of the row at its position
 * when the list is as long as before (typing makes a new object each time): it keeps that row's
 * id, so the control being typed in is never rebuilt. Anything else is a new row with a new id.
 */
export function alignRowIds(
  items: readonly object[],
  previous: readonly number[],
  known: WeakMap<object, number>,
  mint: () => number,
): number[] {
  const ids: (number | undefined)[] = items.map((item) => known.get(item));
  const taken = new Set(ids.filter((id): id is number => id !== undefined));
  const samePlaces = items.length === previous.length;
  const out = ids.map((id, i) => {
    if (id !== undefined) return id;
    const kept = samePlaces ? previous[i] : undefined;
    const next = kept !== undefined && !taken.has(kept) ? kept : mint();
    taken.add(next);
    return next;
  });
  items.forEach((item, i) => {
    const id = out[i];
    if (id !== undefined) known.set(item, id);
  });
  return out;
}

/**
 * `alignRowIds` for a component: the ids, one per item, stable across renders and edits, and
 * `claim(item)`, which gives an item the editor is about to add its id now, so the caller can
 * record row-local state (open) for it in the same event.
 */
export function useRowIds(items: readonly object[]): {
  ids: readonly number[];
  claim(item: object): number;
} {
  const state = useRef<{
    items: readonly object[];
    ids: readonly number[];
    known: WeakMap<object, number>;
    next: number;
  } | null>(null);
  if (state.current === null) state.current = { items: [], ids: [], known: new WeakMap(), next: 0 };
  const s = state.current;
  const same = s.items.length === items.length && items.every((item, i) => item === s.items[i]);
  if (!same) {
    s.ids = alignRowIds(items, s.ids, s.known, () => s.next++);
    s.items = [...items];
  }
  return {
    ids: s.ids,
    claim(item) {
      const id = s.next++;
      s.known.set(item, id);
      return id;
    },
  };
}
