import type { KeywordStyle } from "@querymodule/core/config";
import type { RenderElement } from "@querymodule/core/contracts";
import { highlight as segmentsOf } from "@querymodule/core/response";
import type { JSX } from "react";
import { Highlighted } from "./Highlighted.js";
import { ResultTable } from "./ResultTable.js";
import type { ResultT, SeverityStyles } from "./severity.js";

export interface MappedElementsProps {
  elements: readonly RenderElement[];
  keywords: readonly KeywordStyle[];
  styles: SeverityStyles;
  t: ResultT;
  /** Labels are JSON pointers (generic dump): mono, case kept. */
  paths?: boolean;
}

/**
 * A keyword mark of this many characters or more does not fit one grid column of a card (140 px
 * tracks): its item spans two, so the badge keeps to one line (R8, "NO WANTS OR WARRANTS").
 */
const LONG_MARK_CHARS = 12;

const hasLongMark = (
  e: { value: string; highlight: boolean },
  keywords: readonly KeywordStyle[],
): boolean =>
  e.highlight &&
  segmentsOf(e.value, keywords).some(
    (segment) => segment.severity !== undefined && segment.text.length >= LONG_MARK_CHARS,
  );

const labelOf = (label: { key: string } | { text: string }, t: ResultT): string =>
  "key" in label ? t(label.key) : label.text;

/** Scalar elements as one dt/dd grid, then each table as its own scrolling region (spec 6.2). */
export function MappedElements({
  elements,
  keywords,
  styles,
  t,
  paths = false,
}: MappedElementsProps): JSX.Element {
  const scalars = elements.flatMap((e, i) => (e.kind === "scalar" ? [{ e, i }] : []));
  const tables = elements.flatMap((e, i) => (e.kind === "table" ? [{ e, i }] : []));
  return (
    <>
      {scalars.length === 0 ? null : (
        <dl className={paths ? "qm-result-list qm-result-list--paths" : "qm-result-list"}>
          {scalars.map(({ e, i }) => (
            <div
              key={i}
              className={
                hasLongMark(e, keywords)
                  ? "qm-result-list__item qm-result-list__item--wide"
                  : "qm-result-list__item"
              }
            >
              <dt>{labelOf(e.label, t)}</dt>
              <dd>
                <Highlighted
                  text={e.value}
                  keywords={keywords}
                  highlight={e.highlight}
                  styles={styles}
                  t={t}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {tables.map(({ e, i }) => (
        <ResultTable
          key={i}
          label={labelOf(e.label, t)}
          columns={e.columns.map((c) => t(c.labelKey))}
          rows={e.rows}
          keywords={keywords}
          highlight={e.highlight}
          styles={styles}
          t={t}
        />
      ))}
    </>
  );
}
