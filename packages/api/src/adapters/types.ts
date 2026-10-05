import type { AdapterErrorCode, SourcePayload } from "@querymodule/core/contracts";
import type { CanonicalValue } from "@querymodule/core/rules";
import type { LoadedConfig } from "../config/load";
import type { Secret } from "../credentials/secret";
import type { Timers } from "../dispatch/timers";

/**
 * Adapter API v1 (spec 5.4, 5.7; FR-043). Credentials are always null until M3 P1, and the M3
 * credential work may revise this API (D-A12).
 */
export interface Credentials {
  username: string;
  secret: string;
}

/** One source's share of a query part; values are canonical and reach no log line (spec 5.9). */
export interface SourceRequest {
  correlationId: string;
  partId: number;
  sourceId: string;
  queryType: string;
  values: Readonly<Record<string, CanonicalValue>>;
  types: Readonly<Record<string, string>>;
}

/** The only error an adapter reports; the message is the code, never adapter or wire text. */
export class SourceError extends Error {
  readonly code: AdapterErrorCode;

  constructor(code: AdapterErrorCode) {
    super(code);
    this.name = "SourceError";
    this.code = code;
  }
}

export interface SourceAdapter {
  query(
    req: SourceRequest,
    creds: Secret<Credentials> | null,
    signal: AbortSignal,
  ): Promise<SourcePayload>;
}

/** Adapters are created per config snapshot, so a publish never swaps an adapter under a running job. */
export interface AdapterFactory {
  apiVersion: 1;
  kind: string;
  create(o: { snapshot: LoadedConfig; timers: Timers; random: () => number }): SourceAdapter;
}

export interface AdapterRegistry {
  /** Memoised per snapshot (WeakMap): the same snapshot and kind give the same adapter. */
  get(kind: string, snapshot: LoadedConfig): SourceAdapter;
}
