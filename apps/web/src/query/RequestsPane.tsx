import { type RequestEntry, useStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { RequestList, type RequestRowView } from "@querymodule/web-ui";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

export interface RequestsPaneProps {
  config: ClientSiteConfig;
  /** "list": every request this session (dispatcher). "last": only the latest (officer, spec 6.3). */
  variant: "list" | "last";
}

/**
 * This session's requests and their acknowledgments (B3). It reads the requests store, so it
 * shows a request whichever panel sent it. Announcements stay with the sender: this component
 * announces only that a reference was copied, on the user's own click.
 */
export function RequestsPane({ config, variant }: RequestsPaneProps) {
  const t = useT();
  const { announcer, requests } = useServices();
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
      notes: entry.parts.flatMap((part) =>
        part.status === "skipped"
          ? [t("submit.partNotRun", { queryType: typeLabel(part.queryType) })]
          : part.sourceIds.map((id) => t("requests.sourcePending", { source: sourceLabel(id) })),
      ),
    };
  };
  return (
    <RequestList
      rows={shown.map(rowOf)}
      heading={t(variant === "last" ? "requests.lastHeading" : "requests.heading")}
      emptyText={t(variant === "last" ? "requests.emptyLast" : "requests.empty")}
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
}
