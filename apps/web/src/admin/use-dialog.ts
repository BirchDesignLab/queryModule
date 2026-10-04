import { type KeyboardEvent, useEffect, useRef } from "react";

function show(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function hide(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    if (dialog.open) dialog.close();
  } else dialog.removeAttribute("open");
}

function restore(
  opener: { current: Element | null },
  fallback: { current: (() => HTMLElement | null) | undefined },
): void {
  const back = opener.current;
  opener.current = null;
  if (back instanceof HTMLElement && back.isConnected) back.focus();
  else fallback.current?.()?.focus();
}

/**
 * The behaviour every modal dialog here shares (spec 6.2), so a fix lands once: native <dialog>
 * where the engine has it (the same by hand where it does not), focus to `initialFocus` on open,
 * Tab wrapping between the first and last of `stops`, and focus back to what had it (or to
 * `fallback`) on close or unmount.
 *
 * Escape, the cancel event and a close the browser makes on its own all ask `onDismiss`, unless
 * `keepOpen` (an action is under way, or the content must be left by its own button): then Escape
 * does nothing and a native close reopens the dialog, so state the page still holds is never left
 * in a closed dialog.
 */
export function useDialog({
  open,
  onDismiss,
  keepOpen = false,
  stops,
  initialFocus,
  fallback,
}: {
  open: boolean;
  onDismiss(): void;
  keepOpen?: boolean | undefined;
  stops: string;
  initialFocus(dialog: HTMLDialogElement): HTMLElement | null;
  /** Focus target when the opener is gone. */
  fallback?: (() => HTMLElement | null) | undefined;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const lastOpen = useRef(open);
  lastOpen.current = open;
  const keepRef = useRef(keepOpen);
  keepRef.current = keepOpen;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const initialRef = useRef(initialFocus);
  initialRef.current = initialFocus;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      show(dialog);
      initialRef.current(dialog)?.focus();
    } else if (!open && dialog.open) {
      hide(dialog);
      restore(opener, fallbackRef);
    }
  }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current;
    // StrictMode's simulated unmount runs the cleanup below, then this again with no render in
    // between: put back what the last render said, or a native close is ignored until the next.
    openRef.current = lastOpen.current;
    return () => {
      // Unmounted while open (the parent closes by not rendering it).
      openRef.current = false;
      if (dialog === null || opener.current === null) return;
      hide(dialog);
      restore(opener, fallbackRef);
    };
  }, []);

  const dismiss = () => {
    if (!keepRef.current) dismissRef.current();
  };
  return {
    dialogRef,
    dialogProps: {
      onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
        if (e.key === "Escape") {
          e.preventDefault();
          dismiss();
        } else if (e.key === "Tab") {
          const all = dialogRef.current?.querySelectorAll<HTMLElement>(stops);
          const first = all?.[0];
          const last = all?.[all.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      },
      onCancel(e: { preventDefault(): void }) {
        e.preventDefault();
        dismiss();
      },
      // Closed by the browser on its own (a second close request the page cannot cancel).
      onClose() {
        if (!openRef.current) return;
        const dialog = dialogRef.current;
        if (keepRef.current) {
          if (dialog !== null && !dialog.open) show(dialog);
        } else dismissRef.current();
      },
    },
  };
}
