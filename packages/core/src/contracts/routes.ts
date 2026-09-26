import { z } from "zod";
import { ClientSiteConfigSchema } from "../config/client-config";
import type { FeatureKey } from "../config/features";
import { LOCALE_PATTERN } from "../config/schema";
import { ApiErrorSchema } from "./api-error";
import { Sha256HexSchema } from "./primitives";
import { API_BASE_PATH, API_VERSION } from "./version";

export const MILESTONES = ["m0", "m1", "m2", "m3", "m4"] as const;
export type Milestone = (typeof MILESTONES)[number];
export type HttpMethod = "get" | "post" | "put" | "delete";
export type RouteAccess = "public" | "session" | "sessionOwn" | "policy" | "admin";
/** planned: contract merged, handler not yet; the route matrix expects 404. live: handler merged. */
export type RouteStatus = "planned" | "live";

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
}
export interface RouteRequest {
  params?: z.ZodObject;
  query?: z.ZodObject;
  headers?: z.ZodObject;
  body?: z.ZodType;
}
export interface RouteDef {
  id: string;
  method: HttpMethod;
  /** OpenAPI path template, e.g. /api/v1/locales/{locale} */
  path: string;
  summary: string;
  access: RouteAccess;
  since: Milestone;
  status: RouteStatus;
  feature?: FeatureKey;
  requires?: "ALLOW_MOCK_SOURCES";
  /** State-changing non-auth routes require X-Requested-With: querymodule (spec 5.9). */
  requiresRequestedWith: boolean;
  stepUp?: boolean;
  request?: RouteRequest;
  responses: Record<number, RouteResponse>;
}

export const HealthResponseSchema = z.strictObject({ status: z.literal("ok") });

/** SemVer 2.0.0 (semver.org), capped at 64 characters; the client's version gate compares these. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SemverSchema = z.string().max(64).regex(SEMVER_PATTERN);

export const MetaResponseSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  coreVersion: SemverSchema,
  configSchemaVersion: z.int().min(1),
  configHash: Sha256HexSchema,
  minClientVersion: SemverSchema.nullable(),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;

export const LocaleParamsSchema = z.strictObject({ locale: z.string().regex(LOCALE_PATTERN) });
export const LocaleBundleSchema = z.record(z.string(), z.string());
export type LocaleBundle = z.infer<typeof LocaleBundleSchema>;

const error = (description: string): RouteResponse => ({ description, schema: ApiErrorSchema });

export const ROUTES: readonly RouteDef[] = [
  {
    id: "getHealth",
    method: "get",
    path: `${API_BASE_PATH}/health`,
    summary: "Liveness for the Docker healthcheck; no data",
    access: "public",
    since: "m0",
    status: "planned",
    requiresRequestedWith: false,
    responses: { 200: { description: "Alive", schema: HealthResponseSchema } },
  },
  {
    id: "getMeta",
    method: "get",
    path: `${API_BASE_PATH}/meta`,
    summary: "Versions and config hash; the client refuses to run below minClientVersion",
    access: "public",
    since: "m0",
    status: "planned",
    requiresRequestedWith: false,
    responses: { 200: { description: "Versions", schema: MetaResponseSchema } },
  },
  {
    id: "getLocale",
    method: "get",
    path: `${API_BASE_PATH}/locales/{locale}`,
    summary: "Locale bundle, UI strings only",
    access: "public",
    since: "m0",
    status: "planned",
    requiresRequestedWith: false,
    request: { params: LocaleParamsSchema },
    responses: {
      200: { description: "Bundle", schema: LocaleBundleSchema },
      400: error("Malformed locale parameter (validationFailed)"),
      404: error("Locale not listed in SiteConfig.locales"),
    },
  },
  {
    id: "getConfig",
    method: "get",
    path: `${API_BASE_PATH}/config`,
    summary: "ClientSiteConfig allowlist; never Source.server or mock data",
    access: "session",
    since: "m1",
    status: "planned",
    requiresRequestedWith: false,
    responses: {
      200: { description: "Client config", schema: ClientSiteConfigSchema },
      401: error("No session"),
    },
  },
];

export function findRoute(id: string): RouteDef {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`unknown route ${id}`);
  return route;
}
