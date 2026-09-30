import { VisuallyHidden, visuallyHiddenStyle } from "@querymodule/web-ui";
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
import { revealAndFocus } from "./controls.js";
import { docFromClient, type JsonObject } from "./draft.js";
import { FormTab } from "./FormTab.js";
import { hasPointer, parentPointer } from "./issues.js";
import { BuilderPreview } from "./Preview.js";
import { type RawState, RawTab } from "./RawTab.js";
import {
  defaultPointer,
  isRootIssue,
  issueWords,
  type Selection,
  SelectionContext,
  topItem,
} from "./selection.js";
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

/** A top-level item's own pointer ("/commands", "/queryTypes/2"), which the editor shows whole. */
function isTopPointer(pointer: string): boolean {
  const depth = pointer.split("/").length - 1;
  return depth <= (topItem(pointer) === "queryTypes" ? 2 : 1);
}

/**
 * A selection that no longer exists after a draft change (a raw edit, a removed item) moves to
 * what does, so the tree and the editor show the same item (critic m4): a type index past the
 * end goes to the last type, anything else to its nearest existing parent.
 */
function existingPointer(doc: JsonObject, pointer: string): string | null {
  if (pointer.startsWith("#") || hasPointer(doc, pointer)) return pointer;
  const types = Array.isArray(doc.queryTypes) ? doc.queryTypes.length : 0;
  const m = /^\/queryTypes\/([0-9]+)/.exec(pointer);
  if (m !== null && types > 0 && Number(m[1]) >= types) return `/queryTypes/${types - 1}`;
  for (let p = parentPointer(pointer); p !== null && p !== ""; p = parentPointer(p))
    if (hasPointer(doc, p) && !isTopArray(p)) return p;
  return null;
}

/** "/queryTypes" itself is not an item the editor can show; its elements are. */
const isTopArray = (pointer: string) => pointer === "/queryTypes";

/**
 * Marks the selected item in the editor and scrolls to it (A-D1 A2); for the issue button, also
 * focuses the issue's control. The mark is a DOM attribute, not React state, so memoized rows do
 * not re-render on every selection.
 */
