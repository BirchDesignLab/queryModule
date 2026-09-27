import type { AuthTransport, ClientPlatform, PlatformSignal, TokenStore } from "../platform";

export interface FakePlatform extends ClientPlatform {
  setOnline(value: boolean): void;
  setVisible(value: boolean): void;
}

function signal(initial: boolean): PlatformSignal & { set(value: boolean): void } {
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
      for (const l of listeners) l(next);
    },
  };
}

function memoryTokenStore(): TokenStore {
  let token: string | null = null;
  return {
    get: async () => token,
    set: async (t) => {
      token = t;
    },
    clear: async () => {
      token = null;
    },
  };
}

export function createFakePlatform(
  opts: { authTransport?: AuthTransport; online?: boolean; visible?: boolean } = {},
): FakePlatform {
  const authTransport = opts.authTransport ?? "cookie";
  const online = signal(opts.online ?? true);
  const visible = signal(opts.visible ?? true);
  return {
    authTransport,
    tokenStore: authTransport === "bearer" ? memoryTokenStore() : null,
    online,
    visible,
    setOnline: (v) => online.set(v),
    setVisible: (v) => visible.set(v),
  };
}
