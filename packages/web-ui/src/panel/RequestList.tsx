import { type JSX, useId } from "react";

export interface RequestRowView {
  /** Stable across Sending, Acknowledged and Failed, so a row is never rebuilt (spec 6.6). */
  id: string;
  status: "sending" | "acknowledged" | "failed";
  typeLabel: string;
  /** The command the request was built as; set in mono. */
  summary: string;
  /** The full correlation ID; only an acknowledged row has one. */
  reference?: string;
  /** Epoch milliseconds. */
  acknowledgedAt?: number;
  /** Why the request failed, already in words. */
  failureText?: string;
  /** Short lines under the row, for example "State source: pending". */
  notes: readonly string[];
}

export interface RequestListProps {
  rows: readonly RequestRowView[];
  /** The visible heading, for example "Requests this shift". */
  heading: string;
  emptyText: string;
  onCopy(reference: string): void;
  t(key: string, params?: Readonly<Record<string, string | number | boolean>>): string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** The first eight characters of a correlation ID: what the announcement says, and easy to read out. */
export function shortReference(reference: string): string {
  return reference.slice(0, 8);
}

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

const BADGE_CLASS = {
  sending: "qm-badge qm-badge--status",
  acknowledged: "qm-badge qm-badge--ok",
  failed: "qm-badge qm-badge--warning",
} as const;

/**
 * The requests this session sent, newest first (visual system, "Requests this shift"). Not a live
 * region: the shared announcer says each state change once (spec 6.6), and this list never moves
 * focus. The text says a query was sent, never that a source answered; responses arrive with M2.
 */
export function RequestList({
  rows,
  heading,
  emptyText,
  onCopy,
  t,
}: RequestListProps): JSX.Element {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="qm-requests">
      <h2 id={headingId} className="qm-requests__heading">
        {heading}
      </h2>
      {rows.length === 0 ? (
        <p className="qm-requests__empty">{emptyText}</p>
      ) : (
        <ol className="qm-requests__list">
          {rows.map((row) => (
            <li key={row.id} className={`qm-request qm-request--${row.status}`}>
              <span className="qm-request__type">{row.typeLabel}</span>
              <code className="qm-request__summary">{row.summary}</code>
              <span className={BADGE_CLASS[row.status]}>{t(`requests.status.${row.status}`)}</span>
              {row.status === "sending" ? null : (
                <div className="qm-request__meta">
                  {row.status === "acknowledged" &&
                  row.reference !== undefined &&
                  row.acknowledgedAt !== undefined ? (
                    <>
                      <span>
                        {t("requests.sentAt", { time: formatAckTime(row.acknowledgedAt) })}
                      </span>
                      <span>
                        {t("submit.reference")} <code>{shortReference(row.reference)}</code>
                      </span>
                      <button
                        type="button"
                        className="qm-button qm-button--ghost"
                        // The first eight characters of a UUIDv7 are a timestamp, so two rows can
                        // share them: the command tells the copy buttons apart too.
                        aria-label={t("requests.copyReferenceOf", {
                          reference: shortReference(row.reference),
                          summary: row.summary === "" ? row.typeLabel : row.summary,
                        })}
                        onClick={() => onCopy(row.reference as string)}
                      >
                        {t("submit.copyReference")}
                      </button>
                    </>
                  ) : null}
                  {row.failureText === undefined ? null : (
                    <span className="qm-request__failure">{row.failureText}</span>
                  )}
                  {row.notes.map((note, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: notes are static text; two may match
                    <span key={index} className="qm-badge qm-badge--status">
                      {note}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
