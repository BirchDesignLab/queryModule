/**
 * Keyboard navigation for the builder tree (WAI-ARIA tree pattern): pure functions over the flat
 * list of rows that are on screen, in reading order. The component owns focus and expansion; this
 * decides where a key goes.
 */

/** One rendered row of the tree. */
export interface FlatItem {
  pointer: string;
  /** Text for first-character type-ahead. */
  label: string;
  /** aria-level: 1 for a query type or site item, 2 for its section, and so on. */
  level: number;
  /** The row's parent (null at the top level). */
  parent: string | null;
  /** The row has children to show (open or not). */
  hasChildren: boolean;
  /** Its children are showing. */
  expanded: boolean;
  /** The user can close it: a query type, outside a search (a search opens every match). */
  collapsible: boolean;
  /** Which of the tree's groups (query types, site items) the row is in. */
  group: number;
}

export type TreeAction =
  | { kind: "focus"; pointer: string }
  | { kind: "expand"; pointer: string }
  | { kind: "collapse"; pointer: string }
  | { kind: "select"; pointer: string }
  | { kind: "none" };

const NONE: TreeAction = { kind: "none" };

/** A key that types a character: no modifier but Shift, exactly one character. */
export function isTypeAheadKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** What `key` does on the row `current`, given the visible rows. */
export function treeAction(items: readonly FlatItem[], current: string, key: string): TreeAction {
  const i = items.findIndex((x) => x.pointer === current);
  const item = items[i];
  if (item === undefined) return NONE;
  const focus = (x: FlatItem | undefined): TreeAction =>
    x === undefined ? NONE : { kind: "focus", pointer: x.pointer };
  switch (key) {
    case "ArrowDown":
      return focus(items[i + 1]);
    case "ArrowUp":
      return focus(items[i - 1]);
    case "ArrowRight":
      if (!item.hasChildren) return NONE;
      if (!item.expanded) return item.collapsible ? { kind: "expand", pointer: current } : NONE;
      return focus(items[i + 1]?.parent === current ? items[i + 1] : undefined);
    case "ArrowLeft":
      if (item.hasChildren && item.expanded && item.collapsible)
        return { kind: "collapse", pointer: current };
      return focus(items.find((x) => x.pointer === item.parent));
    case "Home":
      return focus(items.find((x) => x.group === item.group));
    case "End":
      return focus(items.findLast((x) => x.group === item.group));
    case "Enter":
    case " ":
      return { kind: "select", pointer: current };
    default:
      return NONE;
  }
}

/** The next row after `current` (wrapping) whose label starts with `char`, ignoring case. */
export function typeAhead(
  items: readonly FlatItem[],
  current: string,
  char: string,
): string | null {
  const c = char.toLowerCase();
  const start = items.findIndex((x) => x.pointer === current);
  for (let n = 1; n <= items.length; n++) {
    const x = items[(start + n) % items.length];
    if (x?.label.toLowerCase().startsWith(c)) return x.pointer;
  }
  return null;
}
