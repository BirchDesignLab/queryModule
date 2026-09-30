import {
  fetchClientConfig,
  type HeartbeatResult,
  runHeartbeatProbe,
  type SocketLike,
} from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

export function heartbeatUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/ws`;
}

/** The last completed check of each part, and whether one is running now. */
export interface StatusChecks {
  checking: boolean;
  connection: HeartbeatResult | null;
  connectionAt: number | null;
  /** null until the first check completes; "failed" leaves the config in hand. */
  config: "done" | "failed" | null;
  configAt: number | null;
}

const INITIAL: StatusChecks = {
  checking: true,
  connection: null,
  connectionAt: null,
  config: null,
  configAt: null,
};

/** The cached config query failed and left no data: the page stops saying "Loading". */
export function useConfigUnavailable(): boolean {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      queryClient.getQueryState(["config"])?.status === "error" &&
      queryClient.getQueryData(["config"]) === undefined,
  );
}

/**
 * The status page's checks: the heartbeat probe (socket hello, ping, pong) and one GET
 * /api/v1/config, run together on open and on every `run()` (a user action, never a timer). A check
 * ends in exactly one announcement that sums up both. A reset (sign-out, a 401, a user change) or
 * leaving the page drops the answer, closes the socket and announces nothing. One check at a time.
 */
export function useStatusChecks(): { checks: StatusChecks; run: () => void } {
  const { api, queryClient, createSocket, announcer, reset } = useServices();
  const t = useT();
  const [checks, setChecks] = useState<StatusChecks>(INITIAL);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const stopRun = useRef<() => void>(() => undefined);
  const translate = useRef(t);
  translate.current = t;

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    let dropped = false;
    let socket: SocketLike | null = null;
    const live = () => gen === generation.current && !dropped;
    const unregister = reset.register(() => {
      dropped = true;
      socket?.close();
    });
    stopRun.current = () => {
      dropped = true;
      unregister();
      socket?.close();
    };
    setChecks((s) => ({ ...s, checking: true }));

    const connection = runHeartbeatProbe({
      url: heartbeatUrl(window.location),
      createSocket: (url) => {
        socket = createSocket(url);
        return socket;
      },
      timeoutMs: 10_000,
      now: () => performance.now(),
      nonce: crypto.randomUUID(),
      setTimer: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });
    const config = fetchClientConfig(api).then(
      (next): "done" | "failed" => {
        if (!live()) return "done";
        // A newer answer replaces the cache the way the background refresh does.
        const current = queryClient.getQueryData<ClientSiteConfig>(["config"]);
        if (current === undefined || current.configHash !== next.configHash) {
          queryClient.setQueryData(["config"], next);
        }
        return "done";
      },
      (): "done" | "failed" => "failed",
    );

    void Promise.all([connection, config]).then(([result, configResult]) => {
      unregister();
      if (gen === generation.current) inFlight.current = false;
      if (!live()) return;
      const now = Date.now();
      setChecks({
        checking: false,
        connection: result,
        connectionAt: now,
        config: configResult,
        configAt: now,
      });
      const tr = translate.current;
      const reason = result.ok ? "" : tr(`status.reason.${result.reason}`);
      const cfg = configResult === "done" ? "ConfigOk" : "ConfigFailed";
      announcer.announce(
        tr(`status.announce.${result.ok ? "connected" : "failed"}${cfg}`, { reason }),
      );
    });
  }, [api, queryClient, createSocket, announcer, reset]);

  useEffect(() => {
    run();
    return () => {
      generation.current += 1;
      inFlight.current = false;
      stopRun.current();
    };
  }, [run]);

  return { checks, run };
}
