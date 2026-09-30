import type { DraftStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { resolveShortcuts } from "@querymodule/core/config";
import {
  ActionBar,
  blockedErrorCount,
  CommandEcho,
  fieldErrorMessages,
  formErrorsId,
  formLevelErrors,
  ModeSeg,
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
import { useShortcutSheet } from "../app/shortcut-sheet-context.js";
import { isDataField } from "./data-field.js";
import { formToTerminal } from "./form-to-terminal.js";
import { RequestsPane } from "./RequestsPane.js";
import { type PanelViewMode, type ReadyQueryPanel, useQueryPanel } from "./use-query-panel.js";
import { useTerminal } from "./use-terminal.js";

const QUICK_TYPE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** "Alt+Digit1" as aria-keyshortcuts writes it ("Alt+1"); other keys pass through unchanged. */
function ariaKeyShortcut(keys: string): string {
  return keys.replace(/(^|\+)(?:Digit|Key)(?=[0-9A-Z]$)/g, "$1");
}

/** The aria-keyshortcuts of quick-access button `index`, only where quickType(index+1) is bound. */
function quickShortcut(
  bindings: ReturnType<typeof resolveShortcuts>,
  index: number,
): string | undefined {
  const keys = bindings[`quickType${index + 1}`]?.[0]?.keys;
  return keys === undefined ? undefined : ariaKeyShortcut(keys);
}

/** Registers one shortcut handler; a component so the nine quickType hooks are not a loop. */
function PanelShortcut({ action, run }: { action: string; run: () => void }) {
  useShortcutAction(action, run);
  return null;
}

function ReadyPanel({
  panel,
  idPrefix,
  selectType,
  selectTypeSeq,
}: {
  panel: ReadyQueryPanel;
  idPrefix: string;
  selectType?: string | undefined;
  selectTypeSeq?: number | undefined;
}) {
  const preview = panel.mode === "preview";
  const t = useT();
  const { config, formState, queryType } = panel;
  const terminal = useTerminal(panel);
  // The host's pick (code and seq), applied through the panel's own path until the panel shows it;
  // only then is it settled, so the user's own clicks in the preview win until the host picks again
  // (a new code or a new seq). Not settled while unknown (the config may gain the type) or while the
  // fallback for a removed type (use-query-panel, a parent effect that runs after this one) moves the
  // panel elsewhere. `terminal` is a new object each render: the settled ref, not the dependency
  // list, keeps this to one pick.
  const pickKey = selectType === undefined ? undefined : `${selectType}\u0000${selectTypeSeq ?? 0}`;
  const settledPick = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectType === undefined || pickKey === settledPick.current) {
      settledPick.current = pickKey;
      return;
    }
    if (!config.queryTypes.some((q) => q.code === selectType)) return;
    if (queryType === selectType) {
      settledPick.current = pickKey;
      return;
    }
    terminal.selectType(selectType);
  }, [selectType, pickKey, queryType, config, terminal]);
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
          {
            inputFormats: f.inputFormats,
            numberKind: f.numberKind,
            maxLength: f.maxLength,
            data: isDataField(f),
          },
        ]),
      ),
    [config, queryType],
  );
  // The command the form is building, live (spec 4.4): the core formatter over the current draft.
  // Focus on a revealed field clears its Shown tag (the field has been seen).
  const { formContainerRef, dismissRevealed } = panel;
  useEffect(() => {
    const container = formContainerRef.current;
    if (container === null) return;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      const key = target?.closest<HTMLElement>("[data-field-key]")?.dataset.fieldKey;
      if (key !== undefined) dismissRevealed(key);
    };
    container.addEventListener("focusin", onFocusIn);
    return () => container.removeEventListener("focusin", onFocusIn);
  }, [formContainerRef, dismissRevealed]);
  const echo = useMemo(
    () => formToTerminal(config, queryType, panel.values, panel.evaluatedAt).text,
    [config, queryType, panel.values, panel.evaluatedAt],
  );
  const timeoutOf = (sourceId: string): string | undefined => {
    const ms = config.sources.find((x) => x.id === sourceId)?.timeoutMs;
    return ms === undefined
      ? undefined
      : t("form.timeoutSeconds", { seconds: Math.round(ms / 1000) });
  };
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
  const blockedCount = panel.showErrors ? blockedErrorCount(formState) : 0;
  const [sheetOpen, setSheetOpen] = useState(false);
  // The live panel offers its sheet to the account menu ("Keyboard shortcuts"); preview never does.
  const { register: registerSheet } = useShortcutSheet();
  useEffect(() => {
    if (preview) return;
    return registerSheet(() => setSheetOpen(true));
  }, [preview, registerSheet]);
  const bindings = useMemo(() => resolveShortcuts(config.shortcuts), [config]);
  const firstQuick = quickShortcut(bindings, 0);
  const lastQuick = quickShortcut(bindings, quickCodes.length - 1);
  const quickHint =
    preview || firstQuick === undefined || lastQuick === undefined || quickCodes.length < 2
      ? undefined
      : t("form.quickAccessHint", { first: firstQuick, last: lastQuick });
  return (
    <>
      {/* Preview registers no global shortcuts and has no sheet: the host page keeps its own. */}
      {preview ? null : (
        <>
          {QUICK_TYPE_SLOTS.map((n) => (
            <PanelShortcut
              key={n}
              action={`quickType${n}`}
              run={() => {
                const code = quickCodes[n - 1];
                if (code !== undefined) terminal.selectType(code, { focus: true });
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
                document.getElementById(`${idPrefix}-query-type`)
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
        </>
      )}
      <div className="qm-panel-head">
        <h2>{t("panel.title", { type: labelOfType(queryType) })}</h2>
        <ModeSeg
          legend={t("mode.label")}
          formLabel={t("mode.form")}
          terminalLabel={t("mode.terminal")}
          terminal={terminal.mode === "terminal"}
          onSelect={() => terminal.toggle()}
        />
      </div>
      <QuickAccessBar
        codes={quickCodes}
        current={queryType}
        labelOf={labelOfType}
        onSelect={terminal.selectType}
        shortcutOf={preview ? undefined : (_code, index) => quickShortcut(bindings, index)}
        hint={quickHint}
        t={t}
      />
      {selectCodes.length === 0 ? null : (
        <QueryTypeSelect
          id={`${idPrefix}-query-type`}
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
      <div ref={panel.formContainerRef} className="qm-panel__body">
        {terminal.mode === "terminal" ? (
          <TerminalInput
            id={`${idPrefix}-terminal`}
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
              timeoutOf={timeoutOf}
              onChange={panel.setSources}
              idPrefix={idPrefix}
              t={t}
            />
            <ActionBar
              clearLabel={t("form.clear")}
              onClear={terminal.clear}
              status={
                terminal.errors.length > 0
                  ? t("terminal.problems", { count: terminal.errors.length })
                  : ""
              }
            >
              <SubmitButton
                id={`${idPrefix}-submit`}
                reason={panel.submitReason}
                keyHint={t("form.submitKey")}
                t={t}
              />
            </ActionBar>
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
              idPrefix={idPrefix}
            />
            <CommandEcho
              text={echo}
              label={t("echo.label")}
              actionLabel={t("echo.edit")}
              onEdit={() => terminal.toggle({ focus: true })}
            />
            <QueryForm
              key={queryType}
              formState={formState}
              values={panel.values}
              fieldConfig={fieldConfig}
              showErrors={panel.showErrors}
              onChange={panel.setValue}
              onSubmitAttempt={panel.onSubmitAttempt}
              t={t}
              idPrefix={idPrefix}
              excludeKeys={typeFieldKeys}
              revealed={panel.revealed}
            >
              <SourceCheckboxes
                sources={formState.sources}
                checked={panel.checkedSources}
                labelOf={labelOfSource}
                timeoutOf={timeoutOf}
                onChange={panel.setSources}
                idPrefix={idPrefix}
                t={t}
              />
              <ActionBar
                clearLabel={t("form.clear")}
                onClear={terminal.clear}
                status={
                  blockedCount > 0 ? t("form.fieldsNeedAttention", { count: blockedCount }) : ""
                }
              >
                <SubmitButton
                  id={`${idPrefix}-submit`}
                  reason={panel.submitReason}
                  describedBy={
                    panel.showErrors && formLevelErrors(formState).length > 0
                      ? formErrorsId(idPrefix)
                      : undefined
                  }
                  keyHint={t("form.submitKey")}
                  t={t}
                />
              </ActionBar>
            </QueryForm>
          </>
        )}
      </div>
    </>
  );
}

export interface QueryPanelViewProps {
  /** Live: from GET /api/v1/config. Preview: the builder's draft through toClientSiteConfig. */
  config: ClientSiteConfig;
  /** Live: services.drafts. Preview: a private createDraftStore() owned by the preview. */
  drafts: DraftStore;
  /**
   * Preview: submit is aria-disabled with the visible reason "Preview", nothing is ever sent and
   * no global shortcut is registered. The private draft store is reset when the view unmounts.
   */
  mode: PanelViewMode;
  /** Two panels on one page never share ids. */
  idPrefix: string;
  /** Live only: the config changed under a submit; the owner refetches it. */
  onConfigChanged?: () => void | Promise<void>;
  /**
   * Live only: shows this session's requests beside the panel ("list", dispatch) or the latest one
   * below it ("last", officer). Omitted, the view is the panel alone (the builder's preview).
   */
  requests?: "list" | "last";
  /**
   * Preview only: the host (the builder) picks this query type. Each change selects it through the
   * panel's own path, as a quick-access click would (terminal text merged and re-derived, shown
   * errors reset, other types' values kept). Focus never moves. A code the config does not have is
   * applied once it does. The same code again is a no-op (the user's own click in between wins)
   * unless `selectTypeSeq` changes. In terminal mode a half-typed command that does not parse is
   * replaced, exactly as on a quick-access click.
   */
  selectType?: string;
  /**
   * Preview only: a change re-applies `selectType` even when the code is unchanged (the builder's
   * tree picks the same type again after the user clicked another in the preview). A no-op when the
   * panel already shows that type.
   */
  selectTypeSeq?: number;
}

/** The one renderer of the query panel, from config alone (BR-001; ADR-0011 core loop). */
export function QueryPanelView({
  config,
  drafts,
  mode,
  idPrefix,
  onConfigChanged,
  requests,
  selectType,
  selectTypeSeq,
}: QueryPanelViewProps) {
  const panel = useQueryPanel({ config, drafts, mode, onConfigChanged });
  // The preview's store is private and memory-only; it goes with the view (ADR-0011).
  useEffect(
    () => () => {
      if (mode === "preview") drafts.getState().reset();
    },
    [mode, drafts],
  );
  if (panel === null) return null;
  const ready = (
    <ReadyPanel
      panel={panel}
      idPrefix={idPrefix}
      selectType={mode === "preview" ? selectType : undefined}
      selectTypeSeq={mode === "preview" ? selectTypeSeq : undefined}
    />
  );
  if (requests === undefined) return ready;
  return (
    <div className="qm-panes">
      <div className="qm-panes__panel">{ready}</div>
      <RequestsPane config={panel.config} variant={requests} />
    </div>
  );
}
