import { fetchLocaleBundle } from "@querymodule/client";
import {
  createContext,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useT } from "../app/i18n-context.js";
import type { Services } from "../app/services.js";
import { useServices } from "../app/services-context.js";
import {
  type ConfigDraftStore,
  createConfigDraftStore,
  type DraftIssue,
  docFromClient,
  draftIssues,
  flattenBundle,
  groupByControl,
  type JsonObject,
  lineOf,
  type PathSegment,
  parseRawDraft,
  pointerLines,
  registerConfigDraft,
  toPointer,
  validateDraft,
} from "./draft.js";
import { BuilderPreview } from "./Preview.js";
import { useCachedClientConfig } from "./use-cached-config.js";

const stores = new WeakMap<Services["reset"], ConfigDraftStore>();

/** One draft store per app instance, registered with its ResetController on first use. */
export function configDraftStore(services: Services): ConfigDraftStore {
  let store = stores.get(services.reset);
  if (store === undefined) {
    store = createConfigDraftStore();
    registerConfigDraft(services.reset, store);
    stores.set(services.reset, store);
  }
  return store;
}

function useDraft() {
  const services = useServices();
  const store = configDraftStore(services);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return state;
}

interface DraftChecks {
  status: BundleState["status"];
  issues: readonly DraftIssue[];
  groups: ReadonlyMap<string, readonly DraftIssue[]>;
  /** The settled (debounced) draft the issues were computed on; the preview renders this one. */
  doc: JsonObject | null;
  labels: ReturnType<typeof useDraft>["labels"];
}

const NO_CHECKS: DraftChecks = {
  status: "loading",
  issues: [],
  groups: new Map(),
  doc: null,
  labels: {},
};
const ChecksContext = createContext<DraftChecks>(NO_CHECKS);
const CHECK_DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}

/** validateSiteConfig on every draft change, debounced, with diagnostics grouped by control. */
function useDraftChecks(
  doc: JsonObject,
  labels: ReturnType<typeof useDraft>["labels"],
): DraftChecks {
  const bundleState = useEnglishBundle();
  const settledDoc = useDebounced(doc, CHECK_DEBOUNCE_MS);
  const settledLabels = useDebounced(labels, CHECK_DEBOUNCE_MS);
  return useMemo(() => {
    const settled = { doc: settledDoc, labels: settledLabels };
    if (bundleState.status !== "ready")
      return { ...NO_CHECKS, ...settled, status: bundleState.status };
    const issues = draftIssues(validateDraft(settledDoc, settledLabels, bundleState.bundle));
    return { status: "ready", issues, groups: groupByControl(settledDoc, issues), ...settled };
  }, [bundleState, settledDoc, settledLabels]);
}

const isError = (issues: readonly DraftIssue[] | undefined): boolean =>
  issues?.some((i) => i.level === "error") ?? false;

/** The messages of one control, linked by its aria-describedby (UX-004). */
function IssueMessages({ id, issues }: { id: string; issues: readonly DraftIssue[] | undefined }) {
  const t = useT();
  if (issues === undefined || issues.length === 0) return null;
  return (
    <span id={id} className="qm-admin__issues">
      {issues.map((issue) => (
        <span
          key={`${issue.pointer}:${issue.key}:${JSON.stringify(issue.params)}`}
          className="qm-admin__issue"
        >
          {" "}
          {t(issue.key, issue.params)}
        </span>
      ))}
    </span>
  );
}

const issuesFor = (checks: DraftChecks, path: readonly PathSegment[]) =>
  checks.groups.get(toPointer(path));

interface NodeEditorProps {
  value: unknown;
  path: readonly PathSegment[];
  idPrefix: string;
  onChange(path: readonly PathSegment[], value: unknown): void;
}

const pathText = (path: readonly PathSegment[]): string => path.join(".");

/** Per-source timeoutMs is a server-side setting: shown in the client view, not editable here. */
const isServerSideLeaf = (path: readonly PathSegment[]): boolean =>
  path.length === 3 && path[0] === "sources" && path[2] === "timeoutMs";

type PendingFocus = { kind: "item"; index: number } | { kind: "add" };

