import { type SignInResult, useStore } from "@querymodule/client";
import type { ValidationError } from "@querymodule/core/contracts";
import { focusFirstInvalid, TextField, ThemeModeSelect } from "@querymodule/web-ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { LOGIN_LABEL_KEYS, type LoginField, validateLogin } from "./validate-login.js";

type Failure = Extract<SignInResult, { ok: false }>;

function failureKey(result: Failure): { key: string; params?: Record<string, number> } {
  if (result.code === "rateLimited") {
    return result.retryAfterSeconds === null
      ? { key: "login.rateLimitedLater" }
      : { key: "login.rateLimited", params: { retryAfterSeconds: result.retryAfterSeconds } };
  }
  if (result.code === "unavailable") return { key: "error.unavailable" };
  return { key: "login.failed" };
}

/**
 * The visible form error (#login-error) and the live-region announcement both need to carry
 * the failure, but announcing the identical sentence makes it appear twice in the accessible
 * text tree with nothing to tell the two nodes apart, so a plain text lookup for the full
 * sentence matches both. Announcing only the leading clause keeps the announcement distinct
 * from the visible paragraph while still naming the failure; the full sentence stays reachable
 * through the paragraph itself.
 */
function announcementFor(message: string): string {
  const boundary = message.indexOf(". ");
  return boundary === -1 ? message : message.slice(0, boundary + 1);
}

export function LoginPage({ clientSupported }: { clientSupported: boolean }) {
  const { session, authStore, announcer, preferences } = useServices();
  const t = useT();
  const navigate = useNavigate();
  const status = useStore(authStore, (s) => s.status);
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ValidationError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invalidAttempt, setInvalidAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (invalidAttempt > 0 && formRef.current !== null) focusFirstInvalid(formRef.current);
  }, [invalidAttempt]);

  if (status === "signedIn") return <Navigate to="/" replace />;

  const errorFor = (field: LoginField): string | undefined => {
    const error = fieldErrors.find((e) => e.params?.field === field);
    return error === undefined
      ? undefined
      : t(error.key, { ...error.params, label: t(LOGIN_LABEL_KEYS[field]) });
  };
  let blockedReason: string | null = null;
  if (!clientSupported) blockedReason = t("login.updateRequired");
  else if (submitting) blockedReason = t("login.submitting");

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (blockedReason !== null) return;
    const errors = validateLogin({ email, password });
    setFieldErrors(errors);
    setFormError(null);
    if (errors.length > 0) {
      announcer.announce(t("announce.fieldsNeedAttention", { count: errors.length }));
      setInvalidAttempt((n) => n + 1);
      return;
    }
    setSubmitting(true);
    const result = await session.signIn(email.trim(), password);
    setSubmitting(false);
    if (result.ok) {
      navigate("/", { replace: true });
      return;
    }
    const failure = failureKey(result);
    const message = t(failure.key, failure.params);
    setFormError(message);
    setPassword("");
    announcer.announce(announcementFor(message));
  }

  return (
    <main className="qm-page">
      <h1 ref={headingRef} tabIndex={-1}>
        {t("login.title")}
      </h1>
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        aria-describedby={formError === null ? undefined : "login-error"}
      >
        <TextField
          id="login-email"
          label={t("login.email")}
          requiredText={t("field.required")}
          required
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={errorFor("email")}
        />
        <TextField
          id="login-password"
          label={t("login.password")}
          requiredText={t("field.required")}
          required
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errorFor("password")}
        />
        {formError === null ? null : (
          <p id="login-error" className="qm-form-error">
            {formError}
          </p>
        )}
        <button
          type="submit"
          className="qm-button"
          aria-disabled={blockedReason === null ? undefined : "true"}
          aria-describedby={blockedReason === null ? undefined : "login-blocked"}
        >
          {t("login.submit")}
        </button>
        {blockedReason === null ? null : <p id="login-blocked">{blockedReason}</p>}
      </form>
      <footer>
        <ThemeModeSelect
          id="login-theme"
          value={themeMode}
          onChange={(mode) => preferences.getState().setThemeMode(mode)}
          t={t}
        />
      </footer>
    </main>
  );
}
