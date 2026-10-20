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
/** The punctuation that may not start a line: kept with the badge before it. */
const TRAILING_PUNCTUATION = /^[,.;:!?)\]]+/;

export function Highlighted({
  text,
  keywords,
  highlight,
  styles,
  t,
}: HighlightedProps): JSX.Element {
  if (!highlight) return <>{text}</>;
  const segments = segmentsOf(text, keywords);
  let offset = 0;
  // Punctuation right after a badge stays with it: the badge is one inline box, so the line could
  // otherwise break before the comma and start the next line with it (#46).
  let carried = "";
  return (
    <>
      {segments.map((segment, i) => {
        const key = offset;
        offset += segment.text.length;
        if (segment.severity === undefined) {
          const rest = segment.text.slice(carried.length);
          carried = "";
          return rest === "" ? null : <span key={key}>{rest}</span>;
        }
        const style = styles[segment.severity];
        const next = segments[i + 1];
        carried =
          next?.severity === undefined
            ? (TRAILING_PUNCTUATION.exec(next?.text ?? "")?.[0] ?? "")
            : "";
        const mark = (
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
        return carried === "" ? (
          mark
        ) : (
          <span key={key} className="qm-mark__keep">
            {mark}
            {carried}
          </span>
        );
      })}
    </>
  );
}
