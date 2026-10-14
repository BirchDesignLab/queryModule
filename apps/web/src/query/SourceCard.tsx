import type { SubmittedQuery } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { assessResult, mapResponse } from "@querymodule/core/response";
import { ResultCard, type ResultT } from "@querymodule/web-ui";
import { useMemo, useState } from "react";
import { partValuesOf } from "./result-view.js";

export interface SourceCardProps {
  config: ClientSiteConfig;
  /** What the request sent, for the mapping's `when` (memory only). */
  submitted: SubmittedQuery | undefined;
  queryType: string;
  /** The part's parent: null for the primary part, which uses what was submitted. */
  parentPartId: number | null;
  /** The values the server planned for this part (a nested part's `when`); memory only (#633). */
  partValues?: Readonly<Record<string, unknown>> | undefined;
  sourceId: string;
  payload: Record<string, unknown>;
  persona: string;
  /** The source's name, already resolved. */
  sourceName: string;
  /** The request's accessible name (type and primary typed field, ruling 12). */
  requestName: string;
  t: ResultT;
}

/**
 * One returned source as a card (spec 6.2; FR-060). The card is a view over the in-memory payload:
 * it is mapped again whenever the config changes (a publish, Q2) and never fetched again. Which of
 * summary and detail is open lives here, in memory, and is lost with the card (design ruling 2). The
 * parent keys it by request, part and source, so an update never remounts it.
 */
export function SourceCard({
  config,
  submitted,
  queryType,
  parentPartId,
  partValues,
  sourceId,
  payload,
  persona,
  sourceName,
  requestName,
  t,
}: SourceCardProps) {
  const [view, setView] = useState<"summary" | "detail">("summary");
  const mapped = useMemo(() => {
    const now = Date.now();
    return mapResponse(
      config,
      {
        queryType,
        partValues: partValuesOf(
          { queryType, parentPartId, values: partValues },
          submitted,
          config,
          now,
        ),
        sourceId,
        persona,
      },
      payload,
      now,
    );
  }, [config, submitted, queryType, parentPartId, partValues, sourceId, persona, payload]);
  const assessment = useMemo(
    () => assessResult(payload, config.keywords),
    [config.keywords, payload],
  );
  return (
    <ResultCard
      heading={sourceName}
      status={t("sourceStatus.status.returned")}
      assessment={assessment}
      mapped={mapped}
      keywords={config.keywords}
      styles={config.keywordSeverityStyles}
      view={view}
      onToggleView={setView}
      toggleContext={t("result.toggleContext", { source: sourceName, name: requestName })}
      headingLevel={parentPartId === null ? 4 : 5}
      t={t}
    />
  );
}
