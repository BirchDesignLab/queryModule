import {
  isRetryable,
  type RequestEntry,
  retryRequest,
  type SubmittedQuery,
  useStore,
} from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import {
  RequestList,
  type RequestPartView,
  type RequestRowView,
  SeverityBadge,
  type SourceLineView,
} from "@querymodule/web-ui";
import { memo, useEffect, useRef, useState } from "react";
import { useResolvedPersona } from "../app/AppChrome.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { outcomeAnnouncement } from "./announce-outcome.js";
import { submittedOf } from "./edit-as-new.js";
import { requestAccessibleName } from "./request-name.js";
import { assessEntry, highestSeverity, skipReasonText, sourceWhy } from "./result-view.js";
import { rowSummary } from "./row-summary.js";
import { SourceCard } from "./SourceCard.js";

export interface RequestsPaneProps {
  config: ClientSiteConfig;
  /** "list": every request this session (dispatcher). "last": only the latest (officer, spec 6.3). */
  variant: "list" | "last";
  /**
   * Loads a row's values into the form as a new query (#477, G32). The panel owns the form, its note
   * and its focus; this pane offers the action on every settled row that still has its values (a
   * row this browser sent, or a listed one whose planned values have arrived). Absent, no row does.
   */
  onEditAsNew?: (rowId: string) => void;
  /**
   * A Retry from this list was acknowledged: the panel starts its form over, as it does for any
   * acknowledged run (R12), given what the retry sent.
   */
  onRetried?: (submitted: SubmittedQuery) => void;
}

/**
 * This session's requests and their acknowledgments (B3). It reads the requests store, so it
 * shows a request whichever panel sent it. Announcements stay with the sender: this component
 * announces only that a reference was copied, on the user's own click, and the outcome of a retry
 * (the same sentences the form uses, through the shared region). Nothing here moves focus.
 * Memoised: the panel beside it re-renders on every keystroke, and this list (a row per request,
 * up to 100) reads its own store, so a keystroke has no reason to render it.
 */
