import { type AdminUser, AUDIT_EVENT_TYPES } from "@querymodule/core/contracts";
import { focusFirstInvalid, TextField } from "@querymodule/web-ui";
import { type FormEvent, useId, useRef } from "react";
import { useT } from "../app/i18n-context.js";
import type { AuditForm, AuditFormErrors } from "./audit-model.js";

/**
 * The audit filters: one form, applied only by Apply or Enter, because every fetch writes an
 * `auditViewed` row. User and Event change the form only. A bad field names itself and sends
 * nothing. The user is a picker when the users list is available, else an id field.
 */
export function AuditFilterForm({
  form,
  errors,
  users,
  onChange,
  onApply,
  onReset,
}: {
  form: AuditForm;
  errors: AuditFormErrors;
  /** The users list for the picker; null for a plain id field. */
  users: readonly AdminUser[] | null;
  onChange(patch: Partial<AuditForm>): void;
  onApply(): void;
  onReset(): void;
}) {
  const t = useT();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply();
    // Focus moves to the first bad field only; a good Apply leaves focus on the control used.
    queueMicrotask(() => {
      if (formRef.current?.querySelector('[aria-invalid="true"]'))
        focusFirstInvalid(formRef.current);
    });
  };
  return (
    <form
      ref={formRef}
      className="qm-audit__filters"
      aria-label={t("admin.audit.filters")}
      onSubmit={submit}
      noValidate
    >
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
            onChange={(e) => onChange({ user: e.currentTarget.value })}
          >
            <option value="">{t("admin.audit.field.anyUser")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {`${u.name} (${u.email})`}
              </option>
            ))}
          </select>
        </div>
      )}
      <TextField
        id={`${uid}-request`}
        label={t("admin.audit.field.requestId")}
        requiredText=""
        value={form.correlationId}
        onChange={(correlationId) => onChange({ correlationId })}
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
        error={errors.to === undefined ? undefined : t(errors.to)}
        description={t("admin.audit.field.windowHint")}
        data
      />
      <div className="qm-audit__filter-actions">
        <button type="submit" className="qm-button">
          {t("admin.audit.apply")}
        </button>
        <button type="button" className="qm-button qm-button--secondary" onClick={onReset}>
          {t("admin.audit.reset")}
        </button>
      </div>
    </form>
  );
}
