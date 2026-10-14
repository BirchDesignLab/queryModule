import type { ClientSiteConfig } from "@querymodule/core/config";
import type { MockFile, SourcePayload } from "@querymodule/core/contracts";
import { matchMockScenario } from "@querymodule/core/mock";
import { assessResult, mapResponse } from "@querymodule/core/response";
import { evaluateForm } from "@querymodule/core/rules";
import { ResultCard, VisuallyHidden } from "@querymodule/web-ui";
import { useId, useMemo, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import { cardIndexOf, useCardName } from "./CardsEditor.js";
import { asObjects, str } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { parseMock } from "./mock-model.js";
import { previewConfig, useOverlayTranslator } from "./Preview.js";
import { cardsTypeOf } from "./selection.js";

/**
 * The card preview (Task 10, #603; FR-060, UX-015; ADR-0011 decision 4; visual system "Card
 * preview"): the production ResultCard over the draft's cards, mapped by `mapResponse` and assessed
 * by `assessResult`, as a dispatcher or an officer sees it. The answer comes from the draft's mock
 * only: a scenario picked from its list, or typed values matched by the shared `matchMockScenario`
 * (type values from `evaluateForm`, as the server's plan does). A behaviour scenario shows its
 * status line. Typed values live in this pane's state only: never the draft, storage, logs or URLs.
 */

type Persona = "dispatcher" | "officer";
const PERSONA_KEY: Record<Persona, string> = { dispatcher: "dispatch", officer: "mobileUnit" };
const BEHAVIOR_STATUS = {
  timeout: "timedOut",
  error: "failed",
  credentialsRejected: "credentialsRejected",
} as const;

type Answer =
  | { kind: "none" }
  | { kind: "respond"; payload: SourcePayload; matched: string; values: Record<string, unknown> }
  | { kind: "behavior"; status: string; matched: string };

export function CardPreview({
  doc,
  labels,
  selected,
}: {
  /** The settled draft the checks ran on. */
  doc: JsonObject;
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  selected: string | null;
}) {
  const t = useT();
  const headingId = useId();
  const uid = useId();
  const translator = useOverlayTranslator(labels);
  const { mock: rawMock } = useDraft();
  const cardName = useCardName(doc);
  const mock = useMemo<MockFile | null>(() => {
    const parsed = rawMock === null ? null : parseMock(rawMock);
    return parsed?.ok === true ? parsed.mock : null;
  }, [rawMock]);
  const config = useMemo<ClientSiteConfig | null>(() => previewConfig(doc), [doc]);
  const cardIndex = cardIndexOf(selected);
  const card = cardIndex === null ? undefined : asObjects(doc.responseMappings)[cardIndex];
  const code = (selected === null ? null : cardsTypeOf(selected)) ?? str(card?.queryType);
  const type = asObjects(doc.queryTypes).find((q) => str(q.code) === code);
  const typeSources = asObjects(type?.sources).map((s) => str(s.sourceId));
  const [persona, setPersona] = useState<Persona>("dispatcher");
  const [chosenSource, setSource] = useState<string | null>(null);
  const sourceId =
    chosenSource !== null && typeSources.includes(chosenSource)
      ? chosenSource
      : typeof card?.sourceId === "string" && typeSources.includes(card.sourceId)
        ? card.sourceId
        : (typeSources[0] ?? "");
  const [mode, setMode] = useState<"pick" | "type">("pick");
  const [scenario, setScenario] = useState<string | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [view, setView] = useState<"summary" | "detail">("summary");

  const sourceName = (id: string) => {
    const s = asObjects(doc.sources).find((x) => str(x.id) === id);
    return (
      (typeof s?.labelKey === "string" && translator.has(s.labelKey)
        ? translator.t(s.labelKey)
        : "") || id
    );
  };
  const fieldName = (f: JsonObject) =>
    (typeof f.labelKey === "string" && translator.has(f.labelKey)
      ? translator.t(f.labelKey)
      : "") || str(f.key);

  // The draft mock's answers for this source and type: each response's default and scenarios.
  const responses = (mock?.sources[sourceId]?.responses ?? [])
    .map((r, ri) => ({ r, ri }))
    .filter(({ r }) => r.queryType === code);
  const options = responses.flatMap(({ r, ri }) => {
    const prefix =
      responses.length > 1 ? `${t("admin.cards.preview.response", { n: ri + 1 })}: ` : "";
    return [
      { value: `${ri}:d`, text: `${prefix}${t("admin.cards.preview.default")}` },
      ...r.scenarios.map((_, si) => ({
        value: `${ri}:${si}`,
        text: `${prefix}${t("admin.mock.scenario", { n: si + 1 })}`,
      })),
    ];
  });
  const picked =
    scenario !== null && options.some((o) => o.value === scenario)
      ? scenario
      : (options[0]?.value ?? "");

  const answer = useMemo<Answer>(() => {
    if (mock === null || config === null || code === "") return { kind: "none" };
    const matchedText = (si: number | null) =>
      si === null
        ? t("admin.cards.preview.matchedDefault")
        : t("admin.cards.preview.matched", { n: si + 1 });
    if (mode === "pick") {
      const [riText, siText] = picked.split(":");
      const entry = mock.sources[sourceId]?.responses[Number(riText)];
      if (entry === undefined) return { kind: "none" };
      const si = siText === "d" || siText === undefined ? null : Number(siText);
      const s = si === null ? undefined : entry.scenarios[si];
      if (s?.behavior !== undefined)
        return { kind: "behavior", status: BEHAVIOR_STATUS[s.behavior], matched: matchedText(si) };
      return {
        kind: "respond",
        payload: s?.respond ?? entry.default,
        matched: matchedText(si),
        values: {},
      };
    }
    const input: Record<string, string> = {};
    for (const [k, v] of Object.entries(typed)) if (v !== "") input[k] = v;
    const state = evaluateForm(config, code, input, { now: Date.now() });
    const typeValues: Record<string, string> = {};
    for (const f of state.fields)
      if (f.role === "type" && f.visible && typeof f.effectiveValue === "string")
        typeValues[f.key] = f.effectiveValue;
    const match = matchMockScenario(mock, sourceId, {
      queryType: code,
      typeValues,
      values: state.values,
    });
    if (match === null) return { kind: "none" };
    const matched = matchedText(match.scenarioIndex);
    return match.outcome.kind === "behavior"
      ? { kind: "behavior", status: BEHAVIOR_STATUS[match.outcome.behavior], matched }
      : { kind: "respond", payload: match.outcome.payload, matched, values: state.values };
  }, [mock, config, code, mode, picked, sourceId, typed, t]);

  const rendered = useMemo(() => {
    if (answer.kind !== "respond" || config === null) return null;
    const now = Date.now();
    const mapped = mapResponse(
      config,
      { queryType: code, partValues: answer.values, sourceId, persona: PERSONA_KEY[persona] },
      answer.payload,
      now,
    );
    return { mapped, assessment: assessResult(answer.payload, config.keywords) };
  }, [answer, config, code, sourceId, persona]);

  const used = rendered?.mapped.mappingIndex;
  const usedText =
    used === undefined
      ? null
      : used === null
        ? t("admin.cards.preview.noCard")
        : t(used === cardIndex ? "admin.cards.preview.thisCard" : "admin.cards.preview.otherCard", {
            name: cardName(asObjects(doc.responseMappings)[used]),
            id: str(asObjects(doc.responseMappings)[used]?.id),
          });

  return (
    <section className="qm-admin__preview qm-preview" aria-labelledby={headingId}>
      <div className="qm-preview__head">
        <h3 id={headingId}>{t("admin.cards.preview.title")}</h3>
        <fieldset className="qm-seg">
          <legend>
            <VisuallyHidden>{t("admin.preview.as")}</VisuallyHidden>
          </legend>
          {(["dispatcher", "officer"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={persona === p}
              onClick={() => setPersona(p)}
            >
              {t(p === "officer" ? "admin.preview.asOfficer" : "admin.preview.asDispatcher")}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="qm-preview__body">
        {code === "" || type === undefined ? (
          <p className="qm-preview__state">{t("admin.cards.preview.empty")}</p>
        ) : (
          <>
            <div>
              <label htmlFor={`${uid}-source`}>{t("admin.cards.preview.source")}</label>{" "}
              <select
                className="qm-field__input"
                id={`${uid}-source`}
                value={sourceId}
                onChange={(e) => setSource(e.target.value)}
              >
                {typeSources.map((s) => (
                  <option key={s} value={s}>
                    {sourceName(s)}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="qm-mock__radios">
              <legend>{t("admin.cards.preview.answer")}</legend>
              {(["pick", "type"] as const).map((m) => (
                <label key={m} className="qm-mock__radio">
                  <input
                    type="radio"
                    name={`${uid}-mode`}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />{" "}
                  {t(m === "pick" ? "admin.cards.preview.pick" : "admin.cards.preview.type")}
                </label>
              ))}
            </fieldset>
            {mode === "pick" ? (
              <div>
                <label htmlFor={`${uid}-scenario`}>{t("admin.cards.preview.scenario")}</label>{" "}
                <select
                  className="qm-field__input"
                  id={`${uid}-scenario`}
                  value={picked}
                  onChange={(e) => setScenario(e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.text}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              asObjects(type.fields).map((f) => {
                const key = str(f.key);
                const id = `${uid}-field-${key}`;
                return (
                  <div key={key}>
                    <label htmlFor={id}>{fieldName(f)}</label>{" "}
                    <input
                      id={id}
                      type="text"
                      className="qm-field__input"
                      autoComplete="off"
                      value={typed[key] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTyped((v) => ({ ...v, [key]: value }));
                      }}
                    />
                  </div>
                );
              })
            )}
            {config === null ? (
              <p className="qm-preview__state">{t("admin.cards.preview.paused")}</p>
            ) : answer.kind === "none" ? (
              <p className="qm-preview__state">{t("admin.cards.preview.noAnswer")}</p>
            ) : (
              <>
                <p>{answer.matched}</p>
                <div
                  className={
                    persona === "officer"
                      ? "qm-preview__panel qm-layout--mobile-unit"
                      : "qm-preview__panel qm-preview__panel--dispatch"
                  }
                >
                  {answer.kind === "behavior" ? (
                    <div className="qm-source qm-source--problem">
                      <span aria-hidden="true" className="qm-source__icon">
                        !
                      </span>
                      <span>
                        {translator.t("sourceStatus.line", {
                          source: sourceName(sourceId),
                          status: translator.t(`sourceStatus.status.${answer.status}`),
                        })}
                      </span>
                    </div>
                  ) : rendered === null ? null : (
                    <ResultCard
                      heading={sourceName(sourceId)}
                      status={translator.t("sourceStatus.status.returned")}
                      assessment={rendered.assessment}
                      mapped={rendered.mapped}
                      keywords={config.keywords}
                      styles={config.keywordSeverityStyles}
                      view={view}
                      onToggleView={setView}
                      t={translator.t}
                    />
                  )}
                </div>
                {usedText !== null && <p>{usedText}</p>}
              </>
            )}
          </>
        )}
        <p className="qm-preview__note">{t("admin.cards.preview.note")}</p>
      </div>
    </section>
  );
}
