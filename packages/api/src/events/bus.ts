import type { WsEvent } from "@querymodule/core/contracts";
import type { EventBus } from "../seams";

export interface AppEventBus extends EventBus {
  endSession(sessionId: string): void;
}

export function createEventBus(): AppEventBus {
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
  return {
    publish(userId, e) {
      for (const h of [...(subs.get(userId) ?? [])]) h(e);
    },
    subscribe: (userId, h) => add(subs, userId, h),
    onSessionEnded: (sessionId, h) => add(ends, sessionId, h),
    endSession(sessionId) {
      const hs = [...(ends.get(sessionId) ?? [])];
      ends.delete(sessionId);
      for (const h of hs) h();
    },
  };
}
