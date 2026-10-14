import type { JSX } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface ViewToggleProps {
  expanded: boolean;
  /** Id of the detail region this button opens. */
  controlsId: string;
  /** Visible words, already resolved: "Show detail" or "Hide detail". */
  label: string;
  /** For example "2 more items". */
  countText: string;
  /** Hidden text naming the source, type and primary typed field (ruling 12). */
  context?: string;
  onToggle(): void;
}

/** The summary/detail toggle (UX-015): a button, so focus stays on it while the detail opens below. */
export function ViewToggle({
  expanded,
  controlsId,
  label,
  countText,
  context,
  onToggle,
}: ViewToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className="qm-button qm-button--ghost qm-view-toggle"
      aria-expanded={expanded}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <span>{label}</span> <span className="qm-view-toggle__count">{countText}</span>
      {context === undefined ? null : (
        <>
          {" "}
          <VisuallyHidden>{context}</VisuallyHidden>
        </>
      )}
    </button>
  );
}
