import type { KeywordStyle } from "@querymodule/core/config";
import { highlight as segmentsOf } from "@querymodule/core/response";
import type { JSX } from "react";
import { VisuallyHidden } from "../visually-hidden.js";
import { type ResultT, SeverityIcon, type SeverityStyles, severityColors } from "./severity.js";

export interface HighlightedProps {
  text: string;
  keywords: readonly KeywordStyle[];
  /** False for an element the mapping leaves unmarked (the plate): plain text. */
  highlight: boolean;
  styles: SeverityStyles;
  t: ResultT;
}

/** Text with each keyword hit in a mark: icon, the word, marker and a hidden severity (UX-010, UX-011). */
export function Highlighted({
  text,
  keywords,
  highlight,
  styles,
  t,
}: HighlightedProps): JSX.Element {
  if (!highlight) return <>{text}</>;
  let offset = 0;
  return (
    <>
      {segmentsOf(text, keywords).map((segment) => {
        const key = offset;
        offset += segment.text.length;
        if (segment.severity === undefined) return <span key={key}>{segment.text}</span>;
        const style = styles[segment.severity];
        return (
          <mark
            key={key}
            className={`qm-mark qm-mark--${segment.severity}`}
            style={severityColors(style)}
          >
            <SeverityIcon name={style.icon} />
            {segment.text}
            <span aria-hidden="true" className="qm-mark__marker">
              {style.marker}
            </span>
            <VisuallyHidden>
              {t("result.keywordSeverity", { severity: t(`severity.word.${segment.severity}`) })}
            </VisuallyHidden>
          </mark>
        );
      })}
    </>
  );
}
