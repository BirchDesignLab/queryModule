import type { LoadedConfig } from "../config/load";
import type { Timers } from "../dispatch/timers";
import type { AdapterFactory, AdapterRegistry, SourceAdapter } from "./types";

/** Built-in factories; the mock factory joins in Task 7 (#535). ADAPTER_DIR stays unused (D-A11). */
const BUILTIN_FACTORIES: readonly AdapterFactory[] = [];

/**
 * The adapter registry (spec 5.4; FR-043). With allowMockSources false, get("mock") throws.
 * Errors never echo the requested kind. `factories` replaces the built-ins (tests).
 */
export function createAdapterRegistry(o: {
  allowMockSources: boolean;
  timers: Timers;
  random: () => number;
  factories?: readonly AdapterFactory[];
}): AdapterRegistry {
  const byKind = new Map<string, AdapterFactory>();
  for (const f of o.factories ?? BUILTIN_FACTORIES) {
    if (byKind.has(f.kind)) throw new Error("duplicate adapter kind");
    byKind.set(f.kind, f);
  }
  const memo = new WeakMap<LoadedConfig, Map<string, SourceAdapter>>();
  return {
    get(kind, snapshot) {
      if (kind === "mock" && !o.allowMockSources) throw new Error("mock adapter disabled");
      const factory = byKind.get(kind);
      if (!factory) throw new Error("unknown adapter kind");
      let perSnapshot = memo.get(snapshot);
      if (!perSnapshot) {
        perSnapshot = new Map();
        memo.set(snapshot, perSnapshot);
      }
      let adapter = perSnapshot.get(kind);
      if (!adapter) {
        adapter = factory.create({ snapshot, timers: o.timers, random: o.random });
        perSnapshot.set(kind, adapter);
      }
      return adapter;
    },
  };
}
