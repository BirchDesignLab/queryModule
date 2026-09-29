import { resolveShortcuts } from "@querymodule/core/config";
import {
  AckStatus,
  fieldErrorMessages,
  formErrorsId,
  formLevelErrors,
  ModeToggle,
  QueryForm,
  QueryTypeSelect,
  QuickAccessBar,
  ShortcutSheet,
  SourceCheckboxes,
  SubmitButton,
  TerminalInput,
  TypeFieldBar,
  useShortcutAction,
} from "@querymodule/web-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { type ReadyQueryPanel, useQueryPanel } from "./use-query-panel.js";
import { useTerminal } from "./use-terminal.js";

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
  const terminal = useTerminal(panel);
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
  // Types with a button are picked there; the select lists the rest (ADR-0010). With no buttons it
  // lists every type under its original label.
  const otherCodes = typeCodes.filter((code) => !quickCodes.includes(code));
  const selectCodes = quickCodes.length === 0 ? typeCodes : otherCodes;
  const typeFields = formState.fields.filter((f) => f.role === "type" && f.visible);
  const typeFieldKeys = new Set(typeFields.map((f) => f.key));
  const errorMessages = panel.showErrors
    ? fieldErrorMessages(formState, t)
    : new Map<string, string>();
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
            if (code !== undefined) terminal.selectType(code);
          }}
        />
      ))}
      <PanelShortcut
        action="submit"
        run={() => panel.formContainerRef.current?.querySelector("form")?.requestSubmit()}
      />
      <PanelShortcut action="focusTerminal" run={terminal.focusTerminal} />
      <PanelShortcut action="toggleMode" run={() => terminal.toggle({ focus: true })} />
      <PanelShortcut
        action="goPanel"
        run={() =>
          (
            document.querySelector<HTMLElement>(".qm-quick-access [aria-pressed='true']") ??
            document.getElementById(`${ID_PREFIX}-query-type`)
          )?.focus()
        }
      />
      <PanelShortcut action="shortcutSheet" run={() => setSheetOpen(true)} />
      {/* Only while the sheet is open: a standing dismiss handler would swallow every Escape. */}
      {sheetOpen ? <PanelShortcut action="dismiss" run={() => setSheetOpen(false)} /> : null}
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
        onSelect={terminal.selectType}
        t={t}
      />
      {selectCodes.length === 0 ? null : (
        <QueryTypeSelect
          id={`${ID_PREFIX}-query-type`}
          labelKey={quickCodes.length === 0 ? "form.queryType" : "form.otherQueryTypes"}
          emptyOption={quickCodes.length > 0}
          value={quickCodes.length > 0 && quickCodes.includes(queryType) ? "" : queryType}
          options={selectCodes.map((code) => ({ code, label: labelOfType(code) }))}
          onChange={(code) => {
            // The empty option means "none of these": keep the current type.
            if (code !== "") terminal.selectType(code);
          }}
          t={t}
        />
      )}
      <ModeToggle
        pressed={terminal.mode === "terminal"}
        label={t("mode.terminal")}
        onToggle={() => terminal.toggle()}
      />
      <div ref={panel.formContainerRef}>
        {terminal.mode === "terminal" ? (
          <TerminalInput
            id={`${ID_PREFIX}-terminal`}
            label={t("terminal.label")}
            description={t("terminal.description", { delimiter: config.terminal.delimiter })}
            value={terminal.text}
            onChange={terminal.setText}
            onSubmit={terminal.submitTerminal}
            errors={terminal.errors}
            unshown={terminal.unshown}
            errorsLabel={t("terminal.errorsLabel")}
            inputRef={terminal.inputRef}
          >
            <SourceCheckboxes
              sources={formState.sources}
              checked={panel.checkedSources}
              labelOf={labelOfSource}
              onChange={panel.setSources}
              idPrefix={ID_PREFIX}
              t={t}
            />
            <SubmitButton id={`${ID_PREFIX}-submit`} reason={panel.submitReason} t={t} />
          </TerminalInput>
        ) : (
          <>
            <TypeFieldBar
              fields={typeFields}
              values={panel.values}
              fieldConfig={fieldConfig}
              showErrors={panel.showErrors}
              errors={errorMessages}
              onChange={panel.setValue}
              t={t}
              idPrefix={ID_PREFIX}
            />
            <QueryForm
              formState={formState}
              values={panel.values}
              fieldConfig={fieldConfig}
              showErrors={panel.showErrors}
              onChange={panel.setValue}
              onSubmitAttempt={panel.onSubmitAttempt}
              t={t}
              idPrefix={ID_PREFIX}
              excludeKeys={typeFieldKeys}
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
                reason={panel.submitReason}
                describedBy={
                  panel.showErrors && formLevelErrors(formState).length > 0
                    ? formErrorsId(ID_PREFIX)
                    : undefined
                }
                t={t}
              />
            </QueryForm>
          </>
        )}
      </div>
      <AckStatus
        ack={
          panel.lastAck === null
            ? null
            : {
                queryTypeLabel: labelOfType(panel.lastAck.queryType),
                correlationId: panel.lastAck.response.correlationId,
                acknowledgedAt: panel.lastAck.response.acknowledgedAt,
                skipped: panel.lastAck.response.parts
                  .filter((part) => part.status === "skipped")
                  .map((part) => ({
                    queryTypeLabel: labelOfType(part.queryType),
                    // The 202 carries no skip reason; claim none (#382 A1).
                    reasonText: null,
                  })),
              }
        }
        onCopy={panel.copyReference}
        t={t}
      />
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
