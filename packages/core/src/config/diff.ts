/**
 * A structural diff of two config documents (the live client config and a builder draft), and the
 * inverse: `applyChanges(live, diffConfig(live, draft))` gives the draft back. Pure, no zod, no
 * I/O; it reads documents as plain JSON.
 *
 * Lists of objects that carry an identity (a query type's `code`, a field's `key`, a picklist's
 * `id`) are matched by it, so removing the first query type is one removal, not a change to every
 * item after it. So are lists of unique strings (quick access), matched by the value itself.
 * Lists with no identity (rules, repeated values) are matched by equality, and an item edited in
 * place is paired with its old self so it reads as a change.
 */

/** `by` for a list of strings: the item is its own identity (`{ by: VALUE_IDENTITY, is: "VEH" }`). */
export const VALUE_IDENTITY = "$value";

/** An item of a keyed list, addressed by its identity: `{ by: "code", is: "VEH" }`. */
export interface KeyRef {
  readonly by: string;
  readonly is: string;
}
/** An object key, a list index in the live document, or a keyed item. */
export type DiffSegment = string | number | KeyRef;
export type DiffPath = readonly DiffSegment[];

interface Base {
  /** Where the change is in the live document: what `applyChanges` walks. */
  path: DiffPath;
  /**
   * The JSON pointer to show it at, in the draft. For a removal the item is gone, so this is the
   * object that held it (a removed field points at its query type; a removed query type at "").
   */
  pointer: string;
}
export type ConfigChange =
  | (Base & { kind: "added"; after: unknown; index?: number })
  | (Base & { kind: "removed"; before: unknown })
  | (Base & { kind: "changed"; before: unknown; after: unknown })
  /** The kept items of a keyed list changed their order; `order` is the draft's, by `by`. */
  | (Base & { kind: "moved"; by: string; order: readonly string[] });

/** Properties that name an item. A list is named by the first one every item carries. */
const IDENTITY_PROPS = ["code", "key", "id", "sourceId", "keyword", "queryType"];

type Json = { [key: string]: unknown };
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** Own properties only, so a "__proto__" key is data and a prototype member is never read. */
const own = (o: Json, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);
const ownKeys = (o: Json): string[] => Object.keys(o).filter((k) => o[k] !== undefined);

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => deepEqual(x, b[i]))
    );
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = ownKeys(a);
  return keys.length === ownKeys(b).length && keys.every((k) => deepEqual(own(a, k), own(b, k)));
}

const escapePointer = (s: string): string => s.replaceAll("~", "~0").replaceAll("/", "~1");
const parentOf = (pointer: string): string => pointer.slice(0, pointer.lastIndexOf("/"));

/** An item's identity under `prop`: the value itself for strings, else the property's string. */
function idOf(item: unknown, prop: string): string | undefined {
  if (prop === VALUE_IDENTITY) return typeof item === "string" ? item : undefined;
  if (!isObject(item)) return undefined;
  const id = own(item, prop);
  return typeof id === "string" ? id : undefined;
}

/**
 * The one property that identifies the items of both lists: for strings the value itself, for
 * objects the first of IDENTITY_PROPS that every item carries as a string. It names the list only
 * if the filled-in values are unique. A list that repeats them (a typed duplicate) is matched by
 * equality: it never falls through to another property, which would name items by something else
 * (a command by its query type). An item whose value is still blank (a new type with no code yet)
 * has no identity and is never matched.
 */
