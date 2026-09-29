import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { ChecksContext, useDraftChecks } from "./checks.js";
import { docFromClient, type JsonObject } from "./draft.js";
import { FormTab } from "./FormTab.js";
import { BuilderPreview } from "./Preview.js";
import { type RawState, RawTab } from "./RawTab.js";
import { useCachedClientConfig } from "./use-cached-config.js";

export { configDraftStore } from "./builder-store.js";

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
              className="qm-button"
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
