import { diffConfig } from "@querymodule/core/config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import {
  documentFrom,
  editorOf,
  fetchAdminConfig,
  publishDraft,
  rollbackTo,
  saveDraft,
  startOf,
  validateOnServer,
} from "./admin-config.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import type { JsonObject, LabelOverlay } from "./draft.js";
import type { DraftIssue } from "./issues.js";
import { mockChangeCount } from "./mock-model.js";

/**
 * Save, review and publish on the server draft (Task 33 part 2a, #358, BR-001, UX-004). The draft
 * lives on the server (ADR-0011 item 5); this keeps only what is in flight. Save sends the draft
 * on its live base; Review and publish saves, runs the spec 5.8 chain on the server, and only
 * with no errors opens a dialog listing the changes and a Publish button.
 */

/** Issues the server found, tied to the edits they were found for: any later edit retires them. */
interface ServerIssues {
  doc: JsonObject;
  labels: LabelOverlay;
  mock: JsonObject | null;
  issues: DraftIssue[];
}

type Notice = { kind: "info" | "error"; text: string };

export interface PublishFlow {
  unsaved: boolean;
  changeCount: number;
  version: number | null;
  busy: boolean;
  conflict: boolean;
  notice: Notice | null;
  /** Issues from the server for the current edits, or null. */
  serverIssues: readonly DraftIssue[] | null;
  /** Counts up each time the server found errors, so the builder can go to the first one. */
  issueSeq: number;
  /** The version the open review dialog would publish; null while it is closed. */
  reviewing: number | null;
  /** The confirm before the latest version replaces the edits is open. */
  confirmingReload: boolean;
  /** The version whose roll back confirm is open; null while it is closed. */
  rollingBack: number | null;
  /** Counts up whenever the version list changed (a roll back, a publish), so the history reloads. */
  historyStamp: number;
  /** A reload after a publish or roll back failed: the builder still shows the older base. */
  staleBase: boolean;
  save(): void;
  review(): void;
  publish(): void;
  cancelReview(): void;
  askReload(): void;
  cancelReload(): void;
  reload(): void;
  askRollback(version: number): void;
  cancelRollback(): void;
  rollback(): void;
  retryLoad(): void;
}

const labelText = (labels: LabelOverlay): string => JSON.stringify(labels);
const mockText = (mock: JsonObject | null | undefined): string => JSON.stringify(mock ?? null);

function labelChanges(labels: LabelOverlay, live: LabelOverlay): number {
  let n = 0;
  for (const locale of new Set([...Object.keys(labels), ...Object.keys(live)])) {
    const mine = labels[locale] ?? {};
    const theirs = live[locale] ?? {};
    for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)]))
      if (mine[key] !== theirs[key]) n++;
  }
  return n;
}

