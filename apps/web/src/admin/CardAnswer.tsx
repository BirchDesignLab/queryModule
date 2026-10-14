import type { Translator } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { SourcePayload } from "@querymodule/core/contracts";
import { assessResult, mapResponse } from "@querymodule/core/response";
import { ResultCard } from "@querymodule/web-ui";
import { useMemo } from "react";

/**
 * The one way the builder draws an answer as a user sees it (ADR-0011 decision 4; BW3 polish,
 * CRITIC-M3): the card preview and Try a match both render the production ResultCard from the
 * draft's cards through `mapResponse` and `assessResult`, and a behaviour outcome as the status
 * line. Shared here so the two cannot drift. Configuration and mock content only: nothing typed is
 * kept, logged or announced.
 */

export type Persona = "dispatcher" | "officer";
/** The persona keys the plan and `mapResponse` use. */
export const PERSONA_KEY: Readonly<Record<Persona, string>> = {
  dispatcher: "dispatch",
  officer: "mobileUnit",
};

/** A mock behaviour as the sourceStatus status key it shows under. */
export const BEHAVIOR_STATUS = {
  timeout: "timedOut",
  error: "failed",
  credentialsRejected: "credentialsRejected",
} as const;

export type Rendered = {
  mapped: ReturnType<typeof mapResponse>;
  assessment: ReturnType<typeof assessResult>;
};

/** The mapped card and its keyword assessment for one payload, or null while there is none. */
export function useRenderedCard(
  config: ClientSiteConfig | null,
  input: {
    code: string;
    sourceId: string;
    persona: Persona;
    payload: SourcePayload | null;
    /** The values the plan would hand part 0 of this query: what rules in cards read. */
    values: Record<string, unknown>;
  },
): Rendered | null {
  const { code, sourceId, persona, payload, values } = input;
  return useMemo(() => {
    if (payload === null || config === null) return null;
    const mapped = mapResponse(
      config,
      { queryType: code, partValues: values, sourceId, persona: PERSONA_KEY[persona] },
      payload,
      Date.now(),
    );
    return { mapped, assessment: assessResult(payload, config.keywords) };
  }, [config, code, sourceId, persona, payload, values]);
}

/** The production ResultCard over a rendered answer, with the draft's keywords and styles. */
export function RenderedCard({
  rendered,
  config,
  heading,
  translator,
  view,
  onToggleView,
}: {
  rendered: Rendered;
  config: ClientSiteConfig;
  heading: string;
  translator: Translator;
  view: "summary" | "detail";
  onToggleView(view: "summary" | "detail"): void;
}) {
  return (
    <ResultCard
      heading={heading}
      status={translator.t("sourceStatus.status.returned")}
      assessment={rendered.assessment}
      mapped={rendered.mapped}
      keywords={config.keywords}
      styles={config.keywordSeverityStyles}
      view={view}
      onToggleView={onToggleView}
      t={translator.t}
    />
  );
}

/** A behaviour outcome (error, timeout, credentials rejected): the status line, never a card. */
export function BehaviorLine({
  source,
  status,
  translator,
}: {
  source: string;
  status: (typeof BEHAVIOR_STATUS)[keyof typeof BEHAVIOR_STATUS];
  translator: Translator;
}) {
  return (
    <div className="qm-source qm-source--problem">
      <span aria-hidden="true" className="qm-source__icon">
        !
      </span>
      <span>
        {translator.t("sourceStatus.line", {
          source,
          status: translator.t(`sourceStatus.status.${status}`),
        })}
      </span>
    </div>
  );
}
