import { PUBLISH_NOTE_MAX } from "@querymodule/core/contracts";
import { useEffect, useId, useRef } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

/**
 * The publish dialog's optional change note (D-M2P0-4, BR-001, UX-004; design note "Publish note and
 * history drawer", D-M2P2-B6). Plain text in a wrapping text area. `PublishNoteSchema` forbids
 * control characters, so each one (Enter, a tab, a pasted line break) becomes a space as it is
 * typed and that rule cannot fail from this field. The count follows zod: UTF-16 units of the
 * trimmed text, which is what the request carries.
 */

/** From this many characters the count switches from "n of 200" to "n left" (design note). */
export const NOTE_WARN_AT = 180;

const CONTROL = /\p{Cc}/gu;

/** Control characters turned into spaces, as typed. */
export const cleanNote = (text: string): string => text.replace(CONTROL, " ");

/** What the request carries: the trimmed text, or null for none. */
export const noteToSend = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

/** How many characters past the limit; 0 when within it. */
export const noteOver = (text: string): number =>
  Math.max(0, text.trim().length - PUBLISH_NOTE_MAX);

type NoteState = "plain" | "warn" | "over";

export function PublishNoteField({
  value,
  onChange,
}: {
  value: string;
  onChange(next: string): void;
}) {
  const t = useT();
  const { announcer } = useServices();
  const uid = useId();
  const used = value.trim().length;
  const over = noteOver(value);
  const state: NoteState = over > 0 ? "over" : used >= NOTE_WARN_AT ? "warn" : "plain";
  const left = PUBLISH_NOTE_MAX - used;

  // Polite and coalesced (spec 6.6): said once when the count enters a new state, never per key.
  const said = useRef<NoteState>("plain");
  useEffect(() => {
    if (said.current === state) return;
    said.current = state;
    if (state === "warn") announcer.announce(t("admin.publish.note.left", { left }));
    else if (state === "over")
      announcer.announce(t("admin.publish.note.tooLong", { max: PUBLISH_NOTE_MAX, over }));
  }, [announcer, left, over, state, t]);

  const count =
    state === "over"
      ? t("admin.publish.note.over", { over })
      : state === "warn"
        ? t("admin.publish.note.left", { left })
        : t("admin.publish.note.count", { used, max: PUBLISH_NOTE_MAX });
  const hintId = `${uid}-hint`;
  const countId = `${uid}-count`;
  const errorId = `${uid}-error`;
  return (
    <div className="qm-field qm-publish-note">
      <div className="qm-publish-note__head">
        <label className="qm-field__label" htmlFor={`${uid}-note`}>
          {t("admin.publish.note.label")}
        </label>
        <span
          id={countId}
          className={
            state === "over"
              ? "qm-publish-note__count qm-publish-note__count--over"
              : "qm-publish-note__count"
          }
        >
          {state === "plain" ? null : (
            <span
              aria-hidden="true"
              className={`qm-publish-note__icon qm-publish-note__icon--${state}`}
            >
              {state === "over" ? "\u26A0\uFE0E" : "\u24D8"}
            </span>
          )}
          {count}
        </span>
      </div>
      <textarea
        id={`${uid}-note`}
        className="qm-field__input"
        rows={4}
        value={value}
        aria-invalid={state === "over" ? "true" : undefined}
        aria-describedby={`${hintId} ${countId}${state === "over" ? ` ${errorId}` : ""}`}
        onChange={(e) => onChange(cleanNote(e.currentTarget.value))}
      />
      {/* Divs, not paragraphs: the dialog's paragraph rule adds a bottom margin to every <p>. */}
      <div id={hintId} className="qm-field__description">
        {t("admin.publish.note.hint")}
      </div>
      {state === "over" && (
        <div id={errorId} className="qm-field__error">
          {t("admin.publish.note.tooLong", { max: PUBLISH_NOTE_MAX, over })}
        </div>
      )}
    </div>
  );
}