export function usePublishFlow(): PublishFlow {
  const services = useServices();
  const { api, announcer, queryClient } = services;
  const t = useT();
  const store = configDraftStore(services);
  const { doc, labels, mock, server } = useDraft();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [found, setFound] = useState<ServerIssues | null>(null);
  const [issueSeq, setIssueSeq] = useState(0);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [historyStamp, setHistoryStamp] = useState(0);
  // Which reload failed after a publish ("replace": the draft) or a roll back ("live": the diff).
  const [stale, setStale] = useState<"replace" | "live" | null>(null);
  // A "Load again" reload in flight: a second click while it runs asks the server nothing.
  const retrying = useRef(false);

  const unsaved = useMemo(() => {
    if (server === null || doc === null) return false;
    return (
      (doc !== server.savedDoc && JSON.stringify(doc) !== JSON.stringify(server.savedDoc)) ||
      labelText(labels) !== labelText(server.savedLabels) ||
      mockText(mock) !== mockText(server.savedMock)
    );
  }, [doc, labels, mock, server]);
  const changeCount = useMemo(() => {
    if (server === null || doc === null) return 0;
    return (
      diffConfig(server.liveDoc, doc).length +
      labelChanges(labels, server.liveLabels) +
      mockChangeCount(server.liveMock, mock)
    );
  }, [doc, labels, mock, server]);

  /** Runs `work` as the one action in flight; a second request while it runs does nothing. */
  const exclusive = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);

  /** Saves the edits on the live base: the saved draft's version, or why not. */
  const persist = useCallback(async (): Promise<
    { ok: true; version: number; document: ReturnType<typeof documentFrom> } | { ok: false }
  > => {
    const s = store.getState();
    if (s.server === null || s.doc === null) return { ok: false };
    const sent = { doc: s.doc, labels: s.labels, mock: s.mock };
    const document = documentFrom(s.server.document, sent.doc, sent.labels, sent.mock);
    const result = await saveDraft(api, s.server.baseVersion, document);
    if (!result.ok) {
      if (result.reason === "conflict") setConflict(true);
      else setNotice({ kind: "error", text: t("admin.config.saveFailed") });
      return { ok: false };
    }
    store.getState().markSaved(result.version.version, document, sent);
    // A saved draft is a version of its own: an open history shows it.
    setHistoryStamp((n) => n + 1);
    return { ok: true, version: result.version.version, document };
  }, [api, store, t]);

  const save = useCallback(
    () =>
      exclusive(async () => {
        setNotice(null);
        const saved = await persist();
        if (!saved.ok) return;
        setConflict(false);
        announcer.announce(t("admin.config.saved"));
        setNotice({ kind: "info", text: t("admin.config.saved") });
      }),
    [announcer, exclusive, persist, t],
  );

  const review = useCallback(
    () =>
      exclusive(async () => {
        setNotice(null);
        const s = store.getState();
        if (s.server === null || s.doc === null) return;
        const current = { doc: s.doc, labels: s.labels, mock: s.mock };
        let version = s.server.draftVersion;
        let document = s.server.document;
        if (version === null || unsaved) {
          const saved = await persist();
          if (!saved.ok) return;
          version = saved.version;
          document = saved.document;
        }
        const checked = await validateOnServer(api, document);
        if (!checked.ok) {
          setNotice({ kind: "error", text: t("admin.config.reviewFailed") });
          return;
        }
        const issues: DraftIssue[] = [...checked.errors, ...checked.warnings].map((d) => ({
          level: d.level,
          pointer: d.path,
          key: d.key,
          params: d.params,
        }));
        setFound({ ...current, issues });
        if (checked.errors.length > 0) {
          const count = t(
            checked.errors.length === 1 ? "admin.issues.error" : "admin.issues.errors",
            {
              count: checked.errors.length,
            },
          );
          announcer.announce(t("admin.config.reviewErrors", { count }));
          setIssueSeq((n) => n + 1);
          return;
        }
        setReviewing(version);
      }),
    [announcer, api, exclusive, persist, store, t, unsaved],
  );

  /** Re-reads the server's copy and replaces the draft with it (after a publish or a conflict). */
  const load = useCallback(
    async (preferLive: boolean): Promise<boolean> => {
      try {
        const config = await fetchAdminConfig(api);
        const next = startOf(config, { preferLive });
        store.getState().load(next.doc, next.labels, next.server);
        setFound(null);
        return true;
      } catch {
        return false;
      }
    },
    [api, store],
  );

  /** Re-reads the live version for the diff only: the draft and its base stay (after a roll back). */
  const refreshLive = useCallback(async (): Promise<boolean> => {
    try {
      const config = await fetchAdminConfig(api);
      const live = editorOf(config.live.document);
      store.getState().setLive(live.doc, live.labels, live.mock);
      return true;
    } catch {
      return false;
    }
  }, [api, store]);

  const publish = useCallback(
    () =>
      exclusive(async () => {
        const version = reviewing;
        if (version === null) return;
        const result = await publishDraft(api, version);
        if (!result.ok) {
          setReviewing(null);
          if (result.reason === "conflict") setConflict(true);
          else if (result.reason === "invalid") {
            const s = store.getState();
            if (s.doc !== null)
              setFound({
                doc: s.doc,
                labels: s.labels,
                mock: s.mock,
                issues: result.errors.map((e) => ({
                  level: "error",
                  pointer: typeof e.params?.path === "string" ? e.params.path : "",
                  key: e.key,
                  params: e.params ?? {},
                })),
              });
            setIssueSeq((n) => n + 1);
          } else setNotice({ kind: "error", text: t("admin.config.publishFailed") });
          return;
        }
        const text = t("admin.config.published", { version: result.version.version });
        setReviewing(null);
        setConflict(false);
        announcer.announce(text);
        setNotice({ kind: "info", text });
        // Dispatchers' view: the cached client config is refetched now, not at the next poll.
        void queryClient.invalidateQueries({ queryKey: ["config"], refetchType: "all" });
        setHistoryStamp((n) => n + 1);
        setStale((await load(false)) ? null : "replace");
      }),
    [announcer, api, exclusive, load, queryClient, reviewing, store, t],
  );

  const rollback = useCallback(
    () =>
      exclusive(async () => {
        const from = rollingBack;
        if (from === null) return;
        const result = await rollbackTo(api, from);
        setRollingBack(null);
        if (!result.ok) {
          setNotice({
            kind: "error",
            text: t(
              result.reason === "conflict"
                ? "admin.rollback.conflict"
                : result.reason === "invalid"
                  ? "admin.rollback.invalid"
                  : "admin.rollback.failed",
              { version: from },
            ),
          });
          // The live version moved under it: the list on screen is out of date.
          if (result.reason === "conflict") setHistoryStamp((n) => n + 1);
          return;
        }
        const text = t("admin.rollback.done", { version: result.version.version, from });
        announcer.announce(text);
        setNotice({ kind: "info", text });
        void queryClient.invalidateQueries({ queryKey: ["config"], refetchType: "all" });
        setHistoryStamp((n) => n + 1);
        // The draft is left as it is, so its base is now stale: the next save or publish takes the
        // 409 path. Only the live view the changes are counted against is refreshed.
        setStale((await refreshLive()) ? null : "live");
      }),
    [announcer, api, exclusive, queryClient, refreshLive, rollingBack, t],
  );

  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => {
    // A reset (sign-out) clears the draft under an open dialog: nothing left to ask about.
    if (doc === null) {
      setReviewing(null);
      setConfirmReload(false);
      setRollingBack(null);
      setStale(null);
    }
  }, [doc]);

  const serverIssues =
    found !== null && found.doc === doc && found.labels === labels && found.mock === mock
      ? found.issues
      : null;
  return {
    unsaved,
    changeCount,
    version: server?.baseVersion ?? null,
    busy,
    conflict,
    notice,
    serverIssues,
    issueSeq,
    reviewing,
    confirmingReload: confirmReload,
    rollingBack,
    historyStamp,
    staleBase: stale !== null,
    save: () => void save(),
    review: () => void review(),
    publish: () => void publish(),
    cancelReview: () => setReviewing(null),
    askReload: () => setConfirmReload(true),
    cancelReload: () => setConfirmReload(false),
    askRollback: (version) => setRollingBack(version),
    cancelRollback: () => setRollingBack(null),
    rollback: () => void rollback(),
    retryLoad: () => {
      // Edits made since the failed reload are not replaced without the same confirm as a conflict.
      if (stale === "replace" && unsaved) {
        setConfirmReload(true);
        return;
      }
      if (retrying.current) return;
      retrying.current = true;
      void (stale === "replace" ? load(false) : refreshLive()).then((ok) => {
        retrying.current = false;
        if (ok) setStale(null);
      });
    },
    reload: () => {
      setConfirmReload(false);
      void load(true).then((ok) => {
        if (ok) {
          setConflict(false);
          setNotice(null);
          setStale(null);
        } else setNotice({ kind: "error", text: t("admin.config.loadError") });
      });
    },
  };
}
