/**
 * Adapter kinds this build supports (spec 5.4). A leaf module: it imports nothing, so
 * config:validate reads it without pulling the registry, adapters or timers. ADAPTER_DIR plugin
 * loading is deferred (D-A11).
 */
export const BUILTIN_ADAPTER_KINDS = ["mock"] as const;
