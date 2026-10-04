import {
  type DraftState,
  type DraftValue,
  fromCoreDraft,
  terminalErrorText,
  toCoreDraft,
  useStore,
} from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { ValidationError } from "@querymodule/core/contracts";
import { checkTerminalSubmit, mergeDraft, tokenize } from "@querymodule/core/terminal";
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { firstField } from "./first-field.js";
import { formToTerminal } from "./form-to-terminal.js";
import { type ReadyQueryPanel, resolveCheckedSources } from "./use-query-panel.js";

type Values = Readonly<Record<string, DraftValue>>;

/** Each query type's draft values, as the draft store holds them (the one projection of its map). */
function valuesByType(drafts: DraftState["drafts"]): Record<string, Values> {
  return Object.fromEntries(Object.entries(drafts).map(([code, d]) => [code, d.values]));
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
  /** Clears the current draft; in terminal mode the command falls back to the bare command; focus goes to the first field or the command line. */
  clear(): void;
  submitTerminal(): void;
  /**
   * Picks a query type; in terminal mode the text is re-derived from that type's draft. `focus`
   * moves focus to the type's first field, or the command line (the Alt+1..9 shortcut, spec 6.4).
   */
  selectType(code: string, options?: { focus?: boolean }): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Terminal mode of the query panel (FR-050 to FR-056, spec 4.4, 6.2, 6.4). */
export function useTerminal(panel: ReadyQueryPanel): TerminalModel {
  const { announcer } = useServices();
  const t = useT();
  const { config, drafts } = panel;
  const mode = useStore(drafts, (s) => s.mode);
  const text = useStore(drafts, (s) => s.terminalText);
  // Kept as keys and params, never as text: the wording follows the translator and the site's
  // delimiter at render (#382 T8).
  const [problems, setProblems] = useState<readonly ValidationError[]>([]);
  const [unshown, setUnshown] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const wantFocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus follows the commit that shows the target control. A layout effect, so it runs in that
  // commit: a passive mount-time run could otherwise consume wantFocus with a stale mode when a
  // shortcut fires right after the panel first paints (#382).
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusTick and mode are the triggers
  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    if (mode === "terminal") inputRef.current?.focus();
    else firstField(panel.formContainerRef.current)?.focus();
  }, [focusTick, mode]);

  const derive = useCallback(
    (queryType: string): void => {
      const values = drafts.getState().drafts[queryType]?.values ?? {};
      // The panel's own clock for its type, so "Edit as command" writes what the echo shows.
      const now = queryType === panel.queryType ? panel.evaluatedAt : Date.now();
      const derived = formToTerminal(config, queryType, values, now);
      drafts.getState().setTerminalText(derived.text);
      setUnshown(derived.unshown);
      setProblems([]);
    },
    [config, drafts, panel.queryType, panel.evaluatedAt],
  );

  const enterTerminal = useCallback((): void => {
    derive(panel.queryType);
    drafts.getState().setMode("terminal");
  }, [derive, drafts, panel.queryType]);

  /** Merges the current text into the draft of its own type (spec 4.4: nothing typed is lost). */
  const mergeText = (): { queryType: string } | null => {
    const merged = terminalToForm(config, text, valuesByType(drafts.getState().drafts));
    if (merged !== null) drafts.getState().replaceValues(merged.queryType, merged.values);
    return merged;
  };

  /** Lists errors under the input, announces the count and keeps focus there (FR-055). */
  const showProblems = (found: readonly ValidationError[]): void => {
    setProblems(found);
    announcer.announce(t("terminal.problems", { count: found.length }));
    // Enter keeps focus and text; a click on Submit brings focus back to the input.
    inputRef.current?.focus();
  };

  const requestFocus = (): void => {
    wantFocus.current = true;
    setFocusTick((n) => n + 1);
  };

  const errors = problems.map((e) =>
    terminalErrorText(e, { t, delimiter: config.terminal.delimiter }),
  );

  return {
    mode,
    text,
    inputRef,
    errors,
    unshown: unshown === 0 ? null : t("terminal.fieldsNotShown", { count: unshown }),
    setText(next) {
      drafts.getState().setTerminalText(next);
      setProblems([]);
      // The count belongs to the draft of the query type the command names, so it follows the
      // type as it is typed (#382 W3); a command that names none has nothing to count.
      const typed = tokenize(config, next).queryType;
      setUnshown(
        typed === undefined
          ? 0
          : formToTerminal(
              config,
              typed,
              drafts.getState().drafts[typed]?.values ?? {},
              typed === panel.queryType ? panel.evaluatedAt : Date.now(),
            ).unshown,
      );
    },
    toggle(options) {
      if (mode === "form") {
        enterTerminal();
      } else {
        const merged = mergeText();
        if (merged !== null) panel.selectQueryType(merged.queryType);
        setProblems([]);
        drafts.getState().setMode("form");
      }
      if (options?.focus === true) requestFocus();
    },
    clear() {
      panel.clearValues();
      if (mode === "terminal") derive(panel.queryType);
      requestFocus();
    },
    focusTerminal() {
      if (mode === "form") enterTerminal();
      requestFocus();
    },
    selectType(code, options) {
      if (mode === "terminal") mergeText();
      panel.selectQueryType(code);
      if (mode === "terminal") derive(code);
      if (options?.focus === true) requestFocus();
    },
    submitTerminal() {
      if (panel.submitGated()) return;
      const state = drafts.getState();
      const coreDrafts = Object.fromEntries(
        Object.entries(valuesByType(state.drafts)).map(([code, v]) => [code, toCoreDraft(v)]),
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
        showProblems(checked.errors.length > 0 ? checked.errors : (formState?.errors ?? []));
        return;
      }
      setProblems([]);
      const values = fromCoreDraft(merged);
      state.replaceValues(queryType, values);
      panel.selectQueryType(queryType);
      // A run that goes out keeps focus in the command line (a click on Run brings it back).
      inputRef.current?.focus();
      const sourceIds = resolveCheckedSources(formState, state.drafts[queryType]?.sources ?? null);
      void panel.sendChecked({
        queryType,
        values,
        sourceIds,
        state: formState,
        onInvalid: (serverErrors) => showProblems(serverErrors),
      });
    },
  };
}
