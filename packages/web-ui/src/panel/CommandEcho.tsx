import type { JSX } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface CommandEchoProps {
  /** The terminal command the form is building, from the core formatter (spec 4.4). */
  text: string;
  /** Label of the strip for assistive technology (for example "Command"). */
  label: string;
  /** Text of the action that switches to the terminal with this command. */
  actionLabel: string;
  onEdit(): void;
}

/**
 * The command echo (visual system, signature element): under the form, a mono strip with the
 * command the form is building, live as the user types, and an action that continues in the
 * terminal with the same draft. Read-only text, so it takes no Tab stop; not a live region (it
 * changes on every keystroke). Renders nothing when there is no command to show.
 */
export function CommandEcho({
  text,
  label,
  actionLabel,
  onEdit,
}: CommandEchoProps): JSX.Element | null {
  if (text === "") return null;
  return (
    <fieldset className="qm-command-echo">
      <legend>
        <VisuallyHidden>{label}</VisuallyHidden>
      </legend>
      <p className="qm-command-echo__text">
        <span className="qm-command-echo__prompt" aria-hidden="true">
          &gt;
        </span>
        <code>{text}</code>
      </p>
      <button type="button" className="qm-button qm-button--ghost" onClick={onEdit}>
        {actionLabel}
      </button>
    </fieldset>
  );
}
