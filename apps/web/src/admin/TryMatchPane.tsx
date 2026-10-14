import type { ClientSiteConfig } from "@querymodule/core/config";
import type { MockFile } from "@querymodule/core/contracts";
import { matchMockScenario } from "@querymodule/core/mock";
import { evaluateForm } from "@querymodule/core/rules";
import { useId, useMemo, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import { useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { type MockResult, mockPointer, resultOf } from "./mock-edit.js";
import { parseMock } from "./mock-model.js";
import { mockSiteOf } from "./mock-site.js";
import { previewConfig } from "./Preview.js";

/**
 * Try a match (#565; FR-043, FR-044; spec 5.4; CFG-2; mockup v4 "Admin: mock responses"): beside the
 * mock editor, the admin picks a source and a query type, types values for the type's fields, and
 * sees which response and scenario of the draft's mock would answer, through the shared
 * `matchMockScenario` (type values from `evaluateForm`, as the server's plan reads them), so the
 * pane and the mock adapter cannot disagree. It follows the draft as it changes. Typed values live
 * in this pane's state only: never the draft, storage, logs, URLs or announcements (spec 6.7).
 */

const RESULT_KEY: Record<MockResult, string> = {
  record: "record",
  norecord: "noRecord",
  error: "error",
  timeout: "timeout",
  creds: "creds",
};

export function TryMatchPane({ doc, selected }: { doc: JsonObject; selected: string | null }) {
  const t = useT();
  const uid = useId();
  const labelText = useLabelText();
  const { mock: rawMock } = useDraft();
  const mock = useMemo<MockFile | null>(() => {
    const parsed = rawMock === null ? null : parseMock(rawMock);
    return parsed?.ok === true ? parsed.mock : null;
  }, [rawMock]);
  const site = useMemo(() => mockSiteOf(doc), [doc]);
  const config = useMemo<ClientSiteConfig | null>(() => previewConfig(doc), [doc]);

  // The selected response or source gives the starting source and type; the admin can change both.
  const at = selected === null ? null : mockPointer.responseOf(selected);
  const selectedSource = selected === null ? null : mockPointer.sourceOf(selected);
  const selectedType =
    at === null ? undefined : mock?.sources[at.sourceId]?.responses[at.response]?.queryType;
  const sources = site.sources.filter((s) => mock !== null && s.id in mock.sources);
  const [chosenSource, setSource] = useState<string | null>(null);
  const [chosenType, setType] = useState<string | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const pick = <T,>(options: readonly T[], ...wanted: (T | null | undefined)[]): T | undefined =>
    wanted.find((w): w is T => w !== null && w !== undefined && options.includes(w)) ?? options[0];
  const sourceId = pick(
    sources.map((s) => s.id),
    chosenSource,
    selectedSource,
  );
  const types = site.queryTypes.filter(
    (q) => q.code !== "" && sourceId !== undefined && q.sourceIds.includes(sourceId),
  );
  const code = pick(
    types.map((q) => q.code),
    chosenType,
    selectedType,
  );
  const type = types.find((q) => q.code === code);

  const answer = useMemo(() => {
    if (mock === null || config === null || sourceId === undefined || code === undefined)
      return null;
    const input: Record<string, string> = {};
    for (const [k, v] of Object.entries(typed)) if (v !== "") input[k] = v;
    const state = evaluateForm(config, code, input, { now: Date.now() });
    const typeValues: Record<string, string> = {};
    for (const f of state.fields)
      if (f.role === "type" && f.visible && typeof f.effectiveValue === "string")
        typeValues[f.key] = f.effectiveValue;
    return matchMockScenario(mock, sourceId, { queryType: code, typeValues, values: state.values });
  }, [mock, config, sourceId, code, typed]);

  const sourceName = (id: string) =>
    labelText(site.sources.find((s) => s.id === id)?.labelKey) || id;
  const typeName = (c: string) =>
    labelText(site.queryTypes.find((q) => q.code === c)?.labelKey) || c;
  const fieldName = (key: string) =>
    labelText(type?.fields.find((f) => f.key === key)?.labelKey) || key;

  const response =
    answer === null || sourceId === undefined
      ? undefined
      : mock?.sources[sourceId]?.responses[answer.responseIndex];
  const scenario =
    answer?.scenarioIndex === null || answer === null
      ? undefined
      : response?.scenarios[answer.scenarioIndex];
  const sameType =
    response === undefined || sourceId === undefined
      ? 0
      : (mock?.sources[sourceId]?.responses.filter((r) => r.queryType === response.queryType)
          .length ?? 0);
  const result = scenario ?? response?.default;

  return (
    <section className="qm-admin__preview qm-preview" aria-labelledby={`${uid}-h`}>
      <div className="qm-preview__head">
        <h3 id={`${uid}-h`}>{t("admin.mock.try.title")}</h3>
      </div>
      <div className="qm-preview__body">
        {sourceId === undefined ? (
          <p className="qm-preview__state">{t("admin.mock.try.empty")}</p>
        ) : (
          <>
            <div>
              <label htmlFor={`${uid}-source`}>{t("admin.mock.try.source")}</label>{" "}
              <select
                id={`${uid}-source`}
                className="qm-field__input"
                value={sourceId}
                onChange={(e) => setSource(e.target.value)}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sourceName(s.id)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-type`}>{t("admin.mock.try.queryType")}</label>{" "}
              <select
                id={`${uid}-type`}
                className="qm-field__input"
                value={code ?? ""}
                onChange={(e) => setType(e.target.value)}
              >
                {types.map((q) => (
                  <option key={q.code} value={q.code}>
                    {typeName(q.code)}
                  </option>
                ))}
              </select>
            </div>
            {type?.fields.map((f) => {
              const id = `${uid}-field-${f.key}`;
              return (
                <div key={f.key}>
                  <label htmlFor={id}>{fieldName(f.key)}</label>{" "}
                  <input
                    id={id}
                    type="text"
                    className="qm-field__input qm-mock__mono"
                    autoComplete="off"
                    spellCheck={false}
                    value={typed[f.key] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setTyped((v) => ({ ...v, [f.key]: value }));
                    }}
                  />
                </div>
              );
            })}
            {config === null ? (
              <p className="qm-preview__state">{t("admin.mock.try.paused")}</p>
            ) : answer === null || response === undefined || result === undefined ? (
              <p className="qm-preview__state">{t("admin.mock.try.none")}</p>
            ) : (
              <div className="qm-try__answer">
                {sameType > 1 && (
                  <p>{t("admin.mock.try.response", { n: answer.responseIndex + 1 })}</p>
                )}
                <p>
                  {scenario === undefined || answer.scenarioIndex === null
                    ? t("admin.mock.try.default")
                    : t("admin.mock.try.matched", {
                        n: answer.scenarioIndex + 1,
                        when: Object.entries(scenario.when)
                          .map(([field, value]) =>
                            t("admin.mock.summary.when", {
                              field: fieldName(field),
                              value: String(value),
                            }),
                          )
                          .join(t("admin.mock.summary.and")),
                      })}
                </p>
                <p>
                  {t("admin.mock.try.result", {
                    result: t(`admin.mock.result.${RESULT_KEY[resultOf(result)]}`),
                  })}
                </p>
                {answer.outcome.kind === "respond" && (
                  <>
                    <p className="qm-mock__label">{t("admin.mock.try.payload")}</p>
                    <pre className="qm-mock__mono qm-try__payload" data-testid="try-payload">
                      {JSON.stringify(answer.outcome.payload, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <p className="qm-preview__note">{t("admin.mock.try.note")}</p>
      </div>
    </section>
  );
}
