import type { MockFile, MockScenario } from "@querymodule/core/contracts";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext } from "./checks.js";
import { Sect } from "./controls.js";
import { MockPayload } from "./MockPayload.js";
import { requestMockFocus, useMockEnv } from "./mock-context.js";
import {
  addTrigger,
  MOCK_RESULTS,
  type MockResult,
  mockPointer,
  NEW_RECORD,
  removeTrigger,
  resultOf,
  setTriggerField,
  setTriggerValue,
  withDefaultResult,
  withResult,
} from "./mock-edit.js";
import {
  addScenario,
  moveScenario,
  removeScenario,
  setResponseDefault,
  setResponseTypes,
  updateScenario,
} from "./mock-model.js";
import { SelectionContext } from "./selection.js";

/**
 * One response of a mock source (Task 3a, #549, CFG-2; spec 5.4): which query it answers (fixed once
 * it exists, Q1), the default answer, and the scenarios in match order (first match wins).
 */

const RESULT_KEY: Record<MockResult, string> = {
  record: "record",
  norecord: "noRecord",
  error: "error",
  timeout: "timeout",
  creds: "creds",
};

function ResultRadios({
  name,
  value,
  options,
  label,
  onChange,
}: {
  name: string;
  value: MockResult;
  options: readonly MockResult[];
  label: string;
  onChange(result: MockResult): void;
}) {
  const t = useT();
  const labelId = useId();
  return (
    <div className="qm-mock__radios" role="radiogroup" aria-labelledby={labelId}>
      <span className="qm-mock__label" id={labelId}>
        {label}
      </span>
      {options.map((result) => (
        <label key={result} className="qm-mock__radio">
          <input
            type="radio"
            name={name}
            checked={value === result}
            onChange={() => onChange(result)}
          />{" "}
          <b>{t(`admin.mock.result.${RESULT_KEY[result]}`)}</b>{" "}
          <span>{t(`admin.mock.result.${RESULT_KEY[result]}.effect`)}</span>
        </label>
      ))}
    </div>
  );
}

