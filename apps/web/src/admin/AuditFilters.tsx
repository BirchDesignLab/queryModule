import { type AdminUser, AUDIT_EVENT_TYPES } from "@querymodule/core/contracts";
import { TextField } from "@querymodule/web-ui";
import { type ReactNode, type RefObject, useId } from "react";
import { useT } from "../app/i18n-context.js";
import type { AuditForm, AuditFormErrors } from "./audit-model.js";

/**
 * The audit filters (design v6): one form, applied only by Apply filters or Enter, because every
 * fetch writes an `auditViewed` row. User and Event change the form only. A bad field names itself
 * and sends nothing. The user is a picker when the users list is available, else an id field.
 * `children` is the export control, which sits in the same bar.
 */
export function AuditFilterForm({
  form,
  errors,
  users,
  resetRef,
  onChange,
  onApply,
  onReset,
  children,
}: {
  form: AuditForm;
  errors: AuditFormErrors;
  /** The users list for the picker; null for a plain id field. */
  users: readonly AdminUser[] | null;
  /** The Reset button, so the page can put focus back on it after an empty-state reset. */
  resetRef: RefObject<HTMLButtonElement | null>;
  onChange(patch: Partial<AuditForm>): void;
  onApply(): void;
  onReset(): void;
  children?: ReactNode;
}) {
  const t = useT();
  const uid = useId();
  const userHint = `${uid}-user-hint`;
  return (
    <form
      className="qm-audit__form"
      aria-label={t("admin.audit.filters")}
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
      noValidate
    >
      <div className="qm-audit__filters">
        {users === null ? (
          <TextField
            id={`${uid}-user`}
            label={t("admin.audit.field.userId")}
            requiredText=""
            value={form.user}
            onChange={(user) => onChange({ user })}
            description={t("admin.audit.field.userHint")}
            data
          />
        ) : (
          <div className="qm-field">
            <label htmlFor={`${uid}-user`} className="qm-field__label">
              {t("admin.audit.field.user")}
            </label>
            <select
              id={`${uid}-user`}
              className="qm-select"
              value={form.user}
              aria-describedby={userHint}
              onChange={(e) => onChange({ user: e.currentTarget.value })}
            >
              <option value="">{t("admin.audit.field.anyUser")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {`${u.name} (${u.email})`}
                </option>
              ))}
            </select>
            <p id={userHint} className="qm-field__description">
              {t("admin.audit.field.userHint")}
            </p>
          </div>
        )}
        <TextField
          id={`${uid}-request`}
          label={t("admin.audit.field.requestId")}
          requiredText=""
          value={form.correlationId}
          onChange={(correlationId) => onChange({ correlationId })}
          description={t("admin.audit.field.requestHint")}
          error={errors.correlationId === undefined ? undefined : t(errors.correlationId)}
          data
        />
        <div className="qm-field">
          <label htmlFor={`${uid}-event`} className="qm-field__label">
            {t("admin.audit.field.event")}
          </label>
          <select
            id={`${uid}-event`}
            className="qm-select"
            value={form.type}
            onChange={(e) => onChange({ type: e.currentTarget.value })}
          >
            <option value="">{t("admin.audit.field.anyEvent")}</option>
            {AUDIT_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`admin.audit.type.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <TextField
          id={`${uid}-from`}
          label={t("admin.audit.field.from")}
          requiredText=""
          value={form.from}
          onChange={(from) => onChange({ from })}
          error={errors.from === undefined ? undefined : t(errors.from)}
          data
        />
        <TextField
          id={`${uid}-to`}
          label={t("admin.audit.field.to")}
          requiredText=""
          value={form.to}
          onChange={(to) => onChange({ to })}
          description={t("admin.audit.field.windowHint")}
          error={errors.to === undefined ? undefined : t(errors.to)}
          data
        />
      </div>
      <div className="qm-audit__bar">
        <button type="submit" className="qm-button">
          {t("admin.audit.apply")}
        </button>
        <button
          ref={resetRef}
          type="button"
          className="qm-button qm-button--secondary"
          onClick={onReset}
        >
          {t("admin.audit.reset")}
        </button>
        {children}
      </div>
    </form>
  );
}
