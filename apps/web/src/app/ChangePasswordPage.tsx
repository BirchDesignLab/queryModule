import type { ChangePasswordCode } from "@querymodule/client";
import { focusFirstInvalid, TextField } from "@querymodule/web-ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useT } from "./i18n-context.js";
import { useServices } from "./services-context.js";
import { useSignOut } from "./use-sign-out.js";

/** Better Auth's minPasswordLength for this app (packages/api/src/auth/auth.ts). */
const MIN_LENGTH = 12;

type Field = "current" | "next" | "confirm";
type Errors = Partial<Record<Field, string>>;

/** Where each refusal shows: at the field it is about, or in the form-level message. */
const REFUSAL: Record<ChangePasswordCode, { field: Field | null; key: string }> = {
  samePassword: { field: "next", key: "password.change.same" },
  incorrect: { field: "current", key: "password.change.incorrect" },
  tooShort: { field: "next", key: "password.change.tooShort" },
  rateLimited: { field: null, key: "login.rateLimitedLater" },
  unauthenticated: { field: null, key: "password.change.sessionEnded" },
  unavailable: { field: null, key: "error.unavailable" },
};

/**
 * "Choose a new password" (D-A26, SEC-005, UX-004): the only screen a user with an admin-issued
 * temporary password sees. RequireAuth shows it in place of the app, so no header, page or
 * WebSocket exists until the password is changed. On success the app drops what it cached while
 * refused and carries on. Sign out stays available (the same path as every screen, #242). The
 * passwords live in this component's state only and leave with it.
 */
export function ChangePasswordPage() {
  const { authApi, authStore, queryClient, announcer } = useServices();
  const t = useT();
  const signOut = useSignOut();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (attempt === 0 || formRef.current === null) return;
    if (focusFirstInvalid(formRef.current) === null) headingRef.current?.focus();
  }, [attempt]);

  const check = (): Errors => {
    const found: Errors = {};
    const required = (label: string) => t("validation.required", { label: t(label) });
    if (current === "") found.current = required("password.change.current");
    if (next === "") found.next = required("password.change.new");
    else if (next.length < MIN_LENGTH) found.next = t("password.change.tooShort");
    if (confirm === "") found.confirm = required("password.change.confirm");
    else if (next !== "" && confirm !== next) found.confirm = t("password.change.mismatch");
    return found;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const found = check();
    setErrors(found);
    setFormError(null);
    const count = Object.keys(found).length;
    if (count > 0) {
      announcer.announce(t("announce.fieldsNeedAttention", { count }));
      setAttempt((n) => n + 1);
      return;
    }
    setSubmitting(true);
    try {
      const result = await authApi.changePassword(current, next);
      if (result.ok) {
        announcer.announce(t("password.change.done"));
        // Whatever was refused while the password was temporary is dropped and fetched again.
        await queryClient.resetQueries();
        authStore.getState().setPasswordChangeRequired(false);
        return;
      }
      const refusal = REFUSAL[result.code];
      const message = t(refusal.key);
      if (refusal.field === null) setFormError(message);
      else setErrors({ [refusal.field]: message });
      announcer.announce(message);
      setAttempt((n) => n + 1);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <main className="qm-login">
      <section className="qm-login__panel" aria-labelledby="change-password-product">
        <h1 id="change-password-product" className="qm-login__product">
          {t("login.product")}
        </h1>
        <h2 ref={headingRef} tabIndex={-1} className="qm-login__title">
          {t("password.change.title")}
        </h2>
        <p>{t("password.change.intro")}</p>
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => void onSubmit(event)}
          aria-describedby={formError === null ? undefined : "change-password-error"}
        >
          <TextField
            id="change-password-current"
            label={t("password.change.current")}
            requiredText={t("field.required")}
            required
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            error={errors.current}
          />
          <TextField
            id="change-password-new"
            label={t("password.change.new")}
            requiredText={t("field.required")}
            required
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            error={errors.next}
          />
          <TextField
            id="change-password-confirm"
            label={t("password.change.confirm")}
            requiredText={t("field.required")}
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={errors.confirm}
          />
          {formError === null ? null : (
            <p id="change-password-error" className="qm-form-error" role="alert">
              {formError}
            </p>
          )}
          <button
            type="submit"
            className="qm-button qm-button--block"
            aria-disabled={submitting ? "true" : undefined}
            aria-describedby={submitting ? "change-password-busy" : undefined}
          >
            {t("password.change.submit")}
          </button>
          {submitting ? <p id="change-password-busy">{t("password.change.submitting")}</p> : null}
        </form>
        <footer className="qm-login__secondary">
          <button
            type="button"
            className="qm-button qm-button--secondary"
            onClick={() => void signOut()}
          >
            {t("home.signOut")}
          </button>
        </footer>
      </section>
    </main>
  );
}
