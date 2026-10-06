import { FIXTURE_LEAF_KEYS, normaliseFixtureKey } from "@querymodule/core/config";
import type { MockScenario, SourcePayload } from "@querymodule/core/contracts";
import { type PathSegment, setAtPath, toPointer } from "./draft.js";

/**
 * Pointers and pure edits behind the mock responses editor (Task 3a, #549, CFG-2): payloads are
 * edited by path, every update is immutable and a no-op returns its input. Pointers match the
 * server's (`/mock/sources/<id>/responses/<n>/...`); `/mock/coverage` is the builder's own item for
 * the coverage grid. Nothing here logs or reports a value (spec 5.9).
 */

const unescapeSegment = (s: string): string => s.replaceAll("~1", "/").replaceAll("~0", "~");

export const mockPointer = {
  /** The coverage grid item (not part of the mock file). */
  coverage: "/mock/coverage",
  source: (sourceId: string): string => toPointer(["mock", "sources", sourceId]),
  response: (sourceId: string, index: number): string =>
    toPointer(["mock", "sources", sourceId, "responses", index]),
  /** A pointer into the mock: the whole `/mock` subtree, nothing that merely starts with it. */
  is: (pointer: string): boolean => pointer === "/mock" || pointer.startsWith("/mock/"),
  /** The response a pointer is in or at, else null. */
  responseOf: (pointer: string): { sourceId: string; response: number } | null => {
    const m = /^\/mock\/sources\/([^/]+)\/responses\/([0-9]+)(\/|$)/.exec(pointer);
    return m === null
      ? null
      : { sourceId: unescapeSegment(m[1] as string), response: Number(m[2]) };
  },
  /** The source a pointer is in or at, else null. */
  sourceOf: (pointer: string): string | null => {
    const m = /^\/mock\/sources\/([^/]+)(\/|$)/.exec(pointer);
    return m === null ? null : unescapeSegment(m[1] as string);
  },
} as const;

/** The pointer of a payload value: the payload's own pointer plus its path. */
export const payloadPointer = (base: string, path: readonly PathSegment[]): string =>
  `${base}${toPointer(path)}`;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function payloadAt(payload: SourcePayload, path: readonly PathSegment[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node === null || typeof node !== "object"
        ? undefined
        : (node as Record<PathSegment, unknown>)[key],
    payload,
  );
}

/** Edited text keeps a number or a boolean when it still reads as one; anything else is a string. */
function typed(text: string, original: unknown): string | number | boolean {
  if (typeof original === "number" && text.trim() !== "" && Number.isFinite(Number(text)))
    return Number(text);
  if (typeof original === "boolean" && (text === "true" || text === "false"))
    return text === "true";
  return text;
}

export function setPayloadValue(
  payload: SourcePayload,
  path: readonly PathSegment[],
  text: string,
): SourcePayload {
  const original = payloadAt(payload, path);
  const next = typed(text, original);
  return Object.is(original, next) ? payload : setAtPath(payload, path, next);
}

/** Renames an object key in place, keeping the order. A key the object already has is refused. */
export function renamePayloadKey(
  payload: SourcePayload,
  path: readonly PathSegment[],
  key: string,
): SourcePayload {
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  const parent = parentPath.length === 0 ? payload : payloadAt(payload, parentPath);
  if (!isObject(parent) || typeof last !== "string" || key === last || key in parent)
    return payload;
  const renamed = Object.fromEntries(
    Object.entries(parent).map(([k, v]) => [k === last ? key : k, v]),
  );
  return parentPath.length === 0 ? renamed : setAtPath(payload, parentPath, renamed);
}

export function removePayloadAt(
  payload: SourcePayload,
  path: readonly PathSegment[],
): SourcePayload {
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  const parent = parentPath.length === 0 ? payload : payloadAt(payload, parentPath);
  if (last === undefined) return payload;
  if (Array.isArray(parent))
    return setAtPath(
      payload,
      parentPath,
      parent.filter((_, i) => i !== last),
    );
  if (!isObject(parent) || typeof last !== "string" || !(last in parent)) return payload;
  const { [last]: _gone, ...rest } = parent;
  return parentPath.length === 0 ? rest : setAtPath(payload, parentPath, rest);
}

const keysOf = (kinds: readonly (keyof typeof FIXTURE_LEAF_KEYS)[]): string[] =>
  kinds.flatMap((k) => [...FIXTURE_LEAF_KEYS[k]]);

