import { z } from "zod";
import { ClientSiteConfigSchema } from "../config/client-config";
import type { FeatureKey } from "../config/features";
import { LOCALE_PATTERN } from "../config/schema";
import {
  AdminConfigResponseSchema,
  AdminUserListSchema,
  AdminUserSchema,
  AdminUserSessionListSchema,
  ConfigDocumentSchema,
  ConfigVersionListSchema,
  ConfigVersionSchema,
  CreateUserBodySchema,
  CreateUserResponseSchema,
  DisableUserResponseSchema,
  PublishConfigBodySchema,
  PutDraftBodySchema,
  SessionParamsSchema,
  SetRoleBodySchema,
  UserParamsSchema,
  ValidateConfigBodySchema,
  ValidateConfigResponseSchema,
  VersionParamsSchema,
} from "./admin";
import { ApiErrorSchema } from "./api-error";
import { SemverSchema, Sha256HexSchema } from "./primitives";
import {
  IdempotencyKeySchema,
  SubmitQueryRequestSchema,
  SubmitQueryResponseSchema,
} from "./queries";
import { API_BASE_PATH, API_VERSION } from "./version";

export const MILESTONES = ["m0", "m1", "m2", "m3", "m4"] as const;
export type Milestone = (typeof MILESTONES)[number];
export type HttpMethod = "get" | "post" | "put" | "delete";
/** configEditor: admin or implementer (ADR-0011 item 6); admin: admin only. */
export type RouteAccess = "public" | "session" | "sessionOwn" | "policy" | "admin" | "configEditor";
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

/** UX-014, spec 5.5 user_preference: the caller's own row; null means unset. */
export const PreferenceLayoutSchema = z.strictObject({
  orientation: z.enum(["horizontal", "vertical"]),
  terminal: z.enum(["toggle", "pane"]),
});
export const UserPreferenceSchema = z.strictObject({
  themeMode: z.enum(["day", "night", "redShift", "auto"]).nullable(),
  /** A site persona key (PersonaDef.key); bounded because it is stored user input. */
  personaOverride: z.string().min(1).max(64).nullable(),
  layout: PreferenceLayoutSchema.nullable(),
});
export type UserPreference = z.infer<typeof UserPreferenceSchema>;

const error = (description: string): RouteResponse => ({ description, schema: ApiErrorSchema });

