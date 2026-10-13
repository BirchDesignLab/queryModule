import type { StatusAnnouncement } from "@querymodule/client";
import type { Severity } from "@querymodule/core/contracts";

type T = (key: string, params?: Record<string, string | number | boolean>) => string;

/** Terminal statuses first, pending last, so the details lead with what has arrived. */
const ORDER = [
  "returned",
  "failed",
  "timedOut",
  "interrupted",
  "credentialsMissing",
  "credentialsRejected",
  "pending",
] as const;

/** The highest severity found across a request's returned sources, and the configured keyword. */
export interface HighestSeverity {
  severity: Severity;
  keyword: string;
}

export interface StatusAnnouncementExtras {
  /** The primary typed field (plate, name); the short correlation ID stands in when absent (ruling 12). */
  typed?: string;
  highest?: HighestSeverity;
}

/**
 * The one polite sentence for a coalesced status change (spec 6.6): the query type, the
 * primary typed field (else the short reference), how many sources are done, the counts by status,
 * the highest severity with its configured keyword and how many were not run. Never a source id or
 * a payload value (ruling 12, 10-13-26).
 */
export function statusAnnouncementText(
  announcement: StatusAnnouncement,
  t: T,
  typeLabel: (code: string) => string,
  extras: StatusAnnouncementExtras = {},
): string {
  const { summary } = announcement;
  const counts = ORDER.flatMap((status) => {
    const count = summary.byStatus[status];
    return count === undefined || count === 0
      ? []
      : [t("sourceStatus.detail", { count, status: t(`sourceStatus.status.${status}`) })];
  });
  const severity =
    extras.highest === undefined
      ? []
      : [
          t("sourceStatus.severityDetail", {
            severity: t(`severity.word.${extras.highest.severity}`),
            keyword: extras.highest.keyword,
          }),
        ];
  const details = [...counts, ...severity].join(", ");
  // With no counts by status (every source was dropped) the sentence ends at the totals.
  const text = t(details === "" ? "sourceStatus.summaryBare" : "sourceStatus.summary", {
    queryType: typeLabel(announcement.queryType),
    // The summary template's {reference} slot: the typed field names the request, else its short ID.
    reference:
      extras.typed === undefined || extras.typed === ""
        ? announcement.correlationId.slice(0, 8)
        : extras.typed,
    done: summary.done,
    count: summary.total,
    details,
  });
  // Sources dropped before dispatch (plate-only mode) are not in the counts above: say how many.
  return summary.notRun > 0
    ? `${text} ${t("sourceStatus.notRunCount", { count: summary.notRun })}`
    : text;
}

/**
 * The assertive sentence for a critical result, said at once (spec 6.6): the request, the severity
 * word, the configured keyword and the source's name. Never a payload value beyond the keyword.
 */
export function criticalAnnouncementText(
  t: T,
  parts: { name: string; keyword: string; source: string },
): string {
  return t("sourceStatus.criticalNow", {
    name: parts.name,
    severity: t("severity.word.critical"),
    keyword: parts.keyword,
    source: parts.source,
  });
}
