import {
  QueryForm,
  QueryTypeSelect,
  QuickAccessBar,
  SourceCheckboxes,
  SubmitButton,
} from "@querymodule/web-ui";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../app/i18n-context.js";
import { type ReadyQueryPanel, useQueryPanel } from "./use-query-panel.js";

const ID_PREFIX = "qp";

function ReadyPanel({ panel }: { panel: ReadyQueryPanel }) {
  const t = useT();
  const { config, formState, queryType } = panel;
  const labelOfType = (code: string): string => {
    const labelKey = config.queryTypes.find((q) => q.code === code)?.labelKey;
    return labelKey === undefined ? code : t(labelKey);
  };
  const labelOfSource = (sourceId: string): string => {
    const labelKey = config.sources.find((s) => s.id === sourceId)?.labelKey;
    return labelKey === undefined ? sourceId : t(labelKey);
  };
  const fieldConfig = useMemo(
    () =>
      new Map(
        (config.queryTypes.find((q) => q.code === queryType)?.fields ?? []).map((f) => [
          f.key,
          { inputFormats: f.inputFormats, numberKind: f.numberKind },
        ]),
      ),
    [config, queryType],
  );
  const typeCodes = config.queryTypes.map((q) => q.code);
  return (
    <>
      <QuickAccessBar
        codes={config.quickAccess.filter((code) => typeCodes.includes(code))}
        current={queryType}
        labelOf={labelOfType}
        onSelect={panel.selectQueryType}
        t={t}
      />
      <QueryTypeSelect
        id={`${ID_PREFIX}-query-type`}
        value={queryType}
        options={typeCodes.map((code) => ({ code, label: labelOfType(code) }))}
        onChange={panel.selectQueryType}
        t={t}
      />
      <div ref={panel.formContainerRef}>
        <QueryForm
          formState={formState}
          values={panel.values}
          fieldConfig={fieldConfig}
          showErrors={panel.showErrors}
          onChange={panel.setValue}
          onSubmitAttempt={panel.onSubmitAttempt}
          t={t}
          idPrefix={ID_PREFIX}
        >
          <SourceCheckboxes
            sources={formState.sources}
            checked={panel.checkedSources}
            labelOf={labelOfSource}
            onChange={panel.setSources}
            idPrefix={ID_PREFIX}
            t={t}
          />
          <SubmitButton id={`${ID_PREFIX}-submit`} reason={null} t={t} />
        </QueryForm>
      </div>
    </>
  );
}

/** The main screen (spec 6.2): rendered from GET /api/v1/config, no per-query-type code (BR-001). */
export function QueryPanel() {
  const t = useT();
  const panel = useQueryPanel();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main className="qm-page qm-query-panel" aria-busy={panel.status === "loading"}>
      <h1 ref={headingRef} tabIndex={-1}>
        {t("app.title")}
      </h1>
      {panel.status === "loading" ? <p>{t("status.checking")}</p> : null}
      {panel.status === "error" ? (
        <>
          <p role="alert" className="qm-form-error">
            {t("error.unavailable")}
          </p>
          <button type="button" className="qm-button" onClick={panel.retry}>
            {t("app.retry")}
          </button>
        </>
      ) : null}
      {panel.status === "ready" ? <ReadyPanel panel={panel} /> : null}
    </main>
  );
}
