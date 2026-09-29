import { clientConfigQuery, type DraftValue, useStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { evaluateForm, type FormState } from "@querymodule/core/rules";
import { blockedErrorCount, focusFirstInvalid, formLevelMessages } from "@querymodule/web-ui";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

type ConfigLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; config: ClientSiteConfig };

export interface ReadyQueryPanel {
  status: "ready";
  config: ClientSiteConfig;
  queryType: string;
  formState: FormState;
  values: Readonly<Record<string, DraftValue>>;
  checkedSources: readonly string[];
  showErrors: boolean;
  /** Wraps the form so a blocked submit can focus the first invalid field. */
  formContainerRef: RefObject<HTMLDivElement | null>;
  selectQueryType(code: string): void;
  setValue(key: string, value: DraftValue): void;
  setSources(sourceIds: readonly string[]): void;
  onSubmitAttempt(): void;
}

export type QueryPanelModel =
  | { status: "loading" }
  | { status: "error"; retry(): void }
  | ReadyQueryPanel;

const NO_VALUES: Readonly<Record<string, DraftValue>> = {};

function initialQueryType(config: ClientSiteConfig): string | null {
  const codes = config.queryTypes.map((q) => q.code);
  const first = config.quickAccess[0];
  if (first !== undefined && codes.includes(first)) return first;
  return codes[0] ?? null;
}

/**
 * Wires the config, the draft store and evaluateForm to the query panel (spec 6.2). The config
 * lives in the query cache only (spec 6.7); drafts live in the draft store, values as entered.
 * Nothing here is per query type (BR-001).
 */
export function useQueryPanel(): QueryPanelModel {
  const { api, queryClient, drafts, announcer } = useServices();
  const t = useT();
  const [load, setLoad] = useState<ConfigLoad>({ status: "loading" });
  const [showErrors, setShowErrors] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const seen = useRef<{ queryType: string; visible: ReadonlySet<string> } | null>(null);

  // retry: false, the panel has its own Retry button; a second silent attempt would hide the failure.
  const fetchConfig = useCallback(
    () =>
      queryClient.fetchQuery({ ...clientConfigQuery(api), retry: false }).then(
        (config) => {
          if (mounted.current) setLoad({ status: "ready", config });
        },
        () => {
          if (!mounted.current) return;
          setLoad({ status: "error" });
          // Spec 6.6: one announcer, polite; the visible text stays for sighted users.
          announcer.announce(t("error.unavailable"));
        },
      ),
    [api, queryClient, announcer, t],
  );
  useEffect(() => {
    mounted.current = true;
    void fetchConfig();
    return () => {
      mounted.current = false;
    };
  }, [fetchConfig]);

  const config = load.status === "ready" ? load.config : null;
  const initialType = config === null ? null : initialQueryType(config);
  const storeType = useStore(drafts, (s) => s.queryType);
  useEffect(() => {
    if (initialType !== null && storeType === null) drafts.getState().select(initialType);
  }, [drafts, initialType, storeType]);
  const queryType = storeType ?? initialType;

  const values = useStore(drafts, (s) =>
    queryType === null ? undefined : s.drafts[queryType]?.values,
  );
  const draftSources = useStore(drafts, (s) =>
    queryType === null ? null : (s.drafts[queryType]?.sources ?? null),
  );

  const formState = useMemo(
    () =>
      config === null || queryType === null
        ? null
        : evaluateForm(config, queryType, values ?? NO_VALUES, { now: Date.now() }),
    [config, queryType, values],
  );

  // Fields that became visible since the previous evaluation of the same type (spec 6.2 A2).
  // Focus does not move; several reveals share one announcement.
  useEffect(() => {
    if (formState === null) return;
    const visible = new Set(formState.fields.filter((f) => f.visible).map((f) => f.key));
    const previous = seen.current;
    if (previous !== null && previous.queryType === formState.queryType) {
      const messages = formState.fields
        .filter((f) => f.visible && !previous.visible.has(f.key))
        .map((f) =>
          t(f.required ? "form.fieldRevealedRequired" : "form.fieldRevealed", {
            label: t(f.labelKey),
          }),
        );
      if (messages.length > 0) announcer.announce(messages.join(" "));
    }
    seen.current = { queryType: formState.queryType, visible };
  }, [formState, announcer, t]);

  // Errors render on the commit that follows a blocked submit, so focus moves after it.
  useEffect(() => {
    if (focusTick > 0 && formContainerRef.current !== null) {
      focusFirstInvalid(formContainerRef.current);
    }
  }, [focusTick]);

  if (load.status === "loading") return { status: "loading" };
  if (load.status === "error") {
    return {
      status: "error",
      retry: () => {
        setLoad({ status: "loading" });
        void fetchConfig();
      },
    };
  }
  if (config === null || queryType === null || formState === null) return { status: "loading" };

  const eligible = formState.sources.map((s) => s.sourceId);
  const checkedSources =
    draftSources === null
      ? formState.sources.filter((s) => s.selectedByDefault).map((s) => s.sourceId)
      : draftSources.filter((id) => eligible.includes(id));

  return {
    status: "ready",
    config: load.config,
    queryType,
    formState,
    values: values ?? NO_VALUES,
    checkedSources,
    showErrors,
    formContainerRef,
    selectQueryType(code) {
      drafts.getState().select(code);
      setShowErrors(false);
    },
    setValue: (key, value) => drafts.getState().setValue(key, value),
    setSources: (sourceIds) => drafts.getState().setSources(sourceIds),
    onSubmitAttempt() {
      if (formState.valid) {
        // D-B3: P2 proves the form; sending arrives with M1 P3.
        announcer.announce(t("form.readyToSubmit"));
        return;
      }
      const count = blockedErrorCount(formState);
      setShowErrors(true);
      setFocusTick((n) => n + 1);
      announcer.announce(
        [t("form.fieldsNeedAttention", { count }), ...formLevelMessages(formState, t)].join(" "),
      );
    },
  };
}
