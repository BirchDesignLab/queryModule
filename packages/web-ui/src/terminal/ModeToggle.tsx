import type { JSX } from "react";

export interface ModeToggleProps {
  /** True = terminal mode (spec 6.2 table). */
  pressed: boolean;
  label: string;
  onToggle(): void;
}

/** Form/terminal mode toggle (FR-050). */
export function ModeToggle({ pressed, label, onToggle }: ModeToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className="qm-quick-access__button qm-mode-toggle"
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}
