import { createDraftStore, createTranslator, type Translator } from "@querymodule/client";
import { type ClientSiteConfig, ClientSiteConfigSchema } from "@querymodule/core/config";
import { useEffect, useId, useMemo, useState } from "react";
import { I18nProvider, useT, useTranslator } from "../app/i18n-context.js";
import { QueryPanelView } from "../query/QueryPanelView.js";
import type { JsonObject } from "./draft.js";
import { useCachedClientConfig } from "./use-cached-config.js";

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

/**
 * Task 32 (#357): the dispatcher's own panel (QueryPanelView, mode "preview") fed from the settled
 * draft. A draft with errors, or one that does not fit the client view, pauses the preview on the
 * last good config. The preview owns a private, memory-only draft store; submit validates like the
 * live form and never sends (Track B Task 19). The region is aria-busy while a builder edit has not
 * settled into it yet (#357: tests and assistive tech wait on it).
 */
export function BuilderPreview({
  doc,
  labels,
  blocked,
  pending,
}: {
  doc: JsonObject;
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  blocked: boolean;
  /** The builder draft has changed since `doc` settled. */
  pending: boolean;
}) {
  const t = useT();
  const headingId = useId();
  const idPrefix = useId();
  const [drafts] = useState(createDraftStore);
  const translator = useOverlayTranslator(labels);
  const candidate = useMemo(() => (blocked ? null : previewConfig(doc)), [blocked, doc]);
  // The last good draft config, held in state (no render-phase writes); before there is one, for
  // example on reopening the builder on a draft with errors, the live site config (critic 1, 2).
  const [lastGood, setLastGood] = useState<ClientSiteConfig | null>(null);
  useEffect(() => {
    if (candidate !== null) setLastGood(candidate);
  }, [candidate]);
  const live = useCachedClientConfig();
  const config = candidate ?? lastGood ?? live ?? null;
  const paused = candidate === null;
  return (
    <section
      className="qm-admin__preview"
      aria-labelledby={headingId}
      aria-busy={pending ? true : undefined}
    >
      <h3 id={headingId}>{t("admin.preview.title")}</h3>
      {paused && <p>{t("admin.preview.paused")}</p>}
      {config !== null && (
        <I18nProvider translator={translator}>
          <QueryPanelView config={config} drafts={drafts} mode="preview" idPrefix={idPrefix} />
        </I18nProvider>
      )}
    </section>
  );
}
