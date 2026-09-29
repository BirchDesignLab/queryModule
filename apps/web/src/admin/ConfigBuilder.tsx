import { fetchLocaleBundle } from "@querymodule/client";
import {
  type KeyboardEvent,
  useCallback,
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
  docFromClient,
  flattenBundle,
  type JsonObject,
  type PathSegment,
  parseRawDraft,
  registerConfigDraft,
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

interface NodeEditorProps {
  value: unknown;
  path: readonly PathSegment[];
  idPrefix: string;
  onChange(path: readonly PathSegment[], value: unknown): void;
}

const pathText = (path: readonly PathSegment[]): string => path.join(".");

/** The generic schema-driven form: one control per JSON leaf, labelled with its path. */
function NodeEditor({ value, path, idPrefix, onChange }: NodeEditorProps) {
  const t = useT();
  const text = pathText(path);
  const id = `${idPrefix}-${text}`;
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return (
      <fieldset>
        <legend>{text}</legend>
        {items.map((item, i) => {
          const itemPath = [...path, i];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the path is the identity of an item
            <div key={i} className="qm-admin__item">
              <NodeEditor value={item} path={itemPath} idPrefix={idPrefix} onChange={onChange} />
              <button
                type="button"
                className="qm-button"
                aria-label={`${t("admin.config.remove")} ${pathText(itemPath)}`}
                onClick={() =>
                  onChange(
                    path,
                    items.filter((_, j) => j !== i),
                  )
                }
              >
                {t("admin.config.remove")}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="qm-button"
          aria-label={`${t("admin.config.add")} ${text}`}
          onClick={() => onChange(path, [...items, structuredClone(items[items.length - 1] ?? "")])}
        >
          {t("admin.config.add")}
        </button>
      </fieldset>
    );
  }
  if (typeof value === "object" && value !== null) {
    return (
      <fieldset>
        <legend>{text}</legend>
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
          onChange={(e) => onChange(path, e.target.checked)}
        />{" "}
        <label htmlFor={id}>{text}</label>
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
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) onChange(path, n);
          }}
        />
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
        onChange={(e) => onChange(path, e.target.value)}
      />
    </div>
  );
}

/** Sections open on demand, so a large config does not render every control at once. */
function Section({ name, children }: { name: string; children: () => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{name}</summary>
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
  const locales = Array.isArray(doc.locales) ? (doc.locales as string[]) : ["en"];
  return (
    <div>
      {Object.entries(doc).map(([name, value]) => (
        <Section key={name} name={name}>
          {() => <NodeEditor value={value} path={[name]} idPrefix={idPrefix} onChange={onChange} />}
        </Section>
      ))}
      <LabelOverlayEditor locales={locales} idPrefix={idPrefix} />
    </div>
  );
}

/** The shipped English strings, for validating label keys; fetched through the query cache. */
function useEnglishBundle(): Record<string, string> | null {
  const { api, queryClient } = useServices();
  const [bundle, setBundle] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    queryClient
      .fetchQuery({
        queryKey: ["locale", "en"],
        queryFn: () => fetchLocaleBundle(api, "en"),
        staleTime: Number.POSITIVE_INFINITY,
      })
      .then((b) => {
        if (live) setBundle(flattenBundle(b));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, queryClient]);
  return bundle;
}

function RawTab({ doc }: { doc: JsonObject }) {
  const t = useT();
  const services = useServices();
  const store = configDraftStore(services);
  const { labels } = useDraft();
  const uid = useId();
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const bundle = useEnglishBundle();
  const errorId = `${uid}-error`;
  const validation = useMemo(
    () => (parseError === null && bundle !== null ? validateDraft(doc, labels, bundle) : null),
    [parseError, bundle, doc, labels],
  );
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
        {validation?.ok === false && (
          <div>
            <p>{t("admin.config.raw.shapeIssues")}</p>
            <ul>
              {validation.issues.map((issue) => (
                <li key={`${issue.pointer}:${issue.message}`}>
                  {issue.pointer}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {validation?.ok === true && (
          <p>
            {t("admin.config.raw.counts", {
              errors: validation.errors.length,
              warnings: validation.warnings.length,
            })}
          </p>
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
  const uid = useId();
  const config = useCachedClientConfig();
  const { doc } = useDraft();
  const [tab, setTab] = useState<TabId>("form");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ form: null, raw: null });
  useEffect(() => {
    if (config !== undefined) configDraftStore(services).getState().start(docFromClient(config));
  }, [config, services]);
  if (doc === null) return <p aria-busy="true">{t("admin.config.loading")}</p>;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? "form";
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const reasonId = `${uid}-publish-reason`;
  return (
    <div>
      <p>{t("admin.config.serverOnly")}</p>
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
  );
}