/** Admin console routes (ADR-0011): config routes live (Task 27); user routes live (Task 28). */
const adminErrors = {
  401: error("No session"),
  403: error("Role not allowed, or missing X-Requested-With on a write (forbidden)"),
};
const ROUTE_DEFS = [
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
  {
    id: "getMePreferences",
    method: "get",
    path: `${API_BASE_PATH}/me/preferences`,
    summary: "The caller's own preference row; nulls when unset",
    access: "sessionOwn",
    since: "m1",
    status: "planned",
    requiresRequestedWith: false,
    responses: {
      200: { description: "Preferences", schema: UserPreferenceSchema },
      401: error("No session"),
    },
  },
  {
    id: "putMePreferences",
    method: "put",
    path: `${API_BASE_PATH}/me/preferences`,
    summary: "Replace the caller's own preference row",
    access: "sessionOwn",
    since: "m1",
    status: "planned",
    requiresRequestedWith: true,
    request: { body: UserPreferenceSchema },
    responses: {
      200: { description: "Preferences", schema: UserPreferenceSchema },
      400: error("Malformed preferences body (validationFailed)"),
      401: error("No session"),
    },
  },
  {
    id: "submitQuery",
    method: "post",
    path: `${API_BASE_PATH}/queries`,
    summary: "Submit a query; answers 202 with the correlation id once the request is recorded",
    access: "session",
    since: "m1",
    status: "live",
    requiresRequestedWith: true,
    request: {
      headers: z.object({ "idempotency-key": IdempotencyKeySchema }),
      body: SubmitQueryRequestSchema,
    },
    responses: {
      202: { description: "Acknowledged", schema: SubmitQueryResponseSchema },
      400: error("Malformed body or failed validation or plan (validationFailed, errors[])"),
      401: error("No session"),
      403: error("Role, query type or source not allowed for the caller (forbidden)"),
      409: error("Stale config hash (configHashMismatch, currentConfigHash)"),
      413: error("Body over the size cap (payloadTooLarge)"),
      429: error("Rate limited (rateLimited, Retry-After)"),
      500: error("Internal error; nothing was acknowledged (internal)"),
      503: error("Shutting down or not ready (unavailable)"),
    },
  },
  {
    id: "getAdminConfig",
    method: "get",
    path: `${API_BASE_PATH}/admin/config`,
    summary: "The live config version and the shared draft, with documents",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: false,
    responses: {
      200: { description: "Live and draft", schema: AdminConfigResponseSchema },
      ...adminErrors,
    },
  },
  {
    id: "putAdminConfigDraft",
    method: "put",
    path: `${API_BASE_PATH}/admin/config/draft`,
    summary: "Save the shared draft; the base must be the live version",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: true,
    request: { body: PutDraftBodySchema },
    responses: {
      200: { description: "Draft saved", schema: ConfigVersionSchema },
      400: error("Malformed body (validationFailed)"),
      409: error("The base is not the live version (draftConflict)"),
      413: error("Body over the size cap (payloadTooLarge)"),
      ...adminErrors,
    },
  },
  {
    id: "validateAdminConfig",
    method: "post",
    path: `${API_BASE_PATH}/admin/config/validate`,
    summary: "Validate a document by the spec 5.8 chain; diagnostics by JSON pointer",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: true,
    request: { body: ValidateConfigBodySchema },
    responses: {
      200: { description: "Diagnostics", schema: ValidateConfigResponseSchema },
      400: error("Malformed body (validationFailed)"),
      413: error("Body over the size cap (payloadTooLarge)"),
      ...adminErrors,
    },
  },
  {
    id: "publishAdminConfig",
    method: "post",
    path: `${API_BASE_PATH}/admin/config/publish`,
    summary: "Publish the draft and activate it; refused on any validation error",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: true,
    request: { body: PublishConfigBodySchema },
    responses: {
      200: { description: "Published version", schema: ConfigVersionSchema },
      400: error(
        "Malformed body, or the draft fails validation (validationFailed, errors[] keys and paths; validate gives every diagnostic)",
      ),
      404: error("No such draft (notFound)"),
      409: error("The draft base is not the live version (draftConflict)"),
      ...adminErrors,
    },
  },
  {
    id: "listAdminConfigVersions",
    method: "get",
    path: `${API_BASE_PATH}/admin/config/versions`,
    summary: "Version history, newest first; never rewritten",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: false,
    responses: {
      200: { description: "Versions", schema: ConfigVersionListSchema },
      ...adminErrors,
    },
  },
  {
    id: "rollbackAdminConfig",
    method: "post",
    path: `${API_BASE_PATH}/admin/config/versions/{version}/rollback`,
    summary: "Publish an older version as a new version",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: true,
    request: { params: VersionParamsSchema },
    responses: {
      200: { description: "New published version", schema: ConfigVersionSchema },
      400: error(
        "Malformed version, or its document fails validation now (validationFailed, errors[])",
      ),
      404: error("No such published or superseded version (notFound)"),
      409: error("The live version changed during the rollback (draftConflict)"),
      ...adminErrors,
    },
  },
  {
    id: "exportAdminConfigVersion",
    method: "get",
    path: `${API_BASE_PATH}/admin/config/versions/{version}/export`,
    summary: "One version document as JSON (git round trip)",
    access: "configEditor",
    since: "m1",
    status: "live",
    feature: "adminConfig",
    requiresRequestedWith: false,
    request: { params: VersionParamsSchema },
    responses: {
      200: { description: "Document", schema: ConfigDocumentSchema },
      400: error("Malformed version (validationFailed)"),
      404: error("No such version (notFound)"),
      ...adminErrors,
    },
  },
  {
    id: "listAdminUsers",
    method: "get",
    path: `${API_BASE_PATH}/admin/users`,
    summary: "Users with role and state; no secrets",
    access: "admin",
    since: "m1",
    status: "live",
    feature: "adminUsers",
    requiresRequestedWith: false,
    responses: {
      200: { description: "Users", schema: AdminUserListSchema },
      ...adminErrors,
    },
  },
  {
    id: "createAdminUser",
    method: "post",
    path: `${API_BASE_PATH}/admin/users`,
    summary: "Create a user; the one-time password is returned once",
    access: "admin",
    since: "m1",
    status: "live",
    feature: "adminUsers",
    requiresRequestedWith: true,
    request: { body: CreateUserBodySchema },
    responses: {
      201: { description: "Created, with the one-time password", schema: CreateUserResponseSchema },
      400: error(
        "Malformed body, or the email is taken (validationFailed, errors[] key validation.emailTaken)",
      ),
      ...adminErrors,
    },
  },
  {
    id: "disableAdminUser",
    method: "post",
    path: `${API_BASE_PATH}/admin/users/{id}/disable`,
    summary: "Disable a user and revoke their sessions in one transaction",
    access: "admin",
    since: "m1",
    status: "live",
    feature: "adminUsers",
    requiresRequestedWith: true,
    request: { params: UserParamsSchema },
    responses: {
      200: { description: "Disabled", schema: DisableUserResponseSchema },
      400: error("Malformed id (validationFailed)"),
      404: error("No such user (notFound)"),
      409: error(
        "An admin changing their own role or account, or no enabled admin left (lastAdmin)",
      ),
      ...adminErrors,
    },
  },
  {
    id: "setAdminUserRole",
    method: "put",
    path: `${API_BASE_PATH}/admin/users/{id}/role`,
    summary: "Change a user role",
    access: "admin",
    since: "m1",
    status: "live",
    feature: "adminUsers",
    requiresRequestedWith: true,
    request: { params: UserParamsSchema, body: SetRoleBodySchema },
    responses: {
      200: { description: "Updated", schema: AdminUserSchema },
      400: error("Malformed id or body (validationFailed)"),
      404: error("No such user (notFound)"),
      409: error(
        "An admin changing their own role or account, or no enabled admin left (lastAdmin)",
      ),
      ...adminErrors,
    },
  },
  {
    id: "listAdminUserSessions",
    method: "get",
    path: `${API_BASE_PATH}/admin/users/{id}/sessions`,
    summary: "A user's live sessions by row id; never tokens",
    access: "admin",
    since: "m1",
    status: "live",
    feature: "adminUsers",
    requiresRequestedWith: false,
    request: { params: UserParamsSchema },
    responses: {
      200: { description: "Sessions", schema: AdminUserSessionListSchema },
      400: error("Malformed id (validationFailed)"),
      404: error("No such user (notFound)"),
      ...adminErrors,
    },
  },
  {
    id: "revokeAdminSession",
    method: "delete",
    path: `${API_BASE_PATH}/admin/sessions/{sessionId}`,
    summary: "Revoke one session",
    access: "admin",
    since: "m1",
    status: "live",
    feature: "adminUsers",
    requiresRequestedWith: true,
    request: { params: SessionParamsSchema },
    responses: {
      204: { description: "Revoked" },
      400: error("Malformed session id (validationFailed)"),
      404: error("No such session (notFound)"),
      ...adminErrors,
    },
  },
] as const satisfies readonly RouteDef[];

export type RouteId = (typeof ROUTE_DEFS)[number]["id"];

function freezeRoute(r: RouteDef): RouteDef {
  if (r.request) Object.freeze(r.request);
  Object.freeze(r.responses);
  return Object.freeze(r);
}

/** Frozen, so no caller can flip a route status or swap a schema on the shared module. */
export const ROUTES: readonly RouteDef[] = Object.freeze(ROUTE_DEFS.map(freezeRoute));

export function findRoute(id: RouteId): RouteDef {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`unknown route ${id}`);
  return route;
}
