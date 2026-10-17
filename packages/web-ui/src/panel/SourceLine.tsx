import type { JSX } from "react";

/** `notRun`: dropped before dispatch. `unknown`: a status this app does not know (#650), neutral. */
export type SourceLineTone = "pending" | "ok" | "problem" | "notRun" | "unknown";

/** Decorative: the line's text says the status (aria-hidden at the use site). */
const SOURCE_ICON = { pending: "…", ok: "✓", problem: "!", notRun: "–", unknown: "?" } as const;

/**
 * One source's status line: an icon that only repeats the status, the text that carries it, and
 * the reason it did not return when there is one. The request list and the admin card preview
 * draw it the same way (T10-Q3, #642).
 */
export function SourceLine({
  tone,
  text,
  why,
}: {
  tone: SourceLineTone;
  text: string;
  why?: string | undefined;
}): JSX.Element {
  return (
    <div className={`qm-source qm-source--${tone}`}>
      <span aria-hidden="true" className="qm-source__icon">
        {SOURCE_ICON[tone]}
      </span>
      <span>{text}</span>
      {why === undefined ? null : (
        <>
          {/* A space for assistive technology; a flex row drops it visually. */}{" "}
          <span className="qm-source__why">{why}</span>
        </>
      )}
    </div>
  );
}
