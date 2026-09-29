import type { JSX, ReactNode } from "react";

export interface ActionBarProps {
  /** The primary action (the submit button and its visible reason). */
  children: ReactNode;
  clearLabel: string;
  onClear(): void;
  /** Status line text (for example the count of fields that need attention); empty shows nothing. */
  status: string;
}

/**
 * The panel's action bar (visual system): Run query, Clear and a status line, sticky to the bottom
 * of the panel so the actions stay in reach on a long form. The status is plain text, not a live
 * region: blocked submits are announced by the panel's announcer already.
 */
export function ActionBar({ children, clearLabel, onClear, status }: ActionBarProps): JSX.Element {
  return (
    <div className="qm-action-bar">
      {children}
      <button type="button" className="qm-button qm-button--secondary" onClick={onClear}>
        {clearLabel}
      </button>
      <p className="qm-action-bar__status">{status}</p>
    </div>
  );
}
