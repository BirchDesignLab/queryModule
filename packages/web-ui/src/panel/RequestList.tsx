import {
  type JSX,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useShortcutAction } from "../shortcuts/ShortcutProvider.js";
import { SourceLine, type SourceLineTone } from "./SourceLine.js";

/** One source of a part and where it stands: the text carries the status, the icon only repeats it. */
export interface SourceLineView {
  /** Stable across updates (correlation ID, part, source), so a line is never rebuilt. */
  key: string;
  /**
   * Picks the icon and its weight; never the only carrier of the status. `notRun`: dropped before
   * dispatch. `unknown`: a status this app does not know (#650), shown neutrally.
   */
  tone: SourceLineTone;
  /** Already in words, for example "State source: timed out". */
  text: string;
  /** Why the source did not return, in words ("no answer in 10 s"); absent when it did or is pending. */
  why?: string;
  /**
   * The source's result card, once its payload is here. It stands in for the status line (its own
   * heading says "Source: returned"); the key stays, so the line becoming a card is one swap.
   */
  card?: ReactNode;
}

/** A part of a request: the primary part has no label, a nested one is labelled with its origin. */
export interface RequestPartView {
  key: string;
  /** For example "Also run: Warrant"; absent on the primary part. */
  label?: string;
  /** A skipped part says so here and has no lines. */
  skippedText?: string;
  lines: readonly SourceLineView[];
}

export interface RequestRowView {
  /** Stable across Sending, Acknowledged and Failed, so a row is never rebuilt (spec 6.6). */
  id: string;
  status: "sending" | "acknowledged" | "failed";
  typeLabel: string;
  /** The command the request was built as; set in mono. Display only: never in an accessible name. */
  summary: string;
  /**
   * The accessible name for the row's fieldset, Copy and Retry: the query type and the primary
   * typed field, or the short correlation ID (ruling 12). Already in words.
   */
  name: string;
  /** The request's highest severity badge (spec 6.2); absent until a returned source has one. */
  severityBadge?: ReactNode;
  /** The full correlation ID; only an acknowledged row has one. */
  reference?: string;
  /** Epoch milliseconds. */
  acknowledgedAt?: number;
  /** Why the request failed, already in words. */
  failureText?: string;
  /** Short lines under the row, for example "State source: pending". */
  notes: readonly string[];
  /** An acknowledged row's parts with per-source status lines (spec 6.2). */
  parts?: readonly RequestPartView[];
  /** A failed row the owner can send again; shows a Retry button when the list has onRetry. */
  retryable?: boolean;
  /**
   * A settled row whose values the owner can load into the form as a new query (G32: every row, not
   * only a config-changed failure, #477): shows "Edit as new query" when the list has onEditAsNew.
   * It sits beside Retry on a failed row that has both. A row still sending never shows it.
   */
  editable?: boolean;
}

export interface RequestListProps {
  rows: readonly RequestRowView[];
  /** The visible heading, for example "Requests this shift". */
  heading: string;
  /** Shown beside the heading, for example "3 requests"; not part of the section's name. */
  countText?: string;
  emptyText: string;
  onCopy(reference: string): void;
  /** Sends a retryable failed row's values again as a new request; the owner adds the new row. */
  onRetry?(rowId: string): void;
  /**
   * Loads an editable row's kept values into the form as a new query; the owner does it and
   * moves focus, because the user pressed the action. The row itself stays as history.
   */
  onEditAsNew?(rowId: string): void;
  /**
   * Scrolls the list to the top of the screen when the user's own request starts sending and the list
   * begins in the lower half of the viewport, so a result that lands below the form is seen (the
   * officer layout stacks it under the form, G11). Never moves focus.
   */
  revealOnSend?: boolean;
  t(key: string, params?: Readonly<Record<string, string | number | boolean>>): string;
}

/** How long after a request starts the list keeps being brought into view while it grows. */
const REVEAL_MS = 5000;
/** The list counts as in view once its top is in the top 30% of the viewport. */
const REVEAL_TOP = 0.3;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The last eight characters of a correlation ID: what the announcement says, and easy to read out.
 * A UUIDv7 starts with a millisecond timestamp, so its first eight hex digits repeat for every request
 * within about 65 seconds (SEC-014); the tail is the random part and tells requests apart. An ID that is
 * not UUID-shaped (a placeholder, a test ID) is shown whole when short, else by its last eight characters.
 */
export function shortReference(reference: string): string {
  return reference.slice(-8);
}

let ackFormat: Intl.DateTimeFormat | undefined;

