import type { MockFile } from "@querymodule/core/contracts";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useContext, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import { Sect } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { type MockEnv, requestMockFocus, useMockEnvValue } from "./mock-context.js";
import { mockPointer } from "./mock-edit.js";
import { addResponse, scaffoldResponse } from "./mock-model.js";
import { SelectionContext } from "./selection.js";

/**
 * The new query type and new source flows (Task 4, #551, CFG-2; spec 5.4; design 10-05-26 "Adding
 * responses"). On a mock site, a query type that asks a mock source with no response shows the gap
 * where the admin is working, with "Add mock response" (a no-record scaffold, no person, vehicle or
 * address leaves); a source with no mock data offers one no-record response for each query type that
 * asks it. Both write the draft's mock through `env.edit`, so undo, save and publish are the same as
 * everywhere else. Names and counts only: never a trigger value or payload content (Q2).
 */

const hasResponse = (mock: MockFile, sourceId: string, code: string): boolean =>
  mock.sources[sourceId]?.responses.some((r) => r.queryType === code) ?? false;

const rowId = (...parts: string[]): string => `qm-flow-${parts.join("-")}`.replace(/[^\w-]/g, "_");

function useFlowEnv(): MockEnv | null {
  const { doc } = useDraft();
  return useMockEnvValue(doc as JsonObject);
}

/** "No record by default" or what the response has; counts only. */
function summary(t: ReturnType<typeof useT>, mock: MockFile, sourceId: string, code: string) {
  const r = mock.sources[sourceId]?.responses.find((x) => x.queryType === code);
  if (r === undefined) return "";
  if (r.scenarios.length === 0)
    return t(
      Object.keys(r.default).length === 1 && r.default.status === "NO RECORD"
        ? "admin.mock.cell.noRecord"
        : "admin.mock.cell.record",
    );
  return t(r.scenarios.length === 1 ? "admin.mock.cell.scenario1" : "admin.mock.cell.scenarioN", {
    count: r.scenarios.length,
  });
}

/** In the query type editor: one row per mock source the type asks, Missing with an Add button or covered with Open. */
export function TypeMockResponses({
  code,
  sourceIds,
}: {
  code: string;
  sourceIds: readonly string[];
}) {
  const t = useT();
  const env = useFlowEnv();
  const select = useContext(SelectionContext).select;
  if (env === null) return null;
  const known = new Set(env.site.sources.map((s) => s.id));
  const asked = [...new Set(sourceIds)].filter((id) => known.has(id));
  const name = code.trim();
  const missing = asked.filter((id) => !hasResponse(env.mock, id, name));
  const open = (sourceId: string) => {
    const index =
      env.mock.sources[sourceId]?.responses.findIndex((r) => r.queryType === name) ?? -1;
    if (index >= 0) select?.(mockPointer.response(sourceId, index));
  };
  return (
    <Sect title={t("admin.mock.flow.type.title")} hint={t("admin.mock.flow.type.hint")}>
      {name === "" || asked.length === 0 ? (
        <p className="qm-mock__lead">{t("admin.mock.flow.type.needs")}</p>
      ) : (
        <>
          <ul className="qm-mock__flow">
            {asked.map((sourceId) =>
              hasResponse(env.mock, sourceId, name) ? (
                <li key={sourceId} className="qm-mock__flow-row">
                  <span>
                    {env.sourceName(sourceId)}: {summary(t, env.mock, sourceId, name)}
                  </span>
                  <button
                    type="button"
                    className="qm-button"
                    data-owner={rowId(name, sourceId)}
                    data-role="open"
                    onClick={() => open(sourceId)}
                  >
                    {t("admin.mock.flow.open")}{" "}
                    <VisuallyHidden>
                      {t("admin.mock.addResponseFor", {
                        source: env.sourceName(sourceId),
                        type: env.typeName(name),
                      })}
                    </VisuallyHidden>
                  </button>
                </li>
              ) : (
                <li key={sourceId} className="qm-mock__flow-row qm-mock__gap">
                  <span className="qm-mock__missing">
                    <span aria-hidden="true">⚠</span> {t("admin.mock.missing")}
                    <VisuallyHidden>: {env.sourceName(sourceId)}</VisuallyHidden>
                  </span>
                  <span>{env.sourceName(sourceId)}</span>
                  <button
                    type="button"
                    className="qm-button"
                    data-owner={rowId(name, sourceId, "add")}
                    data-role="add"
                    onClick={() => {
                      env.edit((m) => addResponse(m, sourceId, scaffoldResponse(name)));
                      env.announce(
                        t("admin.mock.addedNoRecord", {
                          source: env.sourceName(sourceId),
                          type: env.typeName(name),
                        }),
                      );
                      requestMockFocus(rowId(name, sourceId), "open");
                    }}
                  >
                    {t("admin.mock.addResponse.label")}{" "}
                    <VisuallyHidden>
                      {t("admin.mock.addResponseFor", {
                        source: env.sourceName(sourceId),
                        type: env.typeName(name),
                      })}
                    </VisuallyHidden>
                  </button>
                </li>
              ),
            )}
          </ul>
          {missing.length > 1 && (
            <button
              type="button"
              className="qm-button"
              onClick={() => {
                env.edit((m) =>
                  missing.reduce((acc, id) => addResponse(acc, id, scaffoldResponse(name)), m),
                );
                env.announce(
                  t("admin.mock.addedForType", {
                    type: env.typeName(name),
                    count: missing.length,
                  }),
                );
                const first = missing[0];
                if (first !== undefined) requestMockFocus(rowId(name, first), "open");
              }}
            >
              {t("admin.mock.flow.addAll", { count: missing.length })}
            </button>
          )}
        </>
      )}
    </Sect>
  );
}

