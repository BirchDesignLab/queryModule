import type { WsEvent } from "@querymodule/core/contracts";
import type { Logger } from "../log/logger";
import type { EventBus } from "../seams";

export interface AppEventBus extends EventBus {
  endSession(sessionId: string): void;
}

/**
 * Each handler runs in isolation: one that throws must not stop the others, or a session's
 * remaining sockets would stay open after logout or expiry (spec 5.6, SEC-005). Only the error
 * class is logged, never the event (spec 5.9).
 */
export function createEventBus(o: { log: Logger }): AppEventBus {
  const subs = new Map<string, Set<(e: WsEvent) => void>>();
  const ends = new Map<string, Set<() => void>>();
  function add<T>(m: Map<string, Set<T>>, k: string, h: T): () => void {
    let s = m.get(k);
    if (!s) {
      s = new Set();
      m.set(k, s);
    }
    const set = s;
    set.add(h);
    return () => {
      set.delete(h);
      if (set.size === 0 && m.get(k) === set) m.delete(k);
    };
  }
  function run(h: () => void): void {
    try {
      h();
    } catch (e: unknown) {
      o.log.error("event handler failed", { errorName: e instanceof Error ? e.name : typeof e });
    }
  }
  return {
    publish(userId, e) {
      for (const h of [...(subs.get(userId) ?? [])]) run(() => h(e));
    },
    subscribe: (userId, h) => add(subs, userId, h),
    onSessionEnded: (sessionId, h) => add(ends, sessionId, h),
    endSession(sessionId) {
      const hs = [...(ends.get(sessionId) ?? [])];
      ends.delete(sessionId);
      for (const h of hs) run(h);
    },
  };
}
