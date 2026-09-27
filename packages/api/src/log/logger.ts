// packages/api/src/log/logger.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
  child(f: Record<string, unknown>): Logger;
}
/** Spec 5.9 keys, plus the response and proxy forms of the cookie and authorization headers. */
export const ALWAYS_REDACTED: readonly string[] = [
  "values",
  "payload",
  "body",
  "credentials",
  "secret",
  "password",
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
];
/**
 * A key whose lowercase form, with "-", "_" and "." removed, ends in one of these is
 * redacted too, so variants such as sessionToken, x-api-key, betterAuthSecret or
 * dbEncryptionKey never reach a sink. Over-redaction is the safe failure.
 */
const SENSITIVE_SUFFIXES: readonly string[] = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "cookie",
  "authorization",
  "credential",
  "credentials",
  "encryptionkey",
  "privatekey",
  "credentialkey",
  "datakey",
];
/** secretValues shorter than this are ignored: scrubbing them would mangle ordinary text. */
export const MIN_SECRET_VALUE_LENGTH = 8;
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const R = "[redacted]";

function isRedactedKey(k: string, keys: ReadonlySet<string>): boolean {
  const lower = k.toLowerCase();
  if (keys.has(lower)) return true;
  const norm = lower.replace(/[-_.]/g, "");
  return SENSITIVE_SUFFIXES.some((s) => norm.endsWith(s));
}

/** Replaces each secret value in s; the identity when secrets is empty. */
function scrub(s: string, secrets: readonly string[]): string {
  let out = s;
  for (const v of secrets) out = out.split(v).join(R);
  return out;
}

function walk(
  value: unknown,
  keys: ReadonlySet<string>,
  secrets: readonly string[],
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === "string") return scrub(value, secrets);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: scrub(value.name, secrets), message: scrub(value.message, secrets) };
  }
  if (value === null || typeof value !== "object") return value;
  // Key material (secrets.ts returns Buffers) must never be emitted, not even byte by byte.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return R;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  // Only the current path counts: an object referenced twice without a cycle prints twice.
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try {
    if (value instanceof Map) return walk(Object.fromEntries(value), keys, secrets, ancestors);
    if (value instanceof Set) return walk(Array.from(value), keys, secrets, ancestors);
    if (Array.isArray(value)) return value.map((v) => walk(v, keys, secrets, ancestors));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[scrub(k, secrets)] = isRedactedKey(k, keys) ? R : walk(v, keys, secrets, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

export function redact(value: unknown, keys: ReadonlySet<string>): unknown {
  return walk(value, keys, [], new WeakSet());
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
  // Materialised once: a one-shot iterator (Map.keys(), a generator) is read here only.
  const keys = new Set([
    ...ALWAYS_REDACTED,
    ...[...(o.redactKeys ?? [])].map((k) => k.toLowerCase()),
  ]);
  const secrets = (o.secretValues ?? []).filter((s) => s.length >= MIN_SECRET_VALUE_LENGTH);
  // A secret with a quote, backslash or control character appears escaped in the line.
  const escaped = secrets.map((s) => JSON.stringify(s).slice(1, -1));
  const min = ORDER[o.level ?? "info"];
  const base = o.base ?? {};
  const serialise = (level: LogLevel, msg: string, f: Record<string, unknown>): string => {
    const head = { level, time: Date.now(), msg: scrub(msg, secrets) };
    try {
      const fields = walk({ ...base, ...f }, keys, secrets, new WeakSet()) as object;
      // head first for key order, and again last so no field can forge level, time or msg.
      return JSON.stringify({ ...head, ...fields, ...head });
    } catch {
      return JSON.stringify({ ...head, logError: "fields could not be serialised" });
    }
  };
  const emit = (level: LogLevel, msg: string, f: Record<string, unknown> = {}) => {
    if (ORDER[level] < min) return;
    sink(scrub(serialise(level, msg, f), escaped));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) =>
      createLogger({
        ...o,
        sink,
        secretValues: secrets,
        redactKeys: keys,
        base: { ...base, ...f },
      }),
  };
}
