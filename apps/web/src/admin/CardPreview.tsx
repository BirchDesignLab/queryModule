import type { ClientSiteConfig } from "@querymodule/core/config";
import type { MockFile, SourcePayload } from "@querymodule/core/contracts";
import { matchMockScenario } from "@querymodule/core/mock";
import { VisuallyHidden } from "@querymodule/web-ui";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import {
  BEHAVIOR_STATUS,
  BehaviorLine,
  OutcomeRow,
  type Persona,
  RenderedCard,
  useRenderedCard,
} from "./CardAnswer.js";
import { cardIndexOf, useCardName } from "./CardsEditor.js";
import { asObjects, str, useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { type MockResult, resultOf } from "./mock-edit.js";
import { parseMock } from "./mock-model.js";
import { previewConfig, useOverlayTranslator } from "./Preview.js";
import { formMatchOf, triggerInput } from "./preview-match.js";
import { cardsTypeOf } from "./selection.js";

/**
 * The card preview (Task 10, #603; FR-060, UX-015; ADR-0011 decision 4; visual system "Card
 * preview"): the production ResultCard over the draft's cards, mapped by `mapResponse` and assessed
 * by `assessResult`, as a dispatcher or an officer sees it. The answer comes from the draft's mock
 * only: a scenario picked from its list, or typed values matched by the shared `matchMockScenario`
 * (type values from `evaluateForm`, as the server's plan does). A behaviour scenario shows its
 * status line. Typed values live in this pane's state only: never the draft, storage, logs or URLs.
 */

type Answer =
  | { kind: "none" }
  | {
      kind: "respond";
      payload: SourcePayload;
      matched: string;
      result: MockResult;
      values: Record<string, unknown>;
    }
  | {
      kind: "behavior";
      status: (typeof BEHAVIOR_STATUS)[keyof typeof BEHAVIOR_STATUS];
      matched: string;
      result: MockResult;
    };

/** The values of an answer with none: a stable object, so the rendered card is not rebuilt for nothing. */
const NO_VALUES: Record<string, unknown> = {};

const MODES = ["pick", "type"] as const;
type Mode = (typeof MODES)[number];

/**
 * The Values segmented control (mockup v5): two native radios in one segmented track, the label
 * drawing each segment (the pattern of the web-ui SegField). The browser gives one Tab stop, and
 * Left, Right, Up and Down move and select; Home and End jump to the first and last here. Focus
 * follows the selection and never moves otherwise.
 */
function ValuesSeg({
  label,
  name,
  mode,
  onChange,
  names,
}: {
  label: string;
  name: string;
  mode: Mode;
  onChange(mode: Mode): void;
  names: Readonly<Record<Mode, string>>;
}) {
  const refs = useRef<Partial<Record<Mode, HTMLInputElement | null>>>({});
  const jump = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = (e.key === "Home" ? MODES[0] : MODES[MODES.length - 1]) ?? mode;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <fieldset className="qm-preview__field">
      <legend>{label}</legend>
      <div className="qm-seg qm-seg--options qm-seg--values">
        {MODES.map((m) => (
          <label key={m} className="qm-seg__option">
            <input
              ref={(el) => {
                refs.current[m] = el;
              }}
              type="radio"
              name={name}
              checked={mode === m}
              onChange={() => onChange(m)}
              onKeyDown={jump}
            />
            <span>{names[m]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NO_TYPED: Readonly<Record<string, string>> = {};

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
  const labelText = useLabelText();
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
  const [mode, setMode] = useState<Mode>("pick");
  const [scenario, setScenario] = useState<string | null>(null);
  // Typed values belong to one query type: another type's card starts empty, and coming back to
  // a type finds its values again (T10-Q7). Never the draft.
  const [typedByType, setTypedByType] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  const typed = typedByType[code] ?? NO_TYPED;
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
  // Until one is picked, the preview opens on the first scenario that answers with a record, so
  // a card edit shows at once; the default answer is the fallback (G22).
  const firstRecord = responses
    .flatMap(({ r, ri }) => r.scenarios.map((sc, si) => ({ sc, value: `${ri}:${si}` })))
    .find(({ sc }) => resultOf(sc) === "record")?.value;
  const picked =
    scenario !== null && options.some((o) => o.value === scenario)
      ? scenario
      : (firstRecord ?? options[0]?.value ?? "");

  const answer = useMemo<Answer>(() => {
    if (mock === null || config === null || code === "") return { kind: "none" };
    const typeText = labelText(type?.labelKey) || code;
    const matchedText = (si: number | null) =>
      si === null
        ? t("admin.mock.try.entryDefault", { type: typeText })
        : t("admin.mock.try.entryScenario", { n: si + 1, type: typeText });
    if (mode === "pick") {
      const [riText, siText] = picked.split(":");
      const entry = mock.sources[sourceId]?.responses[Number(riText)];
      if (entry === undefined) return { kind: "none" };
      const si = siText === "d" || siText === undefined ? null : Number(siText);
      const s = si === null ? undefined : entry.scenarios[si];
      if (s?.behavior !== undefined)
        return {
          kind: "behavior",
          status: BEHAVIOR_STATUS[s.behavior],
          matched: matchedText(si),
          result: resultOf(s),
        };
      // The values the plan would hand part 0 for a query that reaches this entry: the response's
      // type values (a typed response answers only a query carrying them) and the scenario's own
      // trigger values, through the form engine, so a rule-narrowed card wins here as it would for
      // that query.
      const { values } = formMatchOf(
        config,
        code,
        triggerInput({ ...(entry.types ?? {}), ...(s?.when ?? {}) }),
        Date.now(),
      );
      return {
        kind: "respond",
        payload: s?.respond ?? entry.default,
        matched: matchedText(si),
        result: resultOf(s ?? entry.default),
        values,
      };
    }
    const { typeValues, values } = formMatchOf(config, code, typed, Date.now());
    const match = matchMockScenario(mock, sourceId, { queryType: code, typeValues, values });
    if (match === null) return { kind: "none" };
    const matched = matchedText(match.scenarioIndex);
    const answered = mock.sources[sourceId]?.responses[match.responseIndex];
    if (answered === undefined) return { kind: "none" };
    const result = resultOf(
      (match.scenarioIndex === null ? undefined : answered.scenarios[match.scenarioIndex]) ??
        answered.default,
    );
    return match.outcome.kind === "behavior"
      ? { kind: "behavior", status: BEHAVIOR_STATUS[match.outcome.behavior], matched, result }
      : { kind: "respond", payload: match.outcome.payload, matched, result, values };
  }, [mock, config, code, type, labelText, mode, picked, sourceId, typed, t]);

  const rendered = useRenderedCard(config, {
    code,
    sourceId,
    persona,
    payload: answer.kind === "respond" ? answer.payload : null,
    values: answer.kind === "respond" ? answer.values : NO_VALUES,
  });

  const used = rendered?.mapped.mappingIndex;
  const usedText =
    used === undefined
      ? null
      : used === null
        ? t("admin.cards.preview.noCard")
        : t(
            // With a type row or Keywords and severity selected there is no "this card" to compare.
            cardIndex === null
              ? "admin.cards.preview.usedCard"
              : used === cardIndex
                ? "admin.cards.preview.thisCard"
                : "admin.cards.preview.otherCard",
            {
              name: cardName(asObjects(doc.responseMappings)[used]),
              id: str(asObjects(doc.responseMappings)[used]?.id),
            },
          );

  return (
    <section
      className="qm-admin__preview qm-preview qm-preview--builder"
      aria-labelledby={headingId}
    >
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
            <ValuesSeg
              label={t("admin.cards.preview.values")}
              name={`${uid}-mode`}
              mode={mode}
              onChange={setMode}
              names={{ pick: t("admin.cards.preview.pick"), type: t("admin.cards.preview.type") }}
            />
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
                        setTypedByType((all) => ({
                          ...all,
                          [code]: { ...all[code], [key]: value },
                        }));
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
                <OutcomeRow result={answer.result} which={answer.matched} />
                <div
                  className={
                    persona === "officer"
                      ? "qm-preview__panel qm-layout--mobile-unit"
                      : "qm-preview__panel qm-preview__panel--dispatch"
                  }
                >
                  {answer.kind === "behavior" ? (
                    <BehaviorLine
                      source={sourceName(sourceId)}
                      status={answer.status}
                      translator={translator}
                    />
                  ) : rendered === null ? null : (
                    <RenderedCard
                      rendered={rendered}
                      config={config}
                      heading={sourceName(sourceId)}
                      translator={translator}
                      view={view}
                      onToggleView={setView}
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
