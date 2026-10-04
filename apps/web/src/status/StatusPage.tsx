import { useStore } from "@querymodule/client";
import { ROLES } from "@querymodule/core/contracts";
import { formatAckTime } from "@querymodule/web-ui";
import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router";
import { usePersonaLayout } from "../app/AppChrome.js";
import { useCachedConfigState } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { MAIN_LANDMARK } from "../app/main-landmark.js";
import { useServices } from "../app/services-context.js";
import { useStatusChecks } from "./use-status-checks.js";

export { heartbeatUrl } from "./use-status-checks.js";

type Tone = "neutral" | "ok" | "critical";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "qm-badge qm-badge--status",
  ok: "qm-badge qm-badge--ok",
  critical: "qm-badge qm-badge--critical",
};

/** One ruled section: its name, a status chip (text, never colour alone) and the rows below. */
function Tile({
  title,
  chip,
  busy,
  children,
}: {
  title: string;
  chip?: { tone: Tone; text: string };
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="qm-status__tile" aria-busy={busy === true ? true : undefined}>
      <div className="qm-status__head">
        <h2>{title}</h2>
        {chip === undefined ? null : <span className={TONE_CLASS[chip.tone]}>{chip.text}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="qm-status__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function StatusPage() {
  const { authStore } = useServices();
  const t = useT();
  const user = useStore(authStore, (s) => s.user);
  const layout = usePersonaLayout();
  const { config, unavailable } = useCachedConfigState();
  const { checks, run } = useStatusChecks();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus lands on the heading once, on navigation; a check never moves it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const checkedAt = (at: number | null) =>
    at === null ? t("status.checked.pending") : formatAckTime(at);

  let sentence = t("status.checking");
  if (checks.connection !== null) {
    sentence = checks.connection.ok
      ? t("status.connected", { rttMs: Math.round(checks.connection.rttMs) })
      : t("status.failed", { reason: t(`status.reason.${checks.connection.reason}`) });
  }
  let connectionChip: { tone: Tone; text: string } = {
    tone: "neutral",
    text: t("status.connection.state.checking"),
  };
  if (!checks.checking && checks.connection !== null) {
    connectionChip = checks.connection.ok
      ? { tone: "ok", text: t("status.connection.state.connected") }
      : { tone: "critical", text: t("status.connection.state.failed") };
  }

  let configChip: { tone: Tone; text: string };
  if (config !== undefined) configChip = { tone: "ok", text: t("status.config.state.loaded") };
  else if (unavailable || checks.config === "failed")
    configChip = { tone: "critical", text: t("status.config.state.unavailable") };
  else configChip = { tone: "neutral", text: t("status.config.state.loading") };

  const role = user?.role ?? null;
  const layoutText =
    config === undefined
      ? t(
          unavailable || checks.config === "failed"
            ? "status.config.state.unavailable"
            : "status.config.state.loading",
        )
      : t(
          layout === "mobileUnit"
            ? "status.session.layout.mobileUnit"
            : "status.session.layout.dispatch",
        );

  return (
    <main
      className={
        layout === "mobileUnit" ? "qm-page qm-layout--mobile-unit qm-status" : "qm-page qm-status"
      }
      {...MAIN_LANDMARK}
    >
      <h1 ref={headingRef} tabIndex={-1}>
        {t("status.title")}
      </h1>
      <Tile title={t("status.connection.title")} chip={connectionChip} busy={checks.checking}>
        <p id="status-text">{sentence}</p>
        <dl className="qm-status__rows">
          <Row label={t("status.checked.label")}>{checkedAt(checks.connectionAt)}</Row>
        </dl>
        <button
          type="button"
          className="qm-button"
          aria-disabled={checks.checking}
          onClick={() => {
            if (!checks.checking) run();
          }}
        >
          {t("status.checkAgain")}
        </button>
      </Tile>
      <Tile title={t("status.config.title")} chip={configChip} busy={checks.checking}>
        {config === undefined ? null : (
          <dl className="qm-status__rows">
            <Row label={t("status.config.site.label")}>{t(config.site.labelKey)}</Row>
            <Row label={t("status.config.hash.label")}>{config.configHash.slice(0, 12)}</Row>
            <Row label={t("status.config.schema.label")}>{config.schemaVersion}</Row>
            <Row label={t("status.checked.label")}>{checkedAt(checks.configAt)}</Row>
          </dl>
        )}
        {checks.config === "failed" ? <p>{t("status.config.checkFailed")}</p> : null}
      </Tile>
      <Tile title={t("status.session.title")}>
        <dl className="qm-status__rows">
          <Row label={t("status.session.email.label")}>{user?.email ?? ""}</Row>
          {role === null ? null : (
            <Row label={t("status.session.role.label")}>
              {(ROLES as readonly string[]).includes(role) ? t(`role.${role}`) : role}
            </Row>
          )}
          <Row label={t("status.session.layout.label")}>{layoutText}</Row>
        </dl>
      </Tile>
      <Link to="/">{t("nav.home")}</Link>
    </main>
  );
}
