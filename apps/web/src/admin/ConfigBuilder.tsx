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
import { ChangesView } from "./ChangesView.js";
import { ChecksContext, useDraftChecks } from "./checks.js";
import { revealAndFocus } from "./controls.js";
import { docFromClient, type JsonObject } from "./draft.js";
import { FormTab } from "./FormTab.js";
import { hasPointer, parentPointer } from "./issues.js";
import { LeaveGuard } from "./LeaveGuard.js";
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

export const TABS = ["form", "raw", "changes"] as const;
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
  // The seq whose Changes-view open already took focus: coming back to the Form tab later, with
  // that selection still current, must not pull focus into the item again.
  const focused = useRef(-1);
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
      } else if (selection.focusNode === true && focused.current !== selection.seq) {
        focused.current = selection.seq;
        // Opened from the Changes view: the button that was clicked went with its view, so focus
        // goes to the item's first control, else to the selected tree row.
        const control = el.querySelector<HTMLElement>(
          "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled):not([aria-disabled=true]), summary",
        );
        if (control) revealAndFocus(control);
        else
          root
            .closest(".qm-builder__scope")
            ?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
            ?.focus();
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
      if (el !== null) {
        apply(el, undefined);
      } else if (selection.focusNode === true && focused.current !== selection.seq) {
        // Nothing to open: the clicked entry has gone, so focus goes to the selected tree row.
        focused.current = selection.seq;
        root
          .closest(".qm-builder__scope")
          ?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
          ?.focus();
      }
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

/** A control that has its own text undo: text-like inputs, textareas and editable content. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ![
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "range",
    "color",
    "file",
    "image",
  ].includes(target.type);
}

function BuilderBody({ doc }: { doc: JsonObject }) {
  const t = useT();
  const uid = useId();
  const { labels, undoCount, redoCount } = useDraft();
  const { announcer } = useServices();
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
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    form: null,
    raw: null,
    changes: null,
  });
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
  // An entry of the Changes view: open its item and focus it (the click is the user's action).
  const onOpen = useCallback((pointer: string) => {
    setTab("form");
    setSelection((s) => ({ pointer, seq: s.seq + 1, focusNode: true }));
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
  // The selection goes into each history step, so an undo can put it back (B1).
  useEffect(() => {
    store.getState().setMeta(shown.pointer);
  }, [store, shown.pointer]);
  const scopeRef = useRef<HTMLDivElement>(null);
  // Focus lost to an undo (the item it was in went away) goes to the selected tree row; the keys
  // work from there. `settle` waits for the restored selection to be on screen.
  const settle = useRef<{ pointer: string | null } | null>(null);
  const step = useCallback(
    (direction: "undo" | "redo") => {
      // The raw text follows the draft again: an undone step can bring back a document the raw
      // tab made itself, which it would otherwise take for its own text and keep.
      rawDoc.current = null;
      const restored = direction === "undo" ? store.getState().undo() : store.getState().redo();
      if (restored === null) return;
      settle.current = { pointer: restored.meta };
      // On the Raw tab there is no item to show: keep the tab, restore the selection under it.
      if (restored.meta !== null) {
        const pointer = restored.meta;
        if (tab !== "form") setSelection((s) => ({ pointer, seq: s.seq + 1 }));
        else onSelect(pointer);
      }
      // The shared live region only: the builder's own summary is not touched.
      const { undoCount: undos, redoCount: redos } = store.getState();
      announcer.announce(
        direction === "undo"
          ? t("admin.config.undone", { count: undos })
          : t("admin.config.redone", { count: redos }),
      );
    },
    [store, onSelect, announcer, t, tab],
  );
  useEffect(() => {
    const waiting = settle.current;
    if (waiting === null || (waiting.pointer !== null && shown.pointer !== waiting.pointer)) return;
    settle.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    scopeRef.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
  });
  // Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (Command on a Mac) inside the builder only, and never in a text
  // entry, where the browser's own undo belongs to the field (a native listener: the scope is a
  // wrapper with no role, so a React key handler on it would be a lint error and a false widget).
  useEffect(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    const onKeys = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // The key by its letter, or by its place on the keyboard on a layout with no Latin letter.
      const key = /^[a-z]$/i.test(e.key)
        ? e.key.toLowerCase()
        : e.code.replace("Key", "").toLowerCase();
      const undo = key === "z" && !e.shiftKey;
      // Ctrl+Y only: Cmd+Y is the browser's History on a Mac.
      const redo =
        (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey);
      if ((!undo && !redo) || isTextEntry(e.target)) return;
      e.preventDefault();
      step(undo ? "undo" : "redo");
    };
    scope.addEventListener("keydown", onKeys);
    return () => scope.removeEventListener("keydown", onKeys);
  }, [step]);
  const historyReasonId = `${uid}-history-reason`;
  const historyReason =
    undoCount === 0 && redoCount === 0
      ? t("admin.config.historyNone")
      : undoCount === 0
        ? t("admin.config.undoNone")
        : redoCount === 0
          ? t("admin.config.redoNone")
          : null;
  const canGoToError =
    checks.status === "ready" && firstIssue !== undefined && raw.parseError === null;
  return (
    <ChecksContext.Provider value={checks}>
      <div ref={scopeRef} className="qm-builder__scope">
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
          {/* Undo and redo stay focusable when there is nothing to do, with the reason (spec 6.2). */}
          <button
            type="button"
            className="qm-button qm-button--secondary"
            aria-disabled={undoCount === 0 ? "true" : undefined}
            aria-describedby={undoCount === 0 ? historyReasonId : undefined}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={() => step("undo")}
          >
            {t("admin.config.undo")}
          </button>
          <button
            type="button"
            className="qm-button qm-button--secondary"
            aria-disabled={redoCount === 0 ? "true" : undefined}
            aria-describedby={redoCount === 0 ? historyReasonId : undefined}
            aria-keyshortcuts="Control+Shift+Z Control+Y Meta+Shift+Z"
            onClick={() => step("redo")}
          >
            {t("admin.config.redo")}
          </button>
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
          {historyReason !== null && (
            <p className="qm-builder__reason" id={historyReasonId}>
              {historyReason}
            </p>
          )}
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
              ) : tab === "raw" ? (
                <RawTab raw={raw} setRaw={setRaw} onRawDoc={onRawDoc} />
              ) : (
                <ChangesView doc={doc} onOpen={onOpen} />
              )}
            </div>
            {checks.doc !== null && (
              <BuilderPreview
                doc={checks.doc}
                labels={checks.labels}
                blocked={raw.parseError !== null || errorCount > 0}
                pending={checks.doc !== doc || checks.labels !== labels}
                selected={shown.pointer}
                selectSeq={shown.seq}
                errorCount={errorCount}
                parseError={raw.parseError !== null}
                onGoToError={canGoToError && errorCount > 0 ? goToFirstIssue : undefined}
              />
            )}
          </div>
        </div>
      </div>
      <LeaveGuard
        dirty={changed}
        fallback={() =>
          scopeRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
        }
      />
    </ChecksContext.Provider>
  );
}
