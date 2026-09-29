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
}

const NO_CHECKS: DraftChecks = { status: "loading", issues: [], groups: new Map() };
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
  const settled = useDebounced({ doc, labels }, CHECK_DEBOUNCE_MS);
  return useMemo(() => {
    if (bundleState.status !== "ready") return { ...NO_CHECKS, status: bundleState.status };
    const issues = draftIssues(validateDraft(settled.doc, settled.labels, bundleState.bundle));
    return { status: "ready", issues, groups: groupByControl(settled.doc, issues) };
  }, [bundleState, settled]);
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
        <span key={`${issue.key}:${JSON.stringify(issue.params)}`} className="qm-admin__issue">
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
  const [want, setWant] = useState<PendingFocus | null>(null);
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
    addRef.current?.focus();
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
        onClick={() => {
          setWant({ kind: "item", index: items.length });
          onChange(path, [...items, structuredClone(items[items.length - 1] ?? "")]);
        }}
      >
        {t("admin.config.add")}
      </button>
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
      <div>
        <label htmlFor={id}>{text}</label>{" "}
        <input
          id={id}
          type="number"
          value={value}
          readOnly={isServerSideLeaf(path)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) onChange(path, n);
          }}
        />
        <IssueMessages id={issuesId} issues={issues} />
      </div>
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

function RawTab({ doc }: { doc: JsonObject }) {
  const t = useT();
  const services = useServices();
  const store = configDraftStore(services);
  const uid = useId();
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const checks = useContext(ChecksContext);
  const errorId = `${uid}-error`;
  const lines = useMemo(() => pointerLines(text), [text]);
  const onEdit = (next: string) => {
    setText(next);
    const parsed = parseRawDraft(next);
    if (parsed.ok) {
      setParseError(null);
      store.getState().setDoc(parsed.doc);
    } else {
      setParseError(parsed.message);
    }
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
      <div id={errorId} aria-live="polite">
        {parseError !== null && <p>{t("admin.config.raw.parseError", { message: parseError })}</p>}
        {parseError === null && checks.status === "loading" && (
          <p>{t("admin.config.labels.loading")}</p>
        )}
        {parseError === null && checks.status === "error" && (
          <p>{t("admin.config.raw.bundleError")}</p>
        )}
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
  const { doc } = useDraft();
  useEffect(() => {
    if (config !== undefined) configDraftStore(services).getState().start(docFromClient(config));
  }, [config, services]);
  if (doc === null) return <p aria-busy="true">{t("admin.config.loading")}</p>;
  return <BuilderBody doc={doc} />;
}

function BuilderBody({ doc }: { doc: JsonObject }) {
  const t = useT();
  const uid = useId();
  const { labels } = useDraft();
  const checks = useDraftChecks(doc, labels);
  const [tab, setTab] = useState<TabId>("form");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ form: null, raw: null });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? "form";
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const reasonId = `${uid}-publish-reason`;
  const errorCount = checks.issues.filter((i) => i.level === "error").length;
  const warningCount = checks.issues.length - errorCount;
  return (
    <ChecksContext.Provider value={checks}>
      <div>
        <p>{t("admin.config.serverOnly")}</p>
        <div data-testid="draft-summary" aria-live="polite">
          {checks.status === "ready" && (
            <p>{t("admin.config.raw.counts", { errors: errorCount, warnings: warningCount })}</p>
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
        <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
          {tab === "form" ? <FormTab doc={doc} /> : <RawTab doc={doc} />}
        </div>
      </div>
    </ChecksContext.Provider>
  );
}
