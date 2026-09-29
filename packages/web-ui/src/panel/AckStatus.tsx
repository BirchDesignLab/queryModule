import type { JSX } from "react";

export interface AckView {
  queryTypeLabel: string;
  correlationId: string;
  /** Epoch milliseconds. */
  acknowledgedAt: number;
  skipped: readonly { queryTypeLabel: string; reasonText: string }[];
}

export interface AckStatusProps {
  ack: AckView | null;
  onCopy(correlationId: string): void;
  t(key: string, params?: Readonly<Record<string, string | number | boolean>>): string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** MM-DD-YY HH:mm:ss in local time (spec 6.2). */
export function formatAckTime(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}-${get("day")}-${get("year")} ${pad(Number(get("hour")))}:${get("minute")}:${get("second")}`;
}

/**
 * The last acknowledgment, on screen until the next one. Not a live region: the announcer speaks
 * (spec 6.6). The text says the query was sent, never that a source answered.
 */
export function AckStatus({ ack, onCopy, t }: AckStatusProps): JSX.Element | null {
  if (ack === null) return null;
  const headingId = "qm-ack-heading";
  return (
    <section aria-labelledby={headingId} className="qm-ack">
      <h2 id={headingId} className="qm-ack__heading">
        {t("submit.sentHeading")}
      </h2>
      <p className="qm-ack__line">
        {ack.queryTypeLabel}, {formatAckTime(ack.acknowledgedAt)}
      </p>
      <p className="qm-ack__line">
        {t("submit.reference")} <code>{ack.correlationId}</code>{" "}
        <button type="button" className="qm-button" onClick={() => onCopy(ack.correlationId)}>
          {t("submit.copyReference")}
        </button>
      </p>
      {ack.skipped.map((part) => (
        <p key={part.queryTypeLabel} className="qm-ack__line">
          {t("submit.partSkipped", { queryType: part.queryTypeLabel, reason: part.reasonText })}
        </p>
      ))}
    </section>
  );
}
