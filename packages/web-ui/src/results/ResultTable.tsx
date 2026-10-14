import type { KeywordStyle } from "@querymodule/core/config";
import { type JSX, useId } from "react";
import { VisuallyHidden } from "../visually-hidden.js";
import { Highlighted } from "./Highlighted.js";
import type { ResultT, SeverityStyles } from "./severity.js";

export interface ResultTableProps {
  /** The table's label, already resolved. */
  label: string;
  /** Column labels, already resolved. */
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  keywords: readonly KeywordStyle[];
  highlight: boolean;
  styles: SeverityStyles;
  t: ResultT;
}

/**
 * A focusable scrolling region around a captioned table (UX-016): it scrolls in its own box so the
 * page never scrolls sideways, and the Tab stop lets a keyboard user scroll it (axe
 * scrollable-region-focusable).
 */
export function ResultTable({
  label,
  columns,
  rows,
  keywords,
  highlight,
  styles,
  t,
}: ResultTableProps): JSX.Element {
  const captionId = useId();
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
    // biome-ignore lint/a11y/useSemanticElements: spec 6.2 names role=region on a div, so the card section stays the only section landmark
    <div className="qm-result-table" role="region" tabIndex={0} aria-labelledby={captionId}>
      <table>
        <caption id={captionId}>
          {label} <VisuallyHidden>{t("result.rowCount", { count: rows.length })}</VisuallyHidden>
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity; the table is replaced whole
            <tr key={r}>
              {row.map((cell, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                <td key={c}>
                  <Highlighted
                    text={cell}
                    keywords={keywords}
                    highlight={highlight}
                    styles={styles}
                    t={t}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
