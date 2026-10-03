import { type ReactNode, useId, useRef } from "react";
import { useDialog } from "./use-dialog.js";

const STOPS = 'button:not([aria-disabled="true"]), input, select, textarea, [tabindex="0"]';

/**
 * A modal dialog that exists only while it is open (spec 6.2): the parent mounts it to open it
 * and unmounts it to close it, so nothing it showed (a one-time password) stays in the DOM.
 * Focus goes to `initialFocus` (default: the first control), Tab wraps inside, Escape asks
 * `onClose` (unless `busy` or `persistent`), and on unmount focus returns to what had it, or to `fallback` when that is gone.
 * Native <dialog> where the engine has it, the same behaviour by hand where it does not.
 */
export function Modal({
  title,
  description,
  onClose,
  initialFocus,
  fallback,
  busy = false,
  persistent = false,
  children,
}: {
  title: string;
  description?: string | undefined;
  onClose(): void;
  /** The control that takes focus on open; the first focusable one when omitted. */
  initialFocus?: string | undefined;
  fallback?: (() => HTMLElement | null) | undefined;
  /** An action is under way and cannot be called off: Escape and a native close do not close it. */
  busy?: boolean;
  /** Only its own buttons close it (a one-time password): Escape and a native close do not. */
  persistent?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  // Read once, at open: the content swaps (a form, then its result) and must not move focus again.
  const focusRef = useRef(initialFocus);
  const { dialogRef, dialogProps } = useDialog({
    open: true,
    onDismiss: onClose,
    keepOpen: busy || persistent,
    stops: STOPS,
    initialFocus: (dialog) =>
      (focusRef.current === undefined
        ? null
        : dialog.querySelector<HTMLElement>(focusRef.current)) ??
      dialog.querySelector<HTMLElement>(STOPS),
    fallback,
  });
  return (
    <dialog
      ref={dialogRef}
      className="qm-leave-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={description === undefined ? undefined : `${id}-body`}
      {...dialogProps}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      {description === undefined ? null : <p id={`${id}-body`}>{description}</p>}
      {children}
    </dialog>
  );
}
