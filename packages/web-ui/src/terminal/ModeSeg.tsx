import type { JSX } from "react";
import { LineIcon } from "../icons.js";
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
  /** Draws the form and terminal icons of mockup v6 before the labels (the dispatcher's panel). */
  icons?: boolean;
  /** The terminal shortcut as a keycap hint ("Ctrl+`"), hidden from the reader: `keys` says it. */
  shortcut?: string;
  /** The same shortcut as aria-keyshortcuts writes it ("Control+`"). */
  keys?: string;
}

/** Form or terminal entry mode (FR-050) as a segmented control: two aria-pressed buttons. */
export function ModeSeg({
  legend,
  formLabel,
  terminalLabel,
  terminal,
  onSelect,
  icons = false,
  shortcut,
  keys,
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
        {icons ? <LineIcon name="form" /> : null}
        {formLabel}
      </button>
      <button
        type="button"
        aria-pressed={terminal}
        aria-keyshortcuts={keys}
        onClick={() => {
          if (!terminal) onSelect("terminal");
        }}
      >
        {icons ? <LineIcon name="terminal" /> : null}
        {terminalLabel}
        {shortcut === undefined ? null : (
          <span aria-hidden="true">
            <kbd className="qm-kbd">{shortcut}</kbd>
          </span>
        )}
      </button>
    </fieldset>
  );
}
