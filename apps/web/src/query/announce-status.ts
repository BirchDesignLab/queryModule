import type { StatusAnnouncement } from "@querymodule/client";

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

/**
 * The one polite sentence for a coalesced status change (spec 6.6): the query type, the short
 * reference, how many sources are done, and the counts by status. Counts and words only: never a
 * field value, a source id or a payload.
 */
export function statusAnnouncementText(
  announcement: StatusAnnouncement,
  t: T,
  typeLabel: (code: string) => string,
): string {
  const { summary } = announcement;
  const details = ORDER.flatMap((status) => {
    const count = summary.byStatus[status];
    return count === undefined || count === 0
      ? []
      : [t("sourceStatus.detail", { count, status: t(`sourceStatus.status.${status}`) })];
  }).join(", ");
  return t("sourceStatus.summary", {
    queryType: typeLabel(announcement.queryType),
    reference: announcement.correlationId.slice(0, 8),
    done: summary.done,
    count: summary.total,
    details,
  });
}
