import { VisuallyHidden, visuallyHiddenStyle } from "@querymodule/web-ui";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { BuilderTree } from "./BuilderTree.js";
import { existingPointer } from "./builder-helpers.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { ChangesView } from "./ChangesView.js";
import { ChecksContext, useDraftChecks, withServerIssues } from "./checks.js";
import type { JsonObject } from "./draft.js";
import { FormTab } from "./FormTab.js";
import { HistoryDrawer } from "./HistoryDrawer.js";
import { LeaveGuard } from "./LeaveGuard.js";
import { useMarkSelected } from "./mark-selected.js";
import { BuilderPreview } from "./Preview.js";
import { PublishButtons, PublishDialogs, PublishNotices } from "./PublishControls.js";
import { usePublishFlow } from "./PublishFlow.js";
import { type RawState, RawTab } from "./RawTab.js";
import {
  defaultPointer,
  isRootIssue,
  issueWords,
  type Selection,
  SelectionContext,
} from "./selection.js";
import { TABS, type TabId, tabAfterKey } from "./tabs.js";
import { useUndoKeys } from "./undo-keys.js";

// Marks a quiet snapshot whose server verdict is not captured yet (see quiet).
const QUIET_PENDING = Symbol("quiet-pending");

export function BuilderBody({ doc }: { doc: JsonObject }) {
  const t = useT();
  const uid = useId();
  const { labels, undoCount, redoCount, server } = useDraft();
  const { announcer } = useServices();
  const localChecks = useDraftChecks(doc, labels, server?.liveLabels);
  const flow = usePublishFlow();
  // Issues the server found when the draft was last checked join the browser's own, until an edit.
  const checks = useMemo(
    () => withServerIssues(localChecks, flow.serverIssues),
    [localChecks, flow.serverIssues],
  );
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
    const target = tabAfterKey(tab, e.key);
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
  const historyRef = useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Esc and Close return focus to the button that opened the history.
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    historyRef.current?.focus();
  }, []);
  const errorCount = checks.issues.filter((i) => i.level === "error").length;
  const warningCount = checks.issues.length - errorCount;
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
  // The server found errors on Review and publish: go to the first, as the issue button does.
  const seenIssues = useRef(flow.issueSeq);
  useEffect(() => {
    if (flow.issueSeq === seenIssues.current || flow.serverIssues === null) return;
    seenIssues.current = flow.issueSeq;
    goToFirstIssue();
  }, [flow.issueSeq, flow.serverIssues, goToFirstIssue]);
  // The selection goes into each history step, so an undo can put it back (B1).
  useEffect(() => {
    store.getState().setMeta(shown.pointer);
  }, [store, shown.pointer]);
  const scopeRef = useRef<HTMLDivElement>(null);
  // Focus lost to an undo (the item it was in went away) goes to the selected tree row; the keys
  // work from there. `settle` waits for the restored selection to be on screen.
  const settle = useRef<{ pointer: string | null } | null>(null);
  // An undo or redo speaks one announcement, the shared "Undone": the draft summary below updates
  // silently for the restored draft (aria-live off) and is polite again from the next edit (#485).
  // A new server verdict or an unparsable Raw edit is a user action of its own: it speaks again.
  // The server verdict the restored draft shows is only known once it renders (PublishFlow ties a
  // verdict to the draft it was found for), so the step marks it pending and an effect captures it.
  const [quiet, setQuiet] = useState<{ doc: JsonObject; issues: unknown } | null>(null);
  const step = useCallback(
    (direction: "undo" | "redo") => {
      // The raw text follows the draft again: an undone step can bring back a document the raw
      // tab made itself, which it would otherwise take for its own text and keep.
      rawDoc.current = null;
      const restored = direction === "undo" ? store.getState().undo() : store.getState().redo();
      if (restored === null) return;
      settle.current = { pointer: restored.meta };
      setQuiet({ doc: store.getState().doc as JsonObject, issues: QUIET_PENDING });
      // On the Raw tab there is no item to show: keep the tab, restore the selection under it.
      if (restored.meta !== null) {
        const pointer = restored.meta;
        if (tab !== "form") setSelection((s) => ({ pointer, seq: s.seq + 1 }));
        else onSelect(pointer);
      }
      // The shared live region only: the builder's own summary is quiet for this draft (quiet).
      const { undoCount: undos, redoCount: redos } = store.getState();
      announcer.announce(
        direction === "undo"
          ? t("admin.config.undone", { count: undos })
          : t("admin.config.redone", { count: redos }),
      );
    },
    [store, onSelect, announcer, t, tab],
  );
  const serverIssues = flow.serverIssues;
  useEffect(() => {
    if (quiet?.issues === QUIET_PENDING && doc === quiet.doc)
      setQuiet({ doc: quiet.doc, issues: serverIssues });
  }, [quiet, doc, serverIssues]);
  useEffect(() => {
    const waiting = settle.current;
    if (waiting === null || (waiting.pointer !== null && shown.pointer !== waiting.pointer)) return;
    settle.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    scopeRef.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
  });
  useUndoKeys(scopeRef, step);
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
            {server === null
              ? ""
              : `${t("admin.config.status.draft", {
                  version: server.baseVersion,
                  changes: t(
                    flow.changeCount === 0
                      ? "admin.config.status.none"
                      : flow.changeCount === 1
                        ? "admin.config.status.one"
                        : "admin.config.status.many",
                    { count: flow.changeCount },
                  ),
                })}${flow.unsaved ? ` ${t("admin.config.status.unsaved")}` : ""}`}
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
          <button
            ref={historyRef}
            type="button"
            className="qm-button qm-button--secondary"
            aria-expanded={historyOpen}
            aria-controls={`${uid}-history`}
            onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
          >
            {t("admin.config.history")}
          </button>
          <PublishButtons flow={flow} parseError={raw.parseError !== null} />
          {historyReason !== null && (
            <p className="qm-builder__reason" id={historyReasonId}>
              {historyReason}
            </p>
          )}
        </div>
        <div className="qm-builder__body">
          <PublishNotices flow={flow} />
          {historyOpen && (
            <HistoryDrawer
              id={`${uid}-history`}
              stamp={flow.historyStamp}
              onClose={closeHistory}
              onRollback={flow.askRollback}
            />
          )}
          {/* The issue button shows the counts; this stays as the polite announcement (Task 33). */}
          <div
            data-testid="draft-summary"
            aria-live={
              quiet !== null &&
              doc === quiet.doc &&
              (quiet.issues === QUIET_PENDING || flow.serverIssues === quiet.issues) &&
              raw.parseError === null
                ? "off"
                : "polite"
            }
            style={visuallyHiddenStyle}
          >
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
      <PublishDialogs
        flow={flow}
        doc={doc}
        fallback={() =>
          scopeRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
        }
        rollbackFallback={() =>
          historyRef.current ??
          scopeRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
          null
        }
      />
      <LeaveGuard
        dirty={flow.unsaved}
        fallback={() =>
          scopeRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
        }
      />
    </ChecksContext.Provider>
  );
}
