import type { RequestEntry, RequestPart, SubmittedQuery } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { type Assessment, SEVERITY_RANK } from "@querymodule/core/contracts";
import { assessResult } from "@querymodule/core/response";
import { evaluateForm } from "@querymodule/core/rules";
import type { HighestSeverity } from "./announce-status.js";

type Acknowledged = Extract<RequestEntry, { status: "acknowledged" }>;

/**
 * The values `mapResponse` matches a mapping's `when` against (spec 4.2, 4.5): the canonical
 * FormState values of what was submitted (4-digit years, upper-case picklist codes, numbers as
 * numbers), evaluated at `now` like the form. Raw typed text would not match a canonical literal.
 * The primary part (the one with no parent) uses what was submitted. A nested part uses the values
 * the server planned for it, from the fetched detail (the config the server planned with may differ
 * from the current one, so nothing is re-planned here); until the detail arrives, or when the part
 * was purged or skipped, it has none and a `when` on its fields falls back to the unconditional
 * card. A part's `when` reads that part's own values only (#633, ruling 10-13-26).
 */
export function partValuesOf(
  part: {
    queryType: string;
    parentPartId: number | null;
    values?: Readonly<Record<string, unknown>> | undefined;
  },
  submitted: SubmittedQuery | undefined,
  config: ClientSiteConfig,
  now: number,
): Readonly<Record<string, unknown>> {
  if (part.parentPartId !== null) return part.values ?? {};
  if (submitted === undefined) return {};
  return evaluateForm(config, part.queryType, submitted.values, { now }).values;
}

/** One assessed source of a request. */
export interface SourceAssessment {
  partId: number;
  sourceId: string;
  assessment: Assessment;
}

/**
 * The assessment of every returned source that has its payload, in part and source order
 * (`assessResult` scans every string leaf, whatever the mapping shows). Payloads stay in memory.
 */
export function assessEntry(
  entry: Acknowledged,
  keywords: ClientSiteConfig["keywords"],
): SourceAssessment[] {
  return entry.parts.flatMap((part) =>
    part.sources.flatMap((source) =>
      source.status === "returned" && source.result !== undefined
        ? [
            {
              partId: part.partId,
              sourceId: source.sourceId,
              assessment: assessResult(source.result.payload, keywords),
            },
          ]
        : [],
    ),
  );
}

/** The request's highest severity and the first keyword at that severity; null when nothing matched. */
export function highestSeverity(assessed: readonly SourceAssessment[]): HighestSeverity | null {
  let best: HighestSeverity | null = null;
  for (const { assessment } of assessed) {
    for (const match of assessment.matches) {
      if (best === null || SEVERITY_RANK[match.severity] > SEVERITY_RANK[best.severity]) {
        best = { severity: match.severity, keyword: match.keyword };
      }
    }
  }
  return best;
}

type T = (key: string, params?: Record<string, string | number | boolean>) => string;

/**
 * Why a nested part was not run, as one sentence from its `skipReasons` message keys (ruling 4,
 * #576): "Wanted check not run: needs Last name." A required field reads "needs <label>"; any other
 * reason is its own message with the field label as `{label}`. Keys and field labels only: the
 * server never sends a submitted value. A part with no reasons (not sent by the contract) says
 * only that it was not run.
 */
export function skipReasonText(
  part: RequestPart,
  config: ClientSiteConfig,
  t: T,
  typeLabel: string,
): string {
  // The wire contract always sends the list; a response without one is read as having no reasons.
  const skipReasons = part.skipReasons ?? [];
  if (skipReasons.length === 0) return t("sourceStatus.skipped", { queryType: typeLabel });
  const fields = config.queryTypes.find((q) => q.code === part.queryType)?.fields ?? [];
  const reasons = skipReasons.map((reason) => {
    const field = reason.params?.field;
    const labelKey =
      reason.params?.labelKey ?? fields.find((f) => f.key === field)?.labelKey ?? undefined;
    const label = labelKey !== undefined ? t(labelKey) : (field ?? "");
    const text =
      reason.key === "validation.required"
        ? t("sourceStatus.reasonNeeds", { field: label })
        : t(reason.key, { label, field: field ?? "" });
    // The messages end in a full stop; the sentence supplies its own.
    return text.replace(/\.$/, "");
  });
  // One sentence per reason (design ruling 4): the first completes the "not run: ..." sentence, each
  // other reason stands as a sentence of its own.
  const [first = "", ...rest] = reasons;
  const lead = t("sourceStatus.skippedWhy", { queryType: typeLabel, reasons: first });
  return [lead, ...rest.map((reason) => `${reason}.`)].join(" ");
}
