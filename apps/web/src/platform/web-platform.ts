import { type ClientPlatform, noTokenStore, type PlatformSignal } from "@querymodule/client";

/** P0's PlatformSignal is boolean-only (online/visible), mirroring the private signal() helper in
 * packages/client/src/testing/fake-platform.ts. The browser is the only consumer of this factory,
 * so it stays local here rather than becoming a new exported generic Signal type (R1). */
function platformSignal(initial: boolean): PlatformSignal & { set(value: boolean): void } {
  let value = initial;
  const listeners = new Set<(value: boolean) => void>();
  return {
    current: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener(next);
    },
  };
}

export function createWebPlatform(): ClientPlatform {
  const online = platformSignal(navigator.onLine);
  window.addEventListener("online", () => online.set(true));
  window.addEventListener("offline", () => online.set(false));
  const visible = platformSignal(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", () =>
    visible.set(document.visibilityState !== "hidden"),
  );
  return { authTransport: "cookie", tokenStore: noTokenStore, online, visible };
}
