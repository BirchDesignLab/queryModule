import { useContext, useId, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { Sect } from "./controls.js";
import { requestMockFocus, useMockEnv } from "./mock-context.js";
import { mockPointer } from "./mock-edit.js";
import { addResponse, scaffoldResponse, setSourceLatency } from "./mock-model.js";
import { typeValuesLabel } from "./mock-site.js";
import { SelectionContext } from "./selection.js";

/**
 * A mock source (Task 3a, #549, CFG-2; spec 5.4): its response time (latencyMs lives on the source
 * in the mock file), its responses, and the form that adds one. A response is one query type, plus a
 * type match when the type has a role:"type" field; there is one per query type and match.
 */

/** Whole milliseconds, as typed; null while the text is not a count. */
const wait = (text: string): number | null =>
  /^[0-9]+$/.test(text.trim()) ? Number(text.trim()) : null;

export function MockSource({ sourceId }: { sourceId: string }) {
  const t = useT();
  const env = useMockEnv();
  const { announcer } = useServices();
  const select = useContext(SelectionContext).select;
  const uid = useId();
  const source = env.mock.sources[sourceId];
  const [text, setText] = useState<[string, string] | null>(null);
  const [adding, setAdding] = useState<{ type: string; code: string }>({ type: "", code: "" });
  if (source === undefined) return <p>{t("admin.mock.noResponse")}</p>;
  const shown: [string, string] = text ?? [
    String(source.latencyMs[0]),
    String(source.latencyMs[1]),
  ];
  const pair = [wait(shown[0]), wait(shown[1])] as const;
  const bad = pair[0] === null || pair[1] === null || pair[0] > pair[1];
  const commit = (next: [string, string]) => {
    setText(next);
    const a = wait(next[0]);
    const b = wait(next[1]);
    if (a !== null && b !== null && a <= b)
      env.edit((m) => setSourceLatency(m, sourceId, [a, b]), { coalesce: `latency:${sourceId}` });
  };
  const asked = env.site.queryTypes.filter((q) => q.sourceIds.includes(sourceId));
  const typeCode = asked.some((q) => q.code === adding.type) ? adding.type : (asked[0]?.code ?? "");
  const type = asked.find((q) => q.code === typeCode);
  const field = type?.typeField ?? null;
  const code = field?.codes.some((c) => c.code === adding.code) ? adding.code : "";
  const types = field === null || code === "" ? undefined : { [field.key]: code };
  const existing = source.responses.findIndex(
    (r) => r.queryType === typeCode && typeValuesLabel(r.types) === typeValuesLabel(types),
  );
  const duplicate = existing >= 0;
  return (
    <>
      <p className="qm-mock__lead">{t("admin.mock.source.lead", { id: sourceId })}</p>
      <Sect title={t("admin.mock.latency")} hint={t("admin.mock.latency.hint")}>
        <fieldset
          className="qm-mock__two qm-mock__group"
          aria-label={t("admin.mock.latency.group")}
        >
          {[0, 1].map((n) => (
            <div key={n}>
              <label htmlFor={`${uid}-lat-${n}`}>
                {t(n === 0 ? "admin.mock.shortest" : "admin.mock.longest")}
              </label>{" "}
              <input
                id={`${uid}-lat-${n}`}
                className="qm-field__input qm-mock__mono"
                inputMode="numeric"
                autoComplete="off"
                value={shown[n as 0 | 1]}
                aria-invalid={(bad && n === 0) || undefined}
                aria-describedby={bad && n === 0 ? `${uid}-lat-e` : undefined}
                data-owner={mockPointer.source(sourceId)}
                data-role={n === 0 ? "latency" : undefined}
                onChange={(e) =>
                  commit(n === 0 ? [e.target.value, shown[1]] : [shown[0], e.target.value])
                }
                onBlur={() => {
                  if (bad) announcer.announce(t("admin.mock.latency.announce"));
                  else setText(null);
                }}
              />{" "}
              <span>{t("admin.mock.ms")}</span>
            </div>
          ))}
        </fieldset>
        {bad && (
          <p className="qm-mock__error" id={`${uid}-lat-e`}>
            <span aria-hidden="true">⚠</span>
            <span>{t("admin.mock.latency.error")}</span>
          </p>
        )}
      </Sect>
      <Sect title={t("admin.mock.responses")}>
        {source.responses.length === 0 ? (
          <p className="qm-sect__hint">{t("admin.mock.responses.none")}</p>
        ) : (
          <ul className="qm-mock__list">
            {source.responses.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: responses have no id; the index is the pointer
              <li key={i}>
                <button
                  type="button"
                  className="qm-button qm-mock__cell"
                  onClick={() => select?.(mockPointer.response(sourceId, i))}
                >
                  <b>
                    {env.typeName(r.queryType)}
                    {r.types === undefined
                      ? ""
                      : `, ${Object.values(r.types)
                          .map((c) => env.codeName(c, r.queryType))
                          .join(", ")}`}
                  </b>
                  <span>
                    {t(
                      r.scenarios.length === 0
                        ? "admin.mock.cell.default"
                        : r.scenarios.length === 1
                          ? "admin.mock.cell.scenario1"
                          : "admin.mock.cell.scenarioN",
                      { count: r.scenarios.length },
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sect>
      <Sect title={t("admin.mock.addResponse")} hint={t("admin.mock.addResponse.hint")}>
        <div className="qm-mock__two">
          <div>
            <label htmlFor={`${uid}-nr-qt`}>{t("admin.mock.queryType")}</label>{" "}
            <select
              id={`${uid}-nr-qt`}
              className="qm-field__input"
              value={typeCode}
              data-owner={`${mockPointer.source(sourceId)}/add`}
              data-role="type"
              onChange={(e) => setAdding({ type: e.target.value, code: "" })}
            >
              {asked.map((q) => (
                <option key={q.code} value={q.code}>
                  {env.typeName(q.code)}
                </option>
              ))}
            </select>
          </div>
          {field !== null && (
            <div>
              <label htmlFor={`${uid}-nr-tf`}>{env.fieldName(typeCode, field.key)}</label>{" "}
              <select
                id={`${uid}-nr-tf`}
                className="qm-field__input"
                value={code}
                onChange={(e) => setAdding({ type: typeCode, code: e.target.value })}
              >
                <option value="">
                  {t("admin.mock.anyType", {
                    field: env.fieldName(typeCode, field.key).toLowerCase(),
                  })}
                </option>
                {field.codes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {env.codeName(c.code, typeCode)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {duplicate && (
          <p className="qm-sect__hint" id={`${uid}-nr-why`}>
            {t("admin.mock.addResponse.exists", { source: env.sourceName(sourceId) })}{" "}
            <button
              type="button"
              className="qm-button qm-button--ghost"
              onClick={() => select?.(mockPointer.response(sourceId, existing))}
            >
              {t("admin.mock.openIt")}
            </button>
          </p>
        )}
        <button
          type="button"
          className="qm-button"
          aria-disabled={duplicate || typeCode === "" ? "true" : undefined}
          aria-describedby={duplicate ? `${uid}-nr-why` : undefined}
          onClick={() => {
            if (duplicate || typeCode === "") return;
            const index = source.responses.length;
            const fresh = {
              ...scaffoldResponse(typeCode),
              ...(types === undefined ? {} : { types }),
            };
            env.edit((m) => addResponse(m, sourceId, fresh));
            env.announce(
              t("admin.mock.added", {
                source: env.sourceName(sourceId),
                type: env.typeName(typeCode),
              }),
            );
            select?.(mockPointer.response(sourceId, index));
            requestMockFocus(mockPointer.response(sourceId, index), "heading");
          }}
        >
          {t("admin.mock.addResponse")}
        </button>
      </Sect>
    </>
  );
}