/** MM-DD-YY HH:mm:ss in local time (spec 6.2). The formatter is built once: every row of the list
 *  formats on every render, and constructing an Intl formatter costs far more than using one. It keeps
 *  the time zone it resolved when first built: a zone changed while the tab is open shows after a reload. */
export function formatAckTime(epochMs: number): string {
  ackFormat ??= new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = ackFormat.formatToParts(new Date(epochMs));
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
  countText,
  emptyText,
  onCopy,
  onRetry,
  onEditAsNew,
  revealOnSend = false,
  t,
}: RequestListProps): JSX.Element {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const newest = rows[0];
  const sendingId = newest?.status === "sending" ? newest.id : null;
  // The row that was already sending at mount is not "new": only a request started afterwards reveals.
  const seenSending = useRef<string | null>(sendingId);
  // A reveal stays owed for a few seconds: the list is short when the row starts sending and grows as
  // the cards arrive, so the first scroll may stop at the end of a page that is still short.
  const revealUntil = useRef(0);
  // Every commit: a no-op unless a reveal is owed.
  useEffect(() => {
    if (!revealOnSend) return;
    if (sendingId !== null && sendingId !== seenSending.current) {
      seenSending.current = sendingId;
      revealUntil.current = Date.now() + REVEAL_MS;
    }
    if (Date.now() >= revealUntil.current) return;
    const section = sectionRef.current;
    if (section === null) return;
    if (section.getBoundingClientRect().top > window.innerHeight * REVEAL_TOP) {
      section.scrollIntoView({ block: "start" });
    } else {
      revealUntil.current = 0;
    }
  });
  // Roving focus (spec 6.4, UX-015): one row is the tab stop. The selection is tracked by row id, so
  // a row arriving on top, or an update to a row, never moves it; with none chosen the first row
  // is the tab stop. Only the user's own keys or focus change it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selectedId),
  );
  const rowElements = (): HTMLElement[] =>
    Array.from(listRef.current?.children ?? []).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );
  const move = (delta: number): void => {
    const next = rows[Math.min(rows.length - 1, Math.max(0, selectedIndex + delta))];
    if (next === undefined) return;
    setSelectedId(next.id);
    rowElements()[rows.indexOf(next)]?.focus();
  };
  useShortcutAction("selectPrev", () => move(-1));
  useShortcutAction("selectNext", () => move(1));
  // The cards of the selected row own their open state; their toggles are the one way to change it
  // (a button, so a pointer or Space does the same). Enter opens every closed card of the row, or
  // closes them all when none is closed. Focus stays where it is.
  useShortcutAction("toggleDetail", () => {
    const toggles = Array.from(
      rowElements()[selectedIndex]?.querySelectorAll<HTMLButtonElement>(
        "button.qm-view-toggle[aria-expanded]",
      ) ?? [],
    );
    const anyClosed = toggles.some((b) => b.getAttribute("aria-expanded") === "false");
    for (const b of toggles) {
      if ((b.getAttribute("aria-expanded") === "false") === anyClosed) b.click();
    }
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The row that held focus when it left the list (a placeholder row built from the detail fetch
  // is replaced by the request's own row when the 202 lands), with its reference. Set by the row's
  // ref cleanup, which runs before the node leaves the page; the layout effect below tells a real
  // removal from a ref re-attach on a render, and hands focus to the row with the same reference.
  const lostRow = useRef<{ id: string; reference: string | undefined } | null>(null);
  // The Retry button that had focus when it was pressed. Where a retry replaces its own row (the
  // officer's "last request" shows one row), or its acknowledgment retires the button (the failed
  // row is superseded, M1 exit C1), the button leaves the page with focus on it; then, and only
  // then, focus goes to this heading (spec 6.4). Where the button stays, nothing moves.
  const retryFocus = useRef<Element | null>(null);
  // Every commit: a no-op until a Retry was pressed while it had focus.
  useLayoutEffect(() => {
    const lost = lostRow.current;
    lostRow.current = null;
    if (lost !== null && !rows.some((row) => row.id === lost.id)) {
      const active = document.activeElement;
      const successor =
        lost.reference === undefined
          ? undefined
          : rows.find((row) => row.reference === lost.reference);
      if (successor !== undefined && (active === null || active === document.body)) {
        setSelectedId(successor.id);
        rowElements()[rows.indexOf(successor)]?.focus();
      }
    }
    const pressed = retryFocus.current;
    if (pressed === null) return;
    if (pressed.isConnected) {
      // Still there: watched while it keeps focus (the answer may yet retire it); once the user
      // moves focus away, it is no longer this list's to move.
      if (document.activeElement !== pressed) retryFocus.current = null;
      return;
    }
    retryFocus.current = null;
    const active = document.activeElement;
    if (active === null || active === document.body) headingRef.current?.focus();
  });
  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="qm-requests"
      data-shortcut-context="results"
    >
      <div className="qm-requests__head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="qm-requests__heading">
          {heading}
        </h2>
        {countText === undefined ? null : <p className="qm-requests__count">{countText}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="qm-requests__empty">{emptyText}</p>
      ) : (
        <ol ref={listRef} className="qm-requests__list">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className={`qm-request qm-request--${row.status}`}
              aria-label={row.name}
              ref={(node) => () => {
                if (node?.contains(document.activeElement))
                  lostRow.current = { id: row.id, reference: row.reference };
              }}
              tabIndex={index === selectedIndex ? 0 : -1}
              // Focus entering the row or anything in it (a click, Tab, an arrow) selects it.
              onFocus={() => setSelectedId(row.id)}
            >
              <span className="qm-request__type">{row.typeLabel}</span>
              <code className="qm-request__summary">{row.summary}</code>
              <span className="qm-request__badges">
                <span className={BADGE_CLASS[row.status]}>
                  {t(`requests.status.${row.status}`)}
                </span>
                {row.severityBadge === undefined ? null : (
                  <span className="qm-request__severity">{row.severityBadge}</span>
                )}
              </span>
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
                        // share them: the type and primary field tell the copy buttons apart too.
                        aria-label={t("requests.copyReferenceOf", {
                          reference: shortReference(row.reference),
                          summary: row.name,
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
              {/* The actions sit on their own row under the meta line, the same in every layout (G32),
                  so a 48 px officer button never stretches the line of small facts above it. */}
              {row.status !== "sending" &&
              ((row.status === "failed" && row.retryable === true && onRetry !== undefined) ||
                (row.editable === true && onEditAsNew !== undefined)) ? (
                <div className="qm-request__actions">
                  {row.status === "failed" && row.retryable === true && onRetry !== undefined ? (
                    <button
                      type="button"
                      className="qm-button qm-button--secondary"
                      // The name (type and primary field) tells the buttons of failed rows apart.
                      aria-label={t("requests.retryOf", { summary: row.name })}
                      onClick={(event) => {
                        retryFocus.current =
                          document.activeElement === event.currentTarget
                            ? event.currentTarget
                            : null;
                        onRetry(row.id);
                      }}
                    >
                      {t("requests.retry")}
                    </button>
                  ) : null}
                  {row.editable === true && onEditAsNew !== undefined ? (
                    <button
                      type="button"
                      className="qm-button qm-button--secondary"
                      // Same name as the row, so the actions of two failed rows differ.
                      aria-label={t("requests.editAsNewOf", { summary: row.name })}
                      onClick={() => onEditAsNew(row.id)}
                    >
                      {t("requests.editAsNew")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {row.parts === undefined || row.parts.length === 0 ? null : (
                // A labelled group of divs, not nested lists: the row stays one list item (an
                // assistive technology reads the list's count as requests), and each line is text.
                <fieldset
                  className="qm-request__parts"
                  aria-label={t("sourceStatus.heading", { summary: row.name })}
                >
                  {row.parts.map((part) => {
                    const partHeadingId = `${headingId}-${row.id}-${part.key}`;
                    const Part = part.label === undefined ? "div" : "section";
                    return (
                      <Part
                        key={part.key}
                        className="qm-request__part"
                        {...(part.label === undefined ? {} : { "aria-labelledby": partHeadingId })}
                      >
                        {part.label === undefined ? null : (
                          <h4 id={partHeadingId} className="qm-request__part-label">
                            {part.label}
                          </h4>
                        )}
                        {part.skippedText === undefined ? null : (
                          <span className="qm-source qm-source--skipped">
                            <span aria-hidden="true" className="qm-source__icon">
                              –
                            </span>
                            <span>{part.skippedText}</span>
                          </span>
                        )}
                        {part.lines.length === 0 ? null : (
                          <div className="qm-request__sources">
                            {part.lines.map((line) =>
                              line.card === undefined ? (
                                <SourceLine
                                  key={line.key}
                                  tone={line.tone}
                                  text={line.text}
                                  why={line.why}
                                />
                              ) : (
                                <div key={line.key} className="qm-request__card">
                                  {line.card}
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </Part>
                    );
                  })}
                </fieldset>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
