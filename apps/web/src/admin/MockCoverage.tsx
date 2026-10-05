import { VisuallyHidden } from "@querymodule/web-ui";
import { useContext } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import { toPointer } from "./draft.js";
import { requestMockFocus, useMockEnv } from "./mock-context.js";
import { mockPointer } from "./mock-edit.js";
import { addResponse, scaffoldResponse } from "./mock-model.js";
import { SelectionContext } from "./selection.js";

/**
 * The coverage grid (Task 3a, #549, CFG-2; spec 5.4): query types as rows, mock sources as columns.
 * A cell is covered (a button that opens its response), Missing (an error, `config.missingMockResponse`,
 * with an Add button that makes a no-record response), or Not asked. Cells show counts and the
 * default outcome, never a payload value.
 */
const gapPointer = (sourceId: string, code: string): string =>
  toPointer(["mock", "coverage", sourceId, code]);
const gapId = (sourceId: string, code: string): string =>
  `qm-mock-gap-${sourceId}-${code}`.replace(/[^A-Za-z0-9_-]/g, "_");

export function MockCoverage() {
  const t = useT();
  const env = useMockEnv();
  const checks = useContext(ChecksContext);
  const select = useContext(SelectionContext).select;
  const sources = env.site.sources.filter(
    (s) => s.id in env.mock.sources || env.site.queryTypes.some((q) => q.sourceIds.includes(s.id)),
  );
  // The rule of checkMockCoverage: a pair is covered when the source has a response for the type.
  const isCovered = (sourceId: string, code: string): boolean =>
    env.mock.sources[sourceId]?.responses.some((r) => r.queryType === code) ?? false;
  const errorsAt = (sourceId: string, index: number): number =>
    checks.issues.filter(
      (i) =>
        i.level === "error" && i.pointer.startsWith(`${mockPointer.response(sourceId, index)}/`),
    ).length;
  return (
    <>
      <p className="qm-mock__lead">{t("admin.mock.coverage.intro")}</p>
      {env.site.sources
        .filter((s) => !(s.id in env.mock.sources))
        .map((s) => {
          // A source of the site with no mock data at all: one message and one fix for the source.
          const asks = env.site.queryTypes.filter((q) => q.sourceIds.includes(s.id));
          const pointer = toPointer(["mock", "coverage", s.id]);
          const id = `${gapId(s.id, "source")}-issue`;
          return (
            <div key={s.id} className="qm-mock__gap">
              <IssueMessages id={id} issues={checks.byPointer.get(pointer)} />
              {asks.length > 0 && (
                <button
                  type="button"
                  className="qm-button"
                  aria-describedby={checks.byPointer.has(pointer) ? id : undefined}
                  onClick={() => {
                    env.edit((m) =>
                      asks.reduce((acc, q) => addResponse(acc, s.id, scaffoldResponse(q.code)), m),
                    );
                    env.announce(
                      t("admin.mock.addedForSource", {
                        source: env.sourceName(s.id),
                        count: asks.length,
                      }),
                    );
                  }}
                >
                  {t("admin.mock.addForSource", { source: env.sourceName(s.id) })}
                </button>
              )}
            </div>
          );
        })}
      <div className="qm-mock__table-wrap">
        <table className="qm-mock__table">
          <caption>
            <VisuallyHidden>{t("admin.mock.coverage.caption")}</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.mock.queryType.label")}</th>
              {sources.map((s) => {
                const latency = env.mock.sources[s.id]?.latencyMs;
                return (
                  <th key={s.id} scope="col">
                    {env.sourceName(s.id)}
                    {latency !== undefined && (
                      <>
                        <br />
                        <span className="qm-mock__mono">
                          {t("admin.mock.latency.range", { min: latency[0], max: latency[1] })}
                        </span>
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {env.site.queryTypes.map((q) => (
              <tr key={q.code}>
                <th scope="row">
                  {env.typeName(q.code)} <span className="qm-tree__key">{q.code}</span>
                </th>
                {sources.map((s) => {
                  if (!q.sourceIds.includes(s.id))
                    return (
                      <td key={s.id} className="qm-mock__na">
                        {t("admin.mock.notAsked")}
                        <VisuallyHidden>
                          :{" "}
                          {t("admin.mock.notAskedWhy", {
                            type: env.typeName(q.code),
                            source: env.sourceName(s.id),
                          })}
                        </VisuallyHidden>
                      </td>
                    );
                  if (!isCovered(s.id, q.code))
                    return (
                      <td key={s.id}>
                        <div className="qm-mock__gap">
                          <span className="qm-mock__missing">
                            <span aria-hidden="true">⚠</span> {t("admin.mock.missing")}
                          </span>
                          <IssueMessages
                            id={`${gapId(s.id, q.code)}-issue`}
                            issues={checks.byPointer.get(gapPointer(s.id, q.code))}
                          />
                          <button
                            type="button"
                            className="qm-button"
                            aria-describedby={
                              checks.byPointer.has(gapPointer(s.id, q.code))
                                ? `${gapId(s.id, q.code)}-issue`
                                : undefined
                            }
                            onClick={() => {
                              const index = env.mock.sources[s.id]?.responses.length ?? 0;
                              env.edit((m) => addResponse(m, s.id, scaffoldResponse(q.code)));
                              env.announce(
                                t("admin.mock.addedNoRecord", {
                                  source: env.sourceName(s.id),
                                  type: env.typeName(q.code),
                                }),
                              );
                              select?.(mockPointer.response(s.id, index));
                              requestMockFocus(mockPointer.response(s.id, index), "heading");
                            }}
                          >
                            {t("admin.mock.addResponse.label")}{" "}
                            <VisuallyHidden>
                              {t("admin.mock.addResponseFor", {
                                source: env.sourceName(s.id),
                                type: env.typeName(q.code),
                              })}
                            </VisuallyHidden>
                          </button>
                        </div>
                      </td>
                    );
                  const responses = (env.mock.sources[s.id]?.responses ?? [])
                    .map((r, i) => ({ r, i }))
                    .filter(({ r }) => r.queryType === q.code);
                  return (
                    <td key={s.id}>
                      <div className="qm-mock__cells">
                        {responses.map(({ r, i }) => {
                          const errors = errorsAt(s.id, i);
                          return (
                            <button
                              key={i}
                              type="button"
                              className="qm-button qm-mock__cell"
                              onClick={() => select?.(mockPointer.response(s.id, i))}
                            >
                              <b>
                                {r.types === undefined
                                  ? ""
                                  : `${Object.values(r.types)
                                      .map((c) => env.codeName(c, q.code))
                                      .join(", ")}: `}
                                {t(
                                  r.scenarios.length === 0
                                    ? "admin.mock.cell.default"
                                    : r.scenarios.length === 1
                                      ? "admin.mock.cell.scenario1"
                                      : "admin.mock.cell.scenarioN",
                                  { count: r.scenarios.length },
                                )}
                              </b>
                              <span>
                                {t(
                                  Object.keys(r.default).length === 1 &&
                                    r.default.status === "NO RECORD"
                                    ? "admin.mock.cell.noRecord"
                                    : "admin.mock.cell.record",
                                )}
                              </span>
                              {errors > 0 && (
                                <span className="qm-badge qm-badge--critical">
                                  {t(errors === 1 ? "admin.issues.error" : "admin.issues.errors", {
                                    count: errors,
                                  })}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="qm-sect__hint qm-mock__legend">
        <span>{t("admin.mock.legend.covered")}</span> <span>{t("admin.mock.legend.missing")}</span>{" "}
        <span>{t("admin.mock.legend.notAsked")}</span>
      </p>
    </>
  );
}