function useMarkSelected(
  panel: React.RefObject<HTMLDivElement | null>,
  selection: Selection,
  tab: TabId,
) {
  useEffect(() => {
    const root = panel.current;
    const pointer = selection.pointer;
    // The Raw JSON view has no items; returning to the form marks and scrolls again (critic m7).
    if (root === null || pointer === null || tab !== "form") return;
    for (const el of root.querySelectorAll("[data-selected]")) el.removeAttribute("data-selected");
    const focus = selection.focus;
    const find = (p: string) => root.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`);
    // Done when the item has rendered and, for the issue button, the issue's message too.
    const nearest = (from: string | null) => {
      let el: HTMLElement | null = null;
      for (let p = from; p !== null && p !== "" && el === null; p = parentPointer(p)) el = find(p);
      return el;
    };
    const ready = () => {
      if (focus === undefined) {
        const el = find(pointer);
        return el === null ? null : { el, message: null };
      }
      // An issue may sit on a leaf value with no item of its own: once its message has rendered,
      // mark the nearest item that holds it.
      const message = root.querySelector(
        `[data-issue-pointer="${CSS.escape(focus)}"]`,
      )?.parentElement;
      const el = message === null || message === undefined ? null : nearest(pointer);
      return el === null ? null : { el, message };
    };
    const apply = (el: HTMLElement, message: Element | null | undefined) => {
      // The editor shows only the selected top-level item, so marking that item would tint the
      // whole pane: only a part inside it (a section, a field) is marked (critic m6).
      if (!isTopPointer(pointer)) el.setAttribute("data-selected", "true");
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
      el.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
      const rootMessages = message?.closest<HTMLElement>("[data-root-issues]");
      if (rootMessages) rootMessages.focus();
      else if (message?.id) {
        // The control the issue's message describes, or the first control of the item it
        // describes (an item-level issue).
        const described = root.querySelector<HTMLElement>(
          `[aria-describedby~="${CSS.escape(message.id)}"]`,
        );
        const control = described?.matches("input, select, textarea, button, summary, [tabindex]")
          ? described
          : described?.querySelector<HTMLElement>("input, select, textarea, button");
        if (control) revealAndFocus(control);
      }
    };
    const now = ready();
    if (now !== null) {
      apply(now.el, now.message);
      return;
    }
    // The section or type opens on this selection, so the item renders after this effect: watch
    // the editor until it appears. If it never does (an issue on a value with no item of its own),
    // mark the nearest rendered item above it after a while.
    const observer = new MutationObserver(() => {
      const found = ready();
      if (found === null) return;
      stop();
      apply(found.el, found.message);
    });
    const fallback = setTimeout(() => {
      stop();
      const el = nearest(parentPointer(pointer));
      if (el !== null) apply(el, undefined);
    }, 3000);
    const stop = () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
    observer.observe(root, { childList: true, subtree: true });
    return stop;
  }, [panel, selection, tab]);
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
  const onSelect = useCallback((pointer: string, focus?: string) => {
    setTab("form");
    setSelection((s) => ({ pointer, seq: s.seq + 1, ...(focus === undefined ? {} : { focus }) }));
  }, []);
  // Errors outrank warnings: the button goes to the first error, else the first warning.
  const firstIssue = checks.issues.find((i) => i.level === "error") ?? checks.issues[0];
  const panelRef = useRef<HTMLDivElement>(null);
  useMarkSelected(panelRef, selection, tab);
  // Before any selection the editor shows the first query type (design lead 09-29-26).
  const fallback = defaultPointer(doc);
  const shown = useMemo<Selection>(
    () => ({ ...selection, pointer: selection.pointer ?? fallback, select: onSelect }),
    [selection, fallback, onSelect],
  );
  useEffect(() => {
    const p = selection.pointer;
    if (p === null) return;
    const next = existingPointer(doc, p);
    if (next !== p) setSelection((s) => ({ pointer: next, seq: s.seq }));
  }, [doc, selection.pointer]);
  const reasonId = `${uid}-publish-reason`;
  const errorCount = checks.issues.filter((i) => i.level === "error").length;
  const warningCount = checks.issues.length - errorCount;
  const changed = useDraftChanged(doc, labels);
  // The issue button and the preview's "Go to the error" share this path: select the issue's item,
  // then focus its control (useMarkSelected). A whole-config issue has no item: keep the current
  // one and focus its message.
  const goToFirstIssue = useCallback(() => {
    if (firstIssue === undefined) return;
    onSelect(
      isRootIssue(doc, firstIssue.pointer) ? (shown.pointer ?? fallback) : firstIssue.pointer,
      firstIssue.pointer,
    );
  }, [doc, fallback, firstIssue, onSelect, shown.pointer]);
  const canGoToError =
    checks.status === "ready" && firstIssue !== undefined && raw.parseError === null;
  return (
    <ChecksContext.Provider value={checks}>
      {/* The section h2 sits just before this bar and reads as its title (design target, A2). */}
      <div className="qm-builder__toolbar">
        <p className="qm-builder__status" data-testid="draft-status">
          {t(changed ? "admin.config.status.changed" : "admin.config.status.unchanged")}
        </p>
        {canGoToError && (
          <button
            type="button"
            className={`qm-badge ${errorCount > 0 ? "qm-badge--critical" : "qm-badge--warning"} qm-builder__issues`}
            onClick={goToFirstIssue}
          >
            {issueWords(t, errorCount, warningCount)}
            <VisuallyHidden>. {t("admin.issues.goTo")}</VisuallyHidden>
          </button>
        )}
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
        {/* The issue button shows the counts; this stays as the polite announcement (Task 33). */}
        <div data-testid="draft-summary" aria-live="polite" style={visuallyHiddenStyle}>
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
          <BuilderTree doc={doc} selected={shown.pointer} onSelect={onSelect} />
          <div
            ref={panelRef}
            className="qm-builder__editor"
            role="tabpanel"
            id={`${uid}-panel`}
            aria-labelledby={`${uid}-tab-${tab}`}
          >
            {tab === "form" ? (
              <SelectionContext.Provider value={shown}>
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
              selected={shown.pointer}
              errorCount={errorCount}
              parseError={raw.parseError !== null}
              onGoToError={canGoToError && errorCount > 0 ? goToFirstIssue : undefined}
            />
          )}
        </div>
      </div>
    </ChecksContext.Provider>
  );
}
