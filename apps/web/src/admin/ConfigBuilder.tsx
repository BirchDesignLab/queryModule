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
import { useServices } from "../app/services-context.js";
import { BuilderTree } from "./BuilderTree.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { ChecksContext, useDraftChecks } from "./checks.js";
import { docFromClient, type JsonObject } from "./draft.js";
import { FormTab } from "./FormTab.js";
import { BuilderPreview } from "./Preview.js";
import { type RawState, RawTab } from "./RawTab.js";
import { type Selection, SelectionContext } from "./selection.js";
import { useCachedClientConfig } from "./use-cached-config.js";

export { configDraftStore } from "./builder-store.js";

export const TABS = ["form", "raw"] as const;
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
  if (doc === null && failed)
    return (
      <p className="qm-builder__body" role="alert">
        {t("admin.config.loadError")}
      </p>
    );
  if (doc === null)
    return (
      <p className="qm-builder__body" aria-busy="true">
        {t("admin.config.loading")}
      </p>
    );
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

/**
 * Marks the selected item in the editor and scrolls to it (A-D1 A2). The item renders once its
 * section or type has opened, so this retries for a few frames. The mark is a DOM attribute, not
 * React state, so memoized rows do not re-render on every selection.
 */
function useMarkSelected(panel: React.RefObject<HTMLDivElement | null>, selection: Selection) {
  useEffect(() => {
    const root = panel.current;
    const pointer = selection.pointer;
    if (root === null || pointer === null) return;
    for (const el of root.querySelectorAll("[data-selected]")) el.removeAttribute("data-selected");
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mark = () => {
      const el = root.querySelector<HTMLElement>(`[data-path="${CSS.escape(pointer)}"]`);
      if (el === null) {
        if (tries++ < 20) timer = setTimeout(mark, 16);
        return;
      }
      el.setAttribute("data-selected", "true");
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
      el.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
    };
    mark();
    return () => clearTimeout(timer);
  }, [panel, selection]);
}

/**
 * Whether the draft differs from the live config (design lead 09-29-26: no count and no "saved"
 * before the config store, AC2). Label overlay entries count as changes.
 */
function useDraftChanged(doc: JsonObject, labels: Readonly<Record<string, object>>): boolean {
  const live = useCachedClientConfig();
  const liveText = useMemo(
    () => (live === undefined ? null : JSON.stringify(docFromClient(live))),
    [live],
  );
  const docText = useMemo(() => JSON.stringify(doc), [doc]);
  const labelled = Object.values(labels).some((l) => Object.keys(l).length > 0);
  return labelled || (liveText !== null && docText !== liveText);
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
  const [selection, setSelection] = useState<Selection>({ pointer: null, seq: 0 });
  const onSelect = useCallback((pointer: string) => {
    setTab("form");
    setSelection((s) => ({ pointer, seq: s.seq + 1 }));
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  useMarkSelected(panelRef, selection);
  const reasonId = `${uid}-publish-reason`;
  const errorCount = checks.issues.filter((i) => i.level === "error").length;
  const warningCount = checks.issues.length - errorCount;
  const changed = useDraftChanged(doc, labels);
  return (
    <ChecksContext.Provider value={checks}>
      {/* The section h2 sits just before this bar and reads as its title (design target, A2). */}
      <div className="qm-builder__toolbar">
        <p className="qm-builder__status" data-testid="draft-status">
          {t(changed ? "admin.config.status.changed" : "admin.config.status.unchanged")}
        </p>
        <div
          role="tablist"
          aria-label={t("admin.config.tabsLabel")}
          className="qm-seg qm-builder__views"
        >
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
        {/* Spec 6.2: aria-disabled keeps both focusable, and one visible reason describes both. */}
        <button
          type="button"
          className="qm-button qm-button--secondary"
          aria-disabled="true"
          aria-describedby={reasonId}
        >
          {t("admin.config.history")}
        </button>
        <button
          type="button"
          className="qm-button"
          aria-disabled="true"
          aria-describedby={reasonId}
        >
          {t("admin.config.publish")}
        </button>
        <p className="qm-builder__reason" id={reasonId}>
          {t("admin.config.publishDisabled")}
        </p>
      </div>
      <div className="qm-builder__body">
        <p>{t("admin.config.serverOnly")}</p>
        <div data-testid="draft-summary" aria-live="polite">
          {raw.parseError !== null ? (
            <p>{t("admin.config.raw.notParsed")}</p>
          ) : checks.status === "error" ? (
            <p>{t("admin.config.raw.bundleError")}</p>
          ) : checks.status === "loading" ? (
            <p>{t("admin.config.raw.checksLoading")}</p>
          ) : (
            <p>{t("admin.config.raw.counts", { errors: errorCount, warnings: warningCount })}</p>
          )}
        </div>
        <div className="qm-builder__panes">
          <BuilderTree doc={doc} selected={selection.pointer} onSelect={onSelect} />
          <div
            ref={panelRef}
            className="qm-builder__editor"
            role="tabpanel"
            id={`${uid}-panel`}
            aria-labelledby={`${uid}-tab-${tab}`}
          >
            {tab === "form" ? (
              <SelectionContext.Provider value={selection}>
                <FormTab doc={doc} />
              </SelectionContext.Provider>
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