/**
 * Under the site's sources: a source with gaps (or with no mock data and no asker yet) offers a
 * no-record response for each query type that asks it. A row stays after its add, now with "Open mock
 * source", so focus has somewhere to land and the next step (response time) is one press away.
 */
export function SourceMockResponses() {
  const t = useT();
  const env = useFlowEnv();
  const select = useContext(SelectionContext).select;
  const [added, setAdded] = useState<readonly string[]>([]);
  if (env === null) return null;
  const rows = env.site.sources
    .filter((s) => s.id !== "")
    .map((s) => {
      const asks = env.site.queryTypes.filter((q) => q.code !== "" && q.sourceIds.includes(s.id));
      return {
        id: s.id,
        asks,
        gaps: asks.filter((q) => !hasResponse(env.mock, s.id, q.code)),
        hasData: s.id in env.mock.sources,
      };
    })
    .filter(
      (r) => r.gaps.length > 0 || added.includes(r.id) || (!r.hasData && r.asks.length === 0),
    );
  if (rows.length === 0) return null;
  return (
    <Sect title={t("admin.mock.flow.source.title")} hint={t("admin.mock.flow.source.hint")}>
      <ul className="qm-mock__flow">
        {rows.map((r) => (
          <li key={r.id} className="qm-mock__flow-row">
            {r.gaps.length > 0 ? (
              <>
                <span>
                  {t("admin.mock.flow.source.gaps", {
                    source: env.sourceName(r.id),
                    count: r.gaps.length,
                  })}
                </span>
                <button
                  type="button"
                  className="qm-button"
                  data-owner={rowId("source", r.id)}
                  data-role="add"
                  onClick={() => {
                    env.edit((m) =>
                      r.gaps.reduce(
                        (acc, q) => addResponse(acc, r.id, scaffoldResponse(q.code)),
                        m,
                      ),
                    );
                    env.announce(
                      t("admin.mock.addedForSource", {
                        source: env.sourceName(r.id),
                        count: r.gaps.length,
                      }),
                    );
                    setAdded((ids) => [...ids, r.id]);
                    requestMockFocus(rowId("source", r.id), "open");
                  }}
                >
                  {t("admin.mock.addForSource", { source: env.sourceName(r.id) })}
                </button>
              </>
            ) : r.hasData ? (
              <>
                <span>{t("admin.mock.flow.source.done", { source: env.sourceName(r.id) })}</span>
                <button
                  type="button"
                  className="qm-button"
                  data-owner={rowId("source", r.id)}
                  data-role="open"
                  onClick={() => select?.(mockPointer.source(r.id))}
                >
                  {t("admin.mock.flow.source.open", { source: env.sourceName(r.id) })}
                </button>
              </>
            ) : (
              <span>{t("admin.mock.flow.source.unasked", { source: env.sourceName(r.id) })}</span>
            )}
          </li>
        ))}
      </ul>
    </Sect>
  );
}
