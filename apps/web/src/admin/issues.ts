import type { DraftValidation, JsonObject } from "./draft.js";

const escapeSegment = (s: string): string => s.replaceAll("~", "~0").replaceAll("/", "~1");

/**
 * JSON pointer to 1-based line of every object key and array element in the shown JSON text
 * (Task 33: the raw tab maps a diagnostic to its line). Unparseable text yields an empty map.
 */
export function pointerLines(text: string): Map<string, number> {
  const lines = new Map<string, number>();
  let i = 0;
  let line = 1;
  const skipWs = (): void => {
    while (i < text.length && /\s/.test(text[i] ?? "")) {
      if (text[i] === "\n") line++;
      i++;
    }
  };
  const fail = (): never => {
    throw new SyntaxError("unparseable draft text");
  };
  const expect = (ch: string): void => {
    if (text[i] !== ch) fail();
    i++;
  };
  const readString = (): string => {
    const start = i;
    expect('"');
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) fail();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  /** After an element: a comma continues the container, the closer ends it, anything else is malformed. */
  const more = (closer: string): boolean => {
    skipWs();
    if (text[i] === ",") {
      i++;
      skipWs();
      return true;
    }
    expect(closer);
    return false;
  };
  const value = (path: string): void => {
    skipWs();
    const c = text[i];
    if (c === "{") {
      i++;
      skipWs();
      if (text[i] === "}") {
        i++;
        return;
      }
      do {
        const keyLine = line;
        const key = readString();
        const child = `${path}/${escapeSegment(key)}`;
        lines.set(child, keyLine);
        skipWs();
        expect(":");
        value(child);
      } while (more("}"));
    } else if (c === "[") {
      i++;
      skipWs();
      if (text[i] === "]") {
        i++;
        return;
      }
      let index = 0;
      do {
        const child = `${path}/${index++}`;
        lines.set(child, line);
        value(child);
      } while (more("]"));
    } else if (c === '"') {
      readString();
    } else {
      const start = i;
      while (i < text.length && !/[\s,\]}]/.test(text[i] ?? "")) i++;
      if (i === start) fail();
    }
  };
  try {
    value("");
  } catch {
    return new Map();
  }
  return lines;
}

/** The parent of a pointer, or null at the root. */
export function parentPointer(pointerText: string): string | null {
  const cut = pointerText.lastIndexOf("/");
  return cut <= 0 ? (pointerText === "" ? null : "") : pointerText.slice(0, cut);
}

/** Line of a pointer, or of its deepest ancestor that exists in the text. */
export function lineOf(
  lines: ReadonlyMap<string, number>,
  pointerText: string,
): number | undefined {
  let p: string | null = pointerText;
  while (p !== null) {
    const found = lines.get(p);
    if (found !== undefined) return found;
    p = parentPointer(p);
  }
  return undefined;
}

/** One diagnostic shown to the person: level, where, and the message key with its params. */
export interface DraftIssue {
  level: "error" | "warning";
  pointer: string;
  key: string;
  params: Record<string, string | number | boolean>;
}

/** Diagnostics and shape issues as one flat list; shape issues are errors keyed by their text. */
export function draftIssues(validation: DraftValidation): DraftIssue[] {
  if (!validation.ok) {
    return validation.issues.map((i) => ({
      level: "error",
      pointer: i.pointer,
      key: "admin.config.shapeIssue",
      params: { message: i.message },
    }));
  }
  const seen = new Set<string>();
  const issues: DraftIssue[] = [];
  for (const d of [...validation.errors, ...validation.warnings]) {
    const id = JSON.stringify([d.level, d.path, d.key, d.params]);
    if (seen.has(id)) continue;
    seen.add(id);
    issues.push({ level: d.level, pointer: d.path, key: d.key, params: d.params });
  }
  return issues;
}

const hasPointer = (doc: unknown, pointerText: string): boolean => {
  let node: unknown = doc;
  for (const raw of pointerText.split("/").slice(1)) {
    const seg = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof node !== "object" || node === null || !(seg in node)) return false;
    node = (node as Record<string, unknown>)[seg];
  }
  return true;
};

/**
 * Groups issues by the deepest node of the draft that has a control, so a diagnostic on a
 * missing key lands on its parent. Root-level issues sit under "".
 */
export function groupByControl(
  doc: JsonObject,
  issues: readonly DraftIssue[],
): Map<string, DraftIssue[]> {
  const groups = new Map<string, DraftIssue[]>();
  for (const issue of issues) {
    let p: string | null = issue.pointer;
    while (p !== null && p !== "" && !hasPointer(doc, p)) p = parentPointer(p);
    const target = p ?? "";
    groups.set(target, [...(groups.get(target) ?? []), issue]);
  }
  return groups;
}
