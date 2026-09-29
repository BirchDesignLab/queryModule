import type { JSX } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface ModeSegProps {
  /** Group name for assistive technology. */
  legend: string;
  formLabel: string;
  terminalLabel: string;
  /** True = terminal mode (spec 6.2 table). */
  terminal: boolean;
  /** Called with the mode that was pressed, only when it is not the current one. */
  onSelect(mode: "form" | "terminal"): void;
}

/** Form or terminal entry mode (FR-050) as a segmented control: two aria-pressed buttons. */
export function ModeSeg({
  legend,
  formLabel,
  terminalLabel,
  terminal,
  onSelect,
}: ModeSegProps): JSX.Element {
  return (
    <fieldset className="qm-seg qm-mode-seg">
      <legend>
        <VisuallyHidden>{legend}</VisuallyHidden>
      </legend>
      <button
        type="button"
        aria-pressed={!terminal}
        onClick={() => {
          if (terminal) onSelect("form");
        }}
      >
        {formLabel}
      </button>
      <button
        type="button"
        aria-pressed={terminal}
        onClick={() => {
          if (!terminal) onSelect("terminal");
        }}
      >
        {terminalLabel}
      </button>
    </fieldset>
  );
}
