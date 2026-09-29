import {
  clientConfigQuery,
  type DraftValue,
  type SubmitOutcome,
  type SubmitQueryResponse,
  useStore,
} from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { ValidationError } from "@querymodule/core/contracts";
import { evaluateForm, type FormState } from "@querymodule/core/rules";
import {
  blockedErrorCount,
  focusFirstInvalid,
  formatAckTime,
  formLevelMessages,
  type SubmitBlockReason,
} from "@querymodule/web-ui";
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
  /** Why the submit button is blocked, or null (spec 6.2). */
  submitReason: SubmitBlockReason | null;
  /** The last acknowledgment, kept until the next one; null before the first. */
  lastAck: { response: SubmitQueryResponse; queryType: string } | null;
  /** Copies a correlation ID to the clipboard and announces it. */
  copyReference(correlationId: string): void;
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
  const { api, queryClient, drafts, announcer, submit } = useServices();
  const t = useT();
  const [load, setLoad] = useState<ConfigLoad>({ status: "loading" });
  const [showErrors, setShowErrors] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [serverErrors, setServerErrors] = useState<readonly ValidationError[]>([]);
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

  const submitStatus = useStore(submit, (s) => s.status);
  const lastAck = useStore(submit, (s) => s.lastAck);

  // Server validation errors describe the values that were sent; any edit or type change drops them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: values and queryType are the triggers
  useEffect(() => setServerErrors([]), [values, queryType]);

  const localFormState = useMemo(
    () =>
      config === null || queryType === null
        ? null
        : evaluateForm(config, queryType, values ?? NO_VALUES, { now: Date.now() }),
    [config, queryType, values],
  );
  const formState = useMemo(
    () =>
      localFormState === null || serverErrors.length === 0
        ? localFormState
        : {
            ...localFormState,
            errors: [...localFormState.errors, ...serverErrors],
            valid: false,
          },
    [localFormState, serverErrors],
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

  const announceBlocked = (state: FormState): void => {
    const count = blockedErrorCount(state);
    setShowErrors(true);
    setFocusTick((n) => n + 1);
    announcer.announce(
      [t("form.fieldsNeedAttention", { count }), ...formLevelMessages(state, t)].join(" "),
    );
  };

  const typeLabel = (code: string): string => {
    const labelKey = config?.queryTypes.find((q) => q.code === code)?.labelKey;
    return labelKey === undefined ? code : t(labelKey);
  };

  const handleOutcome = (outcome: SubmitOutcome, state: FormState): void => {
    switch (outcome.kind) {
      case "acknowledged":
        announcer.announce(
          t("submit.acknowledged", {
            queryType: typeLabel(outcome.queryType),
            time: formatAckTime(outcome.response.acknowledgedAt),
            reference: outcome.response.correlationId.slice(0, 8),
          }),
        );
        return;
      case "invalid":
        setServerErrors(outcome.errors as ValidationError[]);
        announceBlocked({
          ...state,
          errors: [...state.errors, ...(outcome.errors as ValidationError[])],
          valid: false,
        });
        return;
      case "configChanged":
        // The controller invalidated the config query; fetching re-evaluates the draft against it.
        void fetchConfig();
        announcer.announce(t("submit.configChanged"));
        return;
      case "rateLimited":
        announcer.announce(t("submit.rateLimited", { seconds: outcome.retryAfterSeconds }));
        return;
      default:
        announcer.announce(t(`submit.${outcome.kind}`));
    }
  };

  const send = async (): Promise<void> => {
    if (config === null || queryType === null || formState === null) return;
    const state = formState;
    const outcome = await submit.getState().submit({
      queryType,
      values: values ?? NO_VALUES,
      sourceIds: checkedSources,
      mode: state.mode,
      configHash: config.configHash,
    });
    if (mounted.current) handleOutcome(outcome, state);
  };

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
        void send();
        return;
      }
      announceBlocked(formState);
    },
    submitReason:
      submitStatus === "submitting"
        ? "submitting"
        : submitStatus === "noConnection"
          ? "noConnection"
          : null,
    lastAck,
    copyReference(correlationId) {
      // A failed copy (no permission, no clipboard) stays silent: the ID is on screen to select.
      void navigator.clipboard?.writeText(correlationId).then(
        () => announcer.announce(t("submit.referenceCopied")),
        () => undefined,
      );
    },
  };
}
