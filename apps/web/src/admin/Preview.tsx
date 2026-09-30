import { createDraftStore, createTranslator, type Translator } from "@querymodule/client";
import { type ClientSiteConfig, ClientSiteConfigSchema } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { I18nProvider, useT, useTranslator } from "../app/i18n-context.js";
import { QueryPanelView } from "../query/QueryPanelView.js";
import type { JsonObject } from "./draft.js";
import { topItem } from "./selection.js";
import { useCachedClientConfig, useCachedConfigFailed } from "./use-cached-config.js";

/** A fixed hash: the preview never submits, so no server compares it (ADR-0011 item 4). */
const PREVIEW_HASH = "0".repeat(64);

/** The builder's draft as the client view the dispatcher panel reads, or null if it does not fit. */
export function previewConfig(doc: JsonObject): ClientSiteConfig | null {
  const parsed = ClientSiteConfigSchema.safeParse({ ...doc, configHash: PREVIEW_HASH });
  return parsed.success ? parsed.data : null;
}

/** The app's strings with the draft's label overlay for the same locale on top. */
function useOverlayTranslator(labels: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  const base = useTranslator();
  const overlay = labels[base.locale];
  return useMemo<Translator>(() => {
    if (overlay === undefined || Object.keys(overlay).length === 0) return base;
    const over = createTranslator(base.locale, { ...overlay });
    return {
      locale: base.locale,
      has: (key) => over.has(key) || base.has(key),
      t: (key, params) => (over.has(key) ? over.t(key, params) : base.t(key, params)),
    };
  }, [base, overlay]);
}

