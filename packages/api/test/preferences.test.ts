import { UserPreferenceSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/test-app";

describe("UX-014 me/preferences", () => {
  it("needs a session", async () => {
    const t = await createTestApp();
    expect((await t.request("/api/v1/me/preferences")).status).toBe(401);
  });
  it("defaults to nulls, then round-trips a PUT", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const cookie = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const empty = UserPreferenceSchema.parse(
      await (await t.request("/api/v1/me/preferences", { headers: { cookie } })).json(),
    );
    expect(empty).toEqual({ themeMode: null, personaOverride: null, layout: null });
    const body = {
      themeMode: "night",
      personaOverride: null,
      layout: { orientation: "vertical", terminal: "pane" },
    };
    const put = await t.request("/api/v1/me/preferences", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json", "x-requested-with": "querymodule" },
      body: JSON.stringify(body),
    });
    expect(put.status).toBe(200);
    expect(UserPreferenceSchema.parse(await put.json())).toEqual(body);
    const get = UserPreferenceSchema.parse(
      await (await t.request("/api/v1/me/preferences", { headers: { cookie } })).json(),
    );
    expect(get).toEqual(body);
  });
  it("400s a malformed PUT body", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const cookie = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const put = await t.request("/api/v1/me/preferences", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json", "x-requested-with": "querymodule" },
      body: JSON.stringify({ themeMode: "loud", personaOverride: null, layout: null }),
    });
    expect(put.status).toBe(400);
  });
  it("never sees another user's row", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    await t.createUser("records@example.test", "correct-horse-battery-1");
    const cookieA = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const cookieB = await t.cookieFor("records@example.test", "correct-horse-battery-1");
    await t.request("/api/v1/me/preferences", {
      method: "PUT",
      headers: {
        cookie: cookieA,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
      },
      body: JSON.stringify({ themeMode: "redShift", personaOverride: null, layout: null }),
    });
    const b = UserPreferenceSchema.parse(
      await (await t.request("/api/v1/me/preferences", { headers: { cookie: cookieB } })).json(),
    );
    expect(b.themeMode).toBeNull();
  });
});
