import { useId } from "react";
import { useT } from "../app/i18n-context.js";

/**
 * The right pane on a mock item (Q3, developer 10-05-26: "Try a match" is after the demo, #565): a
 * static note in place of the live preview. No matcher runs here and nothing is sent.
 */
export function MockPane() {
  const t = useT();
  const headingId = useId();
  return (
    <section className="qm-admin__preview qm-preview" aria-labelledby={headingId}>
      <div className="qm-preview__head">
        <h3 id={headingId}>{t("admin.mock.pane.title")}</h3>
      </div>
      <div className="qm-preview__body">
        <p className="qm-preview__state">{t("admin.mock.pane.note")}</p>
      </div>
    </section>
  );
}