function identityProp(a: readonly unknown[], b: readonly unknown[]): string | null {
  const items = [...a, ...b];
  if (items.length === 0) return null;
  const prop = items.every((i) => typeof i === "string")
    ? VALUE_IDENTITY
    : items.every(isObject)
      ? IDENTITY_PROPS.find((p) => items.every((i) => idOf(i, p) !== undefined))
      : undefined;
  if (prop === undefined || items.every((i) => idOf(i, prop) === "")) return null;
  const unique = (list: readonly unknown[]) => {
    const seen = new Set<string>();
    return list.every((item) => {
      const id = idOf(item, prop);
      if (id === undefined || id === "") return id === "";
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  return unique(a) && unique(b) ? prop : null;
}

/** Index pairs (live, draft) of the longest run of equal items, in order. */
function commonRun(a: readonly unknown[], b: readonly unknown[]): [number, number][] {
  const w = b.length + 1;
  const len = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      len[i * w + j] = deepEqual(a[i], b[j])
        ? (len[(i + 1) * w + j + 1] ?? 0) + 1
        : Math.max(len[(i + 1) * w + j] ?? 0, len[i * w + j + 1] ?? 0);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (deepEqual(a[i], b[j])) {
      out.push([i++, j++]);
    } else if ((len[(i + 1) * w + j] ?? 0) >= (len[i * w + j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** Whether an edited item can be the old one: objects that name the same field, or plain values. */
function similar(a: unknown, b: unknown): boolean {
  if (!isObject(a) || !isObject(b)) return !isObject(a) && !isObject(b);
  return own(a, "field") === own(b, "field");
}

/**
 * Matches for a list with no identity: equal items, then between them an item edited in place is
 * paired with the next old item that could be it (same field). What has no partner is removed or
 * added, so a deleted rule is not shown as the edited one.
 */
function pairByPosition(a: readonly unknown[], b: readonly unknown[]): [number, number][] {
  const anchors: [number, number][] = [...commonRun(a, b), [a.length, b.length]];
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of anchors) {
    let next = i;
    for (let k = j; k < bj; k++) {
      let m = next;
      while (m < ai && !similar(a[m], b[k])) m++;
      if (m < ai) {
        pairs.push([m, k]);
        next = m + 1;
      }
    }
    if (ai < a.length) pairs.push([ai, bj]);
    i = ai + 1;
    j = bj + 1;
  }
  return pairs;
}

function diffArray(
  a: readonly unknown[],
  b: readonly unknown[],
  path: DiffPath,
  pointer: string,
  out: ConfigChange[],
): void {
  const by = identityProp(a, b);
  // An item with no identity yet is addressed by its place in its own list.
  const seg = (list: readonly unknown[], i: number): DiffSegment => {
    const id = by === null ? "" : (idOf(list[i], by) ?? "");
    return by === null || id === "" ? i : { by, is: id };
  };
  let pairs: [number, number][];
  if (by === null) {
    pairs = pairByPosition(a, b);
  } else {
    const at = new Map<string, number>();
    a.forEach((item, i) => {
      const id = idOf(item, by) ?? "";
      if (id !== "") at.set(id, i);
    });
    pairs = [];
    b.forEach((item, j) => {
      const i = at.get(idOf(item, by) ?? "");
      if (i !== undefined) pairs.push([i, j]);
    });
  }
  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  const holder = parentOf(pointer);
  a.forEach((_, i) => {
    if (!matchedA.has(i))
      out.push({ kind: "removed", path: [...path, seg(a, i)], pointer: holder, before: a[i] });
  });
  if (by !== null && pairs.some(([i], k) => k > 0 && i < (pairs[k - 1]?.[0] ?? 0))) {
    out.push({
      kind: "moved",
      path,
      pointer,
      by,
      order: pairs.map(([i]) => idOf(a[i], by) ?? ""),
    });
  }
  for (const [i, j] of pairs) diffValue(a[i], b[j], [...path, seg(a, i)], `${pointer}/${j}`, out);
  b.forEach((_, j) => {
    if (!matchedB.has(j))
      out.push({
        kind: "added",
        path: [...path, seg(b, j)],
        pointer: `${pointer}/${j}`,
        after: b[j],
        index: j,
      });
  });
}

function diffValue(
  a: unknown,
  b: unknown,
  path: DiffPath,
  pointer: string,
  out: ConfigChange[],
): void {
  if (deepEqual(a, b)) return;
  if (isObject(a) && isObject(b)) {
    const keys = ownKeys(a);
    for (const k of ownKeys(b)) if (!keys.includes(k)) keys.push(k);
    for (const k of keys) {
      const va = own(a, k);
      const vb = own(b, k);
      const next = `${pointer}/${escapePointer(k)}`;
      if (va === undefined)
        out.push({ kind: "added", path: [...path, k], pointer: next, after: vb });
      else if (vb === undefined)
        out.push({ kind: "removed", path: [...path, k], pointer, before: va });
      else diffValue(va, vb, [...path, k], next, out);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    diffArray(a, b, path, pointer, out);
  } else {
    out.push({ kind: "changed", path, pointer, before: a, after: b });
  }
}

/** What differs between `live` and `draft`, as entries in document order. Neither is modified. */
export function diffConfig(live: unknown, draft: unknown): ConfigChange[] {
  const out: ConfigChange[] = [];
  diffValue(live, draft, [], "", out);
  return out;
}

interface Pending {
  change: ConfigChange;
  rest: DiffPath;
}

function indexOfSegment(list: readonly unknown[], segment: DiffSegment): number {
  if (typeof segment === "number") return segment;
  if (typeof segment === "string") return -1;
  return list.findIndex((item) => idOf(item, segment.by) === segment.is);
}

function applyToArray(list: readonly unknown[], pending: readonly Pending[]): unknown[] {
  const perItem = new Map<number, Pending[]>();
  const added: { index: number; value: unknown }[] = [];
  let moved: { by: string; order: readonly string[] } | null = null;
  for (const p of pending) {
    if (p.change.kind === "moved" && p.rest.length === 0) {
      moved = { by: p.change.by, order: p.change.order };
    } else if (p.change.kind === "added" && p.rest.length === 1) {
      added.push({ index: p.change.index ?? list.length, value: p.change.after });
    } else if (p.rest[0] !== undefined) {
      const i = indexOfSegment(list, p.rest[0]);
      if (i >= 0) perItem.set(i, [...(perItem.get(i) ?? []), { ...p, rest: p.rest.slice(1) }]);
    }
  }
  let kept: unknown[] = [];
  list.forEach((item, i) => {
    const own1 = perItem.get(i) ?? [];
    if (own1.some((p) => p.rest.length === 0 && p.change.kind === "removed")) return;
    kept.push(applyToValue(item, own1));
  });
  if (moved !== null) {
    const { by, order } = moved;
    const rank = (item: unknown) => order.indexOf(idOf(item, by) ?? "");
    kept = kept
      .map((item, i) => ({ item, i }))
      .sort((x, y) => rank(x.item) - rank(y.item) || x.i - y.i)
      .map((x) => x.item);
  }
  for (const { index, value } of added.sort((x, y) => x.index - y.index))
    kept.splice(Math.min(index, kept.length), 0, value);
  return kept;
}

function applyToValue(node: unknown, pending: readonly Pending[]): unknown {
  for (const p of pending)
    if (p.rest.length === 0 && (p.change.kind === "changed" || p.change.kind === "added"))
      return p.change.after;
  if (Array.isArray(node)) return applyToArray(node, pending);
  if (!isObject(node)) return node;
  const entries = new Map<string, unknown>(ownKeys(node).map((k) => [k, own(node, k)]));
  const perKey = new Map<string, Pending[]>();
  for (const p of pending) {
    const head = p.rest[0];
    if (typeof head !== "string") continue;
    if (p.rest.length === 1 && p.change.kind === "removed") entries.delete(head);
    else if (p.rest.length === 1 && p.change.kind === "added") entries.set(head, p.change.after);
    else perKey.set(head, [...(perKey.get(head) ?? []), { ...p, rest: p.rest.slice(1) }]);
  }
  for (const [k, list] of perKey) entries.set(k, applyToValue(entries.get(k), list));
  return Object.fromEntries(entries);
}

/** `live` with `changes` (from `diffConfig(live, draft)`) applied: the draft. `live` is not modified. */
export function applyChanges(live: unknown, changes: readonly ConfigChange[]): unknown {
  return applyToValue(
    live,
    changes.map((change) => ({ change, rest: change.path })),
  );
}
