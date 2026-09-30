import type { SubmitOutcome } from "@querymodule/client";
import { formatAckTime } from "@querymodule/web-ui";

type T = (key: string, params?: Record<string, string | number | boolean>) => string;

/**
 * What the shared announcer says about a submit outcome (spec 6.6). One sentence per outcome, so a
 * send from the form and a retry from the list speak alike. An invalid answer to a retry has no
 * form to mark: it reads as the row's own failure text.
 */
export function outcomeAnnouncement(
  outcome: SubmitOutcome,
  t: T,
  typeLabel: (code: string) => string,
): string {
  switch (outcome.kind) {
    case "acknowledged":
      return t("submit.acknowledged", {
        queryType: typeLabel(outcome.queryType),
        time: formatAckTime(outcome.response.acknowledgedAt),
        reference: outcome.response.correlationId.slice(0, 8),
      });
    case "rateLimited":
      return t("submit.rateLimited", { seconds: outcome.retryAfterSeconds });
    case "configChanged":
      return t("submit.configChanged");
    case "invalid":
      return t("requests.failure.invalid");
    default:
      return t(`submit.${outcome.kind}`);
  }
}
