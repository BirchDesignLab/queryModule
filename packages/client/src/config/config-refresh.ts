import type { ClientSiteConfig } from "@querymodule/core/config";
import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "../api/create-api-client.js";
import type { ClientPlatform } from "../platform.js";
import { fetchClientConfig } from "./config-api.js";

export interface ConfigRefreshOptions {
  api: ApiClient;
  queryClient: QueryClient;
  platform: ClientPlatform;
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
  };
  /** Default 15 000 ms (ADR-0011 item 3). */
  intervalMs?: number;
}

export interface ConfigRefresh {
  /** Idempotent. */
  start(): void;
  /** Stops the timer and the visibility subscription; an answer still in flight is dropped. */
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Keeps the cached GET /api/v1/config current while the user is signed in (ADR-0011 item 3): it
 * refetches every `intervalMs` and at once when the platform becomes visible, marks the request as
 * background, and replaces the cached config only when the hash differs. Failures are silent: the
 * config in hand stays and the next interval tries again. Nothing is logged.
 */
export function createConfigRefresh(options: ConfigRefreshOptions): ConfigRefresh {
  const { api, queryClient, platform } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timers = options.timers ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as number),
  };
  let running = false;
  let timer: unknown = null;
  let unsubscribe: () => void = () => undefined;
  /** Bumped by stop() so an answer from an earlier run is dropped. */
  let generation = 0;
  let inFlight = false;

  const schedule = (): void => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void refresh();
    }, intervalMs);
  };

  async function refresh(): Promise<void> {
    if (!running) return;
    // A hidden page does not poll; becoming visible refetches at once.
    if (!platform.visible.current()) return;
    if (inFlight) return;
    const gen = generation;
    inFlight = true;
    let next: ClientSiteConfig | undefined;
    try {
      next = await fetchClientConfig(api, { background: true });
    } catch {
      next = undefined;
    } finally {
      // A stop() (and possibly a restart) since this request began owns the flag now.
      if (gen === generation) inFlight = false;
    }
    if (gen !== generation) return;
    if (next !== undefined) {
      const current = queryClient.getQueryData<ClientSiteConfig>(["config"]);
      if (current === undefined || current.configHash !== next.configHash) {
        queryClient.setQueryData(["config"], next);
      }
    }
    schedule();
  }

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      unsubscribe = platform.visible.subscribe((visible) => {
        if (!visible) return;
        if (timer !== null) timers.clearTimeout(timer);
        timer = null;
        void refresh();
      });
      schedule();
    },
    stop() {
      running = false;
      generation += 1;
      inFlight = false;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      unsubscribe();
      unsubscribe = () => undefined;
    },
  };
}
