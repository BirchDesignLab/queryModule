import { ClientSiteConfigSchema } from "@querymodule/core/config";
import { ApiErrorSchema, MetaResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/test-app";

describe("BR-007 public routes", () => {
  it("health answers ok with no data", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
  });
  it("meta reports versions, configHash and null minClientVersion", async () => {
    const t = await createTestApp({ env: { MIN_CLIENT_VERSION: "" } });
    const m = MetaResponseSchema.parse(await (await t.request("/api/v1/meta")).json());
    expect(m).toMatchObject({
      apiVersion: "v1",
      configSchemaVersion: 1,
      configHash: t.deps.config.configHash,
      minClientVersion: null,
    });
  });
  it("NFR-001 locales: listed locale 200, other well-formed locale 404", async () => {
    const t = await createTestApp();
    expect((await t.request("/api/v1/locales/en")).status).toBe(200);
    const r = await t.request("/api/v1/locales/fr");
    expect(r.status).toBe(404);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("notFound");
  });
  it("Carry-forward #64: a malformed locale, including prototype keys, is 400 validationFailed", async () => {
    const t = await createTestApp();
    for (const l of ["__proto__", "constructor", "EN_us", "1", "toolonglocalestring"]) {
      const r = await t.request(`/api/v1/locales/${l}`);
      expect(r.status).toBe(400);
      expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("validationFailed");
    }
  });
  it("config needs a session and returns the ClientSiteConfig allowlist", async () => {
    const t = await createTestApp();
    const anon = await t.request("/api/v1/config");
    expect(anon.status).toBe(401);
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const cookie = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const r = await t.request("/api/v1/config", { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    ClientSiteConfigSchema.parse(body);
    expect(body.configHash).toBe(t.deps.config.configHash);
    for (const k of ["auth", "retention", "extends"]) expect(body).not.toHaveProperty(k);
    expect(JSON.stringify(body.sources)).not.toMatch(/"kind"|"server"|"maxConcurrent"/);
  });
});
