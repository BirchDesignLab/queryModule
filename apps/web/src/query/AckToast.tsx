import { formatAckTime, shortReference } from "@querymodule/web-ui";
import { useEffect, useRef, useState } from "react";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { primaryTypedText } from "./request-name.js";

/** Spec 6.6 Toasts: a toast stays at least 10 s. */
export const ACK_TOAST_MS = 10_000;

/** What the toast keeps: ids, the ack time and the typed name text. Memory only, never a payload. */
interface Toast {
  correlationId: string;
  queryType: string;
  typed: string;
  acknowledgedAt: number;
}

/**
 * The acknowledgment toast (A6, spec 6.6, 10.2): when a Sending row becomes Acknowledged it shows
 * the request's name (type and primary typed field, ruling 12), the ack time and the copyable
 * reference. Polite, dismissible by keyboard, never takes focus, gone after 10 s. The shared
 * announcer speaks the same acknowledgment, so the toast is the visible and copyable half. A reset
 * empties the list, which clears the toast (spec 6.7).
 */
export function AckToast() {
  const { requests, announcer } = useServices();
  const config = useCachedConfig();
  const t = useT();
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let previous = requests.getState().items;
    return requests.subscribe((state) => {
      const before = new Map(previous.map((item) => [item.id, item.status]));
      previous = state.items;
      const acknowledged = state.items.find(
        (item) => item.status === "acknowledged" && before.get(item.id) === "sending",
      );
      if (acknowledged?.status === "acknowledged") {
        setToast({
          correlationId: acknowledged.correlationId,
          queryType: acknowledged.queryType,
          typed: primaryTypedText(acknowledged),
          acknowledgedAt: acknowledged.acknowledgedAt,
        });
      } else if (state.items.length === 0) {
        setToast(null);
      }
    });
  }, [requests]);

  // Spec 6.6: the timer stops while the pointer is over the toast or focus is inside it, and a
  // full 10 s runs again once both have left.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const key = toast?.correlationId;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (key === undefined || paused) return;
    timer.current = setTimeout(() => setToast(null), ACK_TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [key, paused]);
  useEffect(() => {
    if (key === undefined) {
      setHovered(false);
      setFocused(false);
    }
  }, [key]);

  if (toast === null) return null;
  const labelKey = config?.queryTypes.find((q) => q.code === toast.queryType)?.labelKey;
  const typeLabel = labelKey === undefined ? toast.queryType : t(labelKey);
  const reference = shortReference(toast.correlationId);
  const name = toast.typed === "" ? `${typeLabel} ${reference}` : `${typeLabel} ${toast.typed}`;
  return (
    <div
      className="qm-toast"
      role="status"
      data-testid="ack-toast"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <strong className="qm-toast__title">{t("toast.ack.title", { name })}</strong>
      <span>{t("requests.sentAt", { time: formatAckTime(toast.acknowledgedAt) })}</span>
      <span>
        {t("submit.reference")} <code>{reference}</code>
      </span>
      <button
        type="button"
        className="qm-button qm-button--ghost"
        aria-label={t("toast.ack.copy", { reference, summary: name })}
        onClick={() => {
          void navigator.clipboard?.writeText(toast.correlationId).then(
            () => announcer.announce(t("submit.referenceCopied")),
            () => undefined,
          );
        }}
      >
        {t("submit.copyReference")}
      </button>
      <button
        type="button"
        className="qm-button qm-button--ghost"
        aria-label={t("toast.ack.dismiss", { name })}
        onClick={() => setToast(null)}
      >
        {t("toast.dismiss")}
      </button>
    </div>
  );
}
