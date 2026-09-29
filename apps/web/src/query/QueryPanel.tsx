import { resolveShortcuts } from "@querymodule/core/config";
import {
  formErrorsId,
  formLevelErrors,
  QueryForm,
  QueryTypeSelect,
  QuickAccessBar,
  ShortcutSheet,
  SourceCheckboxes,
  SubmitButton,
  useShortcutAction,
} from "@querymodule/web-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { type ReadyQueryPanel, useQueryPanel } from "./use-query-panel.js";

const ID_PREFIX = "qp";
const QUICK_TYPE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Registers one shortcut handler; a component so the nine quickType hooks are not a loop. */
function PanelShortcut({ action, run }: { action: string; run: () => void }) {
  useShortcutAction(action, run);
  return null;
}

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
  const quickCodes = config.quickAccess.filter((code) => typeCodes.includes(code));
  const [sheetOpen, setSheetOpen] = useState(false);
  const bindings = useMemo(() => resolveShortcuts(config.shortcuts), [config]);
  return (
    <>
      {QUICK_TYPE_SLOTS.map((n) => (
        <PanelShortcut
          key={n}
          action={`quickType${n}`}
          run={() => {
            const code = quickCodes[n - 1];
            if (code !== undefined) panel.selectQueryType(code);
          }}
        />
      ))}
      <PanelShortcut
        action="submit"
        run={() => panel.formContainerRef.current?.querySelector("form")?.requestSubmit()}
      />
      <PanelShortcut
        action="goPanel"
        run={() => document.getElementById(`${ID_PREFIX}-query-type`)?.focus()}
      />
      <PanelShortcut action="shortcutSheet" run={() => setSheetOpen(true)} />
      <PanelShortcut action="dismiss" run={() => setSheetOpen(false)} />
      <ShortcutSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        bindings={bindings}
        t={t}
      />
      <QuickAccessBar
        codes={quickCodes}
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
          <SubmitButton
            id={`${ID_PREFIX}-submit`}
            reason={null}
            describedBy={
              panel.showErrors && formLevelErrors(formState).length > 0
                ? formErrorsId(ID_PREFIX)
                : undefined
            }
            t={t}
          />
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
    <main
      className="qm-page qm-query-panel"
      data-shortcut-context="panel"
      aria-busy={panel.status === "loading"}
    >
      <h1 ref={headingRef} tabIndex={-1}>
        {t("app.title")}
      </h1>
      {panel.status === "loading" ? <p>{t("status.checking")}</p> : null}
      {panel.status === "error" ? (
        <>
          <p className="qm-form-error">{t("error.unavailable")}</p>
          <button
            type="button"
            className="qm-button"
            onClick={() => {
              // The focused Retry unmounts on click; keep focus on the stable heading (spec 6.4).
              headingRef.current?.focus();
              panel.retry();
            }}
          >
            {t("app.retry")}
          </button>
        </>
      ) : null}
      {panel.status === "ready" ? <ReadyPanel panel={panel} /> : null}
    </main>
  );
}
