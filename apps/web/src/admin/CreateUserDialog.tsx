import { type AdminUser, CreateUserBodySchema, ROLES } from "@querymodule/core/contracts";
import { focusFirstInvalid, SelectField, TextField } from "@querymodule/web-ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { Modal } from "./Modal.js";
import { isRole } from "./roles.js";
import { createUser } from "./users-api.js";

type Field = "email" | "name" | "role";
type Errors = Partial<Record<Field, string>>;

/**
 * Create user, then the temporary password. The password lives in this component's state and
 * nowhere else: not the list, not a query or mutation cache, not the log. Done unmounts the
 * dialog and with it the only copy. Escape does not close the password view: it is shown once,
 * so leaving it takes the explicit Done (spec 6.2).
 */
export function CreateUserDialog({
  onClose,
  onCreated,
  fallback,
}: {
  onClose(): void;
  onCreated(user: AdminUser): void;
  fallback(): HTMLElement | null;
}) {
  const { api, announcer } = useServices();
  const t = useT();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const formRef = useRef<HTMLFormElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (attempt === 0 || formRef.current === null) return;
    focusFirstInvalid(formRef.current);
  }, [attempt]);
  const revealed = issued !== null;
  useEffect(() => {
    // The form is gone and its focused field with it: the password's Copy takes focus.
    if (revealed) copyRef.current?.focus();
  }, [revealed]);

  const required = (label: string) => t("validation.required", { label: t(label) });

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const found: Errors = {};
    if (email.trim() === "") found.email = required("admin.users.create.email");
    if (name.trim() === "") found.name = required("admin.users.create.name");
    if (!isRole(role)) found.role = required("admin.users.create.role");
    if (Object.keys(found).length === 0) {
      // The contract's own check, so each field says what is wrong before anything is sent.
      const checked = CreateUserBodySchema.safeParse({
        email: email.trim(),
        name: name.trim(),
        role,
      });
      if (!checked.success) {
        for (const issue of checked.error.issues) {
          const field = issue.path[0];
          if (field !== "email" && field !== "name" && field !== "role") continue;
          if (found[field] !== undefined) continue;
          const label = t(`admin.users.create.${field}`);
          found[field] =
            issue.code === "too_big"
              ? t("validation.tooLong", { label, max: String(issue.maximum) })
              : t("validation.patternMismatch", { label });
        }
      }
    }
    setErrors(found);
    setFormError(null);
    const count = Object.keys(found).length;
    if (count > 0 || !isRole(role)) {
      announcer.announce(t("announce.fieldsNeedAttention", { count }));
      setAttempt((n) => n + 1);
      return;
    }
    setSubmitting(true);
    try {
      const result = await createUser(api, { email: email.trim(), name: name.trim(), role });
      if (!mounted.current) return;
      if (result.ok) {
        onCreated(result.user);
        setIssued({ name: result.user.name, password: result.temporaryPassword });
        return;
      }
      if (result.reason === "emailTaken") {
        setErrors({ email: t("validation.emailTaken") });
        setAttempt((n) => n + 1);
      } else {
        setFormError(
          t(result.reason === "invalid" ? "admin.users.create.invalid" : "error.unavailable"),
        );
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  async function copyPassword(password: string): Promise<void> {
    try {
      if (navigator.clipboard === undefined) throw new Error("no clipboard");
      await navigator.clipboard.writeText(password);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  if (issued !== null) {
    return (
      <Modal
        title={t("admin.users.reveal.title", { name: issued.name })}
        description={t("admin.users.reveal.body", { name: issued.name })}
        onClose={() => undefined}
        persistent
        fallback={fallback}
      >
        <p className="qm-users__password">
          <code>{issued.password}</code>
        </p>
        {/* Always in the DOM: a live region inserted with its text may not be announced. */}
        <p className={copy === "failed" ? "qm-form-error" : undefined} role="status">
          {copy === "idle"
            ? null
            : t(copy === "copied" ? "admin.users.reveal.copied" : "admin.users.reveal.copyFailed")}
        </p>
        <div className="qm-leave-dialog__actions">
          <button
            ref={copyRef}
            type="button"
            className="qm-button qm-button--secondary"
            onClick={() => void copyPassword(issued.password)}
          >
            {t("admin.users.reveal.copy")}
          </button>
          <button type="button" className="qm-button" onClick={onClose}>
            {t("admin.users.reveal.done")}
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title={t("admin.users.create.title")}
      onClose={onClose}
      busy={submitting}
      fallback={fallback}
    >
      <form ref={formRef} noValidate onSubmit={(event) => void onSubmit(event)}>
        <TextField
          id="create-user-email"
          label={t("admin.users.create.email")}
          requiredText={t("field.required")}
          required
          type="email"
          autoComplete="off"
          value={email}
          onChange={setEmail}
          error={errors.email}
        />
        <TextField
          id="create-user-name"
          label={t("admin.users.create.name")}
          requiredText={t("field.required")}
          required
          autoComplete="off"
          value={name}
          onChange={setName}
          error={errors.name}
        />
        <SelectField
          id="create-user-role"
          label={t("admin.users.create.role")}
          requiredText={t("field.required")}
          required
          options={ROLES.map((r) => ({ code: r, label: t(`role.${r}`) }))}
          value={role}
          onChange={setRole}
          error={errors.role}
        />
        {formError === null ? null : (
          <p className="qm-form-error" role="alert">
            {formError}
          </p>
        )}
        {submitting && (
          <p id="create-user-busy" className="qm-builder__reason">
            {t("admin.users.create.submitting")}
          </p>
        )}
        <div className="qm-leave-dialog__actions">
          <button
            type="button"
            className="qm-button qm-button--secondary"
            aria-disabled={submitting ? "true" : undefined}
            aria-describedby={submitting ? "create-user-busy" : undefined}
            onClick={submitting ? undefined : onClose}
          >
            {t("admin.users.cancel")}
          </button>
          <button
            type="submit"
            className="qm-button"
            aria-disabled={submitting ? "true" : undefined}
          >
            {t("admin.users.create.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