function Scenario({
  sourceId,
  response,
  index,
  count,
  scenario,
  queryType,
  open,
  setOpen,
  respondTo,
}: {
  sourceId: string;
  response: number;
  index: number;
  count: number;
  scenario: MockScenario;
  queryType: string;
  open: boolean;
  setOpen(open: boolean): void;
  respondTo: MockResponseActions;
}) {
  const t = useT();
  const env = useMockEnv();
  const checks = useContext(ChecksContext);
  const uid = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const n = index + 1;
  const at = { sourceId, response, scenario: index };
  const base = `${mockPointer.response(sourceId, response)}/scenarios/${index}`;
  const errors = checks.issues.filter(
    (i) => i.level === "error" && i.pointer.startsWith(`${base}/`),
  ).length;
  const type = env.site.queryTypes.find((q) => q.code === queryType);
  const fieldKeys = [
    ...(type?.typeField === null || type?.typeField === undefined ? [] : [type.typeField.key]),
    ...(type?.fields.map((f) => f.key) ?? []).filter((k) => k !== type?.typeField?.key),
  ];
  const result = resultOf(scenario);
  const write = (next: MockScenario, coalesce?: string) =>
    env.edit((m) => updateScenario(m, at, next), coalesce === undefined ? undefined : { coalesce });
  const triggers = Object.entries(scenario.when);
  const summary = triggers.length
    ? triggers
        .map(([field, value]) =>
          t("admin.mock.summary.when", {
            field: env.fieldName(queryType, field),
            value: String(value) === "" ? t("admin.mock.summary.blank") : String(value),
          }),
        )
        .join(t("admin.mock.summary.and"))
    : t("admin.mock.summary.noTrigger");
  const endButton = (kind: "up" | "down") => {
    const target = kind === "up" ? index - 1 : index + 1;
    const blocked = target < 0 || target >= count;
    return (
      <button
        type="button"
        className="qm-button qm-button--ghost qm-mock__icon"
        aria-disabled={blocked ? "true" : undefined}
        aria-label={t(kind === "up" ? "admin.mock.moveUp" : "admin.mock.moveDown", { n })}
        onClick={() => {
          if (blocked) return;
          respondTo.move(index, target);
          env.announce(t("admin.mock.moved", { n, position: target + 1 }));
        }}
      >
        <span aria-hidden="true">{kind === "up" ? "↑" : "↓"}</span>
      </button>
    );
  };
  return (
    <li className={`qm-mock__scenario${errors > 0 ? " qm-mock__scenario--error" : ""}`}>
      <fieldset
        className="qm-mock__scenario-box"
        aria-labelledby={`${uid}-h`}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !open) return;
          e.stopPropagation();
          setOpen(false);
          editRef.current?.focus();
        }}
      >
        <div className="qm-mock__scenario-head">
          <h5 id={`${uid}-h`}>{t("admin.mock.scenario", { n })}</h5>
          <span className="qm-mock__summary">
            {t("admin.mock.summary", {
              when: summary,
              result: t(`admin.mock.result.${RESULT_KEY[result]}`).toLowerCase(),
            })}
            {errors > 0 && (
              <>
                {" "}
                <span className="qm-badge qm-badge--critical" aria-hidden="true">
                  {errors}
                </span>
                <VisuallyHidden>
                  ,{" "}
                  {t(errors === 1 ? "admin.issues.error" : "admin.issues.errors", {
                    count: errors,
                  })}
                </VisuallyHidden>
              </>
            )}
          </span>
          <span className="qm-mock__scenario-tools">
            <button
              ref={editRef}
              type="button"
              className="qm-button qm-button--ghost"
              data-owner={`${base}`}
              data-role="edit"
              aria-expanded={open}
              aria-controls={`${uid}-b`}
              onClick={() => setOpen(!open)}
            >
              {t(open ? "admin.mock.close" : "admin.mock.edit")}{" "}
              <VisuallyHidden>{t("admin.mock.scenarioLower", { n })}</VisuallyHidden>
            </button>
            {endButton("up")}
            {endButton("down")}
            <button
              type="button"
              className="qm-button qm-button--ghost qm-mock__icon"
              aria-label={t("admin.mock.removeScenario", { n })}
              onClick={() => respondTo.remove(index)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        </div>
        {open && (
          <div className="qm-mock__scenario-body" id={`${uid}-b`}>
            <div className="qm-mock__triggers">
              <span className="qm-mock__label">{t("admin.mock.triggers")}</span>{" "}
              <span className="qm-sect__hint">{t("admin.mock.triggers.hint")}</span>
              {triggers.map(([field, value], w) => {
                const pointer = `${base}/when/${field.replaceAll("~", "~0").replaceAll("/", "~1")}`;
                const empty = (checks.byPointer.get(pointer) ?? []).length > 0;
                const options = fieldKeys.includes(field) ? fieldKeys : [...fieldKeys, field];
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a trigger is its position; the field is editable
                  <div key={w} className="qm-mock__trigger">
                    <label htmlFor={`${uid}-w${w}-f`}>
                      <VisuallyHidden>{t("admin.mock.triggerField", { n: w + 1 })}</VisuallyHidden>
                    </label>
                    <select
                      id={`${uid}-w${w}-f`}
                      className="qm-field__input"
                      value={field}
                      onChange={(e) =>
                        write({
                          ...scenario,
                          when: setTriggerField(scenario.when, field, e.target.value),
                        })
                      }
                    >
                      {options.map((k) => (
                        <option key={k} value={k}>
                          {env.fieldName(queryType, k)}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden="true">{t("admin.mock.is")}</span>
                    <label htmlFor={`${uid}-w${w}-v`}>
                      <VisuallyHidden>{t("admin.mock.triggerValue", { n: w + 1 })}</VisuallyHidden>
                    </label>
                    <input
                      id={`${uid}-w${w}-v`}
                      className="qm-field__input qm-mock__mono"
                      data-owner={base}
                      data-role={w === 0 ? "trigger" : undefined}
                      value={String(value)}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={empty || undefined}
                      aria-describedby={empty ? `${uid}-w${w}-e` : undefined}
                      onChange={(e) =>
                        write(
                          {
                            ...scenario,
                            when: setTriggerValue(scenario.when, field, e.target.value),
                          },
                          `${base}/${field}`,
                        )
                      }
                    />
                    <button
                      type="button"
                      className="qm-button qm-button--ghost qm-mock__icon"
                      aria-disabled={triggers.length === 1 ? "true" : undefined}
                      aria-label={t("admin.mock.removeTrigger", { n: w + 1 })}
                      onClick={() => {
                        if (triggers.length > 1)
                          write({ ...scenario, when: removeTrigger(scenario.when, field) });
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                    {empty && (
                      <p className="qm-mock__error" id={`${uid}-w${w}-e`}>
                        <span aria-hidden="true">⚠</span>
                        <span data-issue-pointer={pointer}>
                          {t("admin.mock.triggerValueEmpty")}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
              {triggers.length === 0 && (
                <p className="qm-mock__error" id={`${uid}-none`}>
                  <span aria-hidden="true">⚠</span>
                  <span>{t("admin.mock.triggerMissing")}</span>
                </p>
              )}
              <button
                type="button"
                className="qm-button qm-button--ghost"
                onClick={() => write({ ...scenario, when: addTrigger(scenario.when, fieldKeys) })}
              >
                {t("admin.mock.addTrigger")}
              </button>
            </div>
            <ResultRadios
              name={`${uid}-result`}
              value={result}
              options={MOCK_RESULTS}
              label={t("admin.mock.result")}
              onChange={(next) => write(withResult(scenario, next))}
            />
            {result === "record" && scenario.respond !== undefined && (
              <MockPayload
                base={`${base}/respond`}
                payload={scenario.respond}
                title={t("admin.mock.payload")}
                hint={t("admin.mock.payload.hint")}
                onChange={(next, coalesce) => write({ ...scenario, respond: next }, coalesce)}
              />
            )}
          </div>
        )}
      </fieldset>
    </li>
  );
}

interface MockResponseActions {
  move(from: number, to: number): void;
  remove(index: number): void;
}

export function MockResponse({ sourceId, index }: { sourceId: string; index: number }) {
  const t = useT();
  const env = useMockEnv();
  const source = env.mock.sources[sourceId];
  const response = source?.responses[index];
  // Which scenarios are open, by position; a move or a remove carries the state along.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  // The issue button goes to a control inside a scenario: that scenario opens to show it.
  const { focus } = useContext(SelectionContext);
  const here = `${mockPointer.response(sourceId, index)}/scenarios/`;
  const focusScenario = focus?.startsWith(here)
    ? Number(focus.slice(here.length).split("/")[0])
    : null;
  useEffect(() => {
    if (focusScenario !== null && Number.isInteger(focusScenario))
      setOpen((cur) => (cur.has(focusScenario) ? cur : new Set([...cur, focusScenario])));
  }, [focusScenario]);
  if (source === undefined || response === undefined) return <p>{t("admin.mock.noResponse")}</p>;
  const type = env.site.queryTypes.find((q) => q.code === response.queryType);
  const count = response.scenarios.length;
  const base = mockPointer.response(sourceId, index);
  const toggle = (k: number, to: boolean) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (to) next.add(k);
      else next.delete(k);
      return next;
    });
  const typeCode = type?.typeField === null || type === undefined ? null : type.typeField;
  const currentCode = typeCode === null ? "" : (response.types?.[typeCode.key] ?? "");
  const defaultResult = resultOf(response.default);
  const actions: MockResponseActions = {
    move(from, to) {
      env.edit((m: MockFile) => moveScenario(m, { sourceId, response: index, scenario: from }, to));
      // Where each open scenario sits after the move.
      const after = (k: number): number =>
        k === from
          ? to
          : from < to && k > from && k <= to
            ? k - 1
            : to < from && k >= to && k < from
              ? k + 1
              : k;
      setOpen((cur) => new Set([...cur].map(after)));
    },
    remove(at) {
      const left = count - 1;
      env.edit((m: MockFile) => removeScenario(m, { sourceId, response: index, scenario: at }));
      env.announce(
        t(left === 1 ? "admin.mock.removed.one" : "admin.mock.removed.many", {
          n: at + 1,
          count: left,
        }),
      );
      setOpen((cur) => new Set([...cur].filter((k) => k !== at).map((k) => (k > at ? k - 1 : k))));
      // Focus never drops to the page: the next scenario's Edit, else the one before, else Add.
      const nextIndex = at < left ? at : left - 1;
      if (left === 0) requestMockFocus(`${base}/add`, "add");
      else requestMockFocus(`${base}/scenarios/${nextIndex}`, "edit");
    },
  };
  const scenarioPrefix = `${base}/scenarios`;
  return (
    <>
      <p className="qm-mock__lead">
        {t("admin.mock.response.lead", {
          source: env.sourceName(sourceId),
          type: env.typeName(response.queryType),
          min: source.latencyMs[0],
          max: source.latencyMs[1],
        })}
      </p>
      <Sect
        title={t("admin.mock.matches")}
        hint={t(typeCode === null ? "admin.mock.matches.noType" : "admin.mock.matches.hint", {
          type: env.typeName(response.queryType),
        })}
      >
        <div className="qm-mock__two">
          <div>
            <label htmlFor={`${base}-qt`}>{t("admin.mock.queryType")}</label>{" "}
            <input
              id={`${base}-qt`}
              className="qm-field__input"
              readOnly
              value={`${env.typeName(response.queryType)} (${response.queryType})`}
              aria-describedby={`${base}-qt-hint`}
            />
            <p className="qm-sect__hint" id={`${base}-qt-hint`}>
              {t("admin.mock.queryType.fixed")}
            </p>
          </div>
          {typeCode !== null && (
            <div>
              <label htmlFor={`${base}-tf`}>
                {env.fieldName(response.queryType, typeCode.key)}
              </label>{" "}
              <select
                id={`${base}-tf`}
                className="qm-field__input"
                value={currentCode}
                onChange={(e) =>
                  env.edit((m) =>
                    setResponseTypes(
                      m,
                      sourceId,
                      index,
                      e.target.value === "" ? undefined : { [typeCode.key]: e.target.value },
                    ),
                  )
                }
              >
                <option value="">
                  {t("admin.mock.anyType", {
                    field: env.fieldName(response.queryType, typeCode.key).toLowerCase(),
                  })}
                </option>
                {typeCode.codes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {env.codeName(c.code, response.queryType)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Sect>
      <Sect title={t("admin.mock.default")} hint={t("admin.mock.default.hint")}>
        <ResultRadios
          name={`${base}-default`}
          value={defaultResult}
          options={["norecord", "record"]}
          label={t("admin.mock.default.label")}
          onChange={(next) =>
            env.edit((m) =>
              setResponseDefault(
                m,
                sourceId,
                index,
                withDefaultResult(response.default, next as "record" | "norecord"),
              ),
            )
          }
        />
        {defaultResult === "record" && (
          <MockPayload
            base={`${base}/default`}
            payload={response.default}
            title={t("admin.mock.payload")}
            hint={t("admin.mock.payload.hint")}
            onChange={(next, coalesce) =>
              env.edit(
                (m) => setResponseDefault(m, sourceId, index, next),
                coalesce === undefined ? undefined : { coalesce },
              )
            }
          />
        )}
      </Sect>
      <Sect title={`${t("admin.mock.scenarios")} ${count}`} hint={t("admin.mock.scenarios.hint")}>
        {count === 0 ? (
          <p className="qm-sect__hint">{t("admin.mock.scenarios.none")}</p>
        ) : (
          <ol className="qm-mock__scenarios">
            {response.scenarios.map((scenario, k) => (
              <Scenario
                // Position is the identity here: scenarios have no id and the first match wins.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={k}
                sourceId={sourceId}
                response={index}
                index={k}
                count={count}
                scenario={scenario}
                queryType={response.queryType}
                open={open.has(k)}
                setOpen={(to) => toggle(k, to)}
                respondTo={actions}
              />
            ))}
          </ol>
        )}
        <button
          type="button"
          className="qm-button"
          data-owner={`${base}/add`}
          data-role="add"
          onClick={() => {
            const first = type?.fields[0]?.key ?? "";
            env.edit((m) =>
              addScenario(m, sourceId, index, {
                when: first === "" ? {} : { [first]: "" },
                respond: { ...NEW_RECORD },
              }),
            );
            env.announce(t("admin.mock.scenarioAdded", { n: count + 1 }));
            toggle(count, true);
            requestMockFocus(`${scenarioPrefix}/${count}`, "trigger");
          }}
        >
          {t("admin.mock.addScenario")}
        </button>
      </Sect>
    </>
  );
}
