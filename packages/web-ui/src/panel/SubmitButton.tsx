import type { JSX } from "react";

export type SubmitBlockReason = "submitting" | "noConnection" | "updateRequired" | "preview";

export interface SubmitButtonProps {
  id: string;
  reason: SubmitBlockReason | null;
  /** Extra id to describe the button, e.g. the form-level error list. */
  describedBy?: string;
  /** The key that runs the query, shown in the button ("Enter"); aria-hidden, the name stays the label. */
  keyHint?: string;
  t(key: string): string;
}

/**
 * aria-disabled, never disabled, so it stays focusable and the visible reason is reachable
 * (spec 6.2, 6.6). The click is cancelled while blocked, which also stops Enter in a field
 * (implicit submission clicks this button). "preview" lets the click through so the form still
 * validates as it would live; the preview never sends (ADR-0011).
 */
export function SubmitButton({
  id,
  reason,
  describedBy,
  keyHint,
  t,
}: SubmitButtonProps): JSX.Element {
  const reasonId = `${id}-reason`;
  const described = [describedBy, reason === null ? undefined : reasonId].filter(Boolean).join(" ");
  return (
    <>
      <button
        id={id}
        type="submit"
        className="qm-button"
        aria-disabled={reason === null ? undefined : "true"}
        aria-describedby={described === "" ? undefined : described}
        onClick={(event) => {
          if (reason !== null && reason !== "preview") event.preventDefault();
        }}
      >
        {t("form.submit")}
        {keyHint === undefined ? null : (
          <kbd className="qm-kbd" aria-hidden="true">
            {keyHint}
          </kbd>
        )}
      </button>
      {reason === null ? null : (
        <p id={reasonId} className="qm-field__description">
          {t(`form.${reason}`)}
        </p>
      )}
    </>
  );
}
