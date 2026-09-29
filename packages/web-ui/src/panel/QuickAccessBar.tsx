import type { JSX } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface QuickAccessBarProps {
  codes: readonly string[];
  current: string;
  labelOf(code: string): string;
  onSelect(code: string): void;
  /** The `aria-keyshortcuts` value for a button, or undefined where no shortcut is bound (spec 6.4). */
  shortcutOf?(code: string, index: number): string | undefined;
  /** One line naming the shortcuts (for example "Alt+1 to Alt+5"); omit when none is bound. */
  hint?: string;
  t(key: string): string;
}

/**
 * Configured query types as a compact group of toggle buttons; the current one is pressed
 * (spec 6.2). The type code is set in mono, aria-hidden, so the accessible name stays the label.
 */
export function QuickAccessBar({
  codes,
  current,
  labelOf,
  onSelect,
  shortcutOf,
  hint,
  t,
}: QuickAccessBarProps): JSX.Element | null {
  if (codes.length === 0) return null;
  return (
    <fieldset className="qm-quick-access">
      <legend>
        <VisuallyHidden>{t("form.quickAccess")}</VisuallyHidden>
      </legend>
      {codes.map((code, index) => (
        <button
          key={code}
          type="button"
          className="qm-quick-access__button"
          aria-pressed={code === current}
          aria-keyshortcuts={shortcutOf?.(code, index)}
          onClick={() => onSelect(code)}
        >
          <span className="qm-quick-access__code" aria-hidden="true">
            {code}
          </span>
          {labelOf(code)}
        </button>
      ))}
      {hint === undefined ? null : <span className="qm-quick-access__hint">{hint}</span>}
    </fieldset>
  );
}
