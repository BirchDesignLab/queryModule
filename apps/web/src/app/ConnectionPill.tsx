import { useStore } from "@querymodule/client";
import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n-context.js";
import { useServices } from "./services-context.js";

/** How long "Connection restored" stays before the pill goes back to "Connected". */
export const RESTORED_MS = 5000;

/**
 * The header's connection state (mockup v5): a dot and a word, Connected, "No connection to server"
 * while a submit is held, then "Connection restored" for a few seconds. Plain text: the shared
 * announcer already speaks these changes (spec 6.6), so this is the visible half.
 */
export function ConnectionPill() {
  const { submit } = useServices();
  const t = useT();
  const status = useStore(submit, (s) => s.status);
  const [restored, setRestored] = useState(false);
  const wasDown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (status === "noConnection") {
      wasDown.current = true;
      clearTimeout(timer.current);
      setRestored(false);
    } else if (wasDown.current) {
      wasDown.current = false;
      setRestored(true);
      timer.current = setTimeout(() => setRestored(false), RESTORED_MS);
    }
  }, [status]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const lost = status === "noConnection";
  const state = lost ? "lost" : restored ? "restored" : "ok";
  return (
    <span className={`qm-conn qm-conn--${state}`}>
      <span aria-hidden="true" className="qm-conn__dot" />
      <span className="qm-conn__text">
        {lost
          ? t("form.noConnection")
          : restored
            ? t("form.connectionRestored")
            : t("status.connection.state.connected")}
      </span>
    </span>
  );
}
