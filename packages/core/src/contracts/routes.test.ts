import { describe, expect, expectTypeOf, it } from "vitest";
import { ClientSiteConfigSchema } from "../config/client-config";
import {
  AdminAuditExportQuerySchema,
  AdminAuditPageSchema,
  AdminAuditQuerySchema,
} from "./admin-audit";
import { ApiErrorSchema } from "./api-error";
import {
  AdminQueryDetailSchema,
  AdminQueryQuerySchema,
  ListQueriesQuerySchema,
  QueryDetailSchema,
  QueryListResponseSchema,
  QueryParamsSchema,
} from "./queries";
import {
  findRoute,
  LocaleParamsSchema,
  MetaResponseSchema,
  ROUTES,
  type RouteId,
  UserPreferenceSchema,
} from "./routes";
import { CORE_VERSION } from "./version";

describe("BR-007 route contracts (spec 5.1)", () => {
  it("every route lives under /api/v1 and has a unique id and method+path", () => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const r of ROUTES) {
      expect(r.path.startsWith("/api/v1/")).toBe(true);
      expect(ids.has(r.id)).toBe(false);
      expect(keys.has(`${r.method} ${r.path}`)).toBe(false);
      ids.add(r.id);
      keys.add(`${r.method} ${r.path}`);
    }
  });

  it("every session route declares 403 passwordChangeRequired (D-A26, #505 T28 Q3)", () => {
    for (const r of ROUTES) {
      if (r.access === "public") continue;
      const forbidden = (r.responses as Record<number, { description: string } | undefined>)[403];
      expect(forbidden?.description, r.id).toMatch(/passwordChangeRequired/);
    }
  });

  it("path parameters match the params schema", () => {
    for (const r of ROUTES) {
      const inPath = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = Object.keys(r.request?.params?.shape ?? {}).sort();
      expect(declared, r.id).toEqual(inPath);
    }
  });

  it("ships the M0/M1 skeleton; submitQuery is live (D-A3, #285); admin config routes live (Task 27), user routes live (Task 28)", () => {
    expect(ROUTES.map((r) => [r.id, r.method, r.path, r.access, r.since, r.status])).toEqual([
      ["getHealth", "get", "/api/v1/health", "public", "m0", "live"],
      ["getMeta", "get", "/api/v1/meta", "public", "m0", "live"],
      ["getLocale", "get", "/api/v1/locales/{locale}", "public", "m0", "live"],
      ["getConfig", "get", "/api/v1/config", "session", "m1", "live"],
      ["getMePreferences", "get", "/api/v1/me/preferences", "sessionOwn", "m1", "live"],
      ["putMePreferences", "put", "/api/v1/me/preferences", "sessionOwn", "m1", "live"],
      ["submitQuery", "post", "/api/v1/queries", "session", "m1", "live"],
      ["getAdminConfig", "get", "/api/v1/admin/config", "configEditor", "m1", "live"],
      ["putAdminConfigDraft", "put", "/api/v1/admin/config/draft", "configEditor", "m1", "live"],
      [
        "validateAdminConfig",
        "post",
        "/api/v1/admin/config/validate",
        "configEditor",
        "m1",
        "live",
      ],
      ["publishAdminConfig", "post", "/api/v1/admin/config/publish", "configEditor", "m1", "live"],
      [
        "listAdminConfigVersions",
        "get",
        "/api/v1/admin/config/versions",
        "configEditor",
        "m1",
        "live",
      ],
      [
        "rollbackAdminConfig",
        "post",
        "/api/v1/admin/config/versions/{version}/rollback",
        "configEditor",
        "m1",
        "live",
      ],
      [
        "exportAdminConfigVersion",
        "get",
        "/api/v1/admin/config/versions/{version}/export",
        "configEditor",
        "m1",
        "live",
      ],
      ["listAdminUsers", "get", "/api/v1/admin/users", "admin", "m1", "live"],
      ["createAdminUser", "post", "/api/v1/admin/users", "admin", "m1", "live"],
      ["disableAdminUser", "post", "/api/v1/admin/users/{id}/disable", "admin", "m1", "live"],
      ["setAdminUserRole", "put", "/api/v1/admin/users/{id}/role", "admin", "m1", "live"],
      ["listAdminUserSessions", "get", "/api/v1/admin/users/{id}/sessions", "admin", "m1", "live"],
      ["revokeAdminSession", "delete", "/api/v1/admin/sessions/{sessionId}", "admin", "m1", "live"],
      ["listQueries", "get", "/api/v1/queries", "sessionOwn", "m2", "planned"],
      ["getQuery", "get", "/api/v1/queries/{correlationId}", "policy", "m2", "planned"],
      ["listAdminAudit", "get", "/api/v1/admin/audit", "admin", "m2", "planned"],
      ["exportAdminAudit", "get", "/api/v1/admin/audit/export", "admin", "m2", "planned"],
      ["getAdminQuery", "get", "/api/v1/admin/queries/{correlationId}", "admin", "m2", "planned"],
    ]);
    expect(findRoute("getConfig").responses[401]?.schema).toBe(ApiErrorSchema);
    expect(findRoute("getConfig").responses[200]?.schema).toBe(ClientSiteConfigSchema);
    expect(() => findRoute("nope" as RouteId)).toThrow("unknown route nope");
  });

  it("route ids are a closed type and ROUTES cannot be changed at runtime", () => {
    expectTypeOf<RouteId>().toEqualTypeOf<
      | "getHealth"
      | "getMeta"
      | "getLocale"
      | "getConfig"
      | "getMePreferences"
      | "putMePreferences"
      | "submitQuery"
      | "getAdminConfig"
      | "putAdminConfigDraft"
      | "validateAdminConfig"
      | "publishAdminConfig"
      | "listAdminConfigVersions"
      | "rollbackAdminConfig"
      | "exportAdminConfigVersion"
      | "listAdminUsers"
      | "createAdminUser"
      | "disableAdminUser"
      | "setAdminUserRole"
      | "listAdminUserSessions"
      | "revokeAdminSession"
      | "listQueries"
      | "getQuery"
      | "listAdminAudit"
      | "exportAdminAudit"
      | "getAdminQuery"
    >();
    expectTypeOf(findRoute).parameter(0).toEqualTypeOf<RouteId>();
    expect(Object.isFrozen(ROUTES)).toBe(true);
    for (const r of ROUTES) {
      expect(Object.isFrozen(r), r.id).toBe(true);
      expect(Object.isFrozen(r.responses), r.id).toBe(true);
      if (r.request) expect(Object.isFrozen(r.request), r.id).toBe(true);
    }
    const health = findRoute("getHealth") as { status: string };
    expect(() => {
      health.status = "planned";
    }).toThrow(TypeError);
    expect(findRoute("getHealth").status).toBe("live");
  });

  it("FR-062, FR-063, SEC-012 (spec 5.1): the M2 read routes are contract only until mounted", () => {
    const ids = [
      "listQueries",
      "getQuery",
      "listAdminAudit",
      "exportAdminAudit",
      "getAdminQuery",
    ] as const;
    for (const id of ids) {
      const r = findRoute(id);
      expect(r.status, id).toBe("planned");
      expect(r.method, id).toBe("get");
      expect(r.requiresRequestedWith, id).toBe(false);
      expect(r.responses[401]?.schema, id).toBe(ApiErrorSchema);
    }
    expect(findRoute("listQueries").request?.query).toBe(ListQueriesQuerySchema);
    expect(findRoute("listQueries").responses[200]?.schema).toBe(QueryListResponseSchema);
    expect(findRoute("getQuery").request?.params).toBe(QueryParamsSchema);
    expect(findRoute("getQuery").responses[200]?.schema).toBe(QueryDetailSchema);
    expect(findRoute("getAdminQuery").request?.query).toBe(AdminQueryQuerySchema);
    expect(findRoute("getAdminQuery").responses[200]?.schema).toBe(AdminQueryDetailSchema);
    expect(findRoute("listAdminAudit").request?.query).toBe(AdminAuditQuerySchema);
    expect(findRoute("listAdminAudit").responses[200]?.schema).toBe(AdminAuditPageSchema);
    expect(findRoute("exportAdminAudit").request?.query).toBe(AdminAuditExportQuerySchema);
    // NDJSON has no JSON body schema: the OpenAPI generator only emits application/json.
    expect(findRoute("exportAdminAudit").responses[200]?.schema).toBeUndefined();
  });

  it("meta body per spec 5.1", () => {
    const body = {
      apiVersion: "v1",
      coreVersion: "0.0.0",
      configSchemaVersion: 1,
      configHash: "a".repeat(64),
      minClientVersion: null,
    };
    expect(MetaResponseSchema.parse(body)).toEqual(body);
    expect(MetaResponseSchema.safeParse({ ...body, apiVersion: "v2" }).success).toBe(false);
    expect(MetaResponseSchema.safeParse({ ...body, configHash: "not-hex" }).success).toBe(false);
    expect(MetaResponseSchema.safeParse({ ...body, configHash: "a".repeat(63) }).success).toBe(
      false,
    );
  });

  it("coreVersion and minClientVersion are semver, so the version gate cannot fail open", () => {
    const body = {
      apiVersion: "v1",
      coreVersion: CORE_VERSION,
      configSchemaVersion: 1,
      configHash: "a".repeat(64),
      minClientVersion: "1.2.3-rc.1",
    };
    expect(MetaResponseSchema.safeParse(body).success).toBe(true);
    expect(MetaResponseSchema.safeParse({ ...body, coreVersion: "latest" }).success).toBe(false);
    expect(MetaResponseSchema.safeParse({ ...body, minClientVersion: "latest" }).success).toBe(
      false,
    );
    expect(MetaResponseSchema.safeParse({ ...body, minClientVersion: "1.2" }).success).toBe(false);
    expect(MetaResponseSchema.safeParse({ ...body, minClientVersion: "01.2.3" }).success).toBe(
      false,
    );
  });

  it("every route that validates request input declares a 400 ApiError response", () => {
    for (const r of ROUTES) {
      if (!r.request) continue;
      expect(r.responses[400]?.schema, r.id).toBe(ApiErrorSchema);
    }
    expect(findRoute("getLocale").responses[400]?.schema).toBe(ApiErrorSchema);
  });

  it("getMePreferences and putMePreferences are session-own routes since m1", () => {
    const get = findRoute("getMePreferences");
    const put = findRoute("putMePreferences");
    expect(get).toMatchObject({
      method: "get",
      path: "/api/v1/me/preferences",
      access: "sessionOwn",
      since: "m1",
    });
    expect(put).toMatchObject({
      method: "put",
      path: "/api/v1/me/preferences",
      access: "sessionOwn",
      since: "m1",
    });
    expect(get.requiresRequestedWith).toBe(false);
    expect(put.requiresRequestedWith).toBe(true);
    expect(put.request?.body).toBe(UserPreferenceSchema);
    for (const r of [get, put]) {
      expect(r.responses[200]?.schema, r.id).toBe(UserPreferenceSchema);
      expect(r.responses[401]?.schema, r.id).toBe(ApiErrorSchema);
    }
    expect(
      UserPreferenceSchema.safeParse({ themeMode: "night", personaOverride: null, layout: null })
        .success,
    ).toBe(true);
    expect(
      UserPreferenceSchema.safeParse({ themeMode: "loud", personaOverride: null, layout: null })
        .success,
    ).toBe(false);
  });

  it("UX-014 preference body: parse and reject cases", () => {
    const ok = (v: unknown) => UserPreferenceSchema.safeParse(v).success;
    expect(ok({ themeMode: null, personaOverride: null, layout: null })).toBe(true);
    for (const themeMode of ["day", "night", "redShift", "auto"]) {
      expect(ok({ themeMode, personaOverride: null, layout: null }), themeMode).toBe(true);
    }
    expect(
      ok({
        themeMode: "day",
        personaOverride: "dispatcher",
        layout: { orientation: "vertical", terminal: "pane" },
      }),
    ).toBe(true);
    expect(ok({ themeMode: null, personaOverride: "", layout: null })).toBe(false);
    expect(ok({ themeMode: null, personaOverride: "p".repeat(64), layout: null })).toBe(true);
    expect(ok({ themeMode: null, personaOverride: "p".repeat(65), layout: null })).toBe(false);
    expect(ok({ themeMode: null, personaOverride: null })).toBe(false);
    expect(ok({ themeMode: null, personaOverride: null, layout: null, extra: 1 })).toBe(false);
    expect(
      ok({
        themeMode: null,
        personaOverride: null,
        layout: { orientation: "diagonal", terminal: "pane" },
      }),
    ).toBe(false);
    expect(
      ok({
        themeMode: null,
        personaOverride: null,
        layout: { orientation: "horizontal", terminal: "popup" },
      }),
    ).toBe(false);
    expect(
      ok({ themeMode: null, personaOverride: null, layout: { orientation: "horizontal" } }),
    ).toBe(false);
    expect(
      ok({
        themeMode: null,
        personaOverride: null,
        layout: { orientation: "horizontal", terminal: "pane", x: 1 },
      }),
    ).toBe(false);
  });

  it("locale param accepts en and en-US only shapes", () => {
    expect(LocaleParamsSchema.safeParse({ locale: "en" }).success).toBe(true);
    expect(LocaleParamsSchema.safeParse({ locale: "en-US" }).success).toBe(true);
    expect(LocaleParamsSchema.safeParse({ locale: "../../etc" }).success).toBe(false);
  });
});
