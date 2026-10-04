import {
  clientConfigQuery,
  type DraftStore,
  type DraftValue,
  type SubmitOutcome,
  useStore,
} from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { ValidationError } from "@querymodule/core/contracts";
import { evaluateForm, type FormState } from "@querymodule/core/rules";
import {
  blockedErrorCount,
  focusFirstInvalid,
  formLevelMessages,
  type SubmitBlockReason,
} from "@querymodule/web-ui";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { outcomeAnnouncement } from "./announce-outcome.js";
import { firstField } from "./first-field.js";
import { formToTerminal } from "./form-to-terminal.js";
import { valuesToSend } from "./send-values.js";

export type PanelViewMode = "live" | "preview";

type ConfigLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; config: ClientSiteConfig };

export interface ReadyQueryPanel {
  status: "ready";
  /** Live sends the query; preview never sends anything (ADR-0011). */
  mode: PanelViewMode;
  config: ClientSiteConfig;
  /** The draft store this panel reads and writes: services.drafts live, a private one in preview. */
  drafts: DraftStore;
  queryType: string;
  formState: FormState;
  /** The clock the form state was evaluated with; the command echo formats with the same one. */
  evaluatedAt: number;
  values: Readonly<Record<string, DraftValue>>;
  checkedSources: readonly string[];
  showErrors: boolean;
  /** Wraps the form so a blocked submit can focus the first invalid field. */
  formContainerRef: RefObject<HTMLDivElement | null>;
  selectQueryType(code: string): void;
  /** Clears the current type's values (not its source choice) and any shown errors. */
  clearValues(): void;
  setValue(key: string, value: DraftValue): void;
  /** Fields a rule revealed since the type opened: each shows a Shown tag until focused or edited. */
  revealed: ReadonlySet<string>;
  dismissRevealed(key: string): void;
  setSources(sourceIds: readonly string[]): void;
  onSubmitAttempt(): void;
  /**
   * The submit gate shared by the form and the terminal (spec 6.8): while submitting or offline it
   * announces the reason and returns true; the caller sends nothing.
   */
  submitGated(): boolean;
  /** Sends a checked request, as the form does; the terminal passes the type it parsed. */
  sendChecked(request: CheckedRequest): Promise<void>;
  /** Why the submit button is blocked, or null (spec 6.2). */
  submitReason: SubmitBlockReason | null;
}

/** A request whose values were already validated against `state` (the terminal's FR-053 check). */
export interface CheckedRequest {
  queryType: string;
  values: Readonly<Record<string, DraftValue>>;
  sourceIds: readonly string[];
  state: FormState;
  /**
   * Shows a server 400's errors where the request came from. The terminal lists them under its
   * input (spec 6.2, FR-055); without it they go to the form fields.
   */
  onInvalid?(errors: readonly ValidationError[]): void;
}

export type LiveConfigModel =
  | { status: "loading" }
  | { status: "error"; retry(): void }
  | { status: "ready"; config: ClientSiteConfig; refetch(): Promise<void> };

/** After a 409 the refetched config's change is not announced again (its own message stands). */
const CONFIG_CHANGED_QUIET_MS = 10_000;
/** How long after the refetch settles the quiet lasts, for the render that applies it. */
const CONFIG_CHANGED_SETTLE_MS = 1000;

const NO_VALUES: Readonly<Record<string, DraftValue>> = {};
const NO_KEYS: ReadonlySet<string> = new Set();

