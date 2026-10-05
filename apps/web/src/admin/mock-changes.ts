import type { Translator } from "@querymodule/client";
import type { JsonObject } from "./draft.js";
import { mockPointer } from "./mock-edit.js";
import type { MockChange } from "./mock-model.js";
import { diffMock, mockChangeCount, parseMock } from "./mock-model.js";

/**
 * The mock's changes as Review lines (Task 3b, #550, CFG-2; Q2, developer 10-05-26): the source, the
 * query type and what happened, in plain words. A line never carries a trigger value or payload
 * content, so the audit record and the default change note can use the same lines.
 */

export interface MockEntry {
  id: string;
  /** The badge, reusing the diff's own kinds. */
  kind: "added" | "removed" | "changed" | "moved";
  /** "State system, Vehicle": where it happened. */
  what: string;
  /** What happened: "Scenario 2 added". */
  text: string;
  /** The item that opens: the response, else its source. */
  target: string;
}

const KIND: Record<MockChange["kind"], MockEntry["kind"]> = {
  responseAdded: "added",
  responseRemoved: "removed",
  matchChanged: "changed",
  defaultChanged: "changed",
  scenariosReordered: "moved",
  scenarioAdded: "added",
  scenarioRemoved: "removed",
  scenarioChanged: "changed",
  latencyChanged: "changed",
};

export interface MockNames {
  source(id: string): string;
  type(code: string): string;
}

export function mockChangeEntries(
  live: JsonObject | null | undefined,
  edited: JsonObject | null,
  names: MockNames,
  t: Translator["t"],
): MockEntry[] {
  const before =
    live === null || live === undefined ? { ok: true as const, mock: null } : parseMock(live);
  const after = edited === null ? { ok: true as const, mock: null } : parseMock(edited);
  if (!before.ok || !after.ok) return unreadable(live, edited, t);
  return diffMock(before.mock, after.mock).map((change, i) => {
    const queryType = "queryType" in change ? change.queryType : null;
    const index =
      queryType === null
        ? -1
        : (after.mock?.sources[change.sourceId]?.responses.findIndex(
            (r) => r.queryType === queryType,
          ) ?? -1);
    return {
      id: `${i}:${JSON.stringify(change)}`,
      kind: KIND[change.kind],
      what:
        queryType === null
          ? names.source(change.sourceId)
          : `${names.source(change.sourceId)}, ${names.type(queryType)}`,
      text: t(`admin.diff.mock.${change.kind}`, {
        n: "scenario" in change ? change.scenario + 1 : 0,
      }),
      target:
        index < 0
          ? mockPointer.source(change.sourceId)
          : mockPointer.response(change.sourceId, index),
    };
  });
}

/** A difference that no line explains (the file's site id, a source with no responses): one plain line. */
export function unexplainedEntry(
  live: JsonObject | null | undefined,
  edited: JsonObject | null,
  entries: readonly MockEntry[],
  t: Translator["t"],
): MockEntry[] {
  if (entries.length > 0 || mockChangeCount(live, edited) === 0) return [];
  return unreadable(live, edited, t);
}

function unreadable(live: unknown, edited: unknown, t: Translator["t"]): MockEntry[] {
  if (mockChangeCount(live, edited) === 0) return [];
  return [
    {
      id: "other",
      kind: "changed",
      what: t("admin.tree.mock"),
      text: t("admin.diff.mock.other"),
      target: mockPointer.coverage,
    },
  ];
}
