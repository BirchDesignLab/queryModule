import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { leaveGuards } from "../app/leave-guard.js";
import { useServices } from "../app/services-context.js";

/**
 * Asks before sign-out wipes a draft with changes (B1), and asks the browser to before a tab close
 * or reload. In-app navigation is not guarded: the draft survives it, and a warning people click
 * through every time teaches them to click through. The draft is memory only, so the dialog says
 * what signing out does to it. It is a modal dialog, not a live region: the browser announces it.
 */
export function LeaveGuard({
  dirty,
  fallback,
}: {
  dirty: boolean;
  /** Where focus goes when the control that had it is gone by the time the dialog closes. */
  fallback?: () => HTMLElement | null;
}) {
  const t = useT();
  const services = useServices();
  const [asking, setAsking] = useState(false);
  // The answer the sign-out is waiting for; one dialog however many times it is asked.
  const answer = useRef<{ promise: Promise<boolean>; settle(leave: boolean): void } | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const off = leaveGuards(services).register(() => {
      if (!dirtyRef.current) return true;
      if (answer.current === null) {
        let settle = (_leave: boolean) => {};
        const promise = new Promise<boolean>((resolve) => {
          settle = resolve;
        });
        answer.current = { promise, settle };
        setAsking(true);
      }
      return answer.current.promise;
    });
    return () => {
      off();
      // Gone while asking (a route change, the draft reset under it): the user did not agree to
      // give the draft up, so the sign-out does not go on. The guard is gone with it, so the next
      // sign-out is not asked.
      answer.current?.settle(false);
      answer.current = null;
    };
  }, [services]);
  const respond = (leave: boolean) => {
    answer.current?.settle(leave);
    answer.current = null;
    setAsking(false);
  };
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      // The browser shows its own text; this only asks it to.
      e.preventDefault();
      // Older engines only prompt for a non-empty value.
      e.returnValue = t("admin.leave.body");
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty, t]);
  return (
    <LeaveDialog
      open={asking}
      title={t("admin.leave.title")}
      body={t("admin.leave.body")}
      stayLabel={t("admin.leave.stay")}
      leaveLabel={t("admin.leave.leave")}
      fallback={fallback}
      onStay={() => respond(false)}
      onLeave={() => respond(true)}
    />
  );
}

/**
 * A modal choice between staying and leaving. Focus goes to Stay (the safe choice) and is trapped
 * between the dialog's focusable parts; Escape stays; on close focus returns to what had it (the link that was
 * used). Native <dialog> where the engine has it, with the same behaviour by hand where it does not.
 */
export function LeaveDialog({
  open,
  title,
  body,
  stayLabel,
  leaveLabel,
  onStay,
  onLeave,
  fallback,
  children,
  leavePrimary = false,
  busy = false,
  busyReason,
  hideLeave = false,
}: {
  open: boolean;
  title: string;
  body: string;
  stayLabel: string;
  leaveLabel: string;
  onStay(): void;
  onLeave(): void;
  /** Focus target when the opener is gone. */
  fallback?: (() => HTMLElement | null) | undefined;
  /** More to read between the text and the buttons (the publish dialog's list of changes). */
  children?: ReactNode;
  /** The second button is the main action (publish), not the way out. */
  leavePrimary?: boolean;
  /** An action is under way: both buttons stay focusable but do nothing (spec 6.2). */
  busy?: boolean;
  /** Why the buttons do nothing while `busy`; read by both buttons and shown in the dialog. */
  busyReason?: string | undefined;
  /** Only the first button: there is nothing to confirm (the publish dialog with no changes). */
  hideLeave?: boolean;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  // Read by the key and cancel handlers: once the action is under way it cannot be called off, so
  // Escape must not look like a cancel while the request still completes.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      stayRef.current?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      const back = opener.current;
      opener.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
      else fallback?.()?.focus();
    }
  }, [open, fallback]);
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busyRef.current) onStay();
    } else if (e.key === "Tab") {
      // Wrap between the first and last focusable (the buttons, and a scrollable list of changes
      // when there is one), whatever the engine's own trap does.
      const stops = dialogRef.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]');
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
      aria-describedby={`${id}-body`}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        if (!busyRef.current) onStay();
      }}
      // Closed by the browser on its own (a second close request the page cannot cancel): still a
      // Stay, so the sign-out that is waiting on the answer is never left hanging.
      onClose={() => {
        if (openRef.current && !busyRef.current) onStay();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-body`}>{body}</p>
      {children}
      {busy && busyReason !== undefined && (
        <p id={`${id}-busy`} className="qm-builder__reason">
          {busyReason}
        </p>
      )}
      <div className="qm-leave-dialog__actions">
        <button
          ref={stayRef}
          type="button"
          className={leavePrimary ? "qm-button qm-button--secondary" : "qm-button"}
          aria-disabled={busy ? "true" : undefined}
          aria-describedby={busy && busyReason !== undefined ? `${id}-busy` : undefined}
          onClick={busy ? undefined : onStay}
        >
          {stayLabel}
        </button>
        {!hideLeave && (
          <button
            ref={leaveRef}
            type="button"
            className={leavePrimary ? "qm-button" : "qm-button qm-button--secondary"}
            aria-disabled={busy ? "true" : undefined}
            aria-describedby={busy && busyReason !== undefined ? `${id}-busy` : undefined}
            onClick={busy ? undefined : onLeave}
          >
            {leaveLabel}
          </button>
        )}
      </div>
    </dialog>
  );
}
