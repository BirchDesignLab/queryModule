// packages/api/src/log/logger.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
  child(f: Record<string, unknown>): Logger;
}
export const ALWAYS_REDACTED: readonly string[] = [
  "values",
  "payload",
  "body",
  "credentials",
  "secret",
  "password",
  "authorization",
  "cookie",
];
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const R = "[redacted]";

export function redact(
  value: unknown,
  keys: ReadonlySet<string>,
  seen = new WeakSet<object>(),
): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, keys, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = keys.has(k.toLowerCase()) ? R : redact(v, keys, seen);
  return out;
}

export function createLogger(
  o: {
    sink?: (line: string) => void;
    redactKeys?: Iterable<string>;
    level?: LogLevel;
    secretValues?: string[];
    base?: Record<string, unknown>;
  } = {},
): Logger {
  const sink = o.sink ?? ((l: string) => process.stdout.write(`${l}\n`));
  const keys = new Set([
    ...ALWAYS_REDACTED,
    ...[...(o.redactKeys ?? [])].map((k) => k.toLowerCase()),
  ]);
  const secrets = (o.secretValues ?? []).filter((s) => s.length >= 8);
  const min = ORDER[o.level ?? "info"];
  const base = o.base ?? {};
  const emit = (level: LogLevel, msg: string, f: Record<string, unknown> = {}) => {
    if (ORDER[level] < min) return;
    let line = JSON.stringify({
      level,
      time: Date.now(),
      msg,
      ...(redact({ ...base, ...f }, keys) as object),
    });
    for (const s of secrets) line = line.split(s).join(R);
    sink(line);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) => createLogger({ ...o, base: { ...base, ...f } }),
  };
}
