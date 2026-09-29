import type { JSX } from "react";

export interface QuickAccessBarProps {
  codes: readonly string[];
  current: string;
  labelOf(code: string): string;
  onSelect(code: string): void;
  t(key: string): string;
}

/** Configured query types as toggle buttons; the current one is pressed (spec 6.2). */
export function QuickAccessBar({
  codes,
  current,
  labelOf,
  onSelect,
  t,
}: QuickAccessBarProps): JSX.Element | null {
  if (codes.length === 0) return null;
  return (
    <nav aria-label={t("form.quickAccess")} className="qm-quick-access">
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          className="qm-quick-access__button"
          aria-pressed={code === current}
          onClick={() => onSelect(code)}
        >
          {labelOf(code)}
        </button>
      ))}
    </nav>
  );
}
