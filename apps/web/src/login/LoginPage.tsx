import { loadPreferences, type SignInResult, useStore } from "@querymodule/client";
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
 * SEC-006, spec 5.6: the last sign-out wiped this device but the server did not confirm it, so
 * the session cookie may still be valid. role="alert" announces it on arrival; a retry repeats
 * the server sign-out and the notice goes away only when the server confirms.
 */
function SignOutFailedNotice({ onCleared }: { onCleared(): void }) {
  const { session, announcer } = useServices();
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  async function retry(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    try {
      // false: a sign-in started meanwhile and this retry was dropped (W4); say nothing.
      if (!(await session.retrySignOut())) return;
      announcer.announce(t("signOut.done"));
      // This notice (and its focused button) unmounts; move focus before it does (spec 6.4).
      onCleared();
    } catch {
      announcer.announce(t("signOut.failed"), "assertive");
    } finally {
      setRetrying(false);
    }
  }
  return (
    <div role="alert" className="qm-form-error">
      <p>{t("signOut.failed")}</p>
      <button
        type="button"
        className="qm-button"
        aria-disabled={retrying ? "true" : undefined}
        onClick={() => void retry()}
      >
        {t("signOut.retry")}
      </button>
    </div>
  );
}

export function LoginPage({ clientSupported }: { clientSupported: boolean }) {
  const { api, session, authStore, announcer, preferences } = useServices();
  const t = useT();
  const navigate = useNavigate();
  const status = useStore(authStore, (s) => s.status);
  const signOutFailed = useStore(authStore, (s) => s.signOutFailed);
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
    if (invalidAttempt === 0 || formRef.current === null) return;
    const focused = focusFirstInvalid(formRef.current);
    if (focused === null) headingRef.current?.focus();
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
    try {
      const result = await session.signIn(email.trim(), password);
      if (result.ok) {
        await loadPreferences(api, preferences).catch(() => undefined);
        navigate("/", { replace: true });
        return;
      }
      const failure = failureKey(result);
      const message = t(failure.key, failure.params);
      setFormError(message);
      setPassword("");
      announcer.announce(message);
    } catch {
      const message = t("error.unavailable");
      setFormError(message);
      setPassword("");
      announcer.announce(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="qm-page">
      <h1 ref={headingRef} tabIndex={-1}>
        {t("login.title")}
      </h1>
      {signOutFailed ? <SignOutFailedNotice onCleared={() => headingRef.current?.focus()} /> : null}
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
