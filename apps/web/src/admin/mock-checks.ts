import type { Diagnostic } from "@querymodule/core/config";
import type { MockFile } from "@querymodule/core/contracts";
import type { DraftChecks } from "./checks.js";
import { buildSiteConfig, type JsonObject, toPointer } from "./draft.js";
import { type DraftIssue, groupByControl } from "./issues.js";
import { mockPointer } from "./mock-edit.js";
import { mockDiagnostics, parseMock } from "./mock-model.js";

/**
 * The mock's diagnostics as builder issues (Task 3b, #550, CFG-2): `mockDiagnostics` (the server's
 * checks and pointers) plus the editor's own rules (Q4, developer 10-05-26: a scenario needs at
 * least one trigger field with a value). A coverage gap is shown at the Coverage item, one per
 * source and query type, whether the browser or the server found it. No value is ever carried.
 */

const empty = (v: unknown): boolean => typeof v === "string" && v.trim() === "";

/** The editor's rules for scenarios; the server has no twin for them, so they are builder-only. */
export function mockEditorIssues(mock: MockFile): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const [sourceId, source] of Object.entries(mock.sources)) {
    source.responses.forEach((response, ri) => {
      response.scenarios.forEach((scenario, si) => {
        const at = toPointer(["mock", "sources", sourceId, "responses", ri, "scenarios", si]);
        const fields = Object.entries(scenario.when);
        if (fields.length === 0)
          out.push({
            level: "error",
            pointer: `${at}/when`,
            key: "admin.mock.triggerMissing",
            params: {},
          });
        for (const [field, value] of fields)
          if (empty(value))
            out.push({
              level: "error",
              pointer: `${at}/when/${field.replaceAll("~", "~0").replaceAll("/", "~1")}`,
              key: "admin.mock.triggerValueEmpty",
              params: {},
            });
      });
    });
  }
  return out;
}

const GAP_KEYS = new Set(["config.missingMockResponse", "config.missingMock"]);

/** A coverage gap at the Coverage item: the source, and the query type when the gap is one. */
function atCoverage(d: {
  key: string;
  level: DraftIssue["level"];
  params: DraftIssue["params"];
}): DraftIssue {
  const sourceId = String(d.params.sourceId ?? "");
  const queryType = d.params.queryType === undefined ? "" : String(d.params.queryType);
  return {
    level: d.level,
    pointer: toPointer(["mock", "coverage", sourceId, ...(queryType === "" ? [] : [queryType])]),
    key: d.key,
    params: d.params,
  };
}

const idOf = (i: DraftIssue): string => JSON.stringify([i.level, i.pointer, i.key, i.params]);

function fromDiagnostic(d: Diagnostic): DraftIssue {
  return GAP_KEYS.has(d.key)
    ? atCoverage(d)
    : { level: d.level, pointer: d.path, key: d.key, params: d.params };
}

/** The mock's own issues for this draft: coverage and fixture findings, and the editor's rules. */
export function mockIssuesOf(doc: JsonObject, rawMock: JsonObject | null): DraftIssue[] {
  if (rawMock === null) return [];
  const parsed = parseMock(rawMock);
  if (!parsed.ok) return [];
  const built = buildSiteConfig(doc);
  return [
    ...(built.ok ? mockDiagnostics(built.config, parsed.mock).map(fromDiagnostic) : []),
    ...mockEditorIssues(parsed.mock),
  ];
}

/**
 * The checks with the mock's issues added. Gaps the server found (at the source) move to the
 * Coverage item so the two never show twice. The same checks come back when the draft has no mock,
 * or while the base checks are not ready.
 */
export function withMockIssues(checks: DraftChecks, rawMock: JsonObject | null): DraftChecks {
  if (rawMock === null || checks.status !== "ready" || checks.doc === null) return checks;
  const mine = mockIssuesOf(checks.doc, rawMock);
  const moved = checks.issues.map((i) => (GAP_KEYS.has(i.key) ? atCoverage(i) : i));
  const seen = new Set(moved.map(idOf));
  const added = mine.filter((i) => !seen.has(idOf(i)));
  const changed = added.length > 0 || moved.some((i, k) => i !== checks.issues[k]);
  if (!changed) return checks;
  const issues = [
    ...moved.filter((i, k, all) => all.findIndex((x) => idOf(x) === idOf(i)) === k),
    ...added,
  ];
  const byPointer = new Map<string, DraftIssue[]>();
  for (const i of issues) byPointer.set(i.pointer, [...(byPointer.get(i.pointer) ?? []), i]);
  const groups = groupByControl(
    checks.doc,
    issues.filter((i) => !mockPointer.is(i.pointer)),
  );
  return { ...checks, issues, byPointer, groups };
}
