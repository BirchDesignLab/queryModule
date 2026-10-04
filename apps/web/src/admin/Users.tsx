import { type AdminUser, ROLES } from "@querymodule/core/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { CreateUserDialog } from "./CreateUserDialog.js";
import { LeaveDialog } from "./LeaveGuard.js";
import { isRole } from "./roles.js";
import { SCROLL_FOCUS } from "./scroll-focus.js";
import { disableUser, fetchUsers, revokeUserSessions, setUserRole } from "./users-api.js";

/**
 * People > Users and roles (Task 34, #359, SEC-005, UX-004, ADR-0011 item 8): one table with the
 * role as an inline select, a status badge, the sign-in figures (a count of distinct addresses,
 * never an address, spec 5.9) and row actions that carry the user's name. The list lives in this
 * component's state only: no cache, nothing persisted (spec 6.7).
 */

type Notice = { kind: "info" | "error"; text: string };

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

  // #507 item 18 (ruling): this ends the user's other sessions but never the caller's own current
  // one, so an admin cannot sign themselves out by accident. Use Sign out for that.
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
                        aria-disabled={acting ? "true" : undefined}
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
