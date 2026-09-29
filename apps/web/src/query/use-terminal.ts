import {
  type DraftValue,
  fromCoreDraft,
  terminalErrorText,
  toCoreDraft,
  useStore,
} from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { ValidationError } from "@querymodule/core/contracts";
import {
  checkTerminalSubmit,
  formatCommand,
  mergeDraft,
  selectCommand,
  tokenize,
} from "@querymodule/core/terminal";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import type { ReadyQueryPanel } from "./use-query-panel.js";

type Values = Readonly<Record<string, DraftValue>>;

/** Spec 4.4 Toggle, form to terminal: user values only; the fields the command cannot carry are counted. */
export function formToTerminal(
  config: ClientSiteConfig,
  queryType: string,
  values: Values,
  now: number,
): { text: string; unshown: number } {
  const draft = toCoreDraft(values);
  const cmd = selectCommand(config, queryType, draft, { now });
  if (cmd === undefined) return { text: "", unshown: 0 };
  const formatted = formatCommand(config, cmd.code, draft, { now });
  return { text: formatted.text, unshown: formatted.unshownCount };
}

/**
 * Spec 4.4 Toggle, terminal to form: merges what the command read into the draft of its own type
 * (#297 item 1); a failing command still merges what it read. Null when no command matched.
 */
export function terminalToForm(
  config: ClientSiteConfig,
  text: string,
  drafts: Readonly<Record<string, Values>>,
): { queryType: string; values: Record<string, DraftValue> } | null {
  const tokenized = tokenize(config, text);
  const { queryType } = tokenized;
  if (queryType === undefined) return null;
  const current = Object.hasOwn(drafts, queryType) ? (drafts[queryType] ?? {}) : {};
  const merged = mergeDraft(toCoreDraft(current), tokenized, config);
  return { queryType, values: fromCoreDraft(merged) };
}

export interface TerminalModel {
  mode: "form" | "terminal";
  text: string;
  setText(text: string): void;
  errors: string[];
  unshown: string | null;
  /** Switches mode; `focus` moves focus to the equivalent control (the keyboard shortcut). */
  toggle(options?: { focus?: boolean }): void;
  focusTerminal(): void;
  submitTerminal(): void;
  /** Picks a query type; in terminal mode the text is re-derived from that type's draft. */
  selectType(code: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Terminal mode of the query panel (FR-050 to FR-056, spec 4.4, 6.2, 6.4). */
export function useTerminal(panel: ReadyQueryPanel): TerminalModel {
  const { drafts, announcer } = useServices();
  const t = useT();
  const { config } = panel;
  const mode = useStore(drafts, (s) => s.mode);
  const text = useStore(drafts, (s) => s.terminalText);
  const [errors, setErrors] = useState<string[]>([]);
  const [unshown, setUnshown] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const wantFocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus follows the commit that shows the target control.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusTick and mode are the triggers
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    if (mode === "terminal") inputRef.current?.focus();
    else
      panel.formContainerRef.current
        ?.querySelector<HTMLElement>("input, select, textarea")
        ?.focus();
  }, [focusTick, mode]);

  const derive = useCallback(
    (queryType: string): void => {
      const values = drafts.getState().drafts[queryType]?.values ?? {};
      const derived = formToTerminal(config, queryType, values, Date.now());
      drafts.getState().setTerminalText(derived.text);
      setUnshown(derived.unshown);
      setErrors([]);
    },
    [config, drafts],
  );

  const enterTerminal = useCallback((): void => {
    derive(panel.queryType);
    drafts.getState().setMode("terminal");
  }, [derive, drafts, panel.queryType]);

  const requestFocus = (): void => {
    wantFocus.current = true;
    setFocusTick((n) => n + 1);
  };

  return {
    mode,
    text,
    inputRef,
    errors,
    unshown: unshown === 0 ? null : t("terminal.fieldsNotShown", { count: unshown }),
    setText(next) {
      drafts.getState().setTerminalText(next);
      setErrors([]);
    },
    toggle(options) {
      if (mode === "form") {
        enterTerminal();
      } else {
        const byType = Object.fromEntries(
          Object.entries(drafts.getState().drafts).map(([code, d]) => [code, d.values]),
        );
        const merged = terminalToForm(config, text, byType);
        if (merged !== null) {
          drafts.getState().replaceValues(merged.queryType, merged.values);
          panel.selectQueryType(merged.queryType);
        }
        setErrors([]);
        drafts.getState().setMode("form");
      }
      if (options?.focus === true) requestFocus();
    },
    focusTerminal() {
      if (mode === "form") enterTerminal();
      requestFocus();
    },
    selectType(code) {
      panel.selectQueryType(code);
      if (mode === "terminal") derive(code);
    },
    submitTerminal() {
      if (panel.submitGated()) return;
      const state = drafts.getState();
      const coreDrafts = Object.fromEntries(
        Object.entries(state.drafts).map(([code, d]) => [code, toCoreDraft(d.values)]),
      );
      const checked = checkTerminalSubmit(config, text, coreDrafts, { now: Date.now() });
      const { queryType, merged, formState } = checked;
      if (
        checked.errors.length > 0 ||
        queryType === undefined ||
        merged === undefined ||
        formState === undefined ||
        !formState.valid
      ) {
        // An invalid form state with no terminal error still shows its own errors.
        const problems: readonly ValidationError[] =
          checked.errors.length > 0 ? checked.errors : (formState?.errors ?? []);
        setErrors(
          problems.map((e) => terminalErrorText(e, { t, delimiter: config.terminal.delimiter })),
        );
        announcer.announce(t("terminal.problems", { count: problems.length }));
        // Enter keeps focus and text (FR-055); a click on Submit brings focus back to the input.
        inputRef.current?.focus();
        return;
      }
      setErrors([]);
      const values = fromCoreDraft(merged);
      state.replaceValues(queryType, values);
      panel.selectQueryType(queryType);
      const eligible = formState.sources.map((s) => s.sourceId);
      const chosen = state.drafts[queryType]?.sources ?? null;
      const sourceIds =
        chosen === null
          ? formState.sources.filter((s) => s.selectedByDefault).map((s) => s.sourceId)
          : chosen.filter((id) => eligible.includes(id));
      void panel.sendChecked({ queryType, values, sourceIds, state: formState });
    },
  };
}