/** Keys that name an item in its list (spec 4.1 overlay identities); a cloned item starts blank. */
const IDENTITY_KEYS = ["id", "code", "key", "keyword"] as const;

/** The next item for a list: a copy of the last one with its identity keys cleared (M5). */
function nextItem(last: unknown): unknown {
  const copy = structuredClone(last);
  if (typeof copy === "object" && copy !== null && !Array.isArray(copy)) {
    const obj = copy as Record<string, unknown>;
    for (const k of IDENTITY_KEYS) if (typeof obj[k] === "string") obj[k] = "";
  }
  return copy;
}

/** Array editor; keeps keyboard focus inside the list after an add or a remove (UX-004). */
function ArrayEditor({
  items,
  path,
  idPrefix,
  onChange,
}: Omit<NodeEditorProps, "value"> & { items: readonly unknown[] }) {
  const t = useT();
  const text = pathText(path);
  const checks = useContext(ChecksContext);
  const issues = issuesFor(checks, path);
  const issuesId = `${idPrefix}-${text}-issues`;
  const root = useRef<HTMLFieldSetElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLSpanElement>(null);
  const [want, setWant] = useState<PendingFocus | null>(null);
  const addReasonId = `${idPrefix}-${text}-add-reason`;
  const empty = items.length === 0;
  useEffect(() => {
    if (want === null) return;
    setWant(null);
    if (want.kind === "item") {
      const item = root.current?.querySelector<HTMLElement>(
        `:scope > [data-item-path="${pathText([...path, want.index])}"]`,
      );
      const control = item?.querySelector<HTMLElement>("input, select, textarea, button");
      if (control !== undefined && control !== null) {
        control.focus();
        return;
      }
    }
    // An emptied list has no enabled Add; its reason text takes focus instead (M5).
    if (addRef.current?.disabled) reasonRef.current?.focus();
    else addRef.current?.focus();
  }, [want, path]);
  return (
    <fieldset ref={root} aria-describedby={issues === undefined ? undefined : issuesId}>
      <legend>{text}</legend>
      <IssueMessages id={issuesId} issues={issues} />
      {items.map((item, i) => {
        const itemPath = [...path, i];
        return (
          <div
            key={pathText(itemPath)}
            className="qm-admin__item"
            data-item-path={pathText(itemPath)}
          >
            <NodeEditor value={item} path={itemPath} idPrefix={idPrefix} onChange={onChange} />
            <button
              type="button"
              className="qm-button"
              aria-label={`${t("admin.config.remove")} ${pathText(itemPath)}`}
              onClick={() => {
                const next = items.filter((_, j) => j !== i);
                setWant(i < next.length ? { kind: "item", index: i } : { kind: "add" });
                onChange(path, next);
              }}
            >
              {t("admin.config.remove")}
            </button>
          </div>
        );
      })}
      <button
        ref={addRef}
        type="button"
        className="qm-button"
        aria-label={`${t("admin.config.add")} ${text}`}
        disabled={empty}
        aria-describedby={empty ? addReasonId : undefined}
        onClick={() => {
          setWant({ kind: "item", index: items.length });
          onChange(path, [...items, nextItem(items[items.length - 1])]);
        }}
      >
        {t("admin.config.add")}
      </button>
      {empty && (
        <span ref={reasonRef} id={addReasonId} tabIndex={-1}>
          {" "}
          {t("admin.config.addInRaw")}
        </span>
      )}
    </fieldset>
  );
}

