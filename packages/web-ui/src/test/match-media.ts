export interface MatchMediaController {
  set(query: string, matches: boolean): void;
  queries: string[];
}

export function installMatchMedia(initial: Record<string, boolean> = {}): MatchMediaController {
  const state = new Map<string, boolean>(Object.entries(initial));
  const listeners = new Map<string, Set<() => void>>();
  const queries: string[] = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      queries.push(query);
      return {
        get matches() {
          return state.get(query) ?? false;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, cb: () => void) => {
          const set = listeners.get(query) ?? new Set<() => void>();
          set.add(cb);
          listeners.set(query, set);
        },
        removeEventListener: (_type: string, cb: () => void) => {
          listeners.get(query)?.delete(cb);
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
  return {
    queries,
    set(query, matches) {
      state.set(query, matches);
      for (const cb of listeners.get(query) ?? []) cb();
    },
  };
}
