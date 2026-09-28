import { type HeartbeatResult, runHeartbeatProbe } from "@querymodule/client";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

export function heartbeatUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/ws`;
}

export function StatusPage() {
  const { createSocket, announcer } = useServices();
  const t = useT();
  const [result, setResult] = useState<HeartbeatResult | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    let live = true;
    void runHeartbeatProbe({
      url: heartbeatUrl(window.location),
      createSocket,
      timeoutMs: 10_000,
      now: () => performance.now(),
      nonce: crypto.randomUUID(),
      setTimer: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    }).then((outcome) => {
      if (live) setResult(outcome);
    });
    return () => {
      live = false;
    };
  }, [createSocket]);

  let text = t("status.checking");
  if (result !== null) {
    text = result.ok
      ? t("status.connected", { rttMs: Math.round(result.rttMs) })
      : t("status.failed", { reason: t(`status.reason.${result.reason}`) });
  }
  useEffect(() => {
    if (result !== null) announcer.announce(text);
  }, [result, text, announcer]);

  return (
    <main className="qm-page">
      <h1 ref={headingRef} tabIndex={-1}>
        {t("status.title")}
      </h1>
      <p id="status-text">{text}</p>
      <Link to="/">{t("nav.home")}</Link>
    </main>
  );
}