/** The generic schema-driven form: one control per JSON leaf, labelled with its path. */
function NodeEditor({ value, path, idPrefix, onChange }: NodeEditorProps) {
  const text = pathText(path);
  const id = `${idPrefix}-${text}`;
  const checks = useContext(ChecksContext);
  const issues = issuesFor(checks, path);
  const issuesId = `${id}-issues`;
  const invalid = isError(issues);
  const describedBy = issues === undefined ? undefined : issuesId;
  if (Array.isArray(value)) {
    return <ArrayEditor items={value} path={path} idPrefix={idPrefix} onChange={onChange} />;
  }
  if (typeof value === "object" && value !== null) {
    return (
      <fieldset aria-describedby={describedBy}>
        <legend>{text}</legend>
        <IssueMessages id={issuesId} issues={issues} />
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
          <NodeEditor
            key={key}
            value={child}
            path={[...path, key]}
            idPrefix={idPrefix}
            onChange={onChange}
          />
        ))}
      </fieldset>
    );
  }
  if (typeof value === "boolean") {
    return (
      <div>
        <input
          id={id}
          type="checkbox"
          checked={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => onChange(path, e.target.checked)}
        />{" "}
        <label htmlFor={id}>{text}</label>
        <IssueMessages id={issuesId} issues={issues} />
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <NumberEditor
        id={id}
        label={text}
        value={value}
        readOnly={isServerSideLeaf(path)}
        invalid={invalid}
        describedBy={describedBy}
        onValue={(n) => onChange(path, n)}
      >
        <IssueMessages id={issuesId} issues={issues} />
      </NumberEditor>
    );
  }
  return (
    <div>
      <label htmlFor={id}>{text}</label>{" "}
      <input
        id={id}
        type="text"
        value={typeof value === "string" ? value : ""}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(path, e.target.value)}
      />
      <IssueMessages id={issuesId} issues={issues} />
    </div>
  );
}

/** A number control that keeps partial text ("", "-") until it parses (M1). */
function NumberEditor({
  id,
  label,
  value,
  readOnly,
  invalid,
  describedBy,
  onValue,
  children,
}: {
  id: string;
  label: string;
  value: number;
  readOnly: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onValue(n: number): void;
  children: React.ReactNode;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) =>
      Number(current) === value && current.trim() !== "" ? current : String(value),
    );
  }, [value]);
  return (
    <div>
      <label htmlFor={id}>{label}</label>{" "}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        readOnly={readOnly}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = Number(next);
          if (next.trim() !== "" && Number.isFinite(n)) onValue(n);
        }}
      />
      {children}
    </div>
  );
}

/** Sections open on demand, so a large config does not render every control at once. */
function Section({ name, children }: { name: string; children: () => React.ReactNode }) {
  const t = useT();
  const checks = useContext(ChecksContext);
  const [open, setOpen] = useState(false);
  const prefix = toPointer([name]);
  const count = checks.issues.filter(
    (i) => i.pointer === prefix || i.pointer.startsWith(`${prefix}/`),
  ).length;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {name}
        {count > 0 && (
          <span className="qm-admin__count"> {t("admin.config.issueCount", { count })}</span>
        )}
      </summary>
      {open && children()}
    </details>
  );
}

function LabelOverlayEditor({
  locales,
  idPrefix,
}: {
  locales: readonly string[];
  idPrefix: string;
}) {
  const t = useT();
  const services = useServices();
  const { labels } = useDraft();
  const store = configDraftStore(services);
  return (
    <Section name={t("admin.config.labels.title")}>
      {() =>
        locales.map((locale) => (
          <LocaleLabels
            key={locale}
            locale={locale}
            idPrefix={idPrefix}
            entries={labels[locale] ?? {}}
            onSet={(key, text) => store.getState().setLabel(locale, key, text)}
          />
        ))
      }
    </Section>
  );
}

function LocaleLabels({
  locale,
  idPrefix,
  entries,
  onSet,
}: {
  locale: string;
  idPrefix: string;
  entries: Readonly<Record<string, string>>;
  onSet(key: string, text: string): void;
}) {
  const t = useT();
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const keyId = `${idPrefix}-label-key-${locale}`;
  const textId = `${idPrefix}-label-text-${locale}`;
  return (
    <fieldset>
      <legend>{locale}</legend>
      {Object.entries(entries).map(([k, v]) => {
        const id = `${idPrefix}-label-${locale}-${k}`;
        return (
          <div key={k}>
            <label htmlFor={id}>{k}</label>{" "}
            <input id={id} type="text" value={v} onChange={(e) => onSet(k, e.target.value)} />
          </div>
        );
      })}
      <div>
        <label htmlFor={keyId}>{t("admin.config.labels.key", { locale })}</label>{" "}
        <input id={keyId} type="text" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div>
        <label htmlFor={textId}>{t("admin.config.labels.text", { locale })}</label>{" "}
        <input id={textId} type="text" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button
        type="button"
        className="qm-button"
        disabled={key.trim() === ""}
        onClick={() => {
          onSet(key.trim(), text);
          setKey("");
          setText("");
        }}
      >
        {t("admin.config.labels.add", { locale })}
      </button>
    </fieldset>
  );
}

