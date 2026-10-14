import type { ClientSiteConfig } from "@querymodule/core/config";
import type { MockFile } from "@querymodule/core/contracts";
import { matchMockScenario } from "@querymodule/core/mock";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useId, useMemo, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import {
  BEHAVIOR_STATUS,
  BehaviorLine,
  OutcomeRow,
  RESULT_KEY,
  RenderedCard,
  useRenderedCard,
} from "./CardAnswer.js";
import { useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { mockPointer, resultOf } from "./mock-edit.js";
import { parseMock } from "./mock-model.js";
import { mockSiteOf } from "./mock-site.js";
import { previewConfig, useOverlayTranslator } from "./Preview.js";
import { formMatchOf } from "./preview-match.js";
import { useDebouncedValue } from "./use-debounced.js";

/**
 * Try a match (#565; FR-043, FR-044; spec 5.4; CFG-2; design "Try a match (refines v4)"): beside
 * the mock editor, the admin picks a source and a query type, types values for the type's fields,
 * and sees which response and scenario of the draft's mock would answer, through the shared
 * `matchMockScenario` (type values from `evaluateForm`, as the server's plan reads them), so the
 * pane and the mock adapter cannot disagree. The answer shows as the production Result card (the
 * draft's cards) or as the read-only payload, with the wait; the outcome kind is announced once
 * typing pauses. It follows the draft as it changes. Typed values live in this pane's state only:
 * never the draft, storage, logs, URLs or announcements (spec 6.7).
 */

/** How long typing must pause before the outcome is announced. */
const ANNOUNCE_DELAY_MS = 600;
const NO_VALUES: Record<string, unknown> = {};

export function TryMatchPane({ doc, selected }: { doc: JsonObject; selected: string | null }) {
  const t = useT();
  const uid = useId();
  const labelText = useLabelText();
  const { mock: rawMock, labels } = useDraft();
  const translator = useOverlayTranslator(labels);
  const mock = useMemo<MockFile | null>(() => {
    const parsed = rawMock === null ? null : parseMock(rawMock);
    return parsed?.ok === true ? parsed.mock : null;
  }, [rawMock]);
  const site = useMemo(() => mockSiteOf(doc), [doc]);
  const config = useMemo<ClientSiteConfig | null>(() => previewConfig(doc), [doc]);

  // The selected response or source gives the starting source and type; the admin can change both,
  // and that choice holds until the selection changes again (T12-C2).
  const at = selected === null ? null : mockPointer.responseOf(selected);
  const selectedSource = selected === null ? null : mockPointer.sourceOf(selected);
  const selectedType =
    at === null ? undefined : mock?.sources[at.sourceId]?.responses[at.response]?.queryType;
  // Only a source the server answers from the mock (kind mock) can be tried here (T12-C3).
  const sources = site.sources.filter(
    (s) => s.kind === "mock" && mock !== null && s.id in mock.sources,
  );
  const [chosenSource, setSource] = useState<string | null>(null);
  const [chosenType, setType] = useState<string | null>(null);
  const [seenSelected, setSeenSelected] = useState(selected);
  if (seenSelected !== selected) {
    setSeenSelected(selected);
    if (at !== null || selectedSource !== null) {
      setSource(null);
      setType(null);
    }
  }
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [touched, setTouched] = useState(false);
  const [answerView, setAnswerView] = useState<"card" | "payload">("card");
  const [cardView, setCardView] = useState<"summary" | "detail">("summary");
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

  const found = useMemo(() => {
    if (mock === null || config === null || sourceId === undefined || code === undefined)
      return null;
    const { typeValues, values } = formMatchOf(config, code, typed, Date.now());
    const match = matchMockScenario(mock, sourceId, { queryType: code, typeValues, values });
    return match === null ? null : { match, values };
  }, [mock, config, sourceId, code, typed]);
  const answer = found?.match ?? null;

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

  // The wait: the source's latency range, one value when both ends agree, nothing without one, and
  // nothing for a timeout: the mock never answers it, the source's timeout ends the wait (FR-044).
  const latency = sourceId === undefined ? undefined : mock?.sources[sourceId]?.latencyMs;
  const timesOut = answer?.outcome.kind === "behavior" && answer.outcome.behavior === "timeout";
  const wait = timesOut
    ? t("admin.mock.try.neverAnswers")
    : latency === undefined || latency[1] <= 0
      ? null
      : latency[0] === latency[1]
        ? t("admin.mock.try.waitOne", { ms: latency[1] })
        : t("admin.mock.try.waitRange", { min: latency[0], max: latency[1] });

  const payload = answer?.outcome.kind === "respond" ? answer.outcome.payload : null;
  const rendered = useRenderedCard(config, {
    code: code ?? "",
    sourceId: sourceId ?? "",
    persona: "dispatcher",
    payload,
    values: found?.values ?? NO_VALUES,
  });

  // What a screen reader hears once typing pauses: the kind of outcome and which entry answered,
  // never a typed value or any payload content (spec 5.4, 6.7).
  const resultWord =
    result === undefined ? "" : t(`admin.mock.result.${RESULT_KEY[resultOf(result)]}`);
  const message =
    sourceId === undefined || config === null
      ? ""
      : answer === null || response === undefined || result === undefined
        ? t("admin.mock.try.none")
        : answer.scenarioIndex === null
          ? t("admin.mock.try.announceDefault", { result: resultWord })
          : t("admin.mock.try.announceScenario", {
              result: resultWord,
              n: answer.scenarioIndex + 1,
              type: typeName(response.queryType),
            });
  const announced = useDebouncedValue(message, ANNOUNCE_DELAY_MS, touched, "");

  const typeCodes =
    type?.typeField === null || type?.typeField === undefined ? null : type.typeField;
  return (
    <section
      className="qm-admin__preview qm-preview qm-preview--builder"
      aria-labelledby={`${uid}-h`}
    >
      <div className="qm-preview__head">
        <h3 id={`${uid}-h`}>{t("admin.mock.try.title")}</h3>
        <span className="qm-preview__hint">{t("admin.mock.try.nothingSent")}</span>
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
                onChange={(e) => {
                  setTouched(true);
                  setSource(e.target.value);
                }}
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
                onChange={(e) => {
                  setTouched(true);
                  setType(e.target.value);
                }}
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
              const set = (value: string) => {
                setTouched(true);
                setTyped((v) => ({ ...v, [f.key]: value }));
              };
              // A type-role field offers its picklist: the admin picks a code, not types it (T12-C4).
              if (typeCodes !== null && typeCodes.key === f.key && typeCodes.codes.length > 0)
                return (
                  <div key={f.key}>
                    <label htmlFor={id}>{fieldName(f.key)}</label>{" "}
                    <select
                      id={id}
                      className="qm-field__input"
                      value={typed[f.key] ?? ""}
                      onChange={(e) => set(e.target.value)}
                    >
                      <option value="">{t("admin.mock.try.noType")}</option>
                      {typeCodes.codes.map((c) => (
                        <option key={c.code} value={c.code}>
                          {labelText(c.labelKey) || c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                );
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
                    onChange={(e) => set(e.target.value)}
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
                <OutcomeRow
                  result={resultOf(result)}
                  which={
                    scenario === undefined || answer.scenarioIndex === null
                      ? t("admin.mock.try.entryDefault", { type: typeName(response.queryType) })
                      : t("admin.mock.try.entryScenario", {
                          n: answer.scenarioIndex + 1,
                          type: typeName(response.queryType),
                        })
                  }
                  hint={wait}
                />
                <fieldset className="qm-seg qm-try__toggle">
                  <legend>
                    <VisuallyHidden>{t("admin.mock.try.showAs")}</VisuallyHidden>
                  </legend>
                  {(["card", "payload"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={answerView === v}
                      onClick={() => setAnswerView(v)}
                    >
                      {t(v === "card" ? "admin.mock.try.viewCard" : "admin.mock.try.payload")}
                    </button>
                  ))}
                </fieldset>
                {answer.outcome.kind === "behavior" ? (
                  <BehaviorLine
                    source={sourceName(sourceId)}
                    status={BEHAVIOR_STATUS[answer.outcome.behavior]}
                    translator={translator}
                  />
                ) : answerView === "payload" ? (
                  <pre className="qm-mock__mono qm-try__payload" data-testid="try-payload">
                    {JSON.stringify(answer.outcome.payload, null, 2)}
                  </pre>
                ) : (
                  rendered !== null && (
                    <div className="qm-preview__panel qm-preview__panel--dispatch">
                      <RenderedCard
                        rendered={rendered}
                        config={config}
                        heading={sourceName(sourceId)}
                        translator={translator}
                        view={cardView}
                        onToggleView={setCardView}
                      />
                    </div>
                  )
                )}
              </div>
            )}
            <div role="status">
              <VisuallyHidden>{announced}</VisuallyHidden>
            </div>
          </>
        )}
        <p className="qm-preview__note">{t("admin.mock.try.note")}</p>
      </div>
    </section>
  );
}
