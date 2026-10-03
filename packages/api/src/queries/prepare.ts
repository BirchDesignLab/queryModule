import type { SiteConfig } from "@querymodule/core/config";
import {
  type SubmitQueryRequest,
  SubmitQueryRequestSchema,
  type ValidationError,
} from "@querymodule/core/contracts";
import { isPlanError, type Plan, planRequest } from "@querymodule/core/planner";
import type { Context } from "hono";
import type { LoadedConfig } from "../config/load";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import type { AppEnv } from "../http/types";
import type { Principal } from "../seams";

/** One (part, source) dispatch with the credential owner fixed at submit (spec 5.2 step 3). */
export interface DispatchPair {
  partId: number;
  sourceId: string;
  credentialUserId: string | null;
  delegationId: string | null;
  adapterKind: string;
}
export interface PreparedSubmit {
  /** The one config snapshot this submit was planned against; T1 records its hash (ADR-0011 item 3). */
  config: LoadedConfig;
  request: SubmitQueryRequest;
  plan: Plan;
  pairs: DispatchPair[];
}
export type Prepared = { ok: true; value: PreparedSubmit } | { ok: false; response: Response };

/**
 * Spec 5.2 step 2, no writes: schema, duplicate sources, config hash, server-side plan, mode, then
 * the credential snapshot. Error params carry field keys and ids only, never a submitted value.
 */
export function prepareSubmit(
  c: Context<AppEnv>,
  d: AppDeps,
  raw: unknown,
  principal: Principal,
): Prepared {
  const parsed = SubmitQueryRequestSchema.safeParse(raw);
  if (!parsed.success) return invalid(c, bodyErrors(parsed.error.issues));
  const request = parsed.data;
  // Controller ruling #284: a repeated source id is a malformed body, not something to dedupe.
  if (new Set(request.sourceIds).size !== request.sourceIds.length)
    return invalid(c, [{ key: "validation.invalidBody", params: { field: "sourceIds" } }]);
  const config = d.config.current();
  if (request.configHash !== config.configHash) {
    return {
      ok: false,
      response: apiError(c, "configHashMismatch", { currentConfigHash: config.configHash }),
    };
  }
  const plan = planRequest(
    config.siteConfig,
    request.queryType,
    request.values,
    request.sourceIds,
    {
      now: d.clock.now(),
    },
  );
  if (isPlanError(plan)) return invalid(c, plan.errors);
  if (request.mode !== plan.mode) return invalid(c, [{ key: "validation.modeMismatch" }]);
  return {
    ok: true,
    value: {
      config,
      request,
      plan,
      pairs: snapshotCredentials(plan, config.siteConfig, principal),
    },
  };
}

/** Spec 5.2 step 3. M1: no credential store exists, so every pair resolves no owner; M3 P1 replaces this body. */
export function snapshotCredentials(
  plan: Plan,
  config: SiteConfig,
  _principal: Principal,
): DispatchPair[] {
  const kindOf = new Map(config.sources.map((s) => [s.id, s.kind]));
  return plan.parts.flatMap((part) =>
    part.sourceIds.map((sourceId) => {
      const adapterKind = kindOf.get(sourceId);
      // The loader validates every query type source against config.sources; this is a bug guard.
      if (adapterKind === undefined) throw new Error("snapshot: planned source not in config");
      // requiresCredentials sources also get null here; the M1 P3 dispatcher reports credentialsMissing.
      return {
        partId: part.partId,
        sourceId,
        credentialUserId: null,
        delegationId: null,
        adapterKind,
      };
    }),
  );
}

function invalid(c: Context<AppEnv>, errors: ValidationError[]): Prepared {
  return { ok: false, response: apiError(c, "validationFailed", undefined, errors) };
}

/**
 * One error per top-level key, in issue order. A root-level issue (not an object, or an
 * unrecognized key) names no field: an unrecognized key is client text and is not echoed.
 */
function bodyErrors(issues: readonly { path: readonly PropertyKey[] }[]): ValidationError[] {
  const out: ValidationError[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const top = issue.path[0];
    const field = typeof top === "string" ? top : "";
    if (seen.has(field)) continue;
    seen.add(field);
    out.push(
      field === ""
        ? { key: "validation.invalidBody" }
        : { key: "validation.invalidBody", params: { field } },
    );
  }
  return out;
}