export const RequestsPane = memo(function RequestsPane({
  config,
  variant,
  onEditAsNew,
  onRetried,
}: RequestsPaneProps) {
  const t = useT();
  const persona = useResolvedPersona();
  const { announcer, requests, submit } = useServices();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const items = useStore(requests, (s) => s.items);
  // A Retry pressed while a request is in flight or the connection is down sends nothing; the row
  // says so beside the button until the gate lifts, so the press is never silent (G10).
  const [heldRows, setHeldRows] = useState<ReadonlyMap<string, string>>(new Map());
  const submitStatus = useStore(submit, (s) => s.status);
  useEffect(() => {
    if (submitStatus === "idle") setHeldRows((held) => (held.size === 0 ? held : new Map()));
  }, [submitStatus]);
  const shown = variant === "last" ? items.slice(0, 1) : items;
  const labelOf = (labelKey: string | undefined, fallback: string): string =>
    labelKey === undefined ? fallback : t(labelKey);
  const typeLabel = (code: string): string =>
    labelOf(config.queryTypes.find((q) => q.code === code)?.labelKey, code);
  // The configured label; the raw id only as a last resort, for a source the config does not list.
  const sourceLabel = (id: string): string => {
    const labelKey = config.sources.find((s) => s.id === id)?.labelKey;
    return labelKey === undefined ? t("sourceStatus.unlistedSource", { source: id }) : t(labelKey);
  };
  const rowOf = (entry: RequestEntry): RequestRowView => {
    const base = {
      id: entry.id,
      typeLabel: typeLabel(entry.queryType),
      // A row listed after a reload has no command: rebuilt from its primary part's values (G7).
      summary: rowSummary(
        config,
        entry.queryType,
        entry.summary,
        entry.status === "acknowledged"
          ? entry.parts.find((part) => part.parentPartId === null)?.values
          : undefined,
        Date.now(),
      ),
      name: requestAccessibleName(entry, typeLabel(entry.queryType), (time) =>
        t("requests.nameSent", { typeLabel: typeLabel(entry.queryType), time }),
      ),
    };
    if (entry.status === "sending") return { ...base, status: "sending", notes: [] };
    if (entry.status === "failed") {
      return {
        ...base,
        status: "failed",
        retryable: isRetryable(entry),
        // A 409 row offers no Retry (#434: the same values cannot succeed), so Edit as new query is
        // how it recovers what was typed (#477); the other failed rows offer it beside Retry (G32).
        editable: entry.submitted !== undefined,
        failureText: t(`requests.failure.${entry.failure}`),
        notes: heldRows.has(entry.id) ? [heldRows.get(entry.id) as string] : [],
      };
    }
    const highest = highestSeverity(assessEntry(entry, config.keywords));
    // The primary part is the one with no parent; a nested part says which type it was run from.
    const primaryType = entry.parts.find((part) => part.parentPartId === null)?.queryType;
    return {
      ...base,
      status: "acknowledged",
      // Every request can start the next one (G32), once its values are known.
      editable: submittedOf(entry) !== undefined,
      reference: entry.correlationId,
      acknowledgedAt: entry.acknowledgedAt,
      notes: [],
      ...(highest === null
        ? {}
        : {
            severityBadge: (
              <SeverityBadge
                severity={highest.severity}
                styles={config.keywordSeverityStyles}
                t={t}
              />
            ),
          }),
      // The 202 starts every dispatched pair at pending and the feed moves it (FR-043): a line is
      // keyed by request, part and source, so an event updates it in place and never remounts the
      // row. A returned source with its payload shows as a card in the same slot (FR-060, spec 6.2).
      // The primary query is the part with no parent; any other is an alsoRun part (spec 6.2),
      // wherever it sits in the list and whatever its partId. A skipped part says why, from its
      // reason keys (#576).
      parts: entry.parts.map((part): RequestPartView => {
        const key = `${entry.correlationId}:${part.partId}`;
        const label =
          part.parentPartId === null
            ? {}
            : {
                label: t("sourceStatus.alsoRun", {
                  queryType: typeLabel(part.queryType),
                  from: typeLabel(primaryType ?? entry.queryType),
                }),
              };
        return {
          key,
          ...label,
          ...(part.status === "skipped"
            ? { skippedText: skipReasonText(part, config, t, typeLabel(part.queryType)) }
            : {}),
          lines: [
            ...part.sources.map((source): SourceLineView => {
              const payload = source.status === "returned" ? source.result?.payload : undefined;
              // A source that returned owes its payload (spec 6.7): until the card arrives the line
              // says so, instead of "returned" with nothing under it (G6).
              const loading = source.status === "returned" && payload === undefined;
              // A source that did not return says why, in words (G5).
              const whyText = sourceWhy(source.status, config, source.sourceId, t);
              return {
                key: `${key}:${source.sourceId}`,
                tone:
                  source.status === "pending" || loading
                    ? "pending"
                    : source.status === "returned"
                      ? "ok"
                      : "problem",
                ...(whyText === undefined ? {} : { why: whyText }),
                text: loading
                  ? t("sourceStatus.loadingResult", { source: sourceLabel(source.sourceId) })
                  : t("sourceStatus.line", {
                      source: sourceLabel(source.sourceId),
                      status: t(`sourceStatus.status.${source.status}`),
                    }),
                ...(payload === undefined
                  ? {}
                  : {
                      card: (
                        <SourceCard
                          config={config}
                          submitted={entry.submitted}
                          queryType={part.queryType}
                          parentPartId={part.parentPartId}
                          partValues={part.values}
                          sourceId={source.sourceId}
                          payload={payload}
                          persona={persona}
                          sourceName={sourceLabel(source.sourceId)}
                          requestName={base.name}
                          t={t}
                        />
                      ),
                    }),
              };
            }),
            // Sources the planner dropped before dispatch (plate-only mode, spec 4.6 step 3): the
            // user must be able to tell "not queried" from "missing" (#587). Their own lines, in words.
            ...(part.status === "skipped" ? [] : part.droppedSourceIds).map(
              (sourceId): SourceLineView => ({
                key: `${key}:${sourceId}:notRun`,
                tone: "notRun",
                text: t("sourceStatus.notRun", { source: sourceLabel(sourceId) }),
              }),
            ),
          ],
        };
      }),
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
      onEditAsNew={onEditAsNew}
      // The officer's last request sits under the form: show it once a request is on its way (G11).
      revealOnSend={variant === "last"}
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
            const held = t(
              result.status === "submitting" ? "form.submitting" : "form.noConnection",
            );
            announcer.announce(held);
            setHeldRows((rows) => new Map(rows).set(rowId, held));
          }
          // A 409 makes the controller refetch the config (every cached copy, observed or not), and
          // the panel announces that change itself: a second sentence here would cut it off in the
          // shared region.
          else if (
            result.kind === "sent" &&
            result.outcome.kind !== "configChanged" &&
            stillListed(result.rowId)
          ) {
            announcer.announce(outcomeAnnouncement(result.outcome, t, typeLabel));
            if (result.outcome.kind === "acknowledged") {
              const sent = requests.getState().items.find((item) => item.id === result.rowId);
              if (sent?.submitted !== undefined) onRetried?.(sent.submitted);
            }
          }
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