/** The query type a tree pointer is in ("/queryTypes/2/fields/1" is the third type), if any. */
function selectedTypeCode(doc: JsonObject, pointer: string | null): string | undefined {
  if (pointer === null) return undefined;
  const m = /^\/queryTypes\/([0-9]+)(\/|$)/.exec(pointer);
  const types = doc.queryTypes;
  if (m === null || !Array.isArray(types)) return undefined;
  const code = (types[Number(m[1])] as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

type Persona = "dispatcher" | "officer";
const PERSONAS: readonly Persona[] = ["dispatcher", "officer"];

/**
 * Task 32 (#357) and A4: the dispatcher's own panel (QueryPanelView, mode "preview") fed from the
 * settled draft, as the dispatcher or, with the touch layout class only, as the officer.
 *
 * - Empty: a site item is selected, so there is no query type to show. The panel stays mounted
 *   (hidden), so what was typed in it survives.
 * - Loading: no valid config to show yet (the live one is still loading): a busy skeleton.
 * - Paused: the draft has errors. The last valid preview stays visible, dimmed and inert, under a
 *   banner. The banner is not a live region: the builder's polite summary announces the counts.
 *
 * The preview owns a private, memory-only draft store; submit validates like the live form and
 * never sends (Track B Task 19). The region is aria-busy while a builder edit has not settled
 * into it yet (#357: tests and assistive tech wait on it).
 */
export function BuilderPreview({
  doc,
  labels,
  blocked,
  pending,
  selected,
  selectSeq,
  errorCount,
  parseError,
  onGoToError,
}: {
  doc: JsonObject;
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  blocked: boolean;
  /** The builder draft has changed since `doc` settled. */
  pending: boolean;
  /** The pointer the tree selected (a site item or LABELS_ITEM shows the empty state). */
  selected: string | null;
  /** Changes on every tree selection, so picking the same type again re-applies it. */
  selectSeq: number;
  errorCount: number;
  /** The Raw JSON text does not parse. */
  parseError: boolean;
  /** Goes to the first error the way the issue button does; absent when there is none to go to. */
  onGoToError?: () => void;
}) {
  const t = useT();
  const headingId = useId();
  const idPrefix = useId();
  const [drafts] = useState(createDraftStore);
  const [persona, setPersona] = useState<Persona>("dispatcher");
  const translator = useOverlayTranslator(labels);
  const candidate = useMemo(() => (blocked ? null : previewConfig(doc)), [blocked, doc]);
  // The last good draft config, held in state (no render-phase writes); before there is one, for
  // example on reopening the builder on a draft with errors, the live site config (critic 1, 2).
  const [lastGood, setLastGood] = useState<ClientSiteConfig | null>(null);
  useEffect(() => {
    if (candidate !== null) setLastGood(candidate);
  }, [candidate]);
  const live = useCachedClientConfig();
  const liveFailed = useCachedConfigFailed();
  const config = candidate ?? lastGood ?? live ?? null;
  const paused = candidate === null;
  // Loading: there is no valid config to show yet and the live one is still on its way.
  const loading = config === null && !liveFailed;
  const empty = selected !== null && topItem(selected) !== "queryTypes";
  // Focus that was inside the panel when it went inert would be lost: repair it (never otherwise),
  // and give it back to the panel when the banner that took it goes away.
  const panelRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const repaired = useRef(false);
  useLayoutEffect(() => {
    if (paused) {
      if (panelRef.current?.contains(document.activeElement)) {
        (goRef.current ?? bannerRef.current)?.focus();
        repaired.current = true;
      }
      return;
    }
    const active = document.activeElement;
    if (repaired.current && (active === null || active === document.body))
      panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    repaired.current = false;
  }, [paused]);
  const pausedText = parseError
    ? t("admin.preview.pausedJson")
    : errorCount > 0
      ? t("admin.preview.pausedErrors", {
          errors: t(errorCount === 1 ? "admin.issues.error" : "admin.issues.errors", {
            count: errorCount,
          }),
        })
      : t("admin.preview.pausedUnfit");
  const showPanel = config !== null && !empty;
  return (
    <section
      className="qm-admin__preview qm-preview"
      aria-labelledby={headingId}
      aria-busy={pending || loading ? true : undefined}
    >
      <div className="qm-preview__head">
        <h3 id={headingId}>{t("admin.preview.title")}</h3>
        <fieldset className="qm-seg">
          <legend>
            <VisuallyHidden>{t("admin.preview.as")}</VisuallyHidden>
          </legend>
          {PERSONAS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={persona === p}
              onClick={() => setPersona(p)}
            >
              {t(p === "officer" ? "admin.preview.asOfficer" : "admin.preview.asDispatcher")}
            </button>
          ))}
        </fieldset>
      </div>
      {empty && <p className="qm-preview__state">{t("admin.preview.empty")}</p>}
      {paused && (
        <div ref={bannerRef} className="qm-preview__banner" tabIndex={-1}>
          <p>{showPanel ? `${pausedText} ${t("admin.preview.showingLast")}` : pausedText}</p>
          {onGoToError !== undefined && (
            <button ref={goRef} type="button" className="qm-button" onClick={onGoToError}>
              {t("admin.preview.goToError")}
            </button>
          )}
        </div>
      )}
      {loading && !empty && (
        <div className="qm-preview__skeleton" aria-busy="true">
          <VisuallyHidden>{t("admin.preview.loading")}</VisuallyHidden>
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
        </div>
      )}
      {config !== null && (
        <div
          ref={panelRef}
          className={
            persona === "officer" ? "qm-preview__panel qm-layout--mobile-unit" : "qm-preview__panel"
          }
          hidden={empty}
          inert={paused}
          data-paused={paused ? "true" : undefined}
        >
          <I18nProvider translator={translator}>
            <QueryPanelView
              config={config}
              drafts={drafts}
              mode="preview"
              idPrefix={idPrefix}
              selectType={selectedTypeCode(doc, selected)}
              selectTypeSeq={selectSeq}
            />
          </I18nProvider>
        </div>
      )}
      <p className="qm-preview__note">{t("admin.preview.note")}</p>
    </section>
  );
}
