import {
  PongMessageSchema,
  ResultHiddenEventSchema,
  ResyncMessageSchema,
  SourceStatusEventSchema,
  WelcomeMessageSchema,
  type WsServerMessage,
} from "@querymodule/core/contracts";

interface KnownSchema {
  shape: Record<string, unknown>;
  safeParse(input: unknown): { success: true; data: WsServerMessage } | { success: false };
}

/**
 * Known server message types only. A type the server adds later is absent here, so the client
 * drops it instead of failing (ADR-0013). The schemas stay the server's strict ones; unknown keys
 * are removed before they run.
 */
const KNOWN = new Map<string, KnownSchema>([
  ["welcome", WelcomeMessageSchema],
  ["pong", PongMessageSchema],
  ["sourceStatus", SourceStatusEventSchema],
  ["resultHidden", ResultHiddenEventSchema],
  ["resync", ResyncMessageSchema],
]);

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Tolerant receipt (ADR-0013): an unknown `type` is dropped, unknown keys are stripped, and a
 * known type that fails its schema is dropped and reported through `onInvalid` with its type name
 * only (a client metric; never the payload). Never throws.
 */
export function parseServerMessage(
  raw: string,
  onInvalid?: (type: string) => void,
): WsServerMessage | null {
  const json = parseJson(raw);
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") return null;
  const schema = KNOWN.get(type);
  if (schema === undefined) return null;
  const known: Record<string, unknown> = {};
  for (const key of Object.keys(schema.shape)) {
    if (Object.hasOwn(record, key)) known[key] = record[key];
  }
  const parsed = schema.safeParse(known);
  if (parsed.success) return parsed.data;
  onInvalid?.(type);
  return null;
}
