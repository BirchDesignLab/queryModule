import { isRetryable, type RequestEntry, retryRequest, useStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { RequestList, type RequestRowView } from "@querymodule/web-ui";
import { memo, useEffect, useRef } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { outcomeAnnouncement } from "./announce-outcome.js";

export interface RequestsPaneProps {
  config: ClientSiteConfig;
  /** "list": every request this session (dispatcher). "last": only the latest (officer, spec 6.3). */
  variant: "list" | "last";
}

/**
 * This session's requests and their acknowledgments (B3). It reads the requests store, so it
 * shows a request whichever panel sent it. Announcements stay with the sender: this component
 * announces only that a reference was copied, on the user's own click, and the outcome of a retry
 * (the same sentences the form uses, through the shared region). Nothing here moves focus.
 * Memoised: the panel beside it re-renders on every keystroke, and this list (a row per request,
 * up to 100) reads its own store, so a keystroke has no reason to render it.
 */
export const RequestsPane = memo(function RequestsPane({ config, variant }: RequestsPaneProps) {
  const t = useT();
  const { announcer, requests, submit } = useServices();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const items = useStore(requests, (s) => s.items);
  const shown = variant === "last" ? items.slice(0, 1) : items;
  const labelOf = (labelKey: string | undefined, fallback: string): string =>
    labelKey === undefined ? fallback : t(labelKey);
  const typeLabel = (code: string): string =>
    labelOf(config.queryTypes.find((q) => q.code === code)?.labelKey, code);
  const sourceLabel = (id: string): string =>
    labelOf(config.sources.find((s) => s.id === id)?.labelKey, id);
  const rowOf = (entry: RequestEntry): RequestRowView => {
    const base = {
      id: entry.id,
      typeLabel: typeLabel(entry.queryType),
      summary: entry.summary,
    };
    if (entry.status === "sending") return { ...base, status: "sending", notes: [] };
    if (entry.status === "failed") {
      return {
        ...base,
        status: "failed",
        retryable: isRetryable(entry),
        failureText: t(`requests.failure.${entry.failure}`),
        notes: [],
      };
    }
    return {
      ...base,
      status: "acknowledged",
      reference: entry.correlationId,
      acknowledgedAt: entry.acknowledgedAt,
      // The 202 only acknowledges: each source the query went to is pending, and a part that was
      // skipped says only that it was not run (#382 A1).
      notes: [
        ...entry.parts
          .filter((part) => part.status === "skipped")
          .map((part) => t("submit.partNotRun", { queryType: typeLabel(part.queryType) })),
        // Two parts can go to one source: it is pending once.
        ...[
          ...new Set(entry.parts.filter((p) => p.status !== "skipped").flatMap((p) => p.sourceIds)),
        ].map((id) => t("requests.sourcePending", { source: sourceLabel(id) })),
      ],
    };
  };
  return (
    <RequestList
      rows={shown.map(rowOf)}
      heading={t(variant === "last" ? "requests.lastHeading" : "requests.heading")}
      // The officer sees one row; the dispatcher's list counts its rows once there are any.
      countText={
        variant === "list" && items.length > 0
          ? t("requests.count", { count: items.length })
          : undefined
      }
      emptyText={t(variant === "last" ? "requests.emptyLast" : "requests.empty")}
      onRetry={(rowId) => {
        // The failed row keeps its place; the values it kept go as a new request under the panel's
        // current config hash, and the new row joins the list.
        void retryRequest({ requests, submit }, rowId, config.configHash).then((result) => {
          if (!mounted.current) return;
          // A reset that leaves this pane mounted clears the rows: a late answer for a row that is
          // gone is not announced (the new row for a sent retry, the failed row for a gated one).
          const stillListed = (id: string): boolean =>
            requests.getState().items.some((item) => item.id === id);
          if (result.kind === "gated") {
            if (!stillListed(rowId)) return;
            announcer.announce(
              t(result.status === "submitting" ? "form.submitting" : "form.noConnection"),
            );
          }
          // A 409 makes the controller refetch the config (every cached copy, observed or not), and
          // the panel announces that change itself: a second sentence here would cut it off in the
          // shared region.
          else if (
            result.kind === "sent" &&
            result.outcome.kind !== "configChanged" &&
            stillListed(result.rowId)
          )
            announcer.announce(outcomeAnnouncement(result.outcome, t, typeLabel));
        });
      }}
      onCopy={(reference) => {
        // A failed copy (no permission, no clipboard) stays silent: the reference is on screen.
        void navigator.clipboard?.writeText(reference).then(
          () => announcer.announce(t("submit.referenceCopied")),
          () => undefined,
        );
      }}
      t={t}
    />
  );
});