function sameValues(
  a: Readonly<Record<string, DraftValue>>,
  b: Readonly<Record<string, DraftValue>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function initialQueryType(config: ClientSiteConfig): string | null {
  const codes = config.queryTypes.map((q) => q.code);
  const first = config.quickAccess[0];
  if (first !== undefined && codes.includes(first)) return first;
  return codes[0] ?? null;
}

/** Defaults while the draft has no choice, else the draft's sources that are still eligible. */
export function resolveCheckedSources(
  formState: FormState,
  draftSources: readonly string[] | null,
): string[] {
  const eligible = formState.sources.map((s) => s.sourceId);
  return draftSources === null
    ? formState.sources.filter((s) => s.selectedByDefault).map((s) => s.sourceId)
    : draftSources.filter((id) => eligible.includes(id));
}

/**
 * Loads GET /api/v1/config for the live route (spec 6.2). The config lives in the query cache
 * only (spec 6.7).
 */
export function useLiveConfig(): LiveConfigModel {
  const { api, queryClient, announcer } = useServices();
  const t = useT();
  const [load, setLoad] = useState<ConfigLoad>({ status: "loading" });
  const mounted = useRef(false);
  // The background refresh writes a newer config into the query cache (ADR-0011 item 3); follow it.
  const cached = useCachedConfig();

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

  if (load.status === "ready")
    return { status: "ready", config: cached ?? load.config, refetch: fetchConfig };
  if (load.status === "error") {
    return {
      status: "error",
      retry: () => {
        setLoad({ status: "loading" });
        void fetchConfig();
      },
    };
  }
  return { status: "loading" };
}

export interface QueryPanelSource {
  config: ClientSiteConfig;
  drafts: DraftStore;
  mode: PanelViewMode;
  /** Live: the config changed under a submit; the owner refetches it. */
  onConfigChanged?: () => void | Promise<void>;
}

/**
 * Wires the injected config, the draft store and evaluateForm to the query panel (spec 6.2).
 * Drafts live in the draft store, values as entered. In preview nothing is ever sent and the
 * submit controller is not consulted. Nothing here is per query type (BR-001).
 */
export function useQueryPanel(source: QueryPanelSource): ReadyQueryPanel | null {
  const { announcer, submit, requests } = useServices();
  const { config, drafts, mode, onConfigChanged } = source;
  const preview = mode === "preview";
  const t = useT();
  const [showErrors, setShowErrors] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [serverErrors, setServerErrors] = useState<readonly ValidationError[]>([]);
  // Fields a rule revealed since the type opened (the Shown tag): cleared by focus, an edit or a reset.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(NO_KEYS);
  const dismissRevealed = useCallback(
    (key: string): void =>
      setRevealed((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      }),
    [],
  );
  const formContainerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const seen = useRef<{
    queryType: string;
    visible: ReadonlySet<string>;
    values: Readonly<Record<string, DraftValue>>;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const initialType = initialQueryType(config);
  const storeType = useStore(drafts, (s) => s.queryType);
  // A selected type the config no longer has (removed or renamed, e.g. in the builder preview)
  // falls back to the first quick-access type, else the first type (ADR-0011).
  const known = storeType !== null && config.queryTypes.some((q) => q.code === storeType);
  useEffect(() => {
    if (initialType !== null && !known) drafts.getState().select(initialType);
  }, [drafts, initialType, known]);
  const queryType = known ? storeType : initialType;

  // A newer config arrived while the panel is open (the live refresh or a refetch): say so, politely,
  // and never move focus (spec 6.6). A 409 already announced itself, so its refetch stays quiet.
  const seenHash = useRef<string | null>(null);
  const quietUntil = useRef(0);
  useEffect(() => {
    const previous = seenHash.current;
    seenHash.current = config.configHash;
    if (preview || previous === null || previous === config.configHash) return;
    if (Date.now() < quietUntil.current) {
      quietUntil.current = 0;
      return;
    }
    const removed = storeType !== null && !known;
    const fallbackKey = config.queryTypes.find((q) => q.code === initialType)?.labelKey;
    const fallback = fallbackKey === undefined ? (initialType ?? "") : t(fallbackKey);
    announcer.announce(
      removed && initialType !== null
        ? `${t("form.configUpdated")} ${t("form.queryTypeRemoved", { queryType: fallback })}`
        : t("form.configUpdated"),
    );
  }, [announcer, config, initialType, known, preview, storeType, t]);

  const values = useStore(drafts, (s) =>
    queryType === null ? undefined : s.drafts[queryType]?.values,
  );
  const draftSources = useStore(drafts, (s) =>
    queryType === null ? null : (s.drafts[queryType]?.sources ?? null),
  );

  // Preview neither reads nor subscribes to the submit controller: its state belongs to the live
  // panel, so preview is always idle and nothing re-renders it when a live submit changes.
  const subscribeSubmit = useCallback(
    (onChange: () => void) => (preview ? () => undefined : submit.subscribe(onChange)),
    [preview, submit],
  );
  const submitStatus = useSyncExternalStore(subscribeSubmit, () =>
    preview ? "idle" : submit.getState().status,
  );

  // Spec 6.6: connection changes are announced politely; a screen reader user has no other signal
  // that the submit is held until the server answers again.
  const wasNoConnection = useRef(false);
  useEffect(() => {
    if (submitStatus === "noConnection") {
      wasNoConnection.current = true;
      announcer.announce(t("form.noConnection"));
    } else if (wasNoConnection.current) {
      wasNoConnection.current = false;
      if (submitStatus === "idle") announcer.announce(t("form.connectionRestored"));
    }
  }, [submitStatus, announcer, t]);

  // An edit to a revealed field clears its Shown tag, whichever way the value arrived (form or terminal).
  const lastValues = useRef(values);
  useEffect(() => {
    const before = lastValues.current;
    lastValues.current = values;
    if (before === values) return;
    setRevealed((prev) => {
      const edited = [...prev].filter((key) => before?.[key] !== values?.[key]);
      return edited.length === 0 ? prev : new Set([...prev].filter((k) => !edited.includes(k)));
    });
  }, [values]);

  // Server validation errors describe the request that was sent (values and sources); any edit, a
  // source change or a type change drops them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: values, draftSources and queryType are the triggers
  useEffect(() => setServerErrors([]), [values, draftSources, queryType]);
  // What is on screen now, for an answer that arrives after the request left (see sameAsSent).
  const onScreen = useRef<{
    queryType: string;
    values: Readonly<Record<string, DraftValue>>;
    sourceIds: readonly string[];
  } | null>(null);

  // One clock read per evaluation: the command echo formats with the same now (evaluatedAt), so a
  // date or year the rules resolve against today reads the same in the form and the echo.
  const evaluated = useMemo(() => {
    if (queryType === null) return null;
    const now = Date.now();
    return { state: evaluateForm(config, queryType, values ?? NO_VALUES, { now }), now };
  }, [config, queryType, values]);
  const localFormState = evaluated?.state ?? null;
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
  // Focus does not move; several reveals share one announcement. A new config shows its own fields:
  // that is announced once as "updated", not as a rule reveal (one polite slot, spec 6.6).
  const revealHash = useRef(config.configHash);
  useEffect(() => {
    if (formState === null) return;
    const visible = new Set(formState.fields.filter((f) => f.visible).map((f) => f.key));
    const previous = seen.current;
    const configChanged = revealHash.current !== config.configHash;
    revealHash.current = config.configHash;
    const current = values ?? NO_VALUES;
    if (previous !== null && previous.queryType !== formState.queryType) setRevealed(NO_KEYS);
    // A key a rule hid again leaves the set, so a later config that shows it is not a "reveal".
    setRevealed((prev) => {
      const kept = [...prev].filter((key) => visible.has(key));
      return kept.length === prev.size ? prev : new Set(kept);
    });
    if (!configChanged && previous !== null && previous.queryType === formState.queryType) {
      const shown = formState.fields.filter((f) => f.visible && !previous.visible.has(f.key));
      // Tagged only in the live panel (a builder edit in preview is not a dispatcher's reveal) and
      // only when the same edit did not also fill the field (a terminal merge sets both).
      const tagged = preview
        ? []
        : shown.filter((f) => previous.values[f.key] === current[f.key]).map((f) => f.key);
      if (tagged.length > 0) setRevealed((prev) => new Set([...prev, ...tagged]));
      const messages = shown.map((f) =>
        t(f.required ? "form.fieldRevealedRequired" : "form.fieldRevealed", {
          label: t(f.labelKey),
        }),
      );
      if (messages.length > 0) announcer.announce(messages.join(" "));
    }
    seen.current = { queryType: formState.queryType, visible, values: current };
  }, [formState, config.configHash, announcer, t, preview, values]);

  // Errors render on the commit that follows a blocked submit, so focus moves after it.
  useEffect(() => {
    if (focusTick > 0 && formContainerRef.current !== null) {
      focusFirstInvalid(formContainerRef.current);
    }
  }, [focusTick]);

  if (queryType === null || formState === null || evaluated === null) return null;

  const checkedSources = resolveCheckedSources(formState, draftSources);
  onScreen.current = { queryType, values: values ?? NO_VALUES, sourceIds: checkedSources };

  /**
   * A 400 describes the values and sources that were sent. If the user changed either while the
   * request was in flight (the effect above only drops errors that already exist), its errors
   * would mark fields the user has since edited, so they are not shown.
   */
  const sameAsSent = (request: CheckedRequest): boolean => {
    const now = onScreen.current;
    return (
      now !== null &&
      now.queryType === request.queryType &&
      sameValues(now.values, request.values) &&
      now.sourceIds.length === request.sourceIds.length &&
      now.sourceIds.every((id, index) => id === request.sourceIds[index])
    );
  };

  const announceBlocked = (state: FormState): void => {
    const count = blockedErrorCount(state);
    setShowErrors(true);
    setFocusTick((n) => n + 1);
    announcer.announce(
      [t("form.fieldsNeedAttention", { count }), ...formLevelMessages(state, t)].join(" "),
    );
  };

  const typeLabel = (code: string): string => {
    const labelKey = config.queryTypes.find((q) => q.code === code)?.labelKey;
    return labelKey === undefined ? code : t(labelKey);
  };

  const handleOutcome = (outcome: SubmitOutcome, request: CheckedRequest): void => {
    const { state } = request;
    switch (outcome.kind) {
      case "acknowledged":
        announcer.announce(outcomeAnnouncement(outcome, t, typeLabel));
        return;
      case "invalid":
        if (!sameAsSent(request)) return;
        setServerErrors(outcome.errors as ValidationError[]);
        if (request.onInvalid !== undefined) {
          request.onInvalid(outcome.errors as ValidationError[]);
          return;
        }
        announceBlocked({
          ...state,
          errors: [...state.errors, ...(outcome.errors as ValidationError[])],
          valid: false,
        });
        return;
      case "configChanged":
        // The controller invalidated the config query; fetching re-evaluates the draft against it.
        quietUntil.current = Date.now() + CONFIG_CHANGED_QUIET_MS;
        // Once the refetch has settled its change (if any) is applied, so the quiet ends shortly
        // after: a later, real change is announced even inside the window.
        void Promise.resolve(onConfigChanged?.()).finally(() => {
          globalThis.setTimeout(() => {
            quietUntil.current = 0;
          }, CONFIG_CHANGED_SETTLE_MS);
        });
        announcer.announce(t("submit.configChanged"));
        return;
      case "rateLimited":
      default:
        announcer.announce(outcomeAnnouncement(outcome, t, typeLabel));
    }
  };

  const sendChecked = async (request: CheckedRequest): Promise<void> => {
    if (preview) return;
    // The list row is the same one from Sending to its outcome. A send that joins one already in
    // flight gets the same outcome, so it adds no row of its own.
    // What goes out is kept with the row, so a failed one can be sent again (memory only).
    const submitted = {
      queryType: request.queryType,
      values: valuesToSend(config, request.queryType, request.values, request.state, Date.now()),
      sourceIds: request.sourceIds,
      mode: request.state.mode,
    };
    const rowId =
      submit.getState().status === "submitting"
        ? null
        : requests.getState().begin({
            queryType: request.queryType,
            summary: formToTerminal(config, request.queryType, request.values, Date.now()).text,
            submitted,
          });
    const outcome = await submit.getState().submit({ ...submitted, configHash: config.configHash });
    // The list outlives the panel, so the row settles even if the panel has unmounted.
    if (rowId !== null) requests.getState().settle(rowId, outcome);
    if (mounted.current) handleOutcome(outcome, request);
  };

  const send = (): Promise<void> =>
    sendChecked({
      queryType,
      values: values ?? NO_VALUES,
      sourceIds: checkedSources,
      state: formState,
    });

  // Ctrl+Enter calls requestSubmit() with no submitter, so the button's aria-disabled guard never
  // runs: while submitting or gated (spec 6.8) re-announce the reason and send nothing.

  const submitGated = (): boolean => {
    // Preview validates like live (ADR-0011: it shows what dispatchers see); sendChecked stops it.
    if (submitStatus === "idle") return false;
    announcer.announce(t(submitStatus === "submitting" ? "form.submitting" : "form.noConnection"));
    return true;
  };

  return {
    status: "ready",
    mode,
    config,
    drafts,
    queryType,
    formState,
    evaluatedAt: evaluated.now,
    values: values ?? NO_VALUES,
    checkedSources,
    showErrors,
    formContainerRef,
    selectQueryType(code) {
      drafts.getState().select(code);
      setShowErrors(false);
    },
    clearValues() {
      drafts.getState().replaceValues(queryType, {});
      setShowErrors(false);
      setRevealed(NO_KEYS);
    },
    setValue: (key, value) => drafts.getState().setValue(key, value),
    revealed,
    dismissRevealed,
    setSources: (sourceIds) => drafts.getState().setSources(sourceIds),
    onSubmitAttempt() {
      if (submitGated()) return;
      if (formState.valid) {
        void send();
        // A run that goes out leaves focus on the first field, ready for the next query (design
        // B2); a blocked one focuses the first invalid field instead.
        firstField(formContainerRef.current)?.focus();
        return;
      }
      announceBlocked(formState);
    },
    submitGated,
    sendChecked,
    submitReason: preview
      ? "preview"
      : submitStatus === "submitting"
        ? "submitting"
        : submitStatus === "noConnection"
          ? "noConnection"
          : null,
  };
}
