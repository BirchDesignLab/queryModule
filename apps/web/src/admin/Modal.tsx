import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

const STOPS = 'button:not([aria-disabled="true"]), input, select, textarea, [tabindex="0"]';

/**
 * A modal dialog that exists only while it is open (spec 6.2): the parent mounts it to open it
 * and unmounts it to close it, so nothing it showed (a one-time password) stays in the DOM.
 * Focus goes to `initialFocus` (default: the first control), Tab wraps inside, Escape asks
 * `onClose`, and on unmount focus returns to what had it, or to `fallback` when that is gone.
 * Native <dialog> where the engine has it, the same behaviour by hand where it does not.
 */
export function Modal({
  title,
  description,
  onClose,
  initialFocus,
  fallback,
  children,
}: {
  title: string;
  description?: string | undefined;
  onClose(): void;
  /** The control that takes focus on open; the first focusable one when omitted. */
  initialFocus?: string | undefined;
  fallback?: (() => HTMLElement | null) | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  // Read once, at open: the content swaps (a form, then its result) and must not move focus again.
  const focusRef = useRef(initialFocus);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const opener = document.activeElement;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const first =
      (focusRef.current === undefined
        ? null
        : dialog.querySelector<HTMLElement>(focusRef.current)) ??
      dialog.querySelector<HTMLElement>(STOPS);
    first?.focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else fallbackRef.current?.()?.focus();
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeRef.current();
    } else if (e.key === "Tab") {
      const stops = dialogRef.current?.querySelectorAll<HTMLElement>(STOPS);
      const first = stops?.[0];
      const last = stops?.[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="qm-leave-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={description === undefined ? undefined : `${id}-body`}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      {description === undefined ? null : <p id={`${id}-body`}>{description}</p>}
      {children}
    </dialog>
  );
}
