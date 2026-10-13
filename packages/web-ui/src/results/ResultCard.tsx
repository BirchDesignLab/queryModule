import type { KeywordStyle } from "@querymodule/core/config";
import type { Assessment, MappedResult } from "@querymodule/core/contracts";
import { cssVarName } from "@querymodule/tokens";
import { type JSX, useId } from "react";
import { MappedElements } from "./MappedElements.js";
import { SeverityBadge } from "./SeverityBadge.js";
import type { ResultT, SeverityStyles } from "./severity.js";
import { ViewToggle } from "./ViewToggle.js";

export interface ResultCardProps {
  /** The source's name, already resolved. */
  heading: string;
  /** The status word, already resolved ("returned"). */
  status: string;
  /** Response time as text, shown in mono in the header. */
  responseTimeText?: string;
  assessment: Assessment;
  mapped: MappedResult;
  keywords: readonly KeywordStyle[];
  styles: SeverityStyles;
  /** Open state is the owner's, in memory per card (design ruling 2). */
  view: "summary" | "detail";
  onToggleView(next: "summary" | "detail"): void;
  /** Hidden toggle text: the source, type and primary typed field (ruling 12). */
  toggleContext?: string;
  /** h4 in part 0, h5 in a nested part. */
  headingLevel?: 4 | 5;
  t: ResultT;
}

/**
 * One source's result (spec 6.2; FR-060, UX-010, UX-015): a section headed "Source: status" with
 * the severity badge, the mapping's summary elements and a toggle that opens the detail below it.
 * A 4 px start edge in the severity colour repeats the badge and never replaces it.
 */
export function ResultCard({
  heading,
  status,
  responseTimeText,
  assessment,
  mapped,
  keywords,
  styles,
  view,
  onToggleView,
  toggleContext,
  headingLevel = 4,
  t,
}: ResultCardProps): JSX.Element {
  const headingId = useId();
  const detailId = useId();
  // The generic dump (no candidate mapping) shows every leaf and has no toggle.
  const generic = mapped.mappingIndex === null;
  const summary = mapped.elements.filter((e) => generic || e.view !== "detail");
  const detail = generic ? [] : mapped.elements.filter((e) => e.view === "detail");
  const open = view === "detail";
  const Heading = headingLevel === 4 ? "h4" : "h5";
  const severity = assessment.severity;
  return (
    <section
      className={severity === null ? "qm-card" : `qm-card qm-card--${severity}`}
      aria-labelledby={headingId}
      style={
        severity === null
          ? undefined
          : { borderInlineStart: `4px solid var(${cssVarName(styles[severity].background)})` }
      }
    >
      <div className="qm-card__head">
        <Heading id={headingId} className="qm-card__title">
          {t("sourceStatus.line", { source: heading, status })}
        </Heading>
        {responseTimeText === undefined ? null : (
          <span className="qm-card__time">{responseTimeText}</span>
        )}
        <SeverityBadge severity={severity} styles={styles} t={t} />
      </div>
      {generic ? <p className="qm-card__note">{t("result.noMapping")}</p> : null}
      <MappedElements elements={summary} keywords={keywords} styles={styles} t={t} />
      {detail.length === 0 ? null : (
        <>
          <ViewToggle
            expanded={open}
            controlsId={detailId}
            label={t(open ? "result.hideDetail" : "result.showDetail")}
            countText={t("result.moreItems", { count: detail.length })}
            {...(toggleContext === undefined ? {} : { context: toggleContext })}
            onToggle={() => onToggleView(open ? "summary" : "detail")}
          />
          <div id={detailId} className="qm-card__detail" hidden={!open}>
            {open ? (
              <MappedElements elements={detail} keywords={keywords} styles={styles} t={t} />
            ) : null}
          </div>
        </>
      )}
      {import.meta.env.DEV && mapped.diagnostics.length > 0 ? (
        <details className="qm-card__diagnostics">
          <summary>{t("result.diagnostics")}</summary>
          <ul>
            {mapped.diagnostics.map((d) => (
              <li key={`${d.path}:${d.reason}`}>
                <code>{d.path}</code> {d.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
