import type { FormMode } from "@querymodule/core/rules";
import type { QueryClient } from "@tanstack/react-query";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ApiClient } from "../api/create-api-client.js";
import type { components } from "../api/generated/openapi-types.js";
import type { DraftValue } from "../draft/draft-store.js";
import type { PlatformSignal } from "../platform.js";

export type SubmitQueryBody = components["schemas"]["submitQueryBody"];
export type SubmitQueryResponse = components["schemas"]["submitQuery202"];
export type ValidationError = NonNullable<
  components["schemas"]["ApiError"]["error"]["errors"]
>[number];

export interface SubmitRequest {
  queryType: string;
  values: Readonly<Record<string, DraftValue>>;
  sourceIds: readonly string[];
  mode: FormMode;
  configHash: string;
}

export type SubmitOutcome =
  | { kind: "acknowledged"; response: SubmitQueryResponse; queryType: string }
  | { kind: "invalid"; errors: ValidationError[] }
  | { kind: "configChanged" }
  | { kind: "rateLimited"; retryAfterSeconds: number }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "noResponse" }
  | { kind: "failed" };

export interface SubmitState {
  status: "idle" | "submitting" | "noConnection";
  lastAck: { response: SubmitQueryResponse; queryType: string } | null;
  /** Ignored (returns the in-flight promise) while submitting. */
  submit(req: SubmitRequest): Promise<SubmitOutcome>;
  reset(): void;
  /** Unsubscribes from the platform signal and stops polling (the web app keeps it for the page's life). */
  dispose(): void;
}

export type SubmitController = StoreApi<SubmitState>;

export interface SubmitControllerOptions {
  api: ApiClient;
  queryClient: QueryClient;
  /** Defaults to crypto.randomUUID(). */
  newKey?: () => string;
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
  };
  /** In [0, 1); full jitter for the health backoff. */
  random?: () => number;
  /** When it reports offline the controller goes noConnection. */
  online?: PlatformSignal;
}

const HEALTH_BASE_MS = 1000;
const HEALTH_MAX_MS = 30_000;

/** User values only; '' and null omitted; the server computes effective values (spec 5.2 step 2). */
export function buildSubmitBody(req: SubmitRequest): SubmitQueryBody {
  const values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(req.values)) {
    if (value !== "" && value !== null) values[key] = value;
  }
  return {
    queryType: req.queryType,
    values,
    sourceIds: [...req.sourceIds],
    mode: req.mode,
    configHash: req.configHash,
  };
}

/** Deterministic text of a body (sorted value keys), used only to compare two bodies. */
function bodyFingerprint(body: SubmitQueryBody): string {
  const values = Object.fromEntries(
    Object.entries(body.values).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return JSON.stringify({ ...body, values });
}

/**
 * Submits a query with an Idempotency-Key (spec 6.7). A new key per attempt; after a network
 * failure the next submit of an identical body reuses it; any HTTP response discards it.
 * Never logs bodies, values or responses.
 */
export function createSubmitController(options: SubmitControllerOptions): SubmitController {
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const timers = options.timers ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as number),
  };
  const random = options.random ?? Math.random;

  let keptKey: { key: string; fingerprint: string } | null = null;
  let inFlight: Promise<SubmitOutcome> | null = null;
  let healthTimer: unknown = null;
  let polling = false;
  /** One id per poll chain: a late health answer from a stopped chain schedules nothing (#382 B1). */
  let chain = 0;
  let generation = 0;
  let unsubscribeOnline: () => void = () => undefined;
  let goOffline: () => void = () => undefined;

  const store = createStore<SubmitState>((set, get) => {
    const stopPolling = (): void => {
      polling = false;
      chain += 1;
      if (healthTimer !== null) timers.clearTimeout(healthTimer);
      healthTimer = null;
    };

    const schedulePoll = (attempt: number): void => {
      const ceiling = Math.min(HEALTH_MAX_MS, HEALTH_BASE_MS * 2 ** attempt);
      const gen = generation;
      const myChain = chain;
      healthTimer = timers.setTimeout(() => {
        healthTimer = null;
        void options.api
          .GET("/api/v1/health", { headers: { "X-Background": "1" } })
          .then(({ response }) => response.ok)
          .catch(() => false)
          .then((answered) => {
            if (gen !== generation || !polling || myChain !== chain) return;
            if (answered) {
              stopPolling();
              if (get().status === "noConnection") set({ status: "idle" });
            } else {
              schedulePoll(attempt + 1);
            }
          });
      }, random() * ceiling);
    };

    const startPolling = (): void => {
      if (polling) return;
      polling = true;
      schedulePoll(0);
    };

    const enterNoConnection = (): void => {
      set({ status: "noConnection" });
      startPolling();
    };
    goOffline = enterNoConnection;

    if (options.online !== undefined) {
      unsubscribeOnline = options.online.subscribe((online) => {
        if (!online && get().status !== "submitting") enterNoConnection();
      });
    }

    const settled = (kind: SubmitOutcome): SubmitOutcome => {
      keptKey = null;
      stopPolling();
      return kind;
    };

    const run = async (req: SubmitRequest, gen: number): Promise<SubmitOutcome> => {
      const body = buildSubmitBody(req);
      const fingerprint = bodyFingerprint(body);
      const key = keptKey?.fingerprint === fingerprint ? keptKey.key : newKey();
      keptKey = { key, fingerprint };
      let result: Awaited<ReturnType<ApiClient["POST"]>>;
      try {
        result = await options.api.POST("/api/v1/queries", {
          params: { header: { "idempotency-key": key } },
          body,
        });
      } catch {
        if (gen !== generation) return { kind: "noResponse" };
        enterNoConnection();
        return { kind: "noResponse" };
      }
      if (gen !== generation) return { kind: "failed" };
      const { response, data, error } = result;
      const status = response.status;
      let outcome: SubmitOutcome;
      if (status === 202 && data !== undefined) {
        outcome = {
          kind: "acknowledged",
          response: data as SubmitQueryResponse,
          queryType: req.queryType,
        };
      } else if (status === 400) {
        const errors = (error as components["schemas"]["ApiError"] | undefined)?.error.errors;
        outcome = errors === undefined ? { kind: "failed" } : { kind: "invalid", errors };
      } else if (status === 409) {
        void options.queryClient.invalidateQueries({ queryKey: ["config"] });
        outcome = { kind: "configChanged" };
      } else if (status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        outcome = {
          kind: "rateLimited",
          retryAfterSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : 0,
        };
      } else if (status === 403) {
        outcome = { kind: "forbidden" };
      } else if (status === 503) {
        outcome = { kind: "unavailable" };
      } else {
        outcome = { kind: "failed" };
      }
      settled(outcome);
      set({
        status: "idle",
        ...(outcome.kind === "acknowledged"
          ? { lastAck: { response: outcome.response, queryType: outcome.queryType } }
          : {}),
      });
      return outcome;
    };

    return {
      status: "idle",
      lastAck: null,
      submit(req) {
        if (inFlight !== null) return inFlight;
        const gen = generation;
        set({ status: "submitting" });
        const promise = run(req, gen).finally(() => {
          if (inFlight === promise) inFlight = null;
        });
        inFlight = promise;
        return promise;
      },
      reset() {
        generation += 1;
        keptKey = null;
        inFlight = null;
        stopPolling();
        set({ status: "idle", lastAck: null });
      },
      dispose() {
        unsubscribeOnline();
        unsubscribeOnline = () => undefined;
        stopPolling();
      },
    };
  });
  // #382 B2: a platform already offline at construction is gated from the start.
  if (options.online?.current() === false) goOffline();
  return store;
}
