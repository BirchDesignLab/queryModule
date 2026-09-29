import type { JSX } from "react";

export type SubmitBlockReason = "submitting" | "noConnection" | "updateRequired";

export interface SubmitButtonProps {
  id: string;
  reason: SubmitBlockReason | null;
  t(key: string): string;
}

/**
 * aria-disabled, never disabled, so it stays focusable and the visible reason is reachable
 * (spec 6.2, 6.6). The click is cancelled while blocked, which also stops Enter in a field
 * (implicit submission clicks this button).
 */
export function SubmitButton({ id, reason, t }: SubmitButtonProps): JSX.Element {
  const reasonId = `${id}-reason`;
  return (
    <>
      <button
        id={id}
        type="submit"
        className="qm-button"
        aria-disabled={reason === null ? undefined : "true"}
        aria-describedby={reason === null ? undefined : reasonId}
        onClick={(event) => {
          if (reason !== null) event.preventDefault();
        }}
      >
        {t("form.submit")}
      </button>
      {reason === null ? null : (
        <p id={reasonId} className="qm-field__description">
          {t(`form.${reason}`)}
        </p>
      )}
    </>
  );
}
