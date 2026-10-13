/**
 * Payload path language (spec 4.5): dot segments, `[n]` array index, `["key.with.dots"]`
 * bracket-quoted keys and `[*]` projection. Resolution never throws; a path that is malformed or
 * does not resolve yields an empty list. Only own members are read.
 */

type Segment = { kind: "key"; key: string } | { kind: "index"; index: number } | { kind: "all" };

const PLAIN_KEY = /^[^.[\]"\\]+$/u;
const INDEX = /^\d+$/u;

/** The path of a child, in the same language `resolvePath` reads (shared with assessResult). */
export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (PLAIN_KEY.test(key)) return parent === "" ? key : `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}

function parseQuoted(path: string, start: number): { key: string; end: number } | null {
  let i = start + 1;
  while (i < path.length) {
    const ch = path[i];
    if (ch === "\\") i += 2;
    else if (ch === '"') break;
    else i += 1;
  }
  if (path[i] !== '"') return null;
  try {
    const key: unknown = JSON.parse(path.slice(start, i + 1));
    return typeof key === "string" ? { key, end: i + 1 } : null;
  } catch {
    return null;
  }
}

function parseBracket(path: string, open: number): { seg: Segment; end: number } | null {
  if (path[open + 1] === '"') {
    const quoted = parseQuoted(path, open + 1);
    if (quoted === null || path[quoted.end] !== "]") return null;
    return { seg: { kind: "key", key: quoted.key }, end: quoted.end + 1 };
  }
  const close = path.indexOf("]", open);
  if (close < 0) return null;
  const inner = path.slice(open + 1, close);
  if (inner === "*") return { seg: { kind: "all" }, end: close + 1 };
  if (!INDEX.test(inner)) return null;
  return { seg: { kind: "index", index: Number(inner) }, end: close + 1 };
}

function parsePath(path: string): Segment[] | null {
  const segments: Segment[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === "[") {
      const parsed = parseBracket(path, i);
      if (parsed === null) return null;
      segments.push(parsed.seg);
      i = parsed.end;
      continue;
    }
    if (path[i] === ".") {
      if (i === 0) return null;
      i += 1;
    } else if (i > 0) {
      return null;
    }
    let j = i;
    while (j < path.length && !'.[]"\\'.includes(path[j] as string)) j += 1;
    if (j === i) return null;
    segments.push({ kind: "key", key: path.slice(i, j) });
    i = j;
  }
  return segments.length === 0 ? null : segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The values a path yields, in payload order: one for a plain path, one per element for `[*]`. */
export function resolvePath(payload: unknown, path: string): unknown[] {
  const segments = parsePath(path);
  if (segments === null) return [];
  let current: unknown[] = [payload];
  for (const seg of segments) {
    const next: unknown[] = [];
    for (const value of current) {
      if (seg.kind === "key") {
        if (isRecord(value) && Object.hasOwn(value, seg.key)) next.push(value[seg.key]);
      } else if (Array.isArray(value)) {
        if (seg.kind === "all") for (const item of value) next.push(item);
        else if (seg.index < value.length) next.push(value[seg.index]);
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}
