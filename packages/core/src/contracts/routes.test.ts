import { describe, expect, expectTypeOf, it } from "vitest";
import { ClientSiteConfigSchema } from "../config/client-config";
import { ApiErrorSchema } from "./api-error";
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

  it("path parameters match the params schema", () => {
    for (const r of ROUTES) {
      const inPath = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = Object.keys(r.request?.params?.shape ?? {}).sort();
      expect(declared, r.id).toEqual(inPath);
    }
  });

  it("ships the M0/M1 skeleton, all planned", () => {
    expect(ROUTES.map((r) => [r.id, r.method, r.path, r.access, r.since, r.status])).toEqual([
      ["getHealth", "get", "/api/v1/health", "public", "m0", "planned"],
      ["getMeta", "get", "/api/v1/meta", "public", "m0", "planned"],
      ["getLocale", "get", "/api/v1/locales/{locale}", "public", "m0", "planned"],
      ["getConfig", "get", "/api/v1/config", "session", "m1", "planned"],
      ["getMePreferences", "get", "/api/v1/me/preferences", "sessionOwn", "m1", "planned"],
      ["putMePreferences", "put", "/api/v1/me/preferences", "sessionOwn", "m1", "planned"],
    ]);
    expect(findRoute("getConfig").responses[401]?.schema).toBe(ApiErrorSchema);
    expect(findRoute("getConfig").responses[200]?.schema).toBe(ClientSiteConfigSchema);
    expect(() => findRoute("nope" as RouteId)).toThrow("unknown route nope");
  });

  it("route ids are a closed type and ROUTES cannot be changed at runtime", () => {
    expectTypeOf<RouteId>().toEqualTypeOf<
      "getHealth" | "getMeta" | "getLocale" | "getConfig" | "getMePreferences" | "putMePreferences"
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
      health.status = "live";
    }).toThrow(TypeError);
    expect(findRoute("getHealth").status).toBe("planned");
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