function FormTab({ doc }: { doc: JsonObject }) {
  const services = useServices();
  const idPrefix = useId();
  const store = configDraftStore(services);
  const onChange = useCallback(
    (path: readonly PathSegment[], value: unknown) => store.getState().setPath(path, value),
    [store],
  );
  const strings = Array.isArray(doc.locales)
    ? doc.locales.filter((l): l is string => typeof l === "string")
    : [];
  const locales = strings.length > 0 ? strings : ["en"];
  const rootIssues = useContext(ChecksContext).groups.get("");
  return (
    <div>
      <IssueMessages id={`${idPrefix}-root-issues`} issues={rootIssues} />
      {Object.entries(doc).map(([name, value]) => (
        <Section key={name} name={name}>
          {() => <NodeEditor value={value} path={[name]} idPrefix={idPrefix} onChange={onChange} />}
        </Section>
      ))}
      <LabelOverlayEditor locales={locales} idPrefix={idPrefix} />
    </div>
  );
}

type BundleState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; bundle: Record<string, string> };

/** The shipped English strings, for validating label keys; fetched through the query cache. */
function useEnglishBundle(): BundleState {
  const { api, queryClient } = useServices();
  const [state, setState] = useState<BundleState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    queryClient
      .fetchQuery({
        queryKey: ["locale", "en"],
        queryFn: () => fetchLocaleBundle(api, "en"),
        staleTime: Number.POSITIVE_INFINITY,
      })
      .then((b) => {
        if (live) setState({ status: "ready", bundle: flattenBundle(b) });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [api, queryClient]);
  return state;
}

interface RawState {
  text: string;
  parseError: string | null;
}

function RawTab({
  raw,
  setRaw,
  onRawDoc,
}: {
  raw: RawState;
  setRaw(next: RawState): void;
  onRawDoc(doc: JsonObject): void;
}) {
  const t = useT();
  const uid = useId();
  const { text, parseError } = raw;
  const checks = useContext(ChecksContext);
  const errorId = `${uid}-error`;
  const lines = useMemo(() => pointerLines(text), [text]);
  const onEdit = (next: string) => {
    const parsed = parseRawDraft(next);
    setRaw({ text: next, parseError: parsed.ok ? null : parsed.message });
    if (parsed.ok) onRawDoc(parsed.doc);
  };
  return (
    <div>
      <label htmlFor={`${uid}-area`}>{t("admin.config.raw.label")}</label>
      <textarea
        id={`${uid}-area`}
        rows={24}
        cols={80}
        spellCheck={false}
        value={text}
        aria-invalid={parseError !== null}
        aria-describedby={errorId}
        onChange={(e) => onEdit(e.target.value)}
      />
      <div id={errorId}>
        {parseError !== null && <p>{t("admin.config.raw.parseError", { message: parseError })}</p>}
        {parseError === null && checks.issues.length > 0 && (
          <ul>
            {checks.issues.map((issue) => {
              const line = lineOf(lines, issue.pointer);
              const message = `${issue.pointer}: ${t(issue.key, issue.params)}`;
              return (
                <li key={`${issue.pointer}:${issue.key}:${JSON.stringify(issue.params)}`}>
                  {line === undefined
                    ? message
                    : t("admin.config.raw.line", { line: String(line), message })}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const TABS = ["form", "raw"] as const;
type TabId = (typeof TABS)[number];

/** Config builder part 1 (Task 31, #355): the generic form and the raw JSON tab over one draft. */
export function ConfigBuilder() {
  const t = useT();
  const services = useServices();
  const config = useCachedClientConfig();
  const failed = useConfigLoadFailed();
  const { doc } = useDraft();
  const seeded = doc !== null;
  useEffect(() => {
    // Q8: also reseeds after a reset while the builder stays open.
    if (config !== undefined && !seeded)
      configDraftStore(services).getState().start(docFromClient(config));
  }, [config, services, seeded]);
  if (doc === null && failed) return <p role="alert">{t("admin.config.loadError")}</p>;
  if (doc === null) return <p aria-busy="true">{t("admin.config.loading")}</p>;
  return <BuilderBody doc={doc} />;
}

/** M8: the cached GET /api/v1/config failed, so the builder has nothing to start from. */
function useConfigLoadFailed(): boolean {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(["config"])?.status === "error",
  );
}

function BuilderBody({ doc }: { doc: JsonObject }) {
  const t = useT();
  const uid = useId();
  const { labels } = useDraft();
  const checks = useDraftChecks(doc, labels);
  const [tab, setTab] = useState<TabId>("form");
  const [raw, setRaw] = useState<RawState>(() => ({
    text: JSON.stringify(doc, null, 2),
    parseError: null,
  }));
  // The raw text follows the draft only when something else changed it (wave critic I1, I2): a
  // raw edit keeps the user's text and caret; a form edit (even while the raw text does not parse,
  // M7 keeps it across a tab switch) replaces the raw text, so no edit is lost.
  const rawDoc = useRef<JsonObject | null>(null);
  const store = configDraftStore(useServices());
  const onRawDoc = useCallback(
    (next: JsonObject) => {
      rawDoc.current = next;
      store.getState().setDoc(next);
    },
    [store],
  );
  useEffect(() => {
    if (doc === rawDoc.current) return;
    setRaw({ text: JSON.stringify(doc, null, 2), parseError: null });
  }, [doc]);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ form: null, raw: null });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // M4: WAI-ARIA tabs, arrows by direction with wrap, Home and End.
    const i = TABS.indexOf(tab);
    const target =
      e.key === "ArrowRight"
        ? TABS[(i + 1) % TABS.length]
        : e.key === "ArrowLeft"
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : undefined;
    if (target === undefined) return;
    e.preventDefault();
    setTab(target);
    tabRefs.current[target]?.focus();
  };
  const reasonId = `${uid}-publish-reason`;
  const errorCount = checks.issues.filter((i) => i.level === "error").length;
  const warningCount = checks.issues.length - errorCount;
  return (
    <ChecksContext.Provider value={checks}>
      <div>
        <p>{t("admin.config.serverOnly")}</p>
        <div data-testid="draft-summary" aria-live="polite">
          {raw.parseError !== null ? (
            <p>{t("admin.config.raw.notParsed")}</p>
          ) : checks.status === "error" ? (
            <p>{t("admin.config.raw.bundleError")}</p>
          ) : (
            checks.status === "ready" && (
              <p>{t("admin.config.raw.counts", { errors: errorCount, warnings: warningCount })}</p>
            )
          )}
        </div>
        <div>
          <button type="button" className="qm-button" disabled aria-describedby={reasonId}>
            {t("admin.config.publish")}
          </button>{" "}
          <button type="button" className="qm-button" disabled aria-describedby={reasonId}>
            {t("admin.config.history")}
          </button>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the disabled controls cannot take focus, so their reason text must (checker ruling 09-29-26) */}
          <p id={reasonId} tabIndex={0}>
            {t("admin.config.publishDisabled")}
          </p>
        </div>
        <div role="tablist" aria-label={t("admin.config.tabsLabel")}>
          {TABS.map((id) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${uid}-panel`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onKeyDown}
            >
              {t(`admin.config.tab.${id}`)}
            </button>
          ))}
        </div>
        <div className="qm-admin__workspace">
          <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
            {tab === "form" ? (
              <FormTab doc={doc} />
            ) : (
              <RawTab raw={raw} setRaw={setRaw} onRawDoc={onRawDoc} />
            )}
          </div>
          {checks.doc !== null && (
            <BuilderPreview
              doc={checks.doc}
              labels={checks.labels}
              blocked={raw.parseError !== null || errorCount > 0}
              pending={checks.doc !== doc || checks.labels !== labels}
            />
          )}
        </div>
      </div>
    </ChecksContext.Provider>
  );
}
