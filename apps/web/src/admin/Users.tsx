import {
  type AdminUser,
  CreateUserBodySchema,
  ROLES,
  type Role,
} from "@querymodule/core/contracts";
import { focusFirstInvalid, SelectField, TextField } from "@querymodule/web-ui";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { LeaveDialog } from "./LeaveGuard.js";
import { Modal } from "./Modal.js";
import {
  createUser,
  disableUser,
  fetchUsers,
  revokeUserSessions,
  setUserRole,
} from "./users-api.js";

/**
 * People > Users and roles (Task 34, #359, SEC-005, UX-004, ADR-0011 item 8): one table with the
 * role as an inline select, a status badge, the sign-in figures (a count of distinct addresses,
 * never an address, spec 5.9) and row actions that carry the user's name. The list lives in this
 * component's state only: no cache, nothing persisted (spec 6.7).
 */

/** A region that scrolls takes focus so the keyboard can scroll it (axe scrollable-region-focusable). */
const SCROLL_FOCUS = { tabIndex: 0 } as const;

type Notice = { kind: "info" | "error"; text: string };

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

export function UsersView() {
  const { api } = useServices();
  const t = useT();
  const { locale } = useTranslator();
  const uid = useId();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  // One action per user at a time: a second request for the same row while one runs does nothing.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [disabling, setDisabling] = useState<AdminUser | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only triggers a reload
  useEffect(() => {
    let open = true;
    fetchUsers(api).then((list) => {
      if (!open) return;
      setFailed(list === null);
      if (list !== null) setUsers(list);
    });
    return () => {
      open = false;
    };
  }, [api, attempt]);

  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const replace = useCallback(
    (user: AdminUser) =>
      setUsers((list) => list?.map((u) => (u.id === user.id ? user : u)) ?? list),
    [],
  );
  const working = useRef(new Set<string>());
  const exclusive = useCallback(async (id: string, work: () => Promise<void>) => {
    if (working.current.has(id)) return;
    working.current.add(id);
    setBusy(new Set(working.current));
    try {
      await work();
    } finally {
      working.current.delete(id);
      setBusy(new Set(working.current));
    }
  }, []);
  const lastAdmin = t("admin.users.lastAdmin");

  const changeRole = (user: AdminUser, value: string) => {
    if (!isRole(value) || value === user.role) return;
    void exclusive(user.id, async () => {
      setNotice(null);
      const result = await setUserRole(api, user.id, value);
      if (result.ok) {
        replace(result.value);
        setNotice({
          kind: "info",
          text: t("admin.users.roleChanged", { name: user.name, role: t(`role.${value}`) }),
        });
      } else
        setNotice({
          kind: "error",
          text:
            result.reason === "lastAdmin"
              ? lastAdmin
              : t("admin.users.roleFailed", { name: user.name }),
        });
    });
  };

  const signOutEverywhere = (user: AdminUser) =>
    void exclusive(user.id, async () => {
      setNotice(null);
      const ended = await revokeUserSessions(api, user.id);
      if (ended === null) {
        setNotice({ kind: "error", text: t("admin.users.signOutFailed", { name: user.name }) });
        return;
      }
      const key =
        ended === 0
          ? "admin.users.signedOut.none"
          : ended === 1
            ? "admin.users.signedOut.one"
            : "admin.users.signedOut.many";
      setNotice({ kind: "info", text: t(key, { name: user.name, count: ended }) });
    });

  const confirmDisable = () => {
    const user = disabling;
    if (user === null) return;
    void exclusive(user.id, async () => {
      setNotice(null);
      const result = await disableUser(api, user.id);
      setDisabling(null);
      if (result.ok) {
        replace(result.value.user);
        const n = result.value.sessionsRevoked;
        const key =
          n === 0
            ? "admin.users.disabled.none"
            : n === 1
              ? "admin.users.disabled.one"
              : "admin.users.disabled.many";
        setNotice({ kind: "info", text: t(key, { name: user.name, count: n }) });
      } else
        setNotice({
          kind: "error",
          text:
            result.reason === "lastAdmin"
              ? lastAdmin
              : t("admin.users.disableFailed", { name: user.name }),
        });
    });
  };

  return (
    <div className="qm-users">
      <div className="qm-users__toolbar">
        <button
          ref={createRef}
          type="button"
          className="qm-button"
          onClick={() => setCreating(true)}
        >
          {t("admin.users.createButton")}
        </button>
      </div>
      {notice !== null &&
        (notice.kind === "error" ? (
          <p className="qm-builder__notice" role="alert">
            {notice.text}
          </p>
        ) : (
          <p className="qm-builder__notice" role="status">
            {notice.text}
          </p>
        ))}
      {failed && (
        <div className="qm-builder__notice" role="alert">
          <span>{t("admin.users.error")}</span>
          <button type="button" className="qm-button" onClick={() => setAttempt((n) => n + 1)}>
            {t("admin.users.retry")}
          </button>
        </div>
      )}
      {users === null ? (
        !failed && (
          <p className="qm-diff__note" aria-busy="true">
            {t("admin.users.loading")}
          </p>
        )
      ) : (
        <section className="qm-users__scroll" aria-label={t("admin.users.table")} {...SCROLL_FOCUS}>
          <table className="qm-users__table" aria-label={t("admin.users.table")}>
            <thead>
              <tr>
                {(
                  [
                    "name",
                    "email",
                    "role",
                    "status",
                    "lastSignIn",
                    "signIns",
                    "addresses",
                    "actions",
                  ] as const
                ).map((col) => (
                  <th key={col} scope="col">
                    {t(`admin.users.col.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const statusId = `${uid}-status-${u.id}`;
                const acting = busy.has(u.id);
                return (
                  <tr key={u.id}>
                    <th scope="row">{u.name}</th>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="qm-select"
                        aria-label={t("admin.users.roleFor", { name: u.name })}
                        value={u.role}
                        onChange={(e) => changeRole(u, e.currentTarget.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`role.${r}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        id={statusId}
                        className={
                          u.disabled
                            ? "qm-badge qm-badge--critical"
                            : u.mustChangePassword
                              ? "qm-badge qm-badge--warning"
                              : "qm-badge qm-badge--ok"
                        }
                      >
                        {t(
                          u.disabled
                            ? "admin.users.status.disabled"
                            : u.mustChangePassword
                              ? "admin.users.status.mustChange"
                              : "admin.users.status.active",
                        )}
                      </span>
                    </td>
                    <td>
                      {u.lastSignInAt === null ? (
                        t("admin.users.never")
                      ) : (
                        <time dateTime={new Date(u.lastSignInAt).toISOString()}>
                          {time.format(u.lastSignInAt)}
                        </time>
                      )}
                    </td>
                    <td>{u.signInCount}</td>
                    <td>{u.distinctIps}</td>
                    <td>
                      <span className="qm-users__actions">
                        <button
                          type="button"
                          className="qm-button qm-button--secondary"
                          aria-label={t("admin.users.signOutAllLabel", { name: u.name })}
                          aria-disabled={acting ? "true" : undefined}
                          onClick={acting ? undefined : () => signOutEverywhere(u)}
                        >
                          {t("admin.users.signOutAll")}
                        </button>
                        <button
                          type="button"
                          className="qm-button qm-button--secondary"
                          aria-label={t("admin.users.disableLabel", { name: u.name })}
                          aria-disabled={u.disabled || acting ? "true" : undefined}
                          aria-describedby={u.disabled ? statusId : undefined}
                          onClick={u.disabled || acting ? undefined : () => setDisabling(u)}
                        >
                          {t("admin.users.disable")}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <LeaveDialog
        open={disabling !== null}
        title={t("admin.users.disableTitle", { name: disabling?.name ?? "" })}
        body={t("admin.users.disableBody", { name: disabling?.name ?? "" })}
        stayLabel={t("admin.users.cancel")}
        leaveLabel={t("admin.users.disableConfirm", { name: disabling?.name ?? "" })}
        onStay={() => setDisabling(null)}
        onLeave={confirmDisable}
        busy={disabling !== null && busy.has(disabling.id)}
        busyReason={t("admin.users.disableBusy")}
        fallback={() => createRef.current}
      />
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(user) => setUsers((list) => (list === null ? list : [...list, user]))}
          fallback={() => createRef.current}
        />
      )}
    </div>
  );
}

type Field = "email" | "name" | "role";
type Errors = Partial<Record<Field, string>>;

/**
 * Create user, then the temporary password. The password lives in this component's state and
 * nowhere else: not the list, not a query or mutation cache, not the log. Done unmounts the
 * dialog and with it the only copy. Escape does not close the password view: it is shown once,
 * so leaving it takes the explicit Done (spec 6.2).
 */
function CreateUserDialog({
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
        {copy !== "idle" && (
          <p className={copy === "failed" ? "qm-form-error" : undefined} role="status">
            {t(copy === "copied" ? "admin.users.reveal.copied" : "admin.users.reveal.copyFailed")}
          </p>
        )}
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