/** The first allowlisted key of these kinds that the object does not use yet. */
function freeKey(parent: Json, kinds: readonly (keyof typeof FIXTURE_LEAF_KEYS)[]): string {
  const used = new Set(Object.keys(parent).map(normaliseFixtureKey));
  return keysOf(kinds).find((k) => !used.has(k)) ?? keysOf(kinds)[0] ?? "remarks";
}

/**
 * Adds a row inside the group or list at `path` (the payload itself for an empty path). In a group
 * the row gets an unused allowlisted key: free text for a value, a container key for a group or a
 * list, so the new row passes the fixture policy until the person fills it in. In a list it is a
 * new empty group (the policy allows objects, not scalars, in arrays).
 */
export function addPayloadChild(
  payload: SourcePayload,
  path: readonly PathSegment[],
  kind: "value" | "group" | "list",
): SourcePayload {
  const parent = path.length === 0 ? payload : payloadAt(payload, path);
  if (Array.isArray(parent)) return setAtPath(payload, path, [...parent, {}]);
  if (!isObject(parent)) return payload;
  const key =
    kind === "value" ? freeKey(parent, ["freeText", "other"]) : freeKey(parent, ["container"]);
  const value = kind === "value" ? "" : kind === "group" ? {} : [];
  const next = { ...parent, [key]: value };
  return path.length === 0 ? next : setAtPath(payload, path, next);
}

export type MockResult = "record" | "norecord" | "error" | "timeout" | "creds";
export const MOCK_RESULTS: readonly MockResult[] = [
  "record",
  "norecord",
  "error",
  "timeout",
  "creds",
];

const NO_RECORD: SourcePayload = { status: "NO RECORD" };
const isNoRecord = (p: SourcePayload): boolean =>
  Object.keys(p).length === 1 && p.status === NO_RECORD.status;

const BEHAVIOR: Record<
  MockResult & ("error" | "timeout" | "creds"),
  NonNullable<MockScenario["behavior"]>
> = { error: "error", timeout: "timeout", creds: "credentialsRejected" };

/** One of the five results for a scenario (it has a trigger) or for a default payload. */
export function resultOf(entry: MockScenario | SourcePayload): MockResult {
  if ("when" in entry && ("respond" in entry || "behavior" in entry)) {
    const s = entry as MockScenario;
    if (s.behavior === "error") return "error";
    if (s.behavior === "timeout") return "timeout";
    if (s.behavior === "credentialsRejected") return "creds";
    return s.respond !== undefined && isNoRecord(s.respond) ? "norecord" : "record";
  }
  return isNoRecord(entry as SourcePayload) ? "norecord" : "record";
}

/** The first payload of a record: one status row. */
export const NEW_RECORD: SourcePayload = { status: "RECORD FOUND" };

/** A scenario switched to another result; it always carries exactly one of respond or behavior. */
export function withResult(scenario: MockScenario, result: MockResult): MockScenario {
  if (resultOf(scenario) === result) return scenario;
  const { respond, behavior: _behavior, ...rest } = scenario;
  if (result === "norecord") return { ...rest, respond: { ...NO_RECORD } };
  if (result === "record")
    return {
      ...rest,
      respond: respond !== undefined && !isNoRecord(respond) ? respond : { ...NEW_RECORD },
    };
  return { ...rest, behavior: BEHAVIOR[result] };
}

/** A default payload switched between no record and a record (the default is always a payload). */
export function withDefaultResult(
  payload: SourcePayload,
  result: "record" | "norecord",
): SourcePayload {
  if (resultOf(payload) === result) return payload;
  return result === "norecord" ? { ...NO_RECORD } : { ...NEW_RECORD };
}

type When = MockScenario["when"];

/** A trigger value edited as text keeps a number or a boolean when the text still reads as one. */
export function setTriggerValue(when: When, field: string, text: string): When {
  const original = when[field];
  if (original === undefined) return when;
  const next = typed(text, original);
  return Object.is(original, next) ? when : { ...when, [field]: next };
}

/** Another field for a trigger, in place and with its value. A field the scenario already uses is refused. */
export function setTriggerField(when: When, field: string, to: string): When {
  if (field === to || to in when || !(field in when)) return when;
  return Object.fromEntries(Object.entries(when).map(([k, v]) => [k === field ? to : k, v]));
}

export function removeTrigger(when: When, field: string): When {
  if (!(field in when)) return when;
  const { [field]: _gone, ...rest } = when;
  return rest;
}

/** A blank trigger on the first of `fields` the scenario does not use yet; none left is a no-op. */
export function addTrigger(when: When, fields: readonly string[]): When {
  const free = fields.find((f) => !(f in when));
  return free === undefined ? when : { ...when, [free]: "" };
}
