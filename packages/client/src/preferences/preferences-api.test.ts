import { describe, expect, it } from "vitest";
import { createApiClient } from "../api/create-api-client.js";
import { createFakePlatform } from "../testing/fake-platform.js";
import { loadPreferences, savePreferences } from "./preferences-api.js";
import { createPreferencesStore } from "./preferences-store.js";

/** The contract shape of GET/PUT /api/v1/me/preferences (openapi.json getMePreferences200). */
const SERVER = {
  layout: { orientation: "horizontal", terminal: "toggle" },
  personaOverride: null,
  themeMode: "night",
};

function api(seen: Request[], body: unknown = SERVER) {
  return createApiClient({
    baseUrl: "http://api.test",
    platform: createFakePlatform(),
    onUnauthenticated: () => undefined,
    fetch: async (request) => {
      seen.push(request.clone());
      return Response.json(body);
    },
  });
}

describe("UX-014 preference saved to the user profile (spec 5.1, 5.5)", () => {
  it("loads theme and persona override into the store", async () => {
    const store = createPreferencesStore();
    await loadPreferences(api([]), store);
    expect(store.getState()).toMatchObject({ themeMode: "night", personaOverride: null });
  });
  it("loads the layout; a null or malformed layout stays unset", async () => {
    const store = createPreferencesStore();
    await loadPreferences(
      api([], { ...SERVER, layout: { orientation: "vertical", terminal: "pane" } }),
      store,
    );
    expect(store.getState().layout).toEqual({ orientation: "vertical", terminal: "pane" });
    await loadPreferences(api([], { ...SERVER, layout: null }), store);
    expect(store.getState().layout).toBeNull();
    await loadPreferences(api([], { ...SERVER, layout: { terminal: "pane" } }), store);
    expect(store.getState().layout).toBeNull();
  });
  it("saves a layout patch with the rest of the server copy", async () => {
    const seen: Request[] = [];
    const layout = { orientation: "horizontal", terminal: "pane" } as const;
    expect(await savePreferences(api(seen), { layout })).toBe(true);
    expect(await seen.find((r) => r.method === "PUT")?.json()).toEqual({ ...SERVER, layout });
  });
  it("ignores an unknown theme value from the server", async () => {
    const store = createPreferencesStore();
    await loadPreferences(api([], { ...SERVER, themeMode: "sepia" }), store);
    expect(store.getState().themeMode).toBeNull();
  });
  it("saves by merging the patch into the current server copy with X-Requested-With", async () => {
    const seen: Request[] = [];
    expect(await savePreferences(api(seen), { themeMode: "redShift" })).toBe(true);
    const put = seen.find((r) => r.method === "PUT");
    expect(put?.headers.get("x-requested-with")).toBe("querymodule");
    expect(await put?.json()).toEqual({ ...SERVER, themeMode: "redShift" });
  });
  it("keeps both changes when a theme save and a layout save overlap", async () => {
    // A stateful server that answers each call on a later tick: two saves that each read the row
    // before the other wrote it would send the stale half back (the GET-then-PUT race).
    let row: Record<string, unknown> = { ...SERVER };
    const client = createApiClient({
      baseUrl: "http://api.test",
      platform: createFakePlatform(),
      onUnauthenticated: () => undefined,
      fetch: async (request) => {
        const body = request.method === "PUT" ? await request.json() : null;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (body !== null) row = body as Record<string, unknown>;
        return Response.json(row);
      },
    });
    const layout = { orientation: "horizontal", terminal: "pane" } as const;
    const results = await Promise.all([
      savePreferences(client, { themeMode: "redShift" }),
      savePreferences(client, { layout }),
    ]);
    expect(results).toEqual([true, true]);
    expect(row).toMatchObject({ themeMode: "redShift", layout });
  });
  it("a failed save does not hold up the next one", async () => {
    let fail = true;
    const client = createApiClient({
      baseUrl: "http://api.test",
      platform: createFakePlatform(),
      onUnauthenticated: () => undefined,
      fetch: async () => {
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
        return Response.json(SERVER);
      },
    });
    await expect(savePreferences(client, { themeMode: "day" })).rejects.toThrow();
    expect(await savePreferences(client, { themeMode: "day" })).toBe(true);
  });
});
