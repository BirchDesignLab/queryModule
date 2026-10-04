import { useId, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { ChangesView } from "./ChangesView.js";
import type { JsonObject } from "./draft.js";
import { LeaveDialog } from "./LeaveGuard.js";
import type { PublishFlow } from "./PublishFlow.js";
import { SCROLL_FOCUS } from "./scroll-focus.js";

/** The toolbar's Save draft and Review and publish, each with its visible reason when disabled. */
export function PublishButtons({
  flow,
  parseError,
}: {
  flow: PublishFlow;
  /** The Raw JSON text does not parse. */
  parseError: boolean;
}) {
  const t = useT();
  const uid = useId();
  const saveReason = flow.busy
    ? t("admin.config.reviewBusy")
    : parseError
      ? t("admin.config.saveJson")
      : !flow.unsaved
        ? t("admin.config.saveNone")
        : null;
  const reviewReason = flow.busy
    ? t("admin.config.reviewBusy")
    : parseError
      ? t("admin.config.reviewJson")
      : flow.changeCount === 0 && !flow.unsaved
        ? t("admin.config.reviewNone")
        : null;
  const saveBlocked = saveReason !== null;
  return (
    <>
      <button
        type="button"
        className="qm-button qm-button--secondary"
        aria-disabled={saveBlocked ? "true" : undefined}
        aria-describedby={saveReason !== null ? `${uid}-save` : undefined}
        onClick={saveBlocked ? undefined : flow.save}
      >
        {t("admin.config.save")}
      </button>
      <button
        type="button"
        className="qm-button"
        aria-disabled={reviewReason !== null ? "true" : undefined}
        aria-describedby={reviewReason !== null ? `${uid}-review` : undefined}
        onClick={reviewReason !== null ? undefined : flow.review}
      >
        {t("admin.config.review")}
      </button>
      {saveReason !== null && (
        <p className="qm-builder__reason" id={`${uid}-save`}>
          {saveReason}
        </p>
      )}
      {reviewReason !== null && (
        <p className="qm-builder__reason" id={`${uid}-review`}>
          {reviewReason}
        </p>
      )}
    </>
  );
}

/** What was done or went wrong, and the way out of a conflict. Errors are an alert; the rest is plain. */
export function PublishNotices({ flow }: { flow: PublishFlow }) {
  const t = useT();
  return (
    <>
      {flow.conflict && (
        <div className="qm-builder__notice" role="alert">
          <span>{t("admin.conflict.message")}</span>
          <button type="button" className="qm-button" onClick={flow.askReload}>
            {t("admin.conflict.load")}
          </button>
        </div>
      )}
      {flow.staleBase && (
        <div className="qm-builder__notice" role="alert">
          <span>{t("admin.config.reloadFailed")}</span>
          <button type="button" className="qm-button" onClick={flow.retryLoad}>
            {t("admin.config.reloadRetry")}
          </button>
        </div>
      )}
      {flow.notice?.kind === "error" && (
        <p className="qm-builder__notice" role="alert">
          {flow.notice.text}
        </p>
      )}
      {flow.notice?.kind === "info" && <p className="qm-builder__notice">{flow.notice.text}</p>}
    </>
  );
}

/** The review dialog (changes and Publish) and the confirm before the latest version replaces the edits. */
export function PublishDialogs({
  flow,
  doc,
  fallback,
  rollbackFallback,
}: {
  flow: PublishFlow;
  doc: JsonObject;
  /** Focus target for the review and reload dialogs when their opener is gone. */
  fallback?: () => HTMLElement | null;
  /** The same for the roll back dialog, which the history opened: the History button. */
  rollbackFallback?: () => HTMLElement | null;
}) {
  const t = useT();
  const open = flow.reviewing !== null;
  // Nothing differs from the live version (the edits went back to it): there is nothing to confirm.
  // Decided when the dialog opens: a live check that finds no changes while it is open must not
  // take the focused Publish button away.
  const [latched, setLatched] = useState<boolean | null>(null);
  if (open && latched === null) setLatched(flow.changeCount === 0);
  else if (!open && latched !== null) setLatched(null);
  const nothing = latched ?? flow.changeCount === 0;
  return (
    <>
      <LeaveDialog
        open={open}
        title={t("admin.publish.title")}
        body={
          nothing
            ? t("admin.publish.nothing")
            : t("admin.publish.body", { version: flow.reviewing ?? 0 })
        }
        stayLabel={nothing ? t("admin.publish.close") : t("admin.publish.cancel")}
        leaveLabel={t("admin.publish.confirm", { version: flow.reviewing ?? 0 })}
        hideLeave={nothing}
        onStay={flow.cancelReview}
        onLeave={flow.publish}
        leavePrimary
        busy={flow.busy}
        busyReason={t("admin.publish.busy")}
        fallback={fallback}
      >
        {/* Scrolls when the list is long: focusable so the keyboard can scroll it. */}
        {!nothing && (
          <section
            className="qm-leave-dialog__content"
            aria-label={t("admin.publish.changes")}
            {...SCROLL_FOCUS}
          >
            {open && <ChangesView doc={doc} />}
          </section>
        )}
      </LeaveDialog>
      <LeaveDialog
        open={flow.rollingBack !== null}
        title={t("admin.rollback.title", { version: flow.rollingBack ?? 0 })}
        body={t("admin.rollback.body", { version: flow.rollingBack ?? 0 })}
        stayLabel={t("admin.rollback.cancel")}
        leaveLabel={t("admin.rollback.confirm", { version: flow.rollingBack ?? 0 })}
        onStay={flow.cancelRollback}
        onLeave={flow.rollback}
        leavePrimary
        busy={flow.busy}
        busyReason={t("admin.rollback.busy")}
        fallback={rollbackFallback ?? fallback}
      />
      <LeaveDialog
        open={flow.confirmingReload}
        title={t("admin.conflict.title")}
        body={t("admin.conflict.body")}
        stayLabel={t("admin.conflict.keep")}
        leaveLabel={t("admin.conflict.discard")}
        onStay={flow.cancelReload}
        onLeave={flow.reload}
        fallback={fallback}
      />
    </>
  );
}
